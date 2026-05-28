const DEFAULT_CLIENT_ID = '3024d6d3-fa6a-42ba-aa1c-3cd9c257761c'

// 'common' = any work/school account + personal MSAs. Matches the registration's
// "all account types" choice. Override to a specific tenant ID via env to restrict.
// (The app itself lives in tenant 77df431d-f3b2-4b9e-bcbb-fbe0363ccf3c.)
const DEFAULT_TENANT_ID = 'common'

export const authConfig = {
  clientId: process.env.CAIRN_AZURE_CLIENT_ID ?? DEFAULT_CLIENT_ID,
  tenantId: process.env.CAIRN_AZURE_TENANT_ID ?? DEFAULT_TENANT_ID,
  scopes: [
    'Mail.ReadWrite',
    'Mail.Send',
    'MailboxSettings.Read',
    // Read meeting invites + Accept / Tentative / Decline.
    'Calendars.ReadWrite',
    // Personal Address Book (read + add/edit).
    'Contacts.ReadWrite',
    // Microsoft's auto-curated "people you actually email" list for
    // autocomplete suggestions. User-consentable.
    'People.Read',
    // Org-wide GAL search via /users. ADMIN CONSENT REQUIRED in most
    // tenants — the first user in a tenant without prior consent will
    // see the consent prompt block on this one. Keep it last so the
    // others still apply if an admin only partial-consents.
    'User.ReadBasic.All',
    'offline_access',
    'User.Read',
  ],
}

export function authority(): string {
  return `https://login.microsoftonline.com/${authConfig.tenantId}`
}
