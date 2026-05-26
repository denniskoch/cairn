import { EventEmitter } from 'node:events'
import type { MailEvent } from '../../shared/mail'
import type { MailCache } from './cache'
import type { GetTokenFn } from './graph-http'
import { fetchFolders, fetchMessagesWindow } from './graph-fetch'

const INITIAL_BOOTSTRAP_CAP = 500
const INBOX_INTERVAL_MS = 30_000

export type SyncEventName = 'mail'
export interface SyncEvents {
  mail: (event: MailEvent) => void
}

export class SyncScheduler {
  readonly events = new EventEmitter()
  private inboxTimer: NodeJS.Timeout | null = null
  private inflight = new Set<string>()

  constructor(
    private readonly cache: MailCache,
    private readonly getToken: GetTokenFn,
  ) {}

  start(): void {
    if (this.inboxTimer) return
    this.inboxTimer = setInterval(() => {
      this.refreshFolder('inbox').catch((err) => {
        console.warn('sync: inbox refresh failed:', err)
      })
    }, INBOX_INTERVAL_MS)
  }

  stop(): void {
    if (this.inboxTimer) {
      clearInterval(this.inboxTimer)
      this.inboxTimer = null
    }
  }

  async refreshFolderTree(): Promise<void> {
    const folders = await fetchFolders(this.getToken)
    for (const f of folders) {
      this.cache.upsertFolder({
        id: f.id,
        name: f.name,
        parentId: f.parentId ?? null,
        unreadCount: f.unreadCount,
        totalCount: f.totalCount,
      })
    }
  }

  async initialSync(folderId: string): Promise<void> {
    if (this.inflight.has(folderId)) return
    this.inflight.add(folderId)
    try {
      let nextCursor: string | undefined
      let total = 0
      let maxReceivedAt = 0

      while (total < INITIAL_BOOTSTRAP_CAP) {
        const result = await fetchMessagesWindow(this.getToken, folderId, {
          cursor: nextCursor,
          limit: 100,
        })
        for (const m of result.messages) {
          if (total >= INITIAL_BOOTSTRAP_CAP) break
          this.cache.upsertMessageHeader(folderId, m)
          if (m.receivedAt.getTime() > maxReceivedAt) {
            maxReceivedAt = m.receivedAt.getTime()
          }
          total++
        }
        if (!result.nextCursor || total >= INITIAL_BOOTSTRAP_CAP) break
        nextCursor = result.nextCursor
      }

      if (maxReceivedAt > 0) {
        this.cache.setHighWaterMark(folderId, maxReceivedAt)
      }
    } finally {
      this.inflight.delete(folderId)
    }
  }

  async refreshFolder(folderId: string): Promise<void> {
    if (this.inflight.has(folderId)) return
    const hwm = this.cache.getHighWaterMark(folderId)
    if (hwm === null) {
      // Never bootstrapped — fall through to initial sync.
      await this.initialSync(folderId)
      return
    }

    this.inflight.add(folderId)
    try {
      const filter = `receivedDateTime gt ${new Date(hwm).toISOString()}`
      let nextCursor: string | undefined
      let newHwm = hwm

      do {
        const result = await fetchMessagesWindow(this.getToken, folderId, {
          cursor: nextCursor,
          limit: 100,
          filter: nextCursor ? undefined : filter,
        })
        for (const m of result.messages) {
          const isNew = !this.cache.hasMessage(m.id)
          this.cache.upsertMessageHeader(folderId, m)
          if (m.receivedAt.getTime() > newHwm) {
            newHwm = m.receivedAt.getTime()
          }
          if (isNew) {
            this.events.emit('mail', {
              type: 'new',
              folder: folderId,
              message: m,
            } satisfies MailEvent)
          }
        }
        nextCursor = result.nextCursor
      } while (nextCursor)

      if (newHwm > hwm) {
        this.cache.setHighWaterMark(folderId, newHwm)
      }
    } finally {
      this.inflight.delete(folderId)
    }
  }
}
