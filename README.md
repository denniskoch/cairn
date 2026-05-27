<img src="build/icon.png" alt="Cairn icon" width="128" align="right" />

# Cairn

**A keyboard-driven desktop mail client in the spirit of Alpine.**

Plain text first. No remote content. Microsoft Graph today, IMAP next.

![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)
![Status](https://img.shields.io/badge/status-alpha-orange)
![Platforms](https://img.shields.io/badge/platforms-macOS_%7C_Windows_%7C_Linux-lightgrey)
![Electron](https://img.shields.io/badge/Electron-41.7-9feaf9?logo=electron&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)

![Cairn main menu](docs/screenshots/main-menu.png)

## Why Cairn?

Most mail clients today either render HTML — which means loading remote content, read receipts, tracking pixels, link previewers that fetch URLs on your behalf — or wrap a web UI in a desktop shell.

Cairn does neither. It sanitizes incoming mail down to text, never resolves an external URL, and lives in a terminal grid that you drive entirely from the keyboard. The look and the muscle memory come from [Alpine](https://alpineapp.email/), UW's terminal mail client; the wire protocol is modern OAuth to Microsoft Graph (IMAP next).

If you grew up on Alpine or `pine` and still wish your mail client felt like that — but with Microsoft 365 authentication, a real SQLite cache, and a packaged installer — that's Cairn.

## What works today

- **All five Alpine-style screens** — main menu, folder list, message index, view, compose — plus context-sensitive help (`?`), global search (`/`), and a Setup screen for theme and visual-filter selection.
- **Microsoft Graph backend** with PKCE + loopback OAuth, encrypted refresh-token storage via Electron `safeStorage`, automatic silent refresh, and a dedicated re-auth screen when the token finally expires.
- **Local SQLite cache** — list folders, index messages, and view bodies all read from cache first. A background scheduler polls the inbox and the currently-viewed folder; scroll-driven history paging fetches older messages on demand.
- **Reply / reply-all / forward** with proper `Re:` / `Fwd:` subject handling, `> ` quote prefix, and Alpine-style attribution (`On <day>, <date>, <from> wrote:`). Self-exclusion on reply-all.
- **Plain-text compose** — pico-style chord bindings (`^X` send, `^O` save draft, `^C` cancel). Tab cycles between To / Cc / Subject / Body. Sends real mail via Graph `/sendMail`.
- **Attachments save to disk** — `V` on a viewed message opens an attachment picker; Enter triggers a native save dialog defaulting to `~/Downloads/`.
- **HTML-free rendering** — incoming HTML is sanitized through a strict allowlist (no `<img>`, no inline CSS, no JS, no remote URLs), then `html-to-text` converts to plain text for display.
- **Five themes**: classic green-on-black phosphor, amber, paper (black-on-warm-white), solarized-dark, solarized-light. Live preview as you scroll the picker.
- **CRT-style visual filters**: scanlines, blur, phosphor glow. Optional and switchable.
- **Bundled monospace fonts** — JetBrains Mono and IBM Plex Mono ship inside the app so the look is consistent across platforms.
- **Packaged installers** on all three platforms via `electron-builder` (`.dmg` / `.zip` for macOS, NSIS `.exe` / portable `.zip` for Windows, `.AppImage` / `.deb` for Linux).

## Screenshots

![Folder list](docs/screenshots/folder-list.png)
*Folder list with unread counts.*

![Message index](docs/screenshots/index.png)
*Inbox — unread bolded, flagged marked with `!`, attachments still visible via the indicator.*

![View](docs/screenshots/view.png)
*Viewing a message. Brief headers by default, full headers on `H`.*

![Compose](docs/screenshots/compose.png)
*Pico-style compose. `^X` to send, `^O` to save a draft, `^C` to cancel.*

![Setup](docs/screenshots/setup.png)
*Setup screen — theme and visual filter, more settings to come.*

## Keyboard cheat-sheet

A small sample. Every screen has its own `?` help with the full list.

| Key | Where | What it does |
|-----|-------|-------------|
| `?` | anywhere | Context help |
| `Q` | anywhere | Back / quit |
| `C` | folder list, index | Compose new |
| `I` | main menu | Jump to inbox |
| `L` | folder list, index, view | Refresh / retry |
| `/` | index | Search across all folders |
| `↑` `↓` `j` `k` | most screens | Move cursor |
| `Enter` | most screens | Activate / open |
| `R` | index, view | Reply |
| `A` | index, view | Reply all |
| `F` | index, view | Forward |
| `D` `Del` `⌫` | index, view | Move to Deleted Items |
| `V` | view | Attachment picker → save to disk |
| `H` | view | Toggle brief / full headers |
| `Space` `b` | view | Page down / up through body |
| `^X` | compose | Send |
| `^O` | compose | Save draft |
| `^C` | compose | Cancel |

## Get started

Prerequisites: Node 20+, macOS / Windows / Linux. The native modules (`better-sqlite3`) rebuild against Electron's ABI automatically during `npm install`.

```bash
git clone https://github.com/denniskoch/cairn.git
cd cairn
make install
make dev
```

On first launch Cairn prompts you to sign in via your default browser. See [docs/azure-setup.md](docs/azure-setup.md) for the one-time Entra ID app registration steps if you want to point Cairn at your own tenant; otherwise the bundled defaults work with personal Microsoft accounts and multi-tenant work/school accounts.

For installers:

```bash
make package        # current platform (macOS / Windows / Linux)
make package:mac    # explicit per-platform targets
make package:win
make package:linux
```

Output lands in `dist/`.

## Configuration

Cairn stores its state in `app.getPath('userData')/cairn.db` (SQLite). Themes, visual filters, and message cache all live there.

Azure overrides via environment:

```bash
export CAIRN_AZURE_CLIENT_ID='your-app-client-id'
export CAIRN_AZURE_TENANT_ID='your-tenant-id'   # or 'common' for multi-tenant
```

See [docs/azure-setup.md](docs/azure-setup.md) for the portal walkthrough.

## Stack

- Electron + TypeScript (main / preload / renderer split with strict process isolation)
- xterm.js with WebGL renderer, fit and web-links addons
- `better-sqlite3` for the cache (synchronous embedded SQLite)
- `@azure/msal-node` for OAuth (PKCE + loopback redirect)
- Electron `safeStorage` for refresh-token encryption
- `sanitize-html` + `html-to-text` for inbound HTML
- Raw `fetch` + thin typed wrapper for Microsoft Graph (no SDK)
- `electron-vite` for dev/build; `electron-builder` for packaging
- `vitest` for unit tests, `playwright` for renderer integration (planned)

## Design principles

1. **Keyboard-first.** No mouse required for any operation. Mouse may exist for selection but never as the primary input path.
2. **Plain text mail.** HTML is sanitized and converted to text. No inline images. **No remote content loading, ever.**
3. **Provider-agnostic core.** One `MailProvider` interface, swappable implementations. Graph today, IMAP next.
4. **One binary per platform.** No server, no Docker, no certs to manage. Download and run.
5. **Local-first cache.** SQLite holds folders, headers, bodies. Network is for sync, not for reads.

The full spec — including the build order, schema, IPC contract, and the rationale on each resolved design decision — lives in [docs/SPEC.md](docs/SPEC.md).

## Roadmap

- **IMAP provider** — final spec step. The `MailProvider` interface was designed to make this a self-contained drop-in (`src/main/mail/imap.ts`).
- **Address book** — currently a stub on the main menu (`A`). Will cache Graph contacts locally for `^T` autocomplete in compose.
- **Threading** — `In-Reply-To` and `References` headers on outbound mail via Graph's `/createReply`.
- **Multi-account UI** — the schema is multi-account-capable, but only single-account works today.
- **Code signing / notarization** — `make package` produces unsigned builds. macOS Gatekeeper warns on first launch; Windows SmartScreen the same.
- **Auto-updates** — `electron-updater` against GitHub Releases.

## Contributing

Issues and pull requests welcome. Before non-trivial changes, please skim:

- [docs/SPEC.md](docs/SPEC.md) — what Cairn is and isn't, the architecture, and the build order. The spec is the source of truth; deviations should call themselves out.
- [CLAUDE.md](CLAUDE.md) — project notes that Claude Code (the AI coding assistant used heavily during initial development) reads on every session. Useful context regardless of who's contributing.

`make typecheck && make build` should always pass before pushing.

## Attribution

The interface is modeled on [Alpine](https://alpineapp.email/), the University of Washington's terminal mail client. Alpine is licensed Apache 2.0; Cairn is also licensed Apache 2.0. Cairn is implemented fresh in TypeScript and references Alpine's source for menu flows, screen layouts, key handling, and edge cases. Where a Cairn routine is closely modeled on a specific Alpine routine the source is noted inline. The name "Alpine" belongs to UW and is not used in any Cairn branding, package name, or user-facing string.

Bundled monospace fonts:

- **JetBrains Mono** by JetBrains s.r.o., SIL Open Font License 1.1
- **IBM Plex Mono** by IBM, SIL Open Font License 1.1

See [NOTICE](NOTICE) for the full attribution notices.

## License

[Apache 2.0](LICENSE). Copyright 2026 Dennis Koch.
