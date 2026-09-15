import { Message } from './manager';
import { validateWebhookUrl } from '../lib/urlGuard';

export interface RunnerCallbacks {
  onSnapshot: (fullContent: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export interface RunGenerationParams {
  conversationId: string;
  assistantMessageId: string;
  userMessageContent: string;
  history: Message[];
  webhookUrl: string;
  abortSignal: AbortSignal;
  callbacks: RunnerCallbacks;
}

const STREAM_STALL_TIMEOUT_MS = parseInt(process.env.STREAM_STALL_TIMEOUT_MS || '60000', 10);
// Cap the accumulated response so a runaway (or malicious) webhook can't grow
// the in-memory buffer without bound and OOM the server.
const MAX_RESPONSE_CHARS = parseInt(process.env.MAX_RESPONSE_CHARS || '5000000', 10);

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<{ done: boolean; value?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Stream stalled: no data received for ${timeoutMs}ms`));
    }, timeoutMs);

    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function runGeneration(params: RunGenerationParams): Promise<void> {
  const { conversationId, history, webhookUrl, abortSignal, callbacks, userMessageContent } = params;

  const historyStr = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  if (!webhookUrl) {
    callbacks.onError(new Error('Webhook URL is not configured. Please set it in Settings.'));
    return;
  }

  try {
    // SSRF guard: reject non-http(s) schemes and hosts that resolve to private/
    // loopback/link-local addresses before the server makes the request.
    await validateWebhookUrl(webhookUrl);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, text/plain',
      },
      body: JSON.stringify({ message: userMessageContent, history: historyStr, stream: true }),
      signal: abortSignal,
    });

    if (!response.ok) {
      let errorMessage = `Webhook responded with status: ${response.status}`;
      try {
        const errorData = await response.json() as Record<string, string>;
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        // ignore JSON parsing errors for error response
      }
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is null');
    }

    const decoder = new TextDecoder();
    const contentType = response.headers.get('content-type') || '';
    const isSSE = contentType.includes('text/event-stream');
    let fullContent = '';
    let buffer = '';
    let lastUpdateTime = Date.now();

    const dispatchToken = (_token: string, content: string, force = false) => {
      const now = Date.now();
      if (force || now - lastUpdateTime > 50) {
        callbacks.onSnapshot(content);
        lastUpdateTime = now;
      }
    };

    while (true) {
      if (abortSignal.aborted) {
        break;
      }

      let result: { done: boolean; value?: Uint8Array };
      try {
        result = await readWithTimeout(reader, STREAM_STALL_TIMEOUT_MS);
      } catch (err: any) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const { done, value } = result;
      if (done) break;
      if (abortSignal.aborted) {
        await reader.cancel();
        break;
      }

      const chunk = decoder.decode(value!, { stream: true });
      buffer += chunk;

      if (isSSE) {
        let lineEndIndex;
        while ((lineEndIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, lineEndIndex).trim();
          buffer = buffer.slice(lineEndIndex + 1);

          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              let token = parsed.output || parsed.text || parsed.content || parsed.token || (parsed.choices?.[0]?.delta?.content);
              if (token && typeof token === 'object') {
                token = token.text || token.content || token.output || null;
              }

              if (typeof token === 'string' && token) {
                fullContent += token;
                dispatchToken(token, fullContent);
              }
            } catch {
              const trimmedData = data.trim();
              if (trimmedData && !trimmedData.startsWith('{') && !trimmedData.startsWith('[') && trimmedData !== '[DONE]') {
                fullContent += data;
                dispatchToken(data, fullContent);
              }
            }
          }
        }
      } else {
        let lineBreakIndex;
        while ((lineBreakIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, lineBreakIndex).trim();
          buffer = buffer.slice(lineBreakIndex + 1);

          if (!line) continue;

          try {
            const json = JSON.parse(line);
            let token = json.output || json.text || json.content || json.token || (json.choices?.[0]?.delta?.content);

            if (token && typeof token === 'object') {
              token = token.text || token.content || token.output || null;
            }

            if (typeof token === 'string' && token) {
              fullContent += token;
              dispatchToken(token, fullContent);
            }
          } catch {
            fullContent += line + '\n';
            dispatchToken(line + '\n', fullContent);
          }
        }
      }

      if (fullContent.length > MAX_RESPONSE_CHARS) {
        try { await reader.cancel(); } catch {}
        callbacks.onError(new Error('Response from webhook exceeded the maximum allowed size.'));
        return;
      }
    }

    if (buffer.trim() && !isSSE) {
      try {
        const json = JSON.parse(buffer.trim());
        const token = json.output || json.text || json.content || json.token;
        if (typeof token === 'string' && token) {
          fullContent += token;
          dispatchToken(token, fullContent, true);
        }
      } catch {
        const finalTrimmedData = buffer.trim();
        if (finalTrimmedData && !finalTrimmedData.startsWith('{')) {
          fullContent += finalTrimmedData;
          dispatchToken(finalTrimmedData, fullContent, true);
        }
      }
    }

    if (abortSignal.aborted) {
      return;
    }

    dispatchToken('', fullContent, true);
    callbacks.onComplete();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return;
    }

    let errorObj = error instanceof Error ? error : new Error(String(error));

    if (errorObj.message.includes('error in input stream') || errorObj.message.includes('network error')) {
      errorObj = new Error(
        errorObj.message +
        '\n\n(System Note: "error in input stream" indicates that the network connection was closed abruptly. Since this only happens with slower models like Claude Opus, it is highly likely that your reverse proxy (e.g. Cloudflare, Nginx, Ngrok) or N8N deployment has a timeout that is dropping the connection while waiting for the first token. Please check and increase your proxy/server timeout settings.)'
      );
    }

    callbacks.onError(errorObj);
  }
}