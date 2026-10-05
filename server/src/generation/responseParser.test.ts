import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResponseParser } from './responseParser';

test('SSE handles fragmented lines, CRLF, nested/OpenAI tokens and final unterminated events', () => {
  const parser = new ResponseParser('text/event-stream', 10_000);
  const body = ': heartbeat\r\ndata: {"output":"Hi "}\r\n\r\ndata:{"content":{"text":"there"}}\n\ndata: {"choices":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n\ndata: last';
  for (const char of body) parser.push(char);
  assert.equal(parser.finish(), 'Hi there!last');
});

test('pretty JSON, NDJSON and plain text preserve supported response formats', () => {
  const cases = [
    ['application/json', '{\n "output": {"text":"answer"}\n}', 'answer'],
    ['application/x-ndjson', '{"token":"one"}\n{"text":"two"}', 'onetwo'],
    ['text/plain', '  indented\n\nlast line  ', '  indented\n\nlast line  '],
  ];
  for (const [type, input, expected] of cases) {
    const parser = new ResponseParser(type, 10_000);
    for (let i = 0; i < input.length; i += 3) parser.push(input.slice(i, i + 3));
    assert.equal(parser.finish(), expected);
  }
});

test('oversized unfinished lines, completed content and final JSON are bounded', () => {
  assert.throws(() => new ResponseParser('text/event-stream', 10).push('data:' + 'x'.repeat(11)), /maximum allowed size/);
  const parser = new ResponseParser('text/plain', 10);
  parser.push('abcde\n');
  assert.throws(() => parser.push('fghij\n'), /maximum allowed size/);
  assert.throws(() => new ResponseParser('application/json', 10).push('{"output":"too long"}'), /maximum allowed size/);
});


test('n8n error events fail the generation instead of becoming an assistant reply', () => {
  const parser = new ResponseParser('application/x-ndjson', 1000);
  assert.throws(() => parser.push('{"type":"error","content":"Model unavailable"}\n'), /Model unavailable/);
});

test('n8n JSON event streams work under application/json and emit content before EOF', () => {
  const begin = '{"type":"begin","metadata":{"nodeName":"AI Agent"}}\r\n';
  const item = '{"type":"item","content":"Grüße 🌍\\n"}\r\n';
  const end = '{"type":"end","metadata":{"nodeName":"AI Agent"}}';
  for (const chunkSize of [1, 3, 17, 1000]) {
    const parser = new ResponseParser('application/json; charset=utf-8', 10_000);
    const streamed = begin + item;
    let content = '';
    for (let i = 0; i < streamed.length; i += chunkSize) content = parser.push(streamed.slice(i, i + chunkSize));
    assert.equal(content, 'Grüße 🌍\n', 'text must stream before the response closes');
    parser.push(end);
    assert.equal(parser.finish(), 'Grüße 🌍\n');
  }
});

test('application/json event streams propagate backend errors and reject malformed trailing JSON', () => {
  const parser = new ResponseParser('application/json', 1000);
  parser.push('{"type":"begin"}\n');
  assert.throws(() => parser.push('{"type":"error","content":"Model unavailable"}\n'), /Model unavailable/);
  const malformed = new ResponseParser('application/json', 1000);
  malformed.push('{"type":"item","content":"Partial"}\n{broken JSON\n');
  assert.throws(() => malformed.finish(), /Invalid JSON response/);
});
