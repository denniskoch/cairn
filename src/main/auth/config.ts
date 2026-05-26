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
    'offline_access',
    'User.Read',
  ],
}

export function authority(): string {
  return `https://login.microsoftonline.com/${authConfig.tenantId}`
}
