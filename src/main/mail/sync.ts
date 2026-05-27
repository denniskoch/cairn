import { EventEmitter } from 'node:events'
import type { MailEvent } from '../../shared/mail'
import type { MailCache } from './cache'
import type { GetTokenFn } from './graph-http'
import { fetchFolders, fetchMessagesWindow } from './graph-fetch'

const INITIAL_BOOTSTRAP_CAP = 200
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
    const TREE_KEY = '__folder_tree__'
    if (this.inflight.has(TREE_KEY)) return
    this.beginSync(TREE_KEY)
    try {
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
    } finally {
      this.endSync(TREE_KEY)
    }
  }

  /** Tracked inflight transitions. Emits 'syncStateChanged' on the
   * empty ↔ non-empty edges so the renderer can show a single sync
   * indicator without flickering per-folder. */
  private beginSync(key: string): void {
    const wasIdle = this.inflight.size === 0
    this.inflight.add(key)
    if (wasIdle && this.inflight.size > 0) {
      this.events.emit('syncStateChanged', true)
    }
  }

  private endSync(key: string): void {
    this.inflight.delete(key)
    if (this.inflight.size === 0) {
      this.events.emit('syncStateChanged', false)
    }
  }

  /** Fetches just a single page so the renderer can show something fast.
   * Does NOT set the high-water mark — the periodic poller must not think
   * we're caught up after just one page. Callers typically follow up by
   * kicking initialSync() in the background to continue the bootstrap. */
  async firstPage(folderId: string, limit: number): Promise<void> {
    if (this.inflight.has(folderId)) return
    this.beginSync(folderId)
    try {
      const result = await fetchMessagesWindow(this.getToken, folderId, { limit })
      for (const m of result.messages) {
        this.cache.upsertMessageHeader(folderId, m)
      }
    } finally {
      this.endSync(folderId)
    }
  }

  async initialSync(folderId: string): Promise<void> {
    if (this.inflight.has(folderId)) return
    this.beginSync(folderId)
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
      this.endSync(folderId)
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

    this.beginSync(folderId)
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
      this.endSync(folderId)
    }
  }
}
