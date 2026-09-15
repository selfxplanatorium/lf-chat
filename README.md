<p align="center">
  <img src="assets/lf-chat-wordmark.svg" alt="LF-CHAT" width="460">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-F43F5E.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A522-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 22 or newer">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=101011" alt="React 19">
  <img src="https://img.shields.io/badge/n8n-integrated-FF6D5A?logo=n8n&logoColor=white" alt="n8n integrated">
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker ready">
</p>

LF Chat is a self-hosted assistant chat application built around configurable n8n webhooks. It provides a multi-conversation interface while leaving model selection, tools, business logic, and automation inside n8n.

## Why LF Chat?

Most chat applications do not offer meaningful n8n integration, while n8n's official chat experience is too limited and rough for comfortable daily use. LF Chat exists to bridge that gap: a polished, self-hosted conversation interface with n8n as a first-class backend, so workflows remain in control without sacrificing the chat experience.

## What it does

- Connects one or more user-configured n8n webhook workflows to a chat UI.
- Streams webhook responses into the active conversation over server-sent events (SSE).
- Stores users, settings, conversations, messages, and verification codes in SQLite.
- Supports email verification and password reset flows, with server-side account deletion.
- Includes light/dark themes, localization (English, German, and Italian), conversation search, editing, branching, retry/cancel controls, markdown, code blocks, tables, math, import/export, and responsive navigation.

LF Chat is provider-agnostic. The n8n workflow is the integration boundary: it can call OpenAI, Anthropic, local models, internal APIs, or other services supported by n8n.

## Architecture

```text
Browser (React/Vite)
        |
        | JSON REST API + authenticated SSE
        v
LF Chat server (Express/TypeScript)
        |
        | POST webhook request
        v
Configured n8n workflow -> model/tools/business systems
```

The frontend lives in `src/`. The backend lives in `server/src/`. The backend serves the production frontend from `dist/` and stores its SQLite database under `DATA_DIR` (the Docker deployment mounts this at `/app/data`).

## Requirements

- Node.js 22 or newer
- npm
- An n8n instance with an HTTP Webhook or Chat Trigger workflow
- SMTP credentials if email verification and password reset emails should be delivered

## Local development

Install dependencies for both workspaces:

```bash
npm install
cd server && npm install && cd ..
```

Create an environment file:

```bash
cp .env.example .env
```

At minimum, set a private `JWT_SECRET`. For local development, leave `EMAIL_SMTP=false` (or omit SMTP configuration); verification and password-reset codes are printed by the API process with a `[DEV]` prefix.

Start the frontend and API together:

```bash
npm run dev
```

The Vite frontend runs on `http://localhost:3000` and the API runs on `http://localhost:3001`. Vite proxies `/api` requests to the API during development. To run either process independently:

```bash
npm run dev:web
npm run dev:api
```

Useful checks:

```bash
npm run lint
npm run build
npm run build:server
```

## Docker deployment

The production image builds the frontend and backend and runs the backend as a single service.

```bash
docker compose up -d --build
docker compose logs -f lf-chat
```

The supplied compose file binds the application to `127.0.0.1:3501` and persists the database in the `lf-chat-data` volume. Put a TLS reverse proxy in front of it when exposing the app outside the host. Set `APP_URL` to the public origin; it is used for CORS and password-reset links.

To stop the deployment:

```bash
docker compose down
```

Do not remove the `lf-chat-data` volume unless the database is intentionally being destroyed.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Secret used to sign authentication and SSE tokens. Use a long random value in production. |
| `APP_URL` | Public frontend origin for CORS and email links. |
| `ALLOW_SIGNUPS` | Enables new account registration. Set to `false` for a closed deployment. |
| `PORT` | API/listening port. Defaults to `3000` in production and is set to `3001` by the local dev script. |
| `DATA_DIR` | Directory containing `lf-chat.db`; defaults to `data/` in a source checkout. |
| `DEBUG_INTROSPECTION` | Set to `1` to enable development-only generation diagnostics under `/api/_debug`. Keep disabled on public deployments. |
| `EMAIL_SMTP` | Set to `true` to send verification and reset emails. |
| `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, `EMAIL_SMTP_USE_SSL` | SMTP connection settings. |
| `FROM_EMAIL` | Sender address for transactional email. |
| `GENERATION_TIMEOUT_MS` | Maximum generation duration; defaults to 10 minutes. |
| `STREAM_STALL_TIMEOUT_MS` | Maximum time without webhook data; defaults to 60 seconds. |
| `MAX_RESPONSE_CHARS` | Maximum accumulated assistant response size. |

## n8n webhook contract

The current LF Chat runner sends a JSON `POST` request to the active webhook:

```json
{
  "message": "The user's message",
  "history": "User: ...\\nAssistant: ...",
  "stream": true
}
```

The webhook should return either plain text/JSON or an SSE response. LF Chat currently recognizes common response fields such as `output`, `text`, `content`, `token`, and OpenAI-style delta content. For streaming, configure the n8n workflow and any reverse proxy to keep the connection open.

Each configured webhook is user-selectable from Settings. LF Chat does not assume that all webhooks use the same model or capabilities.

## Debugging

When `DEBUG_INTROSPECTION=1`, the API exposes:

```text
GET /api/_debug/generations
GET /api/_debug/generations/:conversationId/snapshot
```

These endpoints are intended for local troubleshooting and are not protected like normal user routes, so disable them in production. Development verification and reset codes are visible in the API terminal output when SMTP is not enabled.

## Data and backups

The application database is a SQLite file named `lf-chat.db`. The in-app Data Management panel can export conversations, settings, and profile data as a ZIP backup and import a previous backup. Treat the database, backups, JWT secret, and SMTP credentials as sensitive.

## Project layout

```text
src/                  React application, components, hooks, i18n, API client
server/src/routes/    Auth, settings, conversations, and debug endpoints
server/src/generation/Generation manager, webhook runner, SSE event bus, snapshots
server/src/db.ts      SQLite schema and lightweight migrations
docker-compose.yml    Persistent production deployment
Dockerfile            Multi-stage frontend/backend image build
ROADMAP.md            Planned reasoning and media capabilities
```

## Deployment scope

This repository was originally designed as an internal company tool. Review authentication, reverse-proxy, SMTP, backup, retention, and webhook security settings before using it with sensitive data or exposing it to the public internet.
