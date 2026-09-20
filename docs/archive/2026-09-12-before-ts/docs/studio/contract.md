# OEYdesign Studio — shared contract (v1)

Status: working contract for the Studio product layer. Backend (`src/oeydesign/studio/`),
frontend (`studio-ui/`) and exporters are built against this document. Change it here first,
then change code.

Studio is a lean product layer. It does **not** use the Phase 6 governed pipeline
(AppContainer, esbuild, eight-slot readiness). It imports selected modules from
`src/oeydesign/` (renderer, quality helpers, image intake rules) but never modifies them
except where explicitly listed.

## 1. Runtime layout

```text
data/studio/
  studio.sqlite                       # single SQLite DB (WAL)
  projects/<project_id>/
    workspace/                        # the ONLY agent-writable root
      artifact.json                   # written by set_artifact tool (see §5)
      index.html ...                  # kind=web
      deck.json, theme.css, slides/01.html ...   # kind=deck
      document.md, doc.css            # kind=doc
      assets/gen/<sha12>.png          # generated images
      assets/uploads/<asset_id>.<ext> # user references (read-only copies)
    versions/<n>/                     # full workspace snapshot per completed run
    renders/<run_id>/<name>.png       # screenshots
    exports/<filename>                # produced exports
```

Repo root `.env` (utf-8-sig, `KEY=VALUE`) supplies defaults: `API_KEY`, `BASE_URL`, `MODEL`
(LLM) and `ARK_API_KEY`, `ARK_BASE_URL`, `ARK_MODEL_ID` (image generation). Settings saved via
the API override `.env`. Secrets are never returned by the API and never written to
`run_events` or logs.

## 2. Servers

- **API + UI**: FastAPI app, default `http://127.0.0.1:8880`. Serves `/api/*` and the built
  frontend from `studio-ui/dist` at `/` (SPA fallback to `index.html`).
  (Ports 8728–8827 are inside a Windows/Hyper-V excluded range on the dev machine, so 8780/8781
  are NOT usable; defaults are 8880/8881.)
- **Preview**: a second loopback origin, default `http://127.0.0.1:8881`, serving only
  workspace files: `GET /p/{project_id}/{path}`. HTML responses get a small bridge script
  injected before `</body>` (see §7). `kind=doc` is rendered on the fly:
  `GET /p/{project_id}/document.html` returns markdown-it rendered HTML wrapped in the doc
  template (`doc.css` + built-in print CSS). No directory listing, no path traversal
  (realpath must stay inside `workspace/`).
- Launch: `python -m oeydesign.studio --port 8880 --preview-port 8881 --data-root data/studio`
  (console script `oeydesign-studio`). `start-studio.ps1` wraps it and builds the UI when
  `studio-ui/dist` is missing.

## 3. SQLite schema (`store.py`)

```sql
projects(id TEXT PK, title TEXT, kind TEXT NULL, created_at TEXT, updated_at TEXT)
messages(id TEXT PK, project_id TEXT, seq INTEGER, role TEXT,        -- user|assistant|tool
         content_json TEXT,   -- full OpenAI-format message dict (content, tool_calls, tool_call_id, name)
         run_id TEXT NULL, created_at TEXT)
runs(id TEXT PK, project_id TEXT, status TEXT, trigger_message_id TEXT,
     started_at TEXT, finished_at TEXT NULL, error TEXT NULL, usage_json TEXT NULL)
run_events(seq INTEGER PK AUTOINCREMENT, project_id TEXT, run_id TEXT, type TEXT,
           payload_json TEXT, created_at TEXT)
versions(id TEXT PK, project_id TEXT, n INTEGER, run_id TEXT, summary TEXT,
         manifest_json TEXT,  -- {path: sha256}
         created_at TEXT)
assets(id TEXT PK, project_id TEXT, kind TEXT,  -- upload|generated|screenshot
       path TEXT, mime TEXT, width INTEGER NULL, height INTEGER NULL, sha256 TEXT,
       meta_json TEXT, created_at TEXT)
settings(key TEXT PK, value_json TEXT)
```

Run status values: `QUEUED`, `RUNNING`, `NEEDS_INPUT`, `VERIFYING`, `DONE`, `CANCELLED`,
`FAILED`. One active run per project at a time.

## 4. HTTP API (`/api`)

All JSON. IDs are opaque strings. Errors: `{ "error": { "code": string, "message": string } }`.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ok, version, provider_configured, image_provider_configured, preview_base_url}` |
| GET | `/api/settings` | | `Settings` (see below) |
| PUT | `/api/settings` | partial `Settings` (+ optional `provider.api_key`, `image.api_key`) | `Settings` |
| POST | `/api/settings/test` | `{target: "provider"\|"image"}` | `{ok, detail}` |
| GET | `/api/projects` | | `Project[]` |
| POST | `/api/projects` | `{title?}` | `Project` |
| GET | `/api/projects/{id}` | | `ProjectDetail` |
| DELETE | `/api/projects/{id}` | | `{ok}` |
| GET | `/api/projects/{id}/messages` | | `UiMessage[]` |
| POST | `/api/projects/{id}/messages` | `{content, attachments?: asset_id[], target?: {selector, text}}` | `202 {run_id, message_id}` — if a run is active it is cancelled first (interrupt), then the new run starts |
| POST | `/api/projects/{id}/runs/{run_id}/cancel` | | `{ok}` |
| POST | `/api/projects/{id}/runs/{run_id}/answer` | `{answers: {question_id: value}}` | `202 {run_id}` — resumes a `NEEDS_INPUT` run |
| GET | `/api/projects/{id}/runs/{run_id}` | | `Run` |
| GET | `/api/projects/{id}/events` | `?after=<seq>` or header `Last-Event-ID` | SSE stream of `run_events` (all runs of the project), keepalive comment every 15 s |
| GET | `/api/projects/{id}/files` | | `[{path, size, sha256, mime}]` (workspace, excluding `assets/uploads`) |
| GET | `/api/projects/{id}/files/{path}` | | raw file |
| PUT | `/api/projects/{id}/files/{path}` | `{content}` | `{ok}` (manual edit; emits `artifact.updated`) |
| GET | `/api/projects/{id}/artifact` | | `ArtifactManifest` or `null` |
| GET | `/api/projects/{id}/versions` | | `Version[]` |
| POST | `/api/projects/{id}/versions/{n}/restore` | | `{ok}` (restores snapshot into workspace, emits `artifact.updated`) |
| POST | `/api/projects/{id}/assets` | multipart `files[]` | `Asset[]` |
| GET | `/api/projects/{id}/assets` | | `Asset[]` |
| GET | `/api/projects/{id}/assets/{asset_id}` | | raw bytes |
| GET | `/api/projects/{id}/renders/{run_id}/{name}` | | png |
| GET | `/api/projects/{id}/quality` | | latest `QualityReport` or `null` |
| POST | `/api/projects/{id}/export` | `{format: "zip"\|"html"\|"pptx"\|"pdf"\|"docx"\|"md"}` | `{filename, download_url, size}` |
| GET | `/api/projects/{id}/exports/{filename}` | | file download |

Shapes:

```ts
type Settings = {
  provider: { base_url: string; model: string; api_key_set: boolean; reasoning_effort: "low"|"high"|"max" };
  image:    { base_url: string; model: string; api_key_set: boolean; enabled: boolean };
  render:   { viewport_width: number; viewport_height: number; allowed_hosts: string[] };
  agent:    { max_steps: number; max_renders: number; auto_repair_rounds: number; visual_review: boolean };
};
type Project = { id: string; title: string; kind: "web"|"deck"|"doc"|null; created_at: string; updated_at: string };
type ProjectDetail = Project & { artifact: ArtifactManifest|null; active_run: Run|null; latest_version: number|null; preview_url: string|null };
type Run = { id: string; project_id: string; status: RunStatus; started_at: string; finished_at: string|null; error: string|null; usage: {prompt_tokens:number; completion_tokens:number; total_tokens:number}|null };
type UiMessage = { id: string; role: "user"|"assistant"; content: string; run_id: string|null; created_at: string;
                   attachments?: Asset[]; tool_calls?: {id:string; name:string; args_summary:string; ok:boolean|null; summary:string|null}[]; interrupted?: boolean };
type ArtifactManifest = { kind: "web"|"deck"|"doc"; title: string; entry: string;   // "index.html" | "deck.json" | "document.md"
                          viewport: {width:number; height:number};
                          slides?: {file:string; title:string; notes?:string}[] };  // deck only, mirrored from deck.json
type Version = { n: number; run_id: string; summary: string; created_at: string; file_count: number };
type Asset = { id: string; kind: "upload"|"generated"|"screenshot"; path: string; url: string; mime: string; width: number|null; height: number|null; meta: Record<string, unknown> };
type QualityReport = { run_id: string; verdict: "PASS"|"REPAIR"|"BLOCK"; scores: Record<string, number>; findings: {severity: "critical"|"major"|"minor"; message: string}[];
                       checks: {console_errors: string[]; failed_requests: string[]; overflow: boolean}; screenshot_url: string; created_at: string };
```

## 5. SSE events

`event: <type>`, `id: <seq>`, `data: <json>`. Every payload includes `run_id` and `project_id`.

| type | payload |
|---|---|
| `run.status` | `{status, error?}` |
| `plan.update` | `{items: [{id, text, status: "pending"\|"in_progress"\|"done"}]}` |
| `assistant.delta` | `{message_id, text}` (streamed text chunks) |
| `assistant.message` | `{message_id, content, interrupted?: boolean}` (final) |
| `tool.call` | `{call_id, name, args_summary}` |
| `tool.result` | `{call_id, name, ok, summary}` |
| `artifact.updated` | `{files: string[], kind, entry}` (emitted on every write/edit/delete of workspace files, restore, manual edit) |
| `render.screenshot` | `{url, target, width, height}` |
| `question.form` | `{questions: [{id, prompt, type: "text"\|"choice"\|"multi", options?: string[], default?: unknown}]}` |
| `quality.report` | `QualityReport` |
| `usage` | `{prompt_tokens, completion_tokens, total_tokens}` |
| `error` | `{message}` |

## 6. Agent runtime

- OpenAI-compatible chat completions with **native `tools`**, `stream: true`,
  `stream_options.include_usage`. For Kimi coding profile + model starting with `k3`: do not send
  `temperature`; send `reasoning_effort` from settings. Streamed `tool_calls` deltas are
  assembled by index. Vision content uses `{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}`.
- History = all `messages` of the project in OpenAI format. Images from previous runs are
  replaced with the text `[screenshot omitted]` before sending; only the current run keeps
  image parts. An assistant message with `tool_calls` that was interrupted gets synthetic tool
  results `{"cancelled": true}` so the transcript stays valid.
- Loop: `while steps < max_steps`: stream model → emit deltas → if tool_calls: execute
  sequentially, emit `tool.call`/`tool.result`, append results → continue; else finish.
  Cancel flag is checked before each model call and before each tool call; the HTTP stream is
  closed on cancel.
- Tools (function schemas, all paths relative to `workspace/`, realpath-contained):
  - `list_files(dir?)`, `read_file(path)`, `write_file(path, content)`,
    `edit_file(path, old, new)` (exact, must match once), `delete_file(path)`
  - `set_artifact(kind, title, entry?, viewport?)` → writes `artifact.json`; for `deck`, also
    validates `deck.json` when present
  - `generate_image(items: [{id, prompt, aspect: "1:1"|"16:9"|"9:16"|"4:3"|"3:2"|"21:9", filename}])`
    → runs concurrently, returns `[{id, path, width, height}]`; saves to `assets/gen/`; caches by
    sha of (model, prompt, size); records `assets` rows with `meta.rights = "ANALYSIS_ONLY"`.
    Seedream (`doubao-seedream-5-0`) rejects requests below **3,686,400 pixels**, so the tool maps
    aspect → size: `1:1`→`2048x2048`, `16:9`→`2560x1440`, `9:16`→`1440x2560`, `4:3`→`2304x1728`,
    `3:2`→`2400x1600`, `21:9`→`3024x1296`. Generated PNG/JPEG is downscaled with Pillow to a
    max edge of 1600 px before saving (keeps artifacts light); the original size is kept in meta.
  - `render_preview(target?, viewport?)` → renders with Playwright system Chrome via
    `TrustedWebRenderer` (with `allowed_hosts`), returns text summary of
    `console_errors/failed_requests/overflow` and appends a user message with the screenshot(s)
    as `image_url`. `target`: `index.html` (web), `slides/03.html` or `all` (deck, `all` = up to
    12 slides as a contact sheet + each slide), `document` (doc, first 3 pages). Counts toward
    `max_renders`.
  - `ask_user(questions)` → run becomes `NEEDS_INPUT`, `question.form` emitted; loop suspends;
    on `/answer`, answers are appended as a user message and the run resumes.
  - `update_plan(items)` → emits `plan.update`
  - `list_references()`, `read_reference(asset_id)` → image assets return `image_url`
    content; text-like uploads (`.md .txt .csv .json .html`) return text (≤ 60 kB)
- Automatic visual review (when `agent.visual_review` is on): after the model finishes a run
  that modified the artifact, the server renders the final artifact, sends the screenshot to
  the model with the rubric (hierarchy, composition, typography, color, goal_fit, originality
  1–5; PASS when all ≥3, avg ≥4, no critical) and emits `quality.report`. On `REPAIR`, up to
  `auto_repair_rounds` follow-up turns are run with the findings as a user message.
- Version snapshot: at run end (DONE/CANCELLED/FAILED) if the workspace changed, copy
  `workspace/` (excluding `assets/uploads`) to `versions/<n>/` and insert a row.

## 7. Preview bridge

Injected into HTML served by the preview server:

```js
// click → postMessage to parent, does not navigate
document.addEventListener('click', (e) => {
  if (!(e.altKey || window.__oeyTargetMode)) return;
  e.preventDefault(); e.stopPropagation();
  const el = e.target.closest('[id],[data-oey],h1,h2,h3,p,a,button,img,section,header,footer,nav,li') || e.target;
  const selector = el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/).slice(0,2).join('.') : '');
  parent.postMessage({ type: 'oey-target', selector, text: (el.innerText || el.alt || '').slice(0, 80), tag: el.tagName.toLowerCase() }, '*');
}, true);
window.addEventListener('message', (e) => { if (e.data && e.data.type === 'oey-target-mode') window.__oeyTargetMode = !!e.data.on; });
```

The UI toggles target mode with a toolbar button; a received `oey-target` becomes a chip on the
composer and is sent as `target` in the next message. The backend prepends
`"[User points at <tag> '<selector>' with text '<text>']"` to the user content.

## 8. Frontend (`studio-ui/`)

Vite + React 18 + TypeScript. State: zustand. SSE via native `EventSource`
(`/api/projects/{id}/events?after=<seq>`), reconnect with last seq. Dev: `vite` proxies
`/api` → `http://127.0.0.1:8880`. Build → `studio-ui/dist`.

Layout: left rail (project list collapsible) + chat column + canvas column.
Canvas tabs: **Preview** (iframe to `preview_url`; deck → slide strip + scaled 1280×720
iframe; doc → paged iframe), **Files** (tree + read-only viewer + save), **Versions**,
**Quality**, **Export**. Toolbar: viewport presets (Desktop 1440 / Tablet 834 / Mobile 390),
refresh, open in new tab, target mode toggle. Chat: streaming text, tool-call cards
(collapsed by default), plan checklist, question forms, `Stop` button while running, composer
with attachments (drag-drop upload) and target chip, Ctrl+Enter to send. Settings drawer edits
`Settings`; secret fields are write-only with a "set" indicator.

Visual direction: calm, editorial, high-contrast; no purple gradients; system font stack plus
one display font; dark canvas chrome with light preview area. Must look like a finished
product, not a demo.
