export type AuthStatus = {
  authenticated: boolean
  email?: string
  encryptionAvailable: boolean
}

export interface CairnApi {
  ping(): Promise<'pong'>
  prefs: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }
  auth: {
    start(): Promise<{ email: string }>
    status(): Promise<AuthStatus>
    signOut(): Promise<void>
  }
}

declare global {
  interface Window {
    cairn: CairnApi
  }
}

export {}
