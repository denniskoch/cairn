/// <reference types="vite/client" />
import Database from 'better-sqlite3'

const migrationModules = import.meta.glob('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface Migration {
  version: number
  name: string
  sql: string
}

const migrations: Migration[] = Object.entries(migrationModules)
  .map(([path, sql]) => {
    const match = path.match(/\/(\d{3})_(.+)\.sql$/)
    if (!match) {
      throw new Error(
        `migration filename must match NNN_name.sql: ${path}`,
      )
    }
    return { version: parseInt(match[1], 10), name: match[2], sql }
  })
  .sort((a, b) => a.version - b.version)

export function openDatabase(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)

  const appliedRows = db
    .prepare('SELECT version FROM schema_version')
    .all() as { version: number }[]
  const applied = new Set(appliedRows.map((r) => r.version))

  const recordVersion = db.prepare(
    'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)',
  )

  for (const m of migrations) {
    if (applied.has(m.version)) continue
    const tx = db.transaction(() => {
      db.exec(m.sql)
      recordVersion.run(m.version, m.name, Date.now())
    })
    tx()
  }
}
