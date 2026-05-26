import type Database from 'better-sqlite3'
import type {
  Address,
  Folder,
  Message,
  MessageHeader,
} from '../../shared/mail'

type FolderRow = {
  account_id: string
  id: string
  provider_id: string
  name: string
  parent_id: string | null
  unread_count: number
  total_count: number
  delta_cursor: string | null
}

type MessageRow = {
  account_id: string
  id: string
  folder_id: string
  provider_id: string
  thread_id: string | null
  from_addr: string
  to_addrs: string
  cc_addrs: string
  subject: string | null
  received_at: number
  preview: string | null
  has_attachments: number
  is_read: number
  is_flagged: number
  is_draft: number
  size_bytes: number | null
  body_text: string | null
  body_html: string | null
  raw_headers: string | null
  fetched_at: number | null
}

const HWM_PREFIX = 'ts:'

export class MailCache {
  constructor(
    private readonly db: Database.Database,
    private readonly accountId: string,
  ) {}

  // ----- folders -----

  upsertFolder(folder: {
    id: string
    name: string
    parentId: string | null
    unreadCount: number
    totalCount: number
  }): void {
    this.db
      .prepare(
        `INSERT INTO folders (account_id, id, provider_id, name, parent_id, unread_count, total_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, id) DO UPDATE SET
           name = excluded.name,
           parent_id = excluded.parent_id,
           unread_count = excluded.unread_count,
           total_count = excluded.total_count`,
      )
      .run(
        this.accountId,
        folder.id,
        folder.id,
        folder.name,
        folder.parentId,
        folder.unreadCount,
        folder.totalCount,
      )
  }

  listFolders(): Folder[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM folders WHERE account_id = ? ORDER BY name COLLATE NOCASE`,
      )
      .all(this.accountId) as FolderRow[]
    return rows.map(rowToFolder)
  }

  setHighWaterMark(folderId: string, receivedAtMs: number): void {
    this.db
      .prepare(
        `UPDATE folders SET delta_cursor = ? WHERE account_id = ? AND id = ?`,
      )
      .run(`${HWM_PREFIX}${receivedAtMs}`, this.accountId, folderId)
  }

  getHighWaterMark(folderId: string): number | null {
    const row = this.db
      .prepare(
        `SELECT delta_cursor FROM folders WHERE account_id = ? AND id = ?`,
      )
      .get(this.accountId, folderId) as { delta_cursor: string | null } | undefined
    if (!row?.delta_cursor?.startsWith(HWM_PREFIX)) return null
    const ms = parseInt(row.delta_cursor.slice(HWM_PREFIX.length), 10)
    return Number.isFinite(ms) ? ms : null
  }

  // ----- messages -----

  upsertMessageHeader(folderId: string, m: MessageHeader): void {
    this.db
      .prepare(
        `INSERT INTO messages (
           account_id, id, folder_id, provider_id, thread_id,
           from_addr, to_addrs, cc_addrs, subject, received_at,
           preview, has_attachments, is_read, is_flagged, is_draft,
           size_bytes, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, id) DO UPDATE SET
           folder_id = excluded.folder_id,
           thread_id = excluded.thread_id,
           from_addr = excluded.from_addr,
           to_addrs = excluded.to_addrs,
           cc_addrs = excluded.cc_addrs,
           subject = excluded.subject,
           received_at = excluded.received_at,
           preview = excluded.preview,
           has_attachments = excluded.has_attachments,
           is_read = excluded.is_read,
           is_flagged = excluded.is_flagged,
           is_draft = excluded.is_draft,
           size_bytes = excluded.size_bytes,
           fetched_at = excluded.fetched_at`,
      )
      .run(
        this.accountId,
        m.id,
        folderId,
        m.id,
        m.threadId ?? null,
        JSON.stringify(m.from),
        JSON.stringify(m.to),
        JSON.stringify(m.cc),
        m.subject,
        m.receivedAt.getTime(),
        m.preview,
        m.hasAttachments ? 1 : 0,
        m.flags.read ? 1 : 0,
        m.flags.flagged ? 1 : 0,
        m.flags.draft ? 1 : 0,
        m.sizeBytes,
        Date.now(),
      )
  }

  upsertMessageFull(folderId: string, m: Message): void {
    this.upsertMessageHeader(folderId, m)
    this.db
      .prepare(
        `UPDATE messages SET body_text = ?, body_html = ?, raw_headers = ?
         WHERE account_id = ? AND id = ?`,
      )
      .run(
        m.bodyText,
        m.bodyHtml ?? null,
        JSON.stringify(m.headers),
        this.accountId,
        m.id,
      )
  }

  deleteMessage(id: string): void {
    this.db
      .prepare(`DELETE FROM messages WHERE account_id = ? AND id = ?`)
      .run(this.accountId, id)
  }

  setLocalFlags(id: string, flags: { read?: boolean; flagged?: boolean }): void {
    const sets: string[] = []
    const params: (number | string)[] = []
    if (flags.read !== undefined) {
      sets.push('is_read = ?')
      params.push(flags.read ? 1 : 0)
    }
    if (flags.flagged !== undefined) {
      sets.push('is_flagged = ?')
      params.push(flags.flagged ? 1 : 0)
    }
    if (sets.length === 0) return
    params.push(this.accountId, id)
    this.db
      .prepare(
        `UPDATE messages SET ${sets.join(', ')} WHERE account_id = ? AND id = ?`,
      )
      .run(...params)
  }

  moveLocal(id: string, destFolderId: string): void {
    this.db
      .prepare(
        `UPDATE messages SET folder_id = ? WHERE account_id = ? AND id = ?`,
      )
      .run(destFolderId, this.accountId, id)
  }

  hasMessages(folderId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM messages WHERE account_id = ? AND folder_id = ? LIMIT 1`,
      )
      .get(this.accountId, folderId)
    return row !== undefined
  }

  hasMessage(id: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM messages WHERE account_id = ? AND id = ? LIMIT 1`)
      .get(this.accountId, id)
    return row !== undefined
  }

  getMessageHeaders(
    folderId: string,
    opts: { limit?: number; cursor?: string; unreadOnly?: boolean },
  ): { messages: MessageHeader[]; nextCursor?: string } {
    const limit = opts.limit ?? 50
    const where: string[] = ['account_id = ?', 'folder_id = ?']
    const params: (string | number)[] = [this.accountId, folderId]

    if (opts.cursor) {
      const ts = parseInt(opts.cursor, 10)
      if (Number.isFinite(ts)) {
        where.push('received_at < ?')
        params.push(ts)
      }
    }
    if (opts.unreadOnly) {
      where.push('is_read = 0')
    }

    params.push(limit + 1)

    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE ${where.join(' AND ')}
         ORDER BY received_at DESC
         LIMIT ?`,
      )
      .all(...params) as MessageRow[]

    const hasMore = rows.length > limit
    const sliced = rows.slice(0, limit)
    const messages = sliced.map(rowToMessageHeader)
    const nextCursor = hasMore
      ? String(sliced[sliced.length - 1].received_at)
      : undefined
    return { messages, nextCursor }
  }

  getMessageFull(id: string): Message | null {
    const row = this.db
      .prepare(
        `SELECT * FROM messages WHERE account_id = ? AND id = ?`,
      )
      .get(this.accountId, id) as MessageRow | undefined
    if (!row || row.body_text === null) return null

    return {
      ...rowToMessageHeader(row),
      bodyText: row.body_text,
      bodyHtml: row.body_html ?? undefined,
      attachments: [], // Attachment metadata not cached separately in v1.
      headers: row.raw_headers ? JSON.parse(row.raw_headers) : {},
    }
  }
}

function rowToFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    unreadCount: row.unread_count,
    totalCount: row.total_count,
  }
}

function rowToMessageHeader(row: MessageRow): MessageHeader {
  return {
    id: row.id,
    threadId: row.thread_id ?? undefined,
    from: JSON.parse(row.from_addr) as Address,
    to: JSON.parse(row.to_addrs) as Address[],
    cc: JSON.parse(row.cc_addrs) as Address[],
    subject: row.subject ?? '',
    receivedAt: new Date(row.received_at),
    preview: row.preview ?? '',
    hasAttachments: row.has_attachments !== 0,
    flags: {
      read: row.is_read !== 0,
      flagged: row.is_flagged !== 0,
      draft: row.is_draft !== 0,
    },
    sizeBytes: row.size_bytes ?? 0,
  }
}
