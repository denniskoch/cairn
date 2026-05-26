# Cairn — Notes for Claude Code

Cairn is a keyboard-driven desktop mail client (Electron + xterm.js + TypeScript) inspired by Alpine. Plain text first. Pluggable mail backends; Microsoft Graph is the first provider.

**The canonical spec is [docs/SPEC.md](docs/SPEC.md). Read it before making non-trivial changes — this file is a short pointer, not a substitute.**

## Hard rules

- **Reading Alpine's source for reference is fine; don't copy code verbatim.** Cairn is modeled on Alpine and references its source as a reference under Apache 2.0. Alpine source is checked out at `./alpine-<version>/` (currently `./alpine-2.26/`) — gitignored, not part of Cairn. Use it to resolve "how does Alpine actually do X" questions for menu flows, layouts, key handling, edge cases. Write Cairn-side implementations fresh in TypeScript. Where the implementation is directly modeled on a specific Alpine routine, leave a brief comment noting the source (e.g. `// Modeled on Alpine's pith/mailcmd.c:check_for_move()`). If you ever directly port a substantial routine, preserve Alpine's copyright header for that file and update NOTICE.
- **Do not render HTML mail.** Sanitize, convert to text, display the text. No `<img>`, no inline CSS, no JS, no remote content of any kind — no link previews, no favicon fetches, nothing that resolves an external URL on the user's behalf.
- **Do not store tokens in plaintext.** Use Electron `safeStorage`. If `safeStorage.isEncryptionAvailable()` returns false (e.g. Linux without libsecret), refuse to store and surface the problem to the user.
- **Do not unilaterally pick new major libraries.** The v1 stack is locked in (see "Stack" below; rationale in [docs/SPEC.md](docs/SPEC.md) §"Resolved decisions"). For anything outside that list — additional UI libraries, parsers, schedulers, replacements for the picks already made — ask first.
- **Do not write a custom OAuth implementation.** Use `@azure/msal-node` with PKCE + loopback redirect.
- **Do not enable `nodeIntegration` in the renderer.** Use `contextBridge` + `contextIsolation`. All network I/O, SQLite, and keychain access live in the main process.
- **Do not commit secrets.** `.env.example` only.
- **Do not add features outside the spec without asking.** No threading UI, calendar, contacts manager, signatures, rules/filters, or multi-account UI in v1.

## Architecture in one paragraph

Main process owns all network I/O, SQLite, keychain, OAuth, sync schedulers, and `MailProvider` implementations. Renderer owns the xterm.js terminal, the screen state machine, the keybind dispatcher, and the compose buffer. They talk over a typed IPC contract that will live in `src/shared/ipc.ts`. The `MailProvider` interface is the single most important contract — get it right and IMAP slots in later as a self-contained task.

## Stack

- Electron + TypeScript (main, renderer, shared). **Pinned to `~41.7`** — Electron 42's V8 added an `ExternalPointerTypeTag` parameter to `External::New` that `better-sqlite3@12.10` doesn't compile against (10 errors in `v8-external.h`). Revisit the pin when better-sqlite3 ships a compatible release.
- xterm.js (WebGL renderer, fit + web-links addons) in the renderer
- `better-sqlite3` for the local cache (synchronous, embedded)
- `@azure/msal-node` for OAuth (PKCE + loopback)
- Electron `safeStorage` for refresh-token encryption
- `electron-vite` for the dev/build pipeline; `electron-builder` for packaging
- `sanitize-html` for inbound HTML (revisit if the strict allowlist hits limits)
- `html-to-text` for HTML → text conversion
- Raw `fetch` + a thin typed wrapper for Graph (no SDK)
- `vitest` for unit tests, `playwright` for renderer integration

## Build order

The spec has a numbered 21-step build order. Follow it top-to-bottom. Each step should produce something testable; don't skip ahead. Current status: nothing built yet — next step is #1 (Electron + Vite skeleton with a blank xterm and an IPC ping/pong).

## Model selection hints (from the spec)

- **Opus** for: MSAL/OAuth, token encryption + refresh, `MailProvider` design, Graph delta sync, SQLite schema, screen abstraction, keybind dispatcher.
- **Sonnet** for: individual screen implementations, GraphProvider method bodies, IPC wiring, tests, packaging config.
- **Haiku** for: README polish, docstrings, mechanical refactors.
