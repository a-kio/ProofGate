/** Canonical identifiers and limits used across every ProofGate package. */

export const TOOL_NAME = 'proofgate'
export const TOOL_DISPLAY_NAME = 'ProofGate'
export const TOOL_VERSION = '1.0.0'
export const TOOL_TAGLINE = 'AI wrote it. ProofGate verifies it.'
export const TOOL_HOMEPAGE = 'https://github.com/a-kio/ProofGate'
export const TOOL_LICENSE = 'Apache-2.0'

export const PROOFGATE_DIR = '.proofgate'
export const CONFIG_REL_PATH = '.proofgate/config.yaml'
export const ACCEPTANCE_REL_PATH = '.proofgate/acceptance.yaml'
export const ACCEPTANCE_LOCK_REL_PATH = '.proofgate/acceptance.lock.json'
export const STATE_REL_PATH = '.proofgate/state.json'
export const RUNS_REL_DIR = '.proofgate/runs'
export const CACHE_REL_DIR = '.proofgate/cache'
export const CACHE_REL_PATH = '.proofgate/cache/cache.json'
export const LOCKS_REL_DIR = '.proofgate/locks'
export const RUN_LOCK_REL_PATH = '.proofgate/locks/run.lock'
export const ACTIVE_RUN_REL_PATH = '.proofgate/locks/active-run.json'
export const INTEGRATIONS_STATE_REL_PATH = '.proofgate/integrations.json'
export const BACKUPS_REL_DIR = '.proofgate/backups'
export const HOOKS_REL_DIR = '.proofgate/hooks'
export const DATABASE_REL_PATH = '.proofgate/proofgate.db'
export const INDEX_REL_PATH = '.proofgate/index.json'
export const DASHBOARD_ASSETS_DIR = 'assets/dashboard'

export const HIDDEN_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.proofgate',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
  '.idea',
  '.vscode',
])

export const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
export const DEFAULT_TIMEOUT_SECONDS = 600
export const DEFAULT_MAX_PARALLEL_CHECKS = 4
export const DEFAULT_RUN_RETENTION = 100
export const DEFAULT_CACHE_ENTRIES = 500

export const EXIT_CODES = {
  verified: 0,
  failed: 1,
  incomplete: 2,
  unverifiable: 3,
  error: 4,
  usage: 64,
} as const

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES]

export const MANIFEST_VERSION = 1
export const RUN_SCHEMA_VERSION = 1

/** Environment variables that must never be forwarded verbatim into evidence. */
export const SECRET_ENV_NAME_PATTERN =
  /(?:^|_)(?:token|secret|password|passwd|pwd|key|apikey|api_key|credential|auth|session|cookie|private)(?:_|$)/i
