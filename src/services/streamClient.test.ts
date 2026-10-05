import assert from 'node:assert/strict';
import { test } from 'node:test';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, (event: { data: string }) => void>();
  closed = false;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: { data: string }) => void) { this.listeners.set(type, listener); }
  close() { this.closed = true; }
  emit(type: string, value: unknown) { this.listeners.get(type)?.({ data: JSON.stringify(value) }); }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('shared streams survive unsubscribe, pending closure and replacement', async t => {
  const storage = new Map<string, string>();
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const sourceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource });
  t.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (sourceDescriptor) Object.defineProperty(globalThis, 'EventSource', sourceDescriptor);
    else Reflect.deleteProperty(globalThis, 'EventSource');
  });
  const requests: ((response: Response) => void)[] = [];
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => requests.push(resolve)));
  const { StreamClient } = await import('./streamClient');
  const client = new StreamClient();
  const received: unknown[] = [];
  const first = client.subscribe('a', () => assert.fail('removed subscriber must not run'));
  const second = client.subscribe('a', event => received.push(event), { messageLimit: 12 });
  first();
  // LS uses cookie auth and opens without a token request.
  requests.shift()?.(Response.json({ token: 'token' }));
  await settle();
  const source = FakeEventSource.instances.at(-1)!;
  source.emit('delta', { type: 'delta', conversationId: 'a', content: 'hello' });
  assert.equal(received.length, 1);
  second();
  assert.equal(source.closed, true);

  const old = client.subscribe('b', () => assert.fail('closed subscriber must not run'));
  client.close('b');
  const replacementReceived: unknown[] = [];
  const replacement = client.subscribe('b', event => replacementReceived.push(event));
  old(); // A stale cleanup cannot remove a replacement connection.
  for (const resolve of requests.splice(0)) resolve(Response.json({ token: 'token' }));
  await settle();
  const current = FakeEventSource.instances.at(-1)!;
  assert.equal(current.closed, false);
  current.emit('completed', { type: 'completed', conversationId: 'b' });
  assert.equal(replacementReceived.length, 1);
  replacement();
  assert.equal(current.closed, true);

  const count = FakeEventSource.instances.length;
  const cancel1 = client.subscribe('pending', () => {});
  const cancel2 = client.subscribe('pending', () => {});
  cancel1();
  cancel2(); // Last subscriber may leave before the token arrives.
  for (const resolve of requests.splice(0)) resolve(Response.json({ token: 'token' }));
  await settle();
  assert.equal(FakeEventSource.instances.length, count);
});
