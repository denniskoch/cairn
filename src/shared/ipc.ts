export interface CairnApi {
  ping(): Promise<'pong'>
}

declare global {
  interface Window {
    cairn: CairnApi
  }
}

export {}
