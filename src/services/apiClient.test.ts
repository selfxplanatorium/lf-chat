import assert from 'node:assert/strict';
import { test } from 'node:test';

test('request headers retain caller options and a stale 401 cannot clear a replacement login', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const api = await import('./apiClient');
  let authFailures = 0;
  api.setAuthFailureHandler(() => authFailures++);
  t.after(() => api.setAuthFailureHandler(null));
  let reply: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', (_url: string, options: RequestInit) => {
    const headers = new Headers(options.headers);
    assert.equal(headers.get('X-Test'), 'present');
    assert.equal(headers.get('Authorization'), 'Bearer old-session');
    assert.equal(headers.get('Content-Type'), 'application/json');
    return new Promise<Response>(resolve => { reply = resolve; });
  });
  api.setAuthToken('old-session');
  const pending = api.apiRequest('/conversations', { headers: new Headers({ 'X-Test': 'present' }) });
  api.setAuthToken('new-session');
  reply!(Response.json({ error: 'Invalid or expired token' }, { status: 401 }));
  await assert.rejects(pending, /Invalid or expired token/);
  assert.equal(api.getAuthToken(), 'new-session');
  assert.equal(authFailures, 0);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Invalid or expired token' }, { status: 401 }));
  await assert.rejects(api.apiRequest('/conversations'), /Invalid or expired token/);
  assert.equal(api.getAuthToken(), null);
  assert.equal(authFailures, 1);
});
