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
  private currentFolderId: string | null = null

  constructor(
    private readonly cache: MailCache,
    private readonly getToken: GetTokenFn,
  ) {}

  start(): void {
    if (this.inboxTimer) return
    this.inboxTimer = setInterval(() => {
      this.pollWatched()
    }, INBOX_INTERVAL_MS)
  }

  stop(): void {
    if (this.inboxTimer) {
      clearInterval(this.inboxTimer)
      this.inboxTimer = null
    }
  }

  /** The renderer sets this to whatever folder the user is currently
   * viewing so the periodic poller picks up new messages there too,
   * not only in the inbox. Pass null when no folder is open.
   *
   * Does NOT trigger an immediate refresh — listMessages already kicks
   * the right call (firstPage for empty cache, refreshFolder for
   * populated cache). Racing with it here would steal the inflight slot
   * from firstPage and leave the UI showing "(no messages)" until the
   * background initialSync finishes. */
  setCurrentFolder(id: string | null): void {
    this.currentFolderId = id
  }

  /** Poll the folder the user is looking at first so newer messages
   * there appear without waiting on inbox; fall back to inbox so
   * background notifications still work when the user is elsewhere. */
  private pollWatched(): void {
    const order: string[] = []
    if (this.currentFolderId) order.push(this.currentFolderId)
    if (!order.includes('inbox')) order.push('inbox')
    for (const folder of order) {
      this.refreshFolder(folder).catch((err) => {
        console.warn(`sync: ${folder} refresh failed:`, err)
      })
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

  /** Pages further into history than the initial bootstrap covered.
   * Called when the renderer scrolls past what's in cache. Does NOT touch
   * the high-water mark — that tracks how far forward we've synced, and
   * backfill works the other direction. Returns the number of new messages
   * inserted into the cache so the caller knows whether to keep paging. */
  async backfill(
    folderId: string,
    beforeReceivedAtMs: number,
    limit: number,
  ): Promise<number> {
    const key = `backfill:${folderId}:${beforeReceivedAtMs}`
    if (this.inflight.has(key)) return 0
    this.beginSync(key)
    try {
      const filter = `receivedDateTime lt ${new Date(beforeReceivedAtMs).toISOString()}`
      const result = await fetchMessagesWindow(this.getToken, folderId, {
        filter,
        limit,
      })
      let inserted = 0
      for (const m of result.messages) {
        if (!this.cache.hasMessage(m.id)) inserted++
        this.cache.upsertMessageHeader(folderId, m)
      }
      return inserted
    } finally {
      this.endSync(key)
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
