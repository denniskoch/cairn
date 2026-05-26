# Azure (Entra ID) app registration for Cairn

Cairn is a desktop client that authenticates against Microsoft Graph using the OAuth 2.0 **Authorization Code with PKCE** flow on a **loopback** redirect. The Azure side requires a one-time setup. This doc captures the exact portal steps so anyone can re-create or audit the registration.

There is no client secret — public/native clients don't have one, by design. PKCE is the proof-of-possession instead.

---

## 1. Sign in to the Azure portal

Go to <https://portal.azure.com> and switch to the directory you want Cairn to authenticate against. For personal use the directory is whichever tenant your Microsoft account belongs to.

## 2. Register the application

1. Open **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Fill in:
   - **Name**: `Cairn` (or whatever you want; user-visible during sign-in).
   - **Supported account types**: choose one:
     - *Accounts in this organizational directory only* — single tenant. Use this if Cairn should only sign in users from your tenant.
     - *Accounts in any organizational directory and personal Microsoft accounts* — multi-tenant + personal MSAs. Use this if you want personal `@outlook.com` / `@hotmail.com` accounts to work too.
   - **Redirect URI**:
     - Platform: **Public client/native (mobile & desktop)**.
     - Value: `http://localhost` — exactly that, no port. MSAL chooses a random loopback port at runtime and the platform matches by prefix.
3. Click **Register**.

## 3. Record the IDs

On the new app's **Overview** page, copy:

- **Application (client) ID** → goes into `CAIRN_AZURE_CLIENT_ID` (or the default in `src/main/auth/config.ts`).
- **Directory (tenant) ID** → goes into `CAIRN_AZURE_TENANT_ID` (single-tenant) or use `common` (multi-tenant + personal).

These are *not* secrets. Native client IDs are designed to be embedded in distributed binaries.

## 4. Authentication settings

Go to the app's **Authentication** blade and verify:

- Under **Platform configurations** you have **Mobile and desktop applications** with `http://localhost` listed.
- Under **Advanced settings**, set **Allow public client flows** → **Yes**. Without this the loopback flow fails with `AADSTS7000218`.

Save.

## 5. API permissions

Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**, and add:

| Permission | Purpose |
|---|---|
| `Mail.ReadWrite` | Read and modify mail (folders, messages, flags). |
| `Mail.Send` | Send mail. |
| `MailboxSettings.Read` | Read user's mailbox settings (timezone, etc. — used for date formatting). |
| `offline_access` | Issue a refresh token so silent re-auth works between launches. |
| `User.Read` | Read the signed-in user's basic profile (used to show their email/name). |

If you picked a tenant where you are an admin, grant admin consent for the tenant. Personal MSAs consent at sign-in time and don't need admin consent.

## 6. Certificates & secrets

Should be empty. Cairn is a public client; if a client secret existed it'd be useless (you can't ship a secret to a distributed binary).

---

## Wiring into Cairn

The defaults in `src/main/auth/config.ts` are baked in. To override (e.g., for a different tenant or a dev-vs-prod app registration), set these env vars before launching:

```bash
export CAIRN_AZURE_CLIENT_ID='...'
export CAIRN_AZURE_TENANT_ID='...'      # or 'common' for multi-tenant + personal
```

The authority URL is built as `https://login.microsoftonline.com/{tenant}`.

## Troubleshooting

- **`AADSTS50011: Redirect URI mismatch`** — the platform configuration on the app registration isn't `Public client/native` with `http://localhost`. Re-check step 4.
- **`AADSTS7000218: Request body must contain client_assertion or client_secret`** — "Allow public client flows" is off. Step 4 again.
- **Sign-in succeeds but `/me` returns 403** — API permissions weren't granted. Step 5; verify admin consent if applicable.
- **Browser tab opens then the app hangs** — MSAL's loopback listener didn't get the redirect. Most often a corporate proxy or antivirus is intercepting localhost traffic. Try from a different network.
