import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  MANIFEST_VERSION,
  PROOFGATE_DIR,
  TOOL_NAME,
  TOOL_VERSION,
  byteLength,
  normalizeRelative,
  nowIso,
  redactSecrets,
  safeJoin,
  sha256File,
  shortHash,
  slugify,
  toPosix,
  type CheckResult,
  type EvidenceEntry,
  type EvidenceSummary,
} from '@proofgate/shared'
import type {
  EvidenceCheckWrite,
  EvidenceManifest,
  EvidencePruneOptions,
  EvidencePruneResult,
  EvidenceSummaryInput,
  EvidenceVerifyProblem,
  EvidenceVerifyResult,
} from './types.js'

export function runsDirFor(root: string): string {
  return path.join(root, PROOFGATE_DIR, 'runs')
}

export function runDirFor(root: string, runId: string): string {
  assertRunId(runId)
  return path.join(root, PROOFGATE_DIR, 'runs', runId)
}

export function manifestPathFor(root: string, runId: string): string {
  return path.join(runDirFor(root, runId), 'manifest.json')
}

export function evidenceDirRel(runId: string): string {
  assertRunId(runId)
  return normalizeRelative(`${PROOFGATE_DIR}/runs/${runId}`)
}

export function assertRunId(runId: string): void {
  if (!/^run_[0-9a-z]{26}$/.test(runId)) {
    throw new Error(`unsafe run id: ${runId}`)
  }
}

async function atomicWrite(targetPath: string, contents: string | Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  const temporary = `${targetPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await fsp.writeFile(temporary, contents)
  await fsp.rename(temporary, targetPath)
}

function redactText(value: string): { text: string; redacted: boolean } {
  const result = redactSecrets(value)
  return { text: result.text, redacted: result.redacted }
}

function redactChunk(chunk: CheckResult['stdout']): { chunk: CheckResult['stdout']; redacted: boolean } {
  const result = redactText(chunk.text)
  if (!result.redacted) return { chunk, redacted: false }
  return {
    chunk: {
      text: result.text,
      bytes: byteLength(result.text),
      totalBytes: Math.max(chunk.totalBytes, beenBytes(result.text, chunk.totalBytes)),
      truncated: chunk.truncated,
    },
    redacted: true,
  }
}

function beenBytes(text: string, fallback: number): number {
  return Math.max(byteLength(text), fallback)
}

/** Redact every human-readable field before it is persisted or reported. */
export function redactCheckResult(result: CheckResult): { result: CheckResult; redacted: boolean } {
  let redacted = false
  const stdout = redactChunk(result.stdout)
  const stderr = redactChunk(result.stderr)
  redacted ||= stdout.redacted || stderr.redacted

  const summary = redactText(result.summary)
  redacted ||= summary.redacted

  const findings = result.findings.map((finding) => {
    const message = redactText(finding.message)
    const details = finding.details === undefined ? undefined : redactText(finding.details)
    if (message.redacted || details?.redacted) redacted = true
    return {
      ...finding,
      message: message.text,
      ...(details ? { details: details.text } : {}),
    }
  })

  let errorMessage = result.errorMessage
  if (errorMessage !== undefined) {
    const value = redactText(errorMessage)
    errorMessage = value.text
    redacted ||= value.redacted
  }
  let skipReason = result.skipReason
  if (skipReason !== undefined) {
    const value = redactText(skipReason)
    skipReason = value.text
    redacted ||= value.redacted
  }

  return {
    redacted,
    result: {
      ...result,
      summary: summary.text,
      stdout: stdout.chunk,
      stderr: stderr.chunk,
      findings,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      ...(skipReason !== undefined ? { skipReason } : {}),
    },
  }
}

function safeCheckBase(id: string): string {
  return `${slugify(id, 'check')}-${shortHash(id, 6)}`
}

function kindForPath(relativePath: string): EvidenceEntry['kind'] {
  if (relativePath.endsWith('.log')) return 'log'
  if (relativePath.endsWith('summary.json')) return 'summary'
  if (relativePath.endsWith('.json')) return 'json'
  return 'artifact'
}

/**
 * Writes a single run's evidence bundle:
 *
 *   .proofgate/runs/<runId>/
 *     checks/<slug>.stdout.log
 *     checks/<slug>.stderr.log
 *     checks/<slug>.json
 *     summary.json
 *     manifest.json
 *
 * `run.json` is written by storage and is deliberately not covered by the
 * manifest: the report embeds the manifest hash, so covering `run.json` would
 * create a hash fixed-point. The manifest attests the raw evidence instead.
 */
export class EvidenceWriter {
  readonly runId: string
  readonly dir: string
  private readonly entries: EvidenceEntry[] = []
  private redacted = false
  private summaryWritten = false
  private finalized: EvidenceSummary | null = null

  constructor(
    private readonly root: string,
    runId: string,
  ) {
    assertRunId(runId)
    this.runId = runId
    this.dir = runDirFor(root, runId)
  }

  private relative(absolute: string): string {
    return normalizeRelative(path.relative(this.root, absolute))
  }

  private async record(absolute: string): Promise<EvidenceEntry> {
    const stat = await fsp.stat(absolute)
    const relativePath = this.relative(absolute)
    const entry: EvidenceEntry = {
      path: relativePath,
      sha256: await sha256File(absolute),
      bytes: stat.size,
      kind: kindForPath(relativePath),
    }
    const existing = this.entries.findIndex((candidate) => candidate.path === entry.path)
    if (existing >= 0) this.entries[existing] = entry
    else this.entries.push(entry)
    return entry
  }

  private async write(relativePath: string, contents: string): Promise<EvidenceEntry> {
    const absolute = safeJoin(this.dir, normalizeRelative(relativePath))
    await atomicWrite(absolute, contents)
    return this.record(absolute)
  }

  async writeCheck(check: CheckResult): Promise<EvidenceCheckWrite> {
    if (this.finalized) throw new Error('evidence bundle has already been finalized')
    const { result, redacted } = redactCheckResult(check)
    this.redacted ||= redacted
    const base = `checks/${safeCheckBase(check.id)}`
    await this.write(`${base}.stdout.log`, result.stdout.text)
    await this.write(`${base}.stderr.log`, result.stderr.text)
    await this.write(`${base}.json`, `${JSON.stringify(result, null, 2)}\n`)
    const files = this.entries
      .filter((entry) => entry.path.includes(base))
      .map((entry) => entry.path)
      .sort()
    return {
      result: {
        ...result,
        artifacts: [...new Set([...(result.artifacts ?? []), ...files])].sort(),
      },
      files,
    }
  }

  async writeSummary(input: EvidenceSummaryInput): Promise<void> {
    if (this.finalized) throw new Error('evidence bundle has already been finalized')
    if (this.summaryWritten) throw new Error('a summary has already been written')
    const payload = {
      schemaVersion: 1,
      runId: this.runId,
      createdAt: nowIso(),
      ...input,
    }
    await this.write('summary.json', `${JSON.stringify(payload, null, 2)}\n`)
    this.summaryWritten = true
  }

  async finalize(
    tool: { name: string; version: string } = { name: TOOL_NAME, version: TOOL_VERSION },
  ): Promise<EvidenceSummary> {
    if (this.finalized) return this.finalized
    const entries = [...this.entries].sort((a, b) => a.path.localeCompare(b.path))
    const manifest: EvidenceManifest = {
      schemaVersion: MANIFEST_VERSION,
      runId: this.runId,
      createdAt: nowIso(),
      entries,
      totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      redacted: this.redacted,
      tool,
    }
    const absolute = manifestPathFor(this.root, this.runId)
    await atomicWrite(absolute, `${JSON.stringify(manifest, null, 2)}\n`)
    this.finalized = {
      dir: evidenceDirRel(this.runId),
      manifestPath: this.relative(absolute),
      manifestHash: await sha256File(absolute),
      entries,
      totalBytes: manifest.totalBytes,
      redacted: manifest.redacted,
    }
    return this.finalized
  }
}

export async function readManifest(
  root: string,
  runId: string,
): Promise<{ manifest: EvidenceManifest | null; error?: string }> {
  const manifestPath = manifestPathFor(root, runId)
  try {
    const raw: unknown = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { manifest: null, error: 'manifest is not a JSON object' }
    }
    const candidate = raw as Partial<EvidenceManifest>
    if (
      candidate.schemaVersion !== 1 ||
      candidate.runId !== runId ||
      !Array.isArray(candidate.entries) ||
      typeof candidate.totalBytes !== 'number' ||
      typeof candidate.redacted !== 'boolean'
    ) {
      return { manifest: null, error: 'manifest does not match the expected schema' }
    }
    return { manifest: candidate as EvidenceManifest }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { manifest: null, error: 'manifest.json is missing' }
    }
    return { manifest: null, error: `cannot read manifest: ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = []
  const walk = async (current: string): Promise<void> => {
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) results.push(absolute)
    }
  }
  await walk(dir)
  return results
}

/** Recompute every manifest hash and flag files not covered by the manifest. */
export async function verifyEvidence(root: string, runId: string): Promise<EvidenceVerifyResult> {
  const { manifest, error } = await readManifest(root, runId)
  const manifestPath = manifestPathFor(root, runId)
  if (!manifest) {
    return {
      ok: false,
      manifestPath,
      checked: 0,
      problems: [{ path: toPosix(manifestPath), problem: 'missing', expected: error }],
    }
  }
  const problems: EvidenceVerifyProblem[] = []
  const listed = new Set<string>()
  for (const entry of manifest.entries) {
    listed.add(entry.path)
    const absolute = safeJoin(root, entry.path)
    try {
      const stat = await fsp.stat(absolute)
      if (stat.size !== entry.bytes) {
        problems.push({ path: entry.path, problem: 'size-mismatch', expected: String(entry.bytes), actual: String(stat.size) })
        continue
      }
      const hash = await sha256File(absolute)
      if (hash !== entry.sha256) {
        problems.push({ path: entry.path, problem: 'hash-mismatch', expected: entry.sha256, actual: hash })
      }
    } catch {
      problems.push({ path: entry.path, problem: 'missing' })
    }
  }

  const runDir = runDirFor(root, runId)
  try {
    const files = await listFilesRecursive(runDir)
    for (const absolute of files) {
      const relative = normalizeRelative(path.relative(root, absolute))
      if (relative.endsWith('/manifest.json') || relative.endsWith('/run.json')) continue
      if (!listed.has(relative)) problems.push({ path: relative, problem: 'unexpected' })
    }
  } catch {
    // An unreadable run directory already surfaces as missing evidence.
  }

  return { ok: problems.length === 0, manifestPath, checked: manifest.entries.length, problems }
}

export async function readEvidenceFile(
  root: string,
  runId: string,
  relativePath: string,
): Promise<{ path: string; content: string; bytes: number }> {
  const runDir = runDirFor(root, runId)
  const normalized = normalizeRelative(relativePath)
  if (normalized === '' || normalized === 'run.json' || normalized === 'manifest.json') {
    throw new Error(`refusing to read report metadata as evidence: ${relativePath}`)
  }
  const absolute = safeJoin(runDir, normalized)
  const content = await fsp.readFile(absolute, 'utf8')
  return { path: normalized, content, bytes: byteLength(content) }
}

function startedAtOfRunFile(text: string): string | null {
  try {
    const raw = JSON.parse(text) as { startedAt?: unknown }
    return typeof raw.startedAt === 'string' ? raw.startedAt : null
  } catch {
    return null
  }
}

/** Delete evidence for runs beyond the retention limits. */
export async function pruneEvidence(root: string, options: EvidencePruneOptions): Promise<EvidencePruneResult> {
  const keep = new Set(options.keep ?? [])
  const runsDir = runsDirFor(root)
  let names: string[]
  try {
    const entries = await fsp.readdir(runsDir, { withFileTypes: true })
    names = entries.filter((entry) => entry.isDirectory() && /^run_/.test(entry.name)).map((entry) => entry.name)
  } catch {
    return { removed: [], kept: 0 }
  }

  const candidates: Array<{ runId: string; startedAt: number }> = []
  for (const runId of names) {
    if (keep.has(runId)) continue
    const dir = path.join(runsDir, runId)
    let startedAt = 0
    try {
      const text = await fsp.readFile(path.join(dir, 'run.json'), 'utf8')
      const parsed = Date.parse(startedAtOfRunFile(text) ?? '')
      if (Number.isFinite(parsed)) startedAt = parsed
    } catch {
      // Fall back to directory mtime.
    }
    if (startedAt === 0) {
      try {
        startedAt = (await fsp.stat(dir)).mtimeMs
      } catch {
        startedAt = Date.now()
      }
    }
    candidates.push({ runId, startedAt })
  }

  candidates.sort((a, b) => b.startedAt - a.startedAt)
  const cutoff = Date.now() - options.maxAgeDays * 86_400_000
  const removed: string[] = []
  for (const [index, candidate] of candidates.entries()) {
    const tooOld = candidate.startedAt < cutoff
    const tooMany = index >= options.maxRuns
    if (!tooOld && !tooMany) continue
    try {
      await fsp.rm(path.join(runsDir, candidate.runId), { recursive: true, force: true })
      removed.push(candidate.runId)
    } catch {
      // Best effort: a locked run stays available and is retried next time.
    }
  }
  return { removed, kept: candidates.length - removed.length }
}

export async function deleteRunEvidence(root: string, runId: string): Promise<void> {
  await fsp.rm(runDirFor(root, runId), { recursive: true, force: true })
}

export async function evidenceUsage(root: string): Promise<{ runs: number; bytes: number }> {
  const runsDir = runsDirFor(root)
  let runs = 0
  let bytes = 0
  let names: string[]
  try {
    names = (await fsp.readdir(runsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return { runs: 0, bytes: 0 }
  }
  for (const name of names) {
    runs += 1
    try {
      for (const absolute of await listFilesRecursive(path.join(runsDir, name))) {
        bytes += (await fsp.stat(absolute)).size
      }
    } catch {
      // Ignore unreadable run directories.
    }
  }
  return { runs, bytes }
}

export { TOOL_VERSION }
