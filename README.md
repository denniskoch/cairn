# Cairn

A keyboard-driven desktop mail client in the spirit of Alpine. Cross-platform Electron app with an xterm.js terminal UI. Plain text first.

## Status

Pre-alpha. Nothing builds yet. See [docs/SPEC.md](docs/SPEC.md) for the full design.

## Stack

- Electron + TypeScript (main, renderer, shared)
- xterm.js for the renderer UI
- `better-sqlite3` for the local cache
- `@azure/msal-node` for OAuth (PKCE + loopback)
- Microsoft Graph is the first mail backend; IMAP planned

## Design principles

1. **Keyboard-first.** No mouse required for any operation.
2. **Plain text mail.** HTML is sanitized and converted to text. No inline images. **No remote content loading, ever.**
3. **Provider-agnostic core.** One `MailProvider` interface, swappable implementations.
4. **One binary per platform.** No server, no Docker, no certs.
5. **Local-first cache.** SQLite holds folders, headers, bodies. Network is for sync, not for reads.

## Attribution

The interface is modeled on [Alpine](https://alpineapp.email/), the University of Washington's terminal mail client. Alpine is licensed Apache 2.0; Cairn is also licensed Apache 2.0. Cairn is implemented fresh in TypeScript and references Alpine's source as a reference for menu flows, screen layouts, key handling, and edge cases. Where a Cairn routine is closely modeled on a specific Alpine routine, the source is noted inline. The name "Alpine" belongs to UW and is not used in any Cairn branding, package name, or user-facing string.

## License

[Apache 2.0](LICENSE).
