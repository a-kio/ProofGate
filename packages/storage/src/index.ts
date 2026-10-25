import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  DATABASE_REL_PATH,
  INDEX_REL_PATH,
  PROOFGATE_DIR,
  RUNS_REL_DIR,
  TOOL_VERSION,
  nowIso,
  type RunListItem,
  type RunReport,
} from '@proofgate/shared'

export interface RunStoreOptions {
  /** SQLite is used when available; JSON remains the portable fallback. */
  preferSqlite?: boolean
}

export interface RunStoreBackendInfo {
  backend: 'sqlite' | 'json'
  sqlitePath: string
  jsonPath: string
  sqliteError?: string
}

interface SqliteStatement {
  run(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

interface JsonIndex {
  schemaVersion: 1
  updatedAt: string
  runs: RunListItem[]
}

const MAX_INDEX_ENTRIES = 500

function emptyIndex(): JsonIndex {
  return { schemaVersion: 1, updatedAt: nowIso(), runs: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRunId(runId: string): void {
  if (!/^run_[0-9a-z]{26}$/.test(runId)) throw new Error(`unsafe run id: ${runId}`)
}

function toListItem(report: RunReport): RunListItem {
  return {
    id: report.id,
    status: report.status,
    mode: report.mode,
    profile: report.profile,
    ...(report.task ? { task: report.task } : {}),
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: report.durationMs,
    summary: report.summary,
    checks: report.checks.map((check) => ({
      id: check.id,
      title: check.title,
      status: check.status,
      required: check.required,
    })),
    evidenceDir: report.evidence.dir,
    intentHash: report.intent.hash,
  }
}

function normalizeListEntry(raw: unknown): RunListItem | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.status !== 'string' || typeof raw.startedAt !== 'string') return null
  return raw as unknown as RunListItem
}

async function atomicWrite(targetPath: string, contents: string): Promise<void> {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  const temporary = `${targetPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await fsp.writeFile(temporary, contents, 'utf8')
  await fsp.rename(temporary, targetPath)
}

async function loadSqlite(filePath: string): Promise<{ db: SqliteDatabase | null; error?: string }> {
  try {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    const module = (await import('node:sqlite')) as unknown as {
      DatabaseSync: new (path: string) => SqliteDatabase
    }
    if (typeof module.DatabaseSync !== 'function') {
      return { db: null, error: 'node:sqlite does not expose DatabaseSync' }
    }
    return { db: new module.DatabaseSync(filePath) }
  } catch (error) {
    return { db: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function ensureSchema(db: SqliteDatabase): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      profile TEXT NOT NULL,
      task TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      intent_hash TEXT NOT NULL,
      evidence_dir TEXT NOT NULL,
      list_json TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_started_at ON runs (started_at DESC);
    CREATE INDEX IF NOT EXISTS runs_status ON runs (status);
  `)
}

/**
 * Run storage with an honest dual backend. SQLite is used when the running
 * Node build exposes `node:sqlite`; otherwise the same data is indexed in
 * `.proofgate/index.json`. The per-run `run.json` is always authoritative.
 */
export class RunStore {
  private indexCache: JsonIndex | null = null
  private closed = false

  private constructor(
    readonly root: string,
    private readonly db: SqliteDatabase | null,
    readonly info: RunStoreBackendInfo,
  ) {}

  static async open(root: string, options: RunStoreOptions = {}): Promise<RunStore> {
    const sqlitePath = path.join(root, DATABASE_REL_PATH)
    const jsonPath = path.join(root, INDEX_REL_PATH)
    await fsp.mkdir(path.join(root, RUNS_REL_DIR), { recursive: true })
    let db: SqliteDatabase | null = null
    let sqliteError: string | undefined
    if (options.preferSqlite !== false) {
      const loaded = await loadSqlite(sqlitePath)
      db = loaded.db
      sqliteError = loaded.error
      if (db) {
        try {
          ensureSchema(db)
        } catch (error) {
          sqliteError = error instanceof Error ? error.message : String(error)
          try {
            db.close()
          } catch {
            // ignore
          }
          db = null
        }
      }
    }
    return new RunStore(root, db, {
      backend: db ? 'sqlite' : 'json',
      sqlitePath,
      jsonPath,
      ...(sqliteError ? { sqliteError } : {}),
    })
  }

  get runsDir(): string {
    return path.join(this.root, RUNS_REL_DIR)
  }

  runDir(runId: string): string {
    assertRunId(runId)
    return path.join(this.runsDir, runId)
  }

  private runFile(runId: string): string {
    return path.join(this.runDir(runId), 'run.json')
  }

  async saveRun(report: RunReport): Promise<void> {
    if (this.closed) throw new Error('run store is closed')
    assertRunId(report.id)
    const listItem = toListItem(report)
    const dir = this.runDir(report.id)
    await fsp.mkdir(dir, { recursive: true })
    await atomicWrite(this.runFile(report.id), `${JSON.stringify(report, null, 2)}\n`)

    const index = await this.readIndex()
    index.runs = [listItem, ...index.runs.filter((entry) => entry.id !== listItem.id)]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, MAX_INDEX_ENTRIES)
    index.updatedAt = nowIso()
    await atomicWrite(this.info.jsonPath, `${JSON.stringify(index, null, 2)}\n`)
    this.indexCache = index

    if (this.db) {
      try {
        this.db
          .prepare(
            `INSERT INTO runs (id, status, mode, profile, task, started_at, finished_at, duration_ms, intent_hash, evidence_dir, list_json, report_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               status=excluded.status, mode=excluded.mode, profile=excluded.profile, task=excluded.task,
               started_at=excluded.started_at, finished_at=excluded.finished_at, duration_ms=excluded.duration_ms,
               intent_hash=excluded.intent_hash, evidence_dir=excluded.evidence_dir,
               list_json=excluded.list_json, report_json=excluded.report_json`,
          )
          .run(
            report.id,
            report.status,
            report.mode,
            report.profile,
            report.task ?? null,
            report.startedAt,
            report.finishedAt,
            report.durationMs,
            report.intent.hash,
            report.evidence.dir,
            JSON.stringify(listItem),
            JSON.stringify(report),
            nowIso(),
          )
      } catch {
        // The JSON index was already updated; SQLite is an accelerator, not the source of truth.
      }
    }
  }

  private async readIndex(): Promise<JsonIndex> {
    if (this.indexCache) return this.indexCache
    try {
      const raw: unknown = JSON.parse(await fsp.readFile(this.info.jsonPath, 'utf8'))
      if (isRecord(raw) && raw.schemaVersion === 1 && Array.isArray(raw.runs)) {
        const runs = raw.runs
          .map(normalizeListEntry)
          .filter((entry): entry is RunListItem => entry !== null)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        this.indexCache = { schemaVersion: 1, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(), runs }
        return this.indexCache
      }
    } catch {
      // A missing or corrupt index is rebuilt from disk below.
    }
    const rebuilt = await this.rebuildIndex()
    this.indexCache = rebuilt
    return rebuilt
  }

  private async rebuildIndex(): Promise<JsonIndex> {
    const index = emptyIndex()
    let names: string[] = []
    try {
      names = (await fsp.readdir(this.runsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^run_[0-9a-z]{26}$/.test(entry.name))
        .map((entry) => entry.name)
    } catch {
      return index
    }
    for (const runId of names) {
      try {
        const report = await this.getRun(runId)
        if (report) index.runs.push(toListItem(report))
      } catch {
        // Skip corrupt run records instead of failing the whole store.
      }
    }
    index.runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    index.runs = index.runs.slice(0, MAX_INDEX_ENTRIES)
    await atomicWrite(this.info.jsonPath, `${JSON.stringify(index, null, 2)}\n`)
    return index
  }

  async getRun(runId: string): Promise<RunReport | null> {
    assertRunId(runId)
    try {
      const raw: unknown = JSON.parse(await fsp.readFile(this.runFile(runId), 'utf8'))
      if (!isRecord(raw) || raw.schemaVersion !== 1 || raw.id !== runId) return null
      return raw as unknown as RunReport
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async listRuns(limit = 50): Promise<RunListItem[]> {
    if (limit <= 0) return []
    if (this.db) {
      try {
        const rows = this.db
          .prepare('SELECT list_json FROM runs ORDER BY started_at DESC LIMIT ?')
          .all(limit)
        if (Array.isArray(rows)) {
          return rows
            .map((row) => (isRecord(row) && typeof row.list_json === 'string' ? JSON.parse(row.list_json) : null))
            .map(normalizeListEntry)
            .filter((entry): entry is RunListItem => entry !== null)
        }
      } catch {
        // Fall through to the JSON index.
      }
    }
    const index = await this.readIndex()
    return index.runs.slice(0, limit)
  }

  async latestRun(): Promise<RunReport | null> {
    const runs = await this.listRuns(1)
    const first = runs[0]
    return first ? this.getRun(first.id) : null
  }

  async deleteRun(runId: string): Promise<boolean> {
    assertRunId(runId)
    let existed = false
    try {
      await fsp.rm(this.runDir(runId), { recursive: true, force: true })
      existed = true
    } catch {
      existed = false
    }
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM runs WHERE id = ?').run(runId)
      } catch {
        // JSON cleanup below still applies.
      }
    }
    const index = await this.readIndex()
    const before = index.runs.length
    index.runs = index.runs.filter((entry) => entry.id !== runId)
    index.updatedAt = nowIso()
    await atomicWrite(this.info.jsonPath, `${JSON.stringify(index, null, 2)}\n`)
    this.indexCache = index
    return existed || index.runs.length !== before
  }

  async prune(retention: { maxRuns: number; maxAgeDays: number }, keep: string[] = []): Promise<string[]> {
    const keepSet = new Set(keep)
    const all = await this.listRuns(MAX_INDEX_ENTRIES)
    const cutoff = Date.now() - retention.maxAgeDays * 86_400_000
    const removed: string[] = []
    for (const [index, item] of all.entries()) {
      if (keepSet.has(item.id)) continue
      const started = Date.parse(item.startedAt)
      const tooOld = Number.isFinite(started) && started < cutoff
      const tooMany = index >= retention.maxRuns
      if (!tooOld && !tooMany) continue
      if (await this.deleteRun(item.id)) removed.push(item.id)
    }
    return removed
  }

  async summary(): Promise<{ runs: number; backend: 'sqlite' | 'json'; toolVersion: string }> {
    const runs = await this.listRuns(MAX_INDEX_ENTRIES)
    return { runs: runs.length, backend: this.info.backend, toolVersion: TOOL_VERSION }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.db) {
      try {
        this.db.close()
      } catch {
        // Closing is best effort.
      }
    }
  }
}

export async function openRunStore(root: string, options: RunStoreOptions = {}): Promise<RunStore> {
  return RunStore.open(root, options)
}

/** Remove every stored run and index entry, leaving the store empty. */
export async function clearRunStore(root: string): Promise<number> {
  const store = await openRunStore(root)
  try {
    const runs = await store.listRuns(MAX_INDEX_ENTRIES)
    for (const run of runs) await store.deleteRun(run.id)
    return runs.length
  } finally {
    await store.close()
  }
}

export { PROOFGATE_DIR }
