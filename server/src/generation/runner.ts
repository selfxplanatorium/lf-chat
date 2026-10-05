import type { StoredAttachment } from '../lib/attachments';
import type { Message } from '../lib/conversation';
import { validateWebhookUrl } from '../lib/urlGuard';
import { prepareWebhookFile } from '../lib/webhookFile';
import { ResponseParser } from './responseParser';

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
  attachments?: StoredAttachment[];
  historyAttachments?: StoredAttachment[];
  webhookUrl: string;
  abortSignal: AbortSignal;
  callbacks: RunnerCallbacks;
}

const STREAM_STALL_TIMEOUT_MS = parseInt(process.env.STREAM_STALL_TIMEOUT_MS || '60000', 10);
const MAX_RESPONSE_CHARS = parseInt(process.env.MAX_RESPONSE_CHARS || '5000000', 10);

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ done: boolean; value?: Uint8Array }> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Stream stalled: no data received for ${STREAM_STALL_TIMEOUT_MS}ms`)), STREAM_STALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function runGeneration(params: RunGenerationParams): Promise<void> {
  const { history, webhookUrl, abortSignal, callbacks, userMessageContent } = params;
  const attachments = params.attachments ?? [];
  const historyFiles = params.historyAttachments ?? [];
  const fileText = (files: StoredAttachment[]) => files.map(file => `\n[Attachment: ${JSON.stringify(file.name)}]\n${file.text || "Image supplied separately."}`).join("\n");
  const historyStr = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}${fileText(historyFiles.filter(file => m.attachments?.some(a => a.id === file.id)))}`)
    .join('\n');

  if (!webhookUrl) {
    callbacks.onError(new Error('Webhook URL is not configured. Please set it in Settings.'));
    return;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await validateWebhookUrl(webhookUrl);
    const message = userMessageContent + fileText(attachments);
    const files = [...new Map([...historyFiles.filter(file => file.contentType.startsWith('image/')), ...attachments].map(file => [file.id, file])).values()];
    let body: string | FormData = JSON.stringify({ message, history: historyStr, stream: true });
    const headers: Record<string, string> = { 'Accept': 'text/event-stream, text/plain' };
    if (files.length) {
      const form = new FormData();
      form.set('message', message || 'Please analyze the attached files.');
      form.set('history', historyStr);
      form.set('stream', 'true');
      if (files.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) throw new Error('File context exceeds 10 MB; start a new chat with the files you need');
      for (const [index, original] of files.entries()) {
        const file = await prepareWebhookFile(original);
        if (abortSignal.aborted) return;
        form.append(`file${index}`, new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.name);
      }
      body = form;
    } else headers['Content-Type'] = 'application/json';
    const response = await fetch(webhookUrl, { method: 'POST', headers, body, signal: abortSignal });

    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
      throw new Error(data.error || data.message || `Webhook responded with status: ${response.status}`);
    }

    reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

    const decoder = new TextDecoder();
    const parser = new ResponseParser(response.headers.get('content-type') || '', MAX_RESPONSE_CHARS);
    let lastUpdateTime = Date.now();

    while (!abortSignal.aborted) {
      const { done, value } = await readWithTimeout(reader);
      if (done || abortSignal.aborted) break;
      const content = parser.push(decoder.decode(value, { stream: true }));
      const now = Date.now();
      if (now - lastUpdateTime > 50) {
        callbacks.onSnapshot(content);
        lastUpdateTime = now;
      }
    }

    if (abortSignal.aborted) return;
    parser.push(decoder.decode());
    callbacks.onSnapshot(parser.finish());
    callbacks.onComplete();
  } catch (error: unknown) {
    if (!abortSignal.aborted) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  } finally {
    // Also release stalled/oversized responses and aborted mocked transports.
    // Waiting for cancellation can itself hang on a broken upstream.
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
