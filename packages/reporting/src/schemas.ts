/** Published JSON Schemas for artifacts other tools consume. */

const checkStatus = { enum: ['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED', 'BLOCKED', 'ERROR'] }
const overallStatus = { enum: ['VERIFIED', 'FAILED', 'INCOMPLETE', 'UNVERIFIABLE'] }
const profile = { enum: ['fast', 'balanced', 'thorough'] }

export const RUN_REPORT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://proofgate.dev/schemas/run-report-v1.json',
  title: 'ProofGate run report',
  type: 'object',
  required: [
    'schemaVersion', 'id', 'status', 'mode', 'profile', 'project', 'startedAt', 'finishedAt',
    'environment', 'intent', 'changedFiles', 'criteria', 'checks', 'skippedChecks', 'cache',
    'evidence', 'summary', 'tool',
  ],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: 'string', pattern: '^run_[0-9a-z]{26}$' },
    status: overallStatus,
    mode: { enum: ['changed', 'full', 'task'] },
    profile,
    task: { type: 'string' },
    project: {
      type: 'object',
      required: ['root'],
      properties: {
        root: { type: 'string' },
        name: { type: 'string' },
        ecosystem: { type: 'array', items: { type: 'string' } },
        packageManager: { type: 'string' },
      },
      additionalProperties: true,
    },
    startedAt: { type: 'string', format: 'date-time' },
    finishedAt: { type: 'string', format: 'date-time' },
    durationMs: { type: 'number', minimum: 0 },
    environment: { type: 'object', additionalProperties: true },
    intent: {
      type: 'object',
      required: ['hash', 'approved', 'lockPath', 'stale'],
      properties: {
        hash: { type: 'string' },
        approved: { type: 'boolean' },
        approvedAt: { type: 'string' },
        approvedBy: { type: 'string' },
        lockPath: { type: 'string' },
        stale: { type: 'boolean' },
        reason: { type: 'string' },
      },
      additionalProperties: true,
    },
    changedFiles: {
      type: 'object',
      required: ['source', 'files', 'fingerprint', 'truncated'],
      properties: {
        source: { enum: ['git-working-tree', 'git-base', 'full', 'none', 'unavailable'] },
        base: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'status'],
            properties: {
              path: { type: 'string' },
              status: { enum: ['added', 'modified', 'deleted', 'renamed', 'untracked', 'unknown'] },
              oldPath: { type: 'string' },
            },
            additionalProperties: true,
          },
        },
        fingerprint: { type: 'string' },
        truncated: { type: 'boolean' },
      },
      additionalProperties: true,
    },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'description', 'kind', 'required', 'status', 'reason', 'evidence'],
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          kind: { enum: ['check', 'artifact', 'manual'] },
          required: { type: 'boolean' },
          status: { enum: ['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED'] },
          reason: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: true,
      },
    },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'type', 'status', 'required', 'durationMs', 'summary', 'stdout', 'stderr', 'findings'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          type: { enum: ['command', 'http', 'files', 'secret-scan'] },
          status: checkStatus,
          required: { type: 'boolean' },
          profiles: { type: 'array', items: profile },
          durationMs: { type: 'number', minimum: 0 },
          startedAt: { type: 'string' },
          finishedAt: { type: 'string' },
          cached: { type: 'boolean' },
          cacheKey: { type: 'string' },
          command: { type: 'array', items: { type: 'string' } },
          cwd: { type: 'string' },
          exitCode: { type: ['integer', 'null'] },
          signal: { type: ['string', 'null'] },
          timedOut: { type: 'boolean' },
          summary: { type: 'string' },
          stdout: { $ref: '#/$defs/outputChunk' },
          stderr: { $ref: '#/$defs/outputChunk' },
          findings: { type: 'array', items: { $ref: '#/$defs/finding' } },
          metrics: { type: 'object', additionalProperties: true },
          errorMessage: { type: 'string' },
          skipReason: { type: 'string' },
          artifacts: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: true,
      },
    },
    skippedChecks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'reason', 'detail'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          reason: { enum: ['profile', 'not-applicable', 'dependency-failed', 'guard', 'disabled'] },
          detail: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
    cache: {
      type: 'object',
      required: ['enabled', 'hits', 'misses'],
      properties: {
        enabled: { type: 'boolean' },
        hits: { type: 'integer', minimum: 0 },
        misses: { type: 'integer', minimum: 0 },
      },
      additionalProperties: true,
    },
    evidence: {
      type: 'object',
      required: ['dir', 'manifestPath', 'manifestHash', 'entries', 'totalBytes', 'redacted'],
      properties: {
        dir: { type: 'string' },
        manifestPath: { type: 'string' },
        manifestHash: { type: 'string' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'sha256', 'bytes', 'kind'],
            properties: {
              path: { type: 'string' },
              sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              bytes: { type: 'integer', minimum: 0 },
              kind: { enum: ['log', 'json', 'artifact', 'summary'] },
            },
            additionalProperties: true,
          },
        },
        totalBytes: { type: 'integer', minimum: 0 },
        redacted: { type: 'boolean' },
      },
      additionalProperties: true,
    },
    summary: {
      type: 'object',
      required: ['total', 'passed', 'failed', 'unknown', 'skipped', 'blocked', 'error', 'requiredTotal', 'requiredPassed', 'requiredFailed'],
      additionalProperties: true,
    },
    notes: { type: 'array', items: { type: 'string' } },
    tool: {
      type: 'object',
      required: ['name', 'version', 'schemaVersion'],
      properties: {
        name: { type: 'string' },
        version: { type: 'string' },
        schemaVersion: { type: 'integer' },
      },
      additionalProperties: true,
    },
  },
  $defs: {
    outputChunk: {
      type: 'object',
      required: ['text', 'bytes', 'totalBytes', 'truncated'],
      properties: {
        text: { type: 'string' },
        bytes: { type: 'integer', minimum: 0 },
        totalBytes: { type: 'integer', minimum: 0 },
        truncated: { type: 'boolean' },
      },
      additionalProperties: true,
    },
    finding: {
      type: 'object',
      required: ['kind', 'message'],
      properties: {
        kind: { enum: ['test-failure', 'type-error', 'lint-error', 'runtime-error', 'secret', 'warning', 'info'] },
        message: { type: 'string' },
        file: { type: 'string' },
        line: { type: 'integer' },
        column: { type: 'integer' },
        details: { type: 'string' },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const

export const RUN_LIST_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://proofgate.dev/schemas/run-list-v1.json',
  title: 'ProofGate run list',
  type: 'array',
  items: {
    type: 'object',
    required: ['id', 'status', 'mode', 'profile', 'startedAt', 'finishedAt', 'durationMs', 'summary', 'checks', 'evidenceDir', 'intentHash'],
    properties: {
      id: { type: 'string' },
      status: overallStatus,
      mode: { enum: ['changed', 'full', 'task'] },
      profile,
      task: { type: 'string' },
      startedAt: { type: 'string' },
      finishedAt: { type: 'string' },
      durationMs: { type: 'number' },
      evidenceDir: { type: 'string' },
      intentHash: { type: 'string' },
      summary: { type: 'object', additionalProperties: true },
      checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
    additionalProperties: true,
  },
} as const

export const EVIDENCE_MANIFEST_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://proofgate.dev/schemas/evidence-manifest-v1.json',
  title: 'ProofGate evidence manifest',
  type: 'object',
  required: ['schemaVersion', 'runId', 'createdAt', 'entries', 'totalBytes', 'redacted', 'tool'],
  properties: {
    schemaVersion: { const: 1 },
    runId: { type: 'string', pattern: '^run_[0-9a-z]{26}$' },
    createdAt: { type: 'string', format: 'date-time' },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'sha256', 'bytes', 'kind'],
        properties: {
          path: { type: 'string' },
          sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          bytes: { type: 'integer', minimum: 0 },
          kind: { enum: ['log', 'json', 'artifact', 'summary'] },
        },
        additionalProperties: true,
      },
    },
    totalBytes: { type: 'integer', minimum: 0 },
    redacted: { type: 'boolean' },
    tool: {
      type: 'object',
      required: ['name', 'version'],
      properties: { name: { type: 'string' }, version: { type: 'string' } },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const
