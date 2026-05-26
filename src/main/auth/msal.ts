import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type ICachePlugin,
  type TokenCacheContext,
} from '@azure/msal-node'
import { shell, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { authConfig, authority } from './config'

let db: Database.Database | null = null
let pca: PublicClientApplication | null = null
let currentAccount: AccountInfo | null = null
let currentAccountId: string | null = null

const successTemplate = `<!doctype html>
<html><head><title>Cairn</title><style>
body { font-family: ui-monospace, Menlo, monospace; max-width: 480px; margin: 80px auto; padding: 24px; background: #000; color: #33ff33; }
h1 { font-size: 18px; margin: 0 0 12px; }
</style></head>
<body><h1>Cairn — signed in</h1><p>You can close this window and return to Cairn.</p></body></html>`

const errorTemplate = `<!doctype html>
<html><head><title>Cairn</title><style>
body { font-family: ui-monospace, Menlo, monospace; max-width: 480px; margin: 80px auto; padding: 24px; background: #000; color: #ff5555; }
h1 { font-size: 18px; margin: 0 0 12px; }
</style></head>
<body><h1>Cairn — sign-in failed</h1><p>Close this window and try again in Cairn.</p></body></html>`

const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(_: TokenCacheContext) {
    // Cache is loaded explicitly during restoreSession(); nothing per-access.
  },
  async afterCacheAccess(context: TokenCacheContext) {
    if (!context.cacheHasChanged || !db || !currentAccountId) return
    if (!safeStorage.isEncryptionAvailable()) return
    const json = context.tokenCache.serialize()
    const enc = safeStorage.encryptString(json)
    db.prepare(`
      INSERT INTO auth_tokens (account_id, refresh_token_enc, homeAccountId, scope, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        refresh_token_enc = excluded.refresh_token_enc,
        homeAccountId = excluded.homeAccountId,
        scope = excluded.scope,
        updated_at = excluded.updated_at
    `).run(
      currentAccountId,
      enc,
      currentAccount?.homeAccountId ?? null,
      authConfig.scopes.join(' '),
      Date.now(),
    )
  },
}

export async function initAuth(database: Database.Database): Promise<void> {
  db = database
  pca = new PublicClientApplication({
    auth: {
      clientId: authConfig.clientId,
      authority: authority(),
    },
    cache: { cachePlugin },
  })
  await restoreSession()
}

async function restoreSession(): Promise<void> {
  if (!db || !pca) return
  if (!safeStorage.isEncryptionAvailable()) return

  const row = db
    .prepare(
      `
    SELECT a.id AS account_id, t.refresh_token_enc
    FROM accounts a JOIN auth_tokens t ON a.id = t.account_id
    WHERE a.provider = 'graph'
    LIMIT 1
  `,
    )
    .get() as { account_id: string; refresh_token_enc: Buffer } | undefined

  if (!row) return

  try {
    const json = safeStorage.decryptString(row.refresh_token_enc)
    pca.getTokenCache().deserialize(json)
    const accounts = await pca.getTokenCache().getAllAccounts()
    currentAccount = accounts[0] ?? null
    currentAccountId = row.account_id

    if (currentAccount) {
      await pca.acquireTokenSilent({
        scopes: authConfig.scopes,
        account: currentAccount,
      })
    }
  } catch (err) {
    console.warn('auth: restoring session failed, clearing stored tokens:', err)
    db.prepare('DELETE FROM accounts WHERE id = ?').run(row.account_id)
    currentAccount = null
    currentAccountId = null
  }
}

export async function startInteractive(): Promise<{ email: string }> {
  if (!pca || !db) throw new Error('auth: not initialized')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'auth: OS keychain encryption is unavailable. On Linux, install libsecret.',
    )
  }

  const result = await pca.acquireTokenInteractive({
    scopes: authConfig.scopes,
    openBrowser: async (url) => {
      await shell.openExternal(url)
    },
    successTemplate,
    errorTemplate,
  })

  if (!result.account) {
    throw new Error('auth: interactive flow returned no account')
  }

  currentAccount = result.account
  const email = result.account.username
  const displayName = result.account.name ?? null

  const existing = db
    .prepare("SELECT id FROM accounts WHERE provider = 'graph' AND email = ?")
    .get(email) as { id: string } | undefined
  const accountId = existing?.id ?? randomUUID()

  db.prepare(`
    INSERT INTO accounts (id, provider, email, display_name, created_at)
    VALUES (?, 'graph', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name
  `).run(accountId, email, displayName, Date.now())

  currentAccountId = accountId

  const json = pca.getTokenCache().serialize()
  const enc = safeStorage.encryptString(json)
  db.prepare(`
    INSERT INTO auth_tokens (account_id, refresh_token_enc, homeAccountId, scope, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      refresh_token_enc = excluded.refresh_token_enc,
      homeAccountId = excluded.homeAccountId,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run(
    accountId,
    enc,
    currentAccount.homeAccountId,
    authConfig.scopes.join(' '),
    Date.now(),
  )

  return { email }
}

export async function getStatus(): Promise<{
  authenticated: boolean
  email?: string
  encryptionAvailable: boolean
}> {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  if (currentAccount) {
    return { authenticated: true, email: currentAccount.username, encryptionAvailable }
  }
  return { authenticated: false, encryptionAvailable }
}

export function getCurrentAccountId(): string | null {
  return currentAccountId
}

export async function getAccessToken(): Promise<string> {
  if (!pca || !currentAccount) {
    throw new Error('auth: not authenticated')
  }
  try {
    const result = await pca.acquireTokenSilent({
      scopes: authConfig.scopes,
      account: currentAccount,
    })
    return result.accessToken
  } catch (err) {
    // Refresh-token-permanently-bad: clear state so the user is forced
    // through interactive auth on next attempt. Transient errors (network,
    // service outage) bubble up untouched so callers can retry.
    if (err instanceof InteractionRequiredAuthError && db && currentAccountId) {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(currentAccountId)
      currentAccount = null
      currentAccountId = null
    }
    throw err
  }
}

export async function signOut(): Promise<void> {
  if (!db || !pca) return
  if (currentAccount) {
    await pca.getTokenCache().removeAccount(currentAccount)
  }
  if (currentAccountId) {
    db.prepare('DELETE FROM accounts WHERE id = ?').run(currentAccountId)
  }
  currentAccount = null
  currentAccountId = null
}
