# Portable core refactor

The work starts from LF-Chat's shared base and is also applied to the existing
LS-Chat customer worktree. It changes the chat core without changing the database
schema or redesigning either product. The customer worktree's pre-existing edits
were preserved; a copy of each edited file was saved outside the checkout before
porting.

## Complexity audit

Completed findings, ranked by code removed:

- `delete:` Unused `ChatWindow` and `InputBar` implementations. The app uses `AssistantThread`. [src/components/AssistantThread.tsx](../src/components/AssistantThread.tsx)
- `shrink:` Repeated stream-event reconciliation and separate state/ref mutations. One mutation path and a pure event function. [src/hooks/useConversations.ts](../src/hooks/useConversations.ts), [src/lib/conversationState.ts](../src/lib/conversationState.ts)
- `shrink:` Three copies of webhook token extraction and EOF parsing. One bounded incremental parser. [server/src/generation/responseParser.ts](../server/src/generation/responseParser.ts)
- `shrink:` Repeated database-to-conversation serialization. One typed serializer for summaries and stream snapshots. [server/src/lib/conversation.ts](../server/src/lib/conversation.ts)
- `delete:` Empty streaming maps, unused status helpers, unused date formatting and generation introspection methods, and duplicated client title derivation. Titles come from the server snapshot; the hook exposes a boolean streaming state.
- `delete:` Unused `rehype-highlight`, `autoprefixer`, and the obsolete JSZip type stub. Build plugins and syntax-highlighter types belong in dev dependencies.

net: -620 runtime TypeScript lines, -3 unused dependencies. Tests and lockfiles are excluded from the line count; explicit React/Node type dependencies were added.

## Correctness fixes

These were reviewed separately from the complexity audit:

- A subscriber leaving before LF's stream-token request finishes no longer strands another subscriber. The last unsubscribe safely closes a pending connection; stale cleanup cannot close its replacement. LS had a related bug where removing the first subscriber stopped dispatch to all remaining subscribers.
- A cancelled generation's late callback cannot write into or finish a newer run. Generation timeouts now record a failure and release the active slot. Cancellation clears its timer and retains pending tokens, including a stop before the first token.
- The runner releases stalled or oversized bodies. The size limit also bounds incomplete buffered lines and final JSON responses. Split UTF-8, CRLF, `data:` without a space, pretty JSON, nested/OpenAI token fields, and a final unterminated SSE line are handled consistently. Plain text retains indentation and blank lines. The speculative model/proxy diagnosis previously appended to network errors was removed.
- Paginated edit/retry snapshots retain only messages before their overlapping tail, discarding obsolete newer replies.
- Failure events display the actual server error rather than just changing the role of an empty message.
- The conversation hook updates React state and its async-readable ref together. Initial and history loads ignore responses from a previous authentication session. Unused optimistic title parsing is gone.
- Backup imports fetch complete server histories, including conversations outside the loaded sidebar page. A create conflict merges rather than replacing the server conversation. Duplicate message IDs are filtered and failed writes reach the UI instead of reporting success. LF settings imports persist through the API; LS continues to ignore imported settings.
- LF ignores a late 401 from an old token when a newer login has already replaced it. Request headers now accept every `RequestInit.headers` form.

## Porting boundaries

The following files are identical across both worktrees and can be copied as-is:

- `src/hooks/useConversations.ts`
- `src/lib/conversationState.ts` and its tests
- `src/lib/importConversations.ts` and its tests
- `src/lib/utils.ts`
- `server/src/lib/conversation.ts`
- `server/src/generation/eventBus.ts`, `snapshot.ts`, `responseParser.ts`, and the parser/runner tests
- `src/services/streamClient.test.ts`

Keep these fork-specific seams when transferring subsequent patches:

| File | LF-Chat | LS-Chat |
| --- | --- | --- |
| `src/services/streamClient.ts` | Fetches a short-lived SSE token | Same-origin session cookie; no token endpoint |
| `src/services/apiClient.ts` | Bearer tokens and self-service auth | Cookie sessions, SSO and admin catalog methods |
| `server/src/generation/manager.ts` | Resolves a user-configured webhook | Resolves an allowed admin-managed backend |
| `server/src/generation/runner.ts` | Webhook setup error | Backend setup error |
| `server/src/routes/conversations.ts` | Verifies the SSE token | Runs cookie auth middleware |
| `server/src/generation/generation.test.ts` | LF user/settings fixtures | WordPress user/catalog fixtures |
| `src/components/settings/DataSection.tsx` | Imports settings and retains account deletion UI | Conversation import only; no account deletion |
| `src/types.ts` / `src/App.tsx` | LF themes, branding and controls | LS's existing narrower themes, branding and controls |
| package manifests / lockfiles | LF dependency set | LS dependency set; includes its SSO test |

No auth, catalog, branding, or language features should be transferred by copying
those fork-specific files wholesale. Both lockfiles now belong in version control
because Docker uses `npm ci`. `build:server` builds installed dependencies; install
both workspaces before building. Frontend and backend typechecking are separate,
and both use strict mode.

## Validation

- LF baseline: original frontend/backend typechecks, frontend build, conversation-restore and compression checks passed.
- Both versions: strict frontend/backend typechecks, frontend/backend production builds, and 17 test cases passed.
- Regressions cover subscription races, stopped/reconnected messages, paginated snapshots, final-token persistence, cancellation/replacement, early cancellation, generation timeout, stall cancellation, response parsing/limits, and backup merge/conflict/errors. LF additionally checks stale-token 401 handling; LS runs its existing SSO checks.
- Headless Chromium against temporary SQLite databases and fake webhook responses: LF send/stream/reload, retry, edit-and-branch, stop/reload, repeated empty-draft reloads, mobile drawer, and ZIP export/import retaining unloaded history; LS signed SSO login, cookie authentication, non-admin restrictions, hidden single-backend picker, and send/stream/reload. No live WordPress, n8n or Baserow service was used.
- Clean `npm ci` installs for both workspaces were checked. Both Docker images build on Node 22 Alpine. The same 17 tests per fork also pass there, using compiled server tests and the client sources; the SQLite native binding loads.
- Both builds retain the existing Vite large-chunk warnings. Language coverage in Prism and math rendering are preserved.

## Remaining audit findings

These need separate behavior coverage before broader changes:

1. `useSettings` still combines session loading, browser fallback caching, themes and debounced writes. Its LF cache is shared between accounts; overlapping save responses can report a stale save status. Split the persistence behavior only after testing account changes and failed saves.
2. LF authentication still has large route/page modules and migrations that catch every SQL error. It is fork-specific, so rewriting it offers little benefit to LS. Test migration failures, verification and password reset before changing those paths.
3. Full conversation arrays are stored as JSON. Backup merging now avoids the partial-UI-history bug, but a REST read followed by a PUT is not a transaction across concurrent tabs. A version check or transactional merge endpoint is the next step for stronger concurrency guarantees.
4. Deleting a streaming conversation does not explicitly cancel its upstream generation. The manager eventually finishes it; a focused deletion lifecycle test should precede changing this.
5. LF's short-lived SSE token is reused by EventSource reconnects. Reconnection after token expiry needs a dedicated refresh/re-auth test and implementation. LS uses cookies and does not share this limitation.
6. The webhook URL guard checks DNS before fetching; redirect targets and connect-time DNS rebinding are not checked. This is an existing security boundary, not resolved by parser cleanup.
7. The markdown chunk remains roughly 1.08 MB before gzip. Restricting Prism languages or changing the rendering stack would affect supported content and needs explicit product/compatibility coverage.

This pass establishes a smaller, tested shared core. It does not certify every
legacy route or integration, and it does not deploy either worktree.
