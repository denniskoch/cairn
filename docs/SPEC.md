# Cairn — Project Spec

> A keyboard-driven desktop mail client in the spirit of Alpine. Cross-platform Electron app with an xterm.js terminal UI. Plain text first. Pluggable mail backends, starting with Microsoft Graph.

## Attribution

The interface design is inspired by Alpine, the University of Washington's terminal mail client (https://alpineapp.email/). Cairn shares no code with Alpine and is an independent clean-room implementation. Do not reference Alpine's source while implementing. Use only the published user manual and observed behavior of the running program. The name "Alpine" belongs to UW and is not used in any branding, package name, or user-facing string.

---

## Stack

- **Shell:** Electron (latest stable)
- **Language:** TypeScript everywhere (main + renderer + shared)
- **Renderer UI:** xterm.js with WebGL renderer, fit addon, web-links addon
- **Local storage:** SQLite via `better-sqlite3` (synchronous, fast, embedded)
- **Token storage:** OS keychain via Electron `safeStorage` (Keychain / DPAPI / libsecret)
- **HTTP:** native `fetch` (Node 18+)
- **Graph access:** raw `fetch` + thin typed wrapper
- **OAuth:** `@azure/msal-node` with PKCE, loopback redirect
- **HTML sanitization (received mail only):** `sanitize-html` (revisit if the strict allowlist hits limits)
- **HTML → text conversion:** `html-to-text`
- **MIME parsing (for IMAP path later):** `mailparser`
- **Build:** `electron-vite`
- **Packaging:** `electron-builder`
- **Tests:** `vitest` for unit, `playwright` for renderer integration

## Project Goals

1. **Keyboard-first.** No mouse required for any operation. Mouse may exist for selection/copy but never as the primary input path.
2. **Plain text mail, the way it was intended.** Render text/plain by default. HTML is sanitized and converted to text. No inline images. No remote content loading. Ever.
3. **Provider-agnostic core.** The mail engine does not know whether it is talking to Graph, IMAP, JMAP, or anything else. One interface, swappable implementations.
4. **One binary per platform.** Users download Cairn for macOS / Windows / Linux and run it. No Docker, no server, no certs to manage.
5. **Local-first cache.** SQLite holds folders, headers, bodies. Network is for sync, not for reads.

## Non-Goals

- Not a webmail-as-a-service. Single-user, single-machine.
- Not multi-account in v1. One account at a time. (Schema supports multi-account; UI does not.)
- Not CalDAV / CardDAV / calendar / contacts.
- Not an HTML mail composer. Compose is plain text only.
- Not a mobile app.
- Not an inline image viewer. Attachments save to disk and you open them with the OS handler.
- Not a remote-content loader. If a message has `<img src="https://tracker.com/pixel">`, that URL is never fetched.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Renderer Process (the UI)                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  xterm.js terminal                                   │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  Screen abstraction (cell-based draw API)      │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  │  ┌──────────────┐  ┌────────────────────────────┐    │   │
│  │  │ Keybind      │  │ Screen state machine       │    │   │
│  │  │ dispatcher   │  │ folderlist/index/view/...  │    │   │
│  │  └──────┬───────┘  └─────────────┬──────────────┘    │   │
│  └─────────┼─────────────────────────┼──────────────────┘   │
└────────────┼─────────────────────────┼──────────────────────┘
             │ IPC (contextBridge)     │
┌────────────┼─────────────────────────┼──────────────────────┐
│  Electron Main Process               ▼                      │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Mail engine                                       │     │
│  │  ┌────────────────────────────────────────────┐    │     │
│  │  │  MailProvider interface                    │    │     │
│  │  └────┬──────────────────┬────────────────────┘    │     │
│  │  ┌────▼────────┐    ┌────▼──────────┐              │     │
│  │  │ GraphProvider│   │ ImapProvider  │  (later)     │     │
│  │  └─────────────┘    └───────────────┘              │     │
│  └────────────────────────────────────────────────────┘     │
│  ┌────────────────────┐  ┌───────────────────────────┐      │
│  │ SQLite cache       │  │ OAuth (msal-node) + key-  │      │
│  │ (better-sqlite3)   │  │ chain via safeStorage     │      │
│  └────────────────────┘  └───────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼  HTTPS to graph.microsoft.com
```

### Process boundaries

**Main process owns:** all network I/O, the SQLite database, the keychain, MailProvider implementations, sync schedulers, OAuth flow.

**Renderer process owns:** the xterm.js terminal, the screen state machine, the keybind dispatcher, the compose buffer, the screen redraw logic.

**IPC contract** (typed via shared interfaces in `src/shared/ipc.ts`):

```ts
interface MailIPC {
  // Folders / messages
  listFolders(): Promise<Folder[]>
  listMessages(folderId: string, opts: ListOpts): Promise<ListResult>
  getMessage(id: string): Promise<Message>

  // Mutations
  send(draft: Draft): Promise<void>
  saveDraft(draft: Draft): Promise<string>
  move(id: string, destFolderId: string): Promise<void>
  delete(id: string, permanent?: boolean): Promise<void>
  setFlags(id: string, flags: FlagUpdate): Promise<void>

  // Search
  search(q: string): Promise<MessageHeader[]>

  // Auth
  authStart(): Promise<void>        // triggers loopback OAuth flow
  authStatus(): Promise<AuthStatus>
  signOut(): Promise<void>

  // Sync
  syncFolder(folderId: string): Promise<void>
  syncAll(): Promise<void>
}

// Push from main to renderer
interface MailEvents {
  'mail:new':          (folder: string, msg: MessageHeader) => void
  'mail:flag_changed': (id: string, flags: FlagUpdate) => void
  'mail:deleted':      (id: string) => void
  'mail:moved':        (id: string, from: string, to: string) => void
  'sync:status':       (folder: string, state: SyncState) => void
  'auth:expired':      () => void
}
```

Expose via `contextBridge.exposeInMainWorld('cairn', api)` with `contextIsolation: true` and `nodeIntegration: false`. Renderer **must not** have direct Node or filesystem access.

---

## The MailProvider Interface

The single most important contract in the project. Get this right and adding IMAP later is a self-contained task.

```ts
export interface MailProvider {
  // Folders
  listFolders(): Promise<Folder[]>
  getFolder(id: FolderId): Promise<Folder>

  // Listing (paginated)
  listMessages(folder: FolderId, opts: ListOpts): Promise<{
    messages: MessageHeader[]
    nextCursor?: string
  }>

  // Single message + attachments
  getMessage(id: MessageId): Promise<Message>
  getAttachment(messageId: MessageId, attachmentId: string): Promise<Attachment>

  // Mutations
  send(draft: Draft): Promise<MessageId>
  saveDraft(draft: Draft): Promise<MessageId>
  move(id: MessageId, dest: FolderId): Promise<void>
  delete(id: MessageId, permanent?: boolean): Promise<void>
  setFlags(id: MessageId, flags: FlagUpdate): Promise<void>

  // Search
  search(query: SearchQuery): AsyncIterable<MessageHeader>

  // Push / sync
  watch(folder?: FolderId): AsyncIterable<MailEvent>

  // Lifecycle
  dispose(): Promise<void>
}

export type MessageHeader = {
  id: MessageId
  threadId?: string
  from: Address
  to: Address[]
  cc: Address[]
  subject: string
  receivedAt: Date
  preview: string            // first ~200 chars of text body
  hasAttachments: boolean
  flags: { read: boolean, flagged: boolean, draft: boolean }
  sizeBytes: number
}

export type Message = MessageHeader & {
  bodyText: string           // always populated, derived from HTML if needed
  bodyHtml?: string          // sanitized, never rendered in v1
  attachments: AttachmentMeta[]
  headers: Record<string, string>
}

export type Draft = {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyText: string
  inReplyTo?: MessageId
  references?: MessageId[]
  attachments?: AttachmentInput[]
}

export type MailEvent =
  | { type: 'new', folder: FolderId, message: MessageHeader }
  | { type: 'flag_changed', id: MessageId, flags: FlagUpdate }
  | { type: 'deleted', id: MessageId }
  | { type: 'moved', id: MessageId, from: FolderId, to: FolderId }
```

**Provider implementations must:**

- Translate provider-specific errors into a common `MailError` with codes: `AUTH_EXPIRED`, `NOT_FOUND`, `RATE_LIMITED`, `NETWORK`, `PROVIDER`, `UNKNOWN`.
- Handle their own retry/backoff for rate limits.
- Never leak provider-specific IDs or types upward. `MessageId` is an opaque string.
- Be idempotent on retries.

---

## Graph Provider Specifics

### Authentication — public client with PKCE + loopback

This is the desktop OAuth flow. No client secret. No public callback URL.

1. App registration in Entra ID: type = **Public client / native**, redirect URI = `http://localhost` (MSAL handles the actual port).
2. Scopes: `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.Read`, `offline_access`, `User.Read`.
3. Flow:
   - Renderer hits `cairn.authStart()` IPC.
   - Main process spins up `@azure/msal-node` `PublicClientApplication`.
   - Calls `acquireTokenInteractive({ scopes, openBrowser })` — MSAL opens system browser via `shell.openExternal`, listens on a random loopback port.
   - User authenticates in system browser. Browser redirects to `http://localhost:RANDOM/?code=...`.
   - MSAL captures the code, exchanges for tokens, returns access + refresh token.
   - Main encrypts refresh token with `safeStorage.encryptString()`, stores in SQLite.
4. On every API call, check expiry; call `acquireTokenSilent` if <5min remaining. On refresh failure, emit `auth:expired` to renderer, which routes to a re-auth screen.

### Entra app registration (document in README)

- App type: **Native / Public client**
- Redirect URI: `http://localhost` (just that — MSAL adds the port)
- Allow public client flows: **Yes**
- Permissions (delegated): `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.Read`, `offline_access`, `User.Read`
- No client secret needed
- Tenant: usually `common` for multi-tenant personal+work, or your specific tenant ID

Document the exact Azure portal clicks in `docs/azure-setup.md`.

### Endpoints used

| Operation | Endpoint |
|---|---|
| Sign-in user info | `GET /me` |
| List folders | `GET /me/mailFolders?$top=100` |
| List messages | `GET /me/mailFolders/{id}/messages?$top=50&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments,isRead,flag&$orderby=receivedDateTime desc` |
| Delta sync | `GET /me/mailFolders/{id}/messages/delta` |
| Get message (body) | `GET /me/messages/{id}?$select=body,uniqueBody,...` |
| Get attachment | `GET /me/messages/{id}/attachments/{aid}` |
| Send | `POST /me/sendMail` |
| Save draft | `POST /me/messages` |
| Move | `POST /me/messages/{id}/move` |
| Update flags | `PATCH /me/messages/{id}` (`isRead`, `flag`) |
| Delete | `DELETE /me/messages/{id}` |
| Search | `GET /me/messages?$search="..."` (KQL syntax) |

**Always use `$select`.** Default response includes full body, which kills the index view.

### HTML handling (received mail)

Order of operations on `getMessage`:

1. If `uniqueBody.contentType === 'text'`, use as-is.
2. Else if `body.contentType === 'text'`, use as-is.
3. Else (HTML), pass HTML through `sanitize-html` with **strict** allowlist:
   - **Forbidden:** `<img>`, `<iframe>`, `<script>`, `<style>`, `<link>`, `<object>`, `<embed>`, `<video>`, `<audio>`, all `on*` attributes, all `style` attributes, all URL attributes pointing to `http(s)://` except plain `<a href>`.
   - Then run `html-to-text` for the `bodyText` field that the UI displays.
   - Cache the sanitized HTML in `body_html` but never render it in v1.
4. **Never resolve remote URLs.** No HEAD requests, no preview fetching, nothing.

### Rate limiting

- Always honor `Retry-After`.
- Use `POST /$batch` for bulk operations (max 20 requests).
- Cache aggressively in SQLite. List/get reads hit cache first, network only fills gaps and runs delta sync in the background.

### Push notifications

Graph webhooks require a public HTTPS endpoint. Desktop apps don't have one. So:

**v1: poll delta queries.** Per-folder cursor stored in SQLite. INBOX polls every 30s when app is foregrounded, 5min when backgrounded. Other folders poll on-demand when user navigates to them, then every 5min while visible.

Future: long-running connection via something like Graph's streaming subscriptions if/when Microsoft offers them for desktop clients. Not a v1 concern.

---

## Local Storage

### SQLite schema (`better-sqlite3`, located in `app.getPath('userData')/cairn.db`)

```sql
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,        -- 'graph' | 'imap'
  email         TEXT NOT NULL,
  display_name  TEXT,
  created_at    INTEGER NOT NULL      -- unix ms
);

CREATE TABLE auth_tokens (
  account_id           TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  refresh_token_enc    BLOB NOT NULL,  -- safeStorage.encryptString output
  homeAccountId        TEXT,           -- MSAL identifier
  scope                TEXT,
  updated_at           INTEGER NOT NULL
);

CREATE TABLE folders (
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  provider_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  parent_id     TEXT,
  unread_count  INTEGER DEFAULT 0,
  total_count   INTEGER DEFAULT 0,
  delta_cursor  TEXT,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE messages (
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id                TEXT NOT NULL,
  folder_id         TEXT NOT NULL,
  provider_id       TEXT NOT NULL,
  thread_id         TEXT,
  from_addr         TEXT NOT NULL,         -- JSON
  to_addrs          TEXT NOT NULL,         -- JSON
  cc_addrs          TEXT DEFAULT '[]',     -- JSON
  subject           TEXT,
  received_at       INTEGER NOT NULL,
  preview           TEXT,
  has_attachments   INTEGER DEFAULT 0,
  is_read           INTEGER DEFAULT 0,
  is_flagged        INTEGER DEFAULT 0,
  size_bytes        INTEGER,
  body_text         TEXT,                  -- populated on first full read
  body_html         TEXT,                  -- sanitized; not rendered
  raw_headers       TEXT,                  -- JSON
  fetched_at        INTEGER,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX idx_messages_folder_date ON messages (account_id, folder_id, received_at DESC);
CREATE INDEX idx_messages_thread ON messages (account_id, thread_id);

CREATE TABLE prefs (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Migrations

Use a tiny in-house migration runner. Numbered SQL files in `src/main/db/migrations/001_init.sql`, `002_*.sql`, etc. Track applied versions in a `schema_version` table.

---

## Screens & State Machine

Five top-level screens. The router is keybind-driven; URL fragments are ignored (we're not in a browser). State lives in a single store accessed by the screen state machine.

| Screen | Purpose |
|---|---|
| `folderlist` | Tree of folders with unread counts. Default screen on launch. |
| `index` | Message list for a folder. |
| `view` | Read a single message. |
| `compose` | Write/edit a draft (pico-style editor). |
| `help` | Context-sensitive help. |

Transitions:

```
folderlist  ──Enter──▶  index  ──Enter──▶  view
folderlist  ◀──Q────    index  ◀──Q────    view

(any screen)  ──C──▶  compose
              ◀──^C── (cancel)
              ◀──^X── (send → return to prior screen)

(any screen)  ──?──▶  help  ──Q──▶  (return)
```

### Screen abstraction

Don't sprinkle raw ANSI through your code. Build a small abstraction:

```ts
interface Screen {
  cols: number
  rows: number
  clear(): void
  cell(row: number, col: number, char: string, attrs?: Attrs): void
  text(row: number, col: number, str: string, attrs?: Attrs): void
  fill(row: number, col: number, width: number, char: string, attrs?: Attrs): void
  statusBar(items: StatusItem[]): void
  flush(): void                          // double-buffered render to xterm
}

type Attrs = { fg?: Color, bg?: Color, bold?: boolean, inverse?: boolean, underline?: boolean }
type StatusItem = { key: string, label: string }
```

This makes screens unit-testable. Tests render to a string buffer; production renders to xterm.js.

### Status bar (the Alpine signature)

Always two lines at the bottom of the screen. First line shows the most common commands; second line shows secondary commands. Pressing `O` ("Other commands") cycles through pages of secondary commands.

Examples:

**folderlist**
```
? Help  L Refresh  Q Quit  N Next folder  P Prev folder
Enter Select  ↑↓ Navigate                              O Other
```

**index**
```
? Help  C Compose  R Reply  D Delete  S Save  /  Search
G Goto  N NextNew  J Jump  *  Flag                     O Other
```

**view**
```
? Help  R Reply  A Reply-all  F Forward  D Delete  N Next
Spc PgDn  b PgUp  V Attachments  H Headers  Q Index    O Other
```

**compose**
```
^G Help     ^X Send       ^R Read file  ^Y PgUp    ^K Cut
^O Drafts   ^C Cancel     ^W Where is   ^V PgDn    ^U UnCut
```

---

## Keybinds

Single-keystroke in screens. Control-chords in compose (pico convention).

### Global

| Key | Action |
|---|---|
| `?` | Help (context-sensitive) |
| `Q` | Back / quit current context |
| `O` | Cycle status-bar to show "other commands" |

### folderlist

| Key | Action |
|---|---|
| `↑` `↓` `j` `k` | Navigate |
| `Enter` | Open folder |
| `L` | Refresh folder list from server |
| `N` `P` | Next/prev folder |

### index

| Key | Action |
|---|---|
| `↑` `↓` `j` `k` | Navigate |
| `Enter` | Open message |
| `C` | Compose new |
| `R` | Reply |
| `A` | Reply all |
| `F` | Forward |
| `D` | Delete (move to Deleted Items) |
| `U` | Toggle unread |
| `*` | Toggle flag |
| `S` | Save (move to folder) |
| `G` | Goto folder |
| `/` | Search |
| `N` | Next new (unread) |
| `J` | Jump to message number |

### view

| Key | Action |
|---|---|
| `Space` | Page down |
| `b` | Page up |
| `↑` `↓` | Line scroll |
| `R` `A` `F` `D` | Reply / reply-all / forward / delete |
| `N` `P` | Next / previous message in folder |
| `H` | Toggle full headers vs. brief |
| `V` | View attachments list |
| `S` | Save to folder |

### compose (pico-style)

| Chord | Action |
|---|---|
| `^G` | Help |
| `^X` | Send |
| `^O` | Save draft |
| `^R` | Read file (attach) |
| `^T` | To file (address book / autocomplete) |
| `^C` | Cancel (discard with confirm) |
| `^J` | Justify paragraph (rewrap to 72) |
| `^W` | Where is (search in buffer) |
| `^K` | Cut line |
| `^U` | Uncut (paste) |
| `^Y` | Page up |
| `^V` | Page down |

Browser-reserved chord notes: in Electron the renderer captures all keystrokes if `preventDefault()` is called on `keydown`. The keybind dispatcher must call `preventDefault()` on anything it owns. **`^T` and `^W` overlap in pico's own conventions** — keep both, document, accept.

---

## Compose Editor

A textarea-style buffer rendered into xterm.js. Requirements:

- Fixed column width: 72 (configurable in prefs)
- Auto-wrap on word boundaries
- Quote prefix preservation: lines starting with `> ` stay quoted on wrap
- Justify (`^J`): rewrap current paragraph to 72 columns, preserving any quote prefix
- Cut/uncut buffer (cut text accumulates while consecutive `^K`s are pressed)
- "Where is" (`^W`): incremental search forward from cursor

### Reply behavior

- **Reply (`R`)**: to = original `From`; subject = `Re: <orig>` (add only if not already prefixed); body = blank line, attribution line `On <date>, <name> wrote:`, then original body with each line prefixed `> `.
- **Reply all (`A`)**: as above, plus cc = original `To` + `Cc` minus the user's own address(es).
- **Forward (`F`)**: subject = `Fwd: <orig>`; body = `\n---------- Forwarded message ----------\nFrom: ...\nDate: ...\nSubject: ...\nTo: ...\n\n` + original body (not quote-prefixed).

### Send-path safety

Before sending, validate:

- At least one recipient
- Subject is non-empty (warn but allow if empty — pico convention)
- No bare `\r` in body (normalize to `\n`)

---

## Sync Logic

Per-folder sync state machine in main process:

```
idle ──schedule──▶ syncing ──ok────▶ idle
                          ──error──▶ backoff ──retry──▶ syncing
```

For each folder with a `delta_cursor`, hit `/delta?$deltatoken=...` to get changes since last sync. Apply changes to SQLite. Emit IPC events to renderer.

If no cursor exists, do a full bootstrap: paginate `/messages` once, save all headers, save the `@odata.deltaLink` from the final response as the cursor.

Sync schedule:

- INBOX: 30s foreground, 5min background
- Other folders: 5min when visible, on-demand otherwise
- All folders: full re-sync triggered by `L` in folderlist

Backoff on errors: exponential, capped at 5 minutes.

---

## Theming

Five built-in themes, switchable in prefs:

- **classic** — green on black (the default; "phosphor")
- **amber** — amber on black
- **paper** — black on warm white
- **solarized-dark**
- **solarized-light**

Themes are an `Attrs` palette + an xterm.js `ITheme`. No gradients. No fancy backgrounds. The terminal is sacred.

Bundled monospace fonts (do not rely on system fonts): JetBrains Mono and IBM Plex Mono. License check before bundling — both are OFL-1.1 / Apache-2.0 compatible.

---

## Build Order

Do these in order. Each step should produce something testable. Don't skip ahead.

1. **Electron + Vite skeleton.** App launches, blank xterm in renderer, IPC sanity check (`ping → pong`).
2. **SQLite + migrations.** App creates `cairn.db` on first run, runs migrations, has a `prefs` table.
3. **OAuth flow end-to-end.** `cairn.authStart()` opens system browser, completes MSAL flow, stores encrypted refresh token in SQLite, `cairn.authStatus()` returns the user's email.
4. **MailProvider interface in code.** Real TS types. `GraphProvider` and `ImapProvider` stubs that throw `NotImplemented`.
5. **GraphProvider.listFolders + listMessages.** Hardcoded test screen that calls `mail.listFolders()` and prints results to xterm.
6. **GraphProvider.getMessage.** Including HTML sanitization + html-to-text conversion.
7. **GraphProvider write ops.** `send`, `saveDraft`, `move`, `delete`, `setFlags`.
8. **Delta sync.** Background scheduler, SQLite cache, IPC events on changes.
9. **Screen abstraction.** Cell-based API on top of xterm.js, status bar primitive.
10. **Keybind dispatcher.** Tables per screen, `preventDefault` discipline.
11. **folderlist screen.** Real data, navigation, refresh.
12. **index screen.** Open from folderlist, navigate, mark read.
13. **view screen.** Read messages, page through, next/prev.
14. **compose screen.** Plain new compose, send works end-to-end.
15. **Reply / reply-all / forward.** Quote logic, header preservation.
16. **Search.** Backend Graph search → UI results screen.
17. **Help screen.** Context-sensitive, scrollable.
18. **Themes + font bundling.**
19. **Polish: error states, auth re-auth flow, sync status indicators, attachment save-to-disk.**
20. **electron-builder packaging.** Produce unsigned builds for macOS / Windows / Linux. (Signing is a later concern.)
21. **IMAP provider.** Implement against the same interface. This is where the abstraction earns its keep.

---

## Distribution (deferred until step 20+)

- **macOS:** `electron-builder` produces `.dmg` and `.zip`. Signing requires an Apple Developer account ($99/yr) and notarization. v1 ships unsigned; users right-click → Open the first time.
- **Windows:** `.exe` installer (NSIS) + portable `.zip`. Signing requires a cert ($200-500/yr) or skip and accept SmartScreen warnings.
- **Linux:** AppImage + `.deb`. No signing required.
- **Updates:** `electron-updater` against GitHub Releases. Public repo or use a private feed. Defer until v1 ships.

---

## What NOT to do

- **Do not render HTML mail.** Sanitize, convert to text, display text. Period.
- **Do not load remote content.** No `<img src="http">` resolution, no link previews, no favicon fetching for senders, nothing.
- **Do not add features outside this spec without asking.** No threading UI, no calendar, no contacts manager, no signatures (yet), no rules / filters, no multi-account UI.
- **Do not store tokens in plaintext.** Use `safeStorage`. If `safeStorage.isEncryptionAvailable()` returns false (Linux without libsecret), refuse to store and tell the user.
- **Do not commit secrets.** `.env.example` only.
- **Do not reach into Alpine's source for reference.** Manual and observed behavior only.
- **Do not pick libraries unilaterally for major decisions.** Especially: HTML sanitizer, OAuth library, packager. Ask if there's any doubt.
- **Do not write a custom OAuth implementation.** Use `@azure/msal-node`.
- **Do not enable `nodeIntegration` in the renderer.** Use `contextBridge` + `contextIsolation`.
- **Do not block the renderer on long operations.** All I/O is in main, IPC is async, renderer stays responsive.

---

## Model Selection Guidance (for the human running Claude Code)

- **Opus** for: MSAL/OAuth integration, token encryption + refresh edge cases, `MailProvider` interface design, Graph delta sync logic, SQLite schema, the screen abstraction, the keybind dispatcher.
- **Sonnet** for: individual screen implementations, GraphProvider method bodies, IPC wiring, tests, packaging config.
- **Haiku** for: README polish, docstrings, mechanical refactors.

---

## Resolved decisions

All v1 open questions resolved 2026-05-25:

1. **Build tool:** `electron-vite`. Packaging is handled separately by `electron-builder`, which removes the main reason to reach for `electron-forge`.
2. **HTML sanitizer:** `sanitize-html`. Pure allowlist API, no DOM dependency, easier to express the strict policy. Switch to `dompurify` + `jsdom` if the policy hits limits.
3. **Graph access:** raw `fetch` with a thin typed wrapper. Critical for `$select` discipline — Graph's default response includes full bodies, which would kill the index view. Bigger reason: this is the boundary the IMAP provider will be measured against, so it must stay readable. Revisit if batching/paging boilerplate gets painful.
4. **Address book:** Graph contacts cached locally for `^T` autocomplete. Read-only in v1, synced lazily.
5. **Attachment cache:** persist to a temp dir under `app.getPath('temp')`, cleared on app close.
6. **Sent-mail:** trust Graph's default auto-save to Sent Items. No explicit save.
7. **Conflict resolution:** last-write-wins from Graph. Local optimistic updates revert on conflict.
