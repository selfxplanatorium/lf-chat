function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function extractToken(value: unknown): string {
  const data = record(value);
  if (data.type === "error" || data.error) throw new Error(String(data.content || record(data.error).message || data.error || "Backend generation failed"));
  const choice = Array.isArray(data.choices) ? record(data.choices[0]) : {};
  let token = data.output || data.text || data.content || data.token || record(choice.delta).content;
  if (token && typeof token === 'object') {
    const nested = record(token);
    token = nested.text || nested.content || nested.output;
  }
  return typeof token === 'string' ? token : '';
}

/** Incremental decoding of the webhook formats LF-Chat already accepts. */
export class ResponseParser {
  private buffer = '';
  private content = '';
  private readonly mode: 'sse' | 'json' | 'lines';

  constructor(contentType: string, private readonly maxChars: number) {
    this.mode = contentType.includes('text/event-stream') ? 'sse'
      : contentType.includes('application/json') ? 'json' : 'lines';
  }

  push(chunk: string): string {
    this.buffer += chunk;
    this.checkSize();
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      if (this.mode === 'json') {
        if (!line.trim()) {
          this.buffer = this.buffer.slice(end + 1);
          continue;
        }
        // n8n labels newline-delimited events application/json. Consume
        // complete events now; retain pretty JSON documents for finish().
        try { JSON.parse(line); } catch { break; }
      }
      this.buffer = this.buffer.slice(end + 1);
      this.readLine(line, true);
    }
    return this.content;
  }

  finish(): string {
    const remaining = this.buffer;
    this.buffer = '';
    if (remaining.trim()) this.readLine(remaining, false);
    return this.content;
  }

  private readLine(line: string, newline: boolean): void {
    let data = line;
    if (this.mode === 'sse') {
      if (!line.startsWith('data:')) return;
      data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
    }

    let token: string;
    try {
      const parsed = JSON.parse(data);
      if (record(parsed).type === "error" || record(parsed).error) {
        throw Object.assign(new Error(String(record(parsed).content || record(record(parsed).error).message || record(parsed).error || "Backend generation failed")), { backendError: true });
      }
      token = extractToken(parsed);
    } catch (error) {
      if (error && typeof error === "object" && "backendError" in error) throw error;
      // Malformed JSON events are ignored; ordinary text remains readable.
      if (this.mode === 'sse' && /^[{[]/.test(data)) return;
      if (this.mode === 'json') throw new Error('Invalid JSON response from webhook');
      token = data + (newline && this.mode === 'lines' ? '\n' : '');
    }
    this.content += token;
    this.checkSize();
  }

  private checkSize(): void {
    if (this.content.length + this.buffer.length > this.maxChars) {
      throw new Error('Response from webhook exceeded the maximum allowed size.');
    }
  }
}
