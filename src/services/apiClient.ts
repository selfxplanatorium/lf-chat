import type { Conversation, Message, FileAttachment } from '../types';

const API_BASE = '/api';

let authToken: string | null = localStorage.getItem('lfchat_token');

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('lfchat_token', token);
  } else {
    localStorage.removeItem('lfchat_token');
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

// Allow the auth layer to react to a 401 mid-session (expired/revoked token).
// Without this, a stale token is cleared from storage but the React user state
// stays populated, trapping the user in a UI where every request fails.
type AuthFailureHandler = () => void;
let authFailureHandler: AuthFailureHandler | null = null;

export function setAuthFailureHandler(handler: AuthFailureHandler | null) {
  authFailureHandler = handler;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, options?: RequestInit, responseType: 'json' | 'blob' = 'json'): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const requestToken = authToken;
  if (requestToken) headers.set('Authorization', `Bearer ${requestToken}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    if (response.status === 401 && authToken === requestToken) {
      setAuthToken(null);
      // Notify the auth layer so it can log the user out and surface the login
      // screen instead of leaving a stale, failing session mounted.
      authFailureHandler?.();
    }
    throw new ApiError(error.error || `Request failed with status ${response.status}`, response.status);
  }

  return (responseType === 'blob' ? response.blob() : response.json()) as Promise<T>;
}

export async function getAllConversations(): Promise<ConversationData[]> {
  const all: ConversationData[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const page = await getConversations(limit, offset);
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

export interface AuthResponse {
  token: string;
  user: { id: string; email: string; name: string; isAdmin?: boolean };
}

export interface RegisterResponse {
  message: string;
  email: string;
}

export interface LoginError {
  error: string;
  needsVerification?: boolean;
  email?: string;
}

export function register(email: string, password: string, name?: string): Promise<RegisterResponse> {
  return apiRequest<RegisterResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export function verifyEmail(email: string, code: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
}

export function resendCode(email: string, purpose: string): Promise<{ message: string }> {
  return apiRequest('/auth/resend-code', {
    method: 'POST',
    body: JSON.stringify({ email, purpose }),
  });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function getMe(): Promise<{ user: { id: string; email: string; name: string; isAdmin?: boolean } }> {
  return apiRequest('/auth/me');
}

export function deleteAccount(confirmation: string): Promise<{ success: boolean }> {
  return apiRequest('/auth/account', {
    method: 'DELETE',
    body: JSON.stringify({ confirmation }),
  });
}

// Public, unauthenticated auth flags (e.g. whether the server allows new
// signups). Used by the login page to hide the "Create an account" affordance
// when ALLOW_SIGNUPS=false. Falls back to true if the request fails so a local
// dev server that's down doesn't accidentally hide registration.
export async function getAuthFlags(): Promise<{ allowSignups: boolean }> {
  try {
    return await apiRequest<{ allowSignups: boolean }>('/auth/flags');
  } catch {
    return { allowSignups: true };
  }
}

// Admin-only write for the signup flag. The server re-checks the role, so a
// non-admin reaching this just gets a 403.
export function setAuthFlags(allowSignups: boolean): Promise<{ allowSignups: boolean }> {
  return apiRequest('/auth/flags', {
    method: 'PUT',
    body: JSON.stringify({ allowSignups }),
  });
}

// Changing the password invalidates every session including this tab's, so the
// server returns a replacement token that the caller must install immediately.
export function changePassword(currentPassword: string, newPassword: string): Promise<{ token: string }> {
  return apiRequest('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function forgotPassword(email: string): Promise<{ message: string; email?: string }> {
  return apiRequest('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function verifyResetCode(email: string, code: string): Promise<{ message: string }> {
  return apiRequest('/auth/verify-reset-code', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
}

export function resetPassword(email: string, code: string, password: string): Promise<{ message: string }> {
  return apiRequest('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, code, password }),
  });
}

export interface UserSettings {
  webhooks: { id: string; name: string; url: string; icon?: string }[];
  activeWebhookId: string;
  themeMode: string;
  themePreset: string;
  themeAuto?: boolean;
  sendWithCtrlEnter: boolean;
  confirmDeleteChat: boolean;
  confirmEditMessage: boolean;
  profileName: string;
  profileImage: string;
  hasSeenTour?: boolean;
}

export function getSettings(): Promise<UserSettings> {
  return apiRequest<UserSettings>('/settings');
}

export function updateSettings(data: Partial<UserSettings>): Promise<{ success: boolean }> {
  return apiRequest('/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export type ConversationData = Omit<Conversation, 'streamingStatus' | 'streamingMessageId'> &
  Partial<Pick<Conversation, 'streamingStatus' | 'streamingMessageId'>>;

export function getConversations(limit?: number, offset?: number): Promise<ConversationData[]> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const qs = params.toString();
  return apiRequest<ConversationData[]>(`/conversations${qs ? `?${qs}` : ''}`);
}

export function createConversation(data: { id?: string; title?: string; isUntitled?: boolean; messages?: Message[] }): Promise<ConversationData> {
  return apiRequest<ConversationData>('/conversations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateConversation(id: string, data: { title?: string; isUntitled?: boolean; messages?: Message[]; pinned?: boolean }): Promise<{ success: boolean }> {
  return apiRequest(`/conversations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteConversation(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/conversations/${id}`, {
    method: 'DELETE',
  });
}

export interface SendMessageResponse {
  userMessageId: string | null;
  assistantMessageId: string;
  alreadyRunning: boolean;
}

export function sendMessage(conversationId: string, content: string, idempotencyKey: string, attachmentIds?: string[]): Promise<SendMessageResponse> {
  return apiRequest<SendMessageResponse>(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, idempotencyKey, attachmentIds }),
  });
}

export function cancelGeneration(conversationId: string): Promise<{ success: boolean; cancelled: boolean }> {
  return apiRequest(`/conversations/${conversationId}/cancel`, {
    method: 'POST',
  });
}

export function retryGeneration(conversationId: string, messageId?: string): Promise<{ assistantMessageId: string }> {
  return apiRequest(`/conversations/${conversationId}/retry`, {
    method: 'POST',
    body: messageId ? JSON.stringify({ messageId }) : undefined,
  });
}

export function editMessage(conversationId: string, messageId: string, content: string): Promise<{ assistantMessageId?: string }> {
  return apiRequest(`/conversations/${conversationId}/edit`, {
    method: 'POST',
    body: JSON.stringify({ messageId, content }),
  });
}

export function branchConversation(conversationId: string, messageId: string, content?: string): Promise<ConversationData> {
  return apiRequest<ConversationData>(`/conversations/${conversationId}/branch`, {
    method: 'POST',
    body: JSON.stringify(content === undefined ? { messageId } : { messageId, content }),
  });
}

export function getConversationMessages(conversationId: string, limit: number, offset: number): Promise<{ messages: Message[]; total: number }> {
  return apiRequest(`/conversations/${conversationId}/messages?limit=${limit}&offset=${offset}`);
}

export async function getAllConversationMessages(conversationId: string): Promise<Message[]> {
  const messages: Message[] = [];
  const limit = 1000;
  while (true) {
    const page = await getConversationMessages(conversationId, limit, messages.length);
    messages.push(...page.messages);
    if (messages.length >= page.total) return messages;
    if (page.messages.length === 0) throw new Error('Conversation history changed while loading');
  }
}

export function uploadAttachment(file: File, id = crypto.randomUUID(), signal?: AbortSignal): Promise<FileAttachment> {
  return apiRequest('/attachments', { method: 'POST', body: file, signal, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Id': id } });
}
export function removeAttachment(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function getAttachmentBlob(id: string): Promise<Blob> {
  return apiRequest(`/attachments/${encodeURIComponent(id)}`, undefined, 'blob');
}
export async function downloadAttachment(file: FileAttachment): Promise<void> {
  const url = URL.createObjectURL(await getAttachmentBlob(file.id));
  const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
