export interface CairnApi {
  ping(): Promise<'pong'>
  prefs: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }
}

declare global {
  interface Window {
    cairn: CairnApi
  }
}

export {}
