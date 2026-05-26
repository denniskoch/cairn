export type MailErrorCode =
  | 'AUTH_EXPIRED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'PROVIDER'
  | 'UNKNOWN'

export class MailError extends Error {
  readonly code: MailErrorCode

  constructor(code: MailErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MailError'
    this.code = code
  }
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`MailProvider.${method} is not implemented`)
    this.name = 'NotImplementedError'
  }
}
