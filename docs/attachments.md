# File attachments

LF-Chat and LS-Chat use the same attachment implementation. LS retains its session authentication and server-managed backend catalog; LF retains its bearer authentication and configured webhooks.

## Supported inputs

- Documents: PDF, DOC, DOCX, RTF, PPTX, ODT, ODS, ODP, EPUB.
- Spreadsheets: XLS, XLSX, XLSM, CSV, TSV. Macros are never executed.
- Images: PNG, JPEG/JPG, WebP, GIF. Images are sent to the model as binary image inputs. Originals remain available for download.
- UTF-8 (or BOM-marked UTF-16) text and source files (including extensionless files and less common code formats): TXT, Markdown, JSON/JSONL, YAML, XML, HTML, CSS, JavaScript/TypeScript, Python, Ruby, Rust, Go, Java, C/C++/C#, PHP, shell scripts, SQL, TOML/INI, logs, TeX, R, Vue/Svelte, SVG, RST, Jupyter notebooks, configuration files, diffs/patches, EML.

Audio, video, arbitrary archives, legacy PPT, and unsupported image encodings are rejected with a visible error. Convert legacy presentations to PPTX and unsupported images to PNG/JPEG. SVG is read as text, not rendered as an image. Office/spreadsheet formats are read as text and tables; embedded pictures/charts are not sent separately. Attach an image of a chart when visual interpretation is needed. Password-protected documents must be unlocked before uploading.

A paperclip opens the file picker. Files can also be dropped anywhere in the chat thread or into the expanded composer. Pending files show upload/read status and can be removed. File-only messages are supported. Sent files can be downloaded after reloading the app, and are retained across follow-ups, retries, edits, and branches.

## Processing and storage

The authenticated `POST /api/attachments` receives `application/octet-stream`, an encoded `X-File-Name`, and a client-generated UUID in `X-File-Id`. The server verifies the extension/signature, extracts text in a bounded worker, and returns `{id, name, contentType, size}`. Conversation messages store this metadata; original bytes and extracted text remain in the owner-scoped SQLite `attachments` table.

`GET /api/attachments/:id` downloads original bytes after authenticating the owner. `DELETE` removes unsent files; a file referenced by a message cannot be removed this way. Deleting a conversation removes its files when no other conversation/branch references them. Abandoned uploads are collected on a later upload after 24 hours. Account removal in LF cascades attachment rows. The existing `DATA_DIR` volume persists files along with conversations.

Limits: five files and 10 MiB total per message, 100 MiB of original bytes and extracted text stored per user, 200,000 extracted characters per document, 50 MiB declared Office ZIP expansion, and two simultaneous document-processing requests per app process. Historical images plus current attachments must also fit the 10 MiB webhook file budget. The server allows 100 upload requests per minute per user; rejected uploads remain visible and block sending until removed.

Before forwarding current or historical images, the server prepares a model input copy of at most 1 MiB and 2048 pixels on its longest side. Smaller images retain their original bytes. Larger images become quality-90 JPEGs, preserving their dimensions when possible and reducing them only as needed to fit the byte budget. EXIF rotation is applied, transparency is flattened onto white, and optimized animated images use their first frame. Images above 40 megapixels or damaged images fail with a visible preparation error. Original stored bytes, filenames, message metadata, downloads, and backups are unchanged. This avoids the deployed n8n adapter's `RangeError` with multi-megabyte inline images. Each encoding operation has a ten-second deadline.

Image-only PDFs use OCR in English, German, and Italian, limited to 20 extracted page images and a 60-second worker deadline. The first OCR request downloads Tesseract language data from its standard provider; subsequent requests use the cache under `DATA_DIR/ocr`. Normal searchable PDFs do not require OCR downloads. OCR has the usual recognition limitations; verify important extracted values.

Version 2 backup ZIPs include each original file once at `attachments/<id>`. Restores reuse files already owned by the account or upload missing bytes and remap message references before importing conversations. Version 1 backups without attachments remain valid. Missing bytes or denied access fail the import visibly.

## n8n contract and workflow

Workflow: https://mesh.leben-fuehren.gmbh/workflow/0RQpKbJj8jb9pv8v

The workflow needs a multimodal model and **Automatically Passthrough Binary Images** (`options.passthroughBinaryImages: true`) enabled on the AI Agent. Its POST webhook, streaming response mode, prompts, connections, and credentials are preserved. The selected model can be changed in n8n; image preparation does not change it.

For text-only requests, the app still sends JSON `{message, history, stream: true}`. With attachments it sends multipart fields `message`, `history`, `stream`, and binary `file0`, `file1`, etc. Extracted document text is appended to `message` or its historical turn; current files and prepared historical images are forwarded as binary parts. The Agent passes image parts to the multimodal model. No additional n8n document-extraction node is needed.

Other LF webhooks need to accept multipart fields and binary images to support file inputs. Text-only JSON compatibility is preserved. Keep proxy upload limits above the app's 10 MiB limit; n8n's default webhook payload limit is 16 MiB. File bytes and document text travel server-to-server to the configured backend. The n8n API key is an administrative setup credential and is never sent by the chat app.

A private snapshot of the workflow before the change was saved locally at `/tmp/lfchat-n8n-attachments-original.json` with mode 0600. It is outside both repositories and is not a durable deployment backup.

## Dependencies and verification

The parsers are server-only: [officeparser](https://github.com/harshankur/officeParser), [word-extractor](https://github.com/morungos/node-word-extractor), and [SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). [Sharp](https://sharp.pixelplumbing.com/) prepares bounded image inputs without modifying stored originals. SheetJS 0.20.3 is vendored under `server/vendor` using its official distribution, avoiding the old npm registry release. Docker copies this archive before `npm ci`; no system Office installation is required. Node 22.13 or newer is required.

Run `npm run lint`, `npm run lint:server`, and `npm test` in either worktree. Regression coverage includes real document parsing, authenticated upload/download/removal, foreign-account isolation, file limits, reference retention, multipart transport, historical image/document context, n8n error events, and backup byte restoration.

Live checks confirmed text replies, binary image interpretation, and PDF/DOCX/XLSX extraction through the application runner. Browser checks cover picker/drop, file-only send, download/reload/retry, removal, failed uploads, and expanded-composer layouts on desktop and phone-sized viewports.

References: [n8n Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [n8n Tools Agent image passthrough](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent/), [GLM-5.3 Flash](https://docs.z.ai/guides/llm/glm-5.3-flash).
