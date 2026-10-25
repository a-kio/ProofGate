import { EXIT_CODES } from './constants.js'

export type ProofGateErrorCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_MISSING'
  | 'ACCEPTANCE_STALE'
  | 'ACCEPTANCE_MISSING'
  | 'PROJECT_NOT_FOUND'
  | 'NOT_INITIALIZED'
  | 'GIT_UNAVAILABLE'
  | 'EXECUTABLE_NOT_FOUND'
  | 'CHECK_TIMEOUT'
  | 'CHECK_FAILED'
  | 'LOCKED'
  | 'PATH_UNSAFE'
  | 'STORAGE_FAILURE'
  | 'INTEGRATION_FAILED'
  | 'INTEGRATION_UNKNOWN'
  | 'INTEGRATION_CONFLICT'
  | 'USER_CANCELLED'
  | 'UNSUPPORTED'
  | 'NETWORK'
  | 'INTERNAL'

const EXIT_BY_CODE: Record<ProofGateErrorCode, number> = {
  CONFIG_INVALID: EXIT_CODES.error,
  CONFIG_MISSING: EXIT_CODES.error,
  ACCEPTANCE_STALE: EXIT_CODES.unverifiable,
  ACCEPTANCE_MISSING: EXIT_CODES.unverifiable,
  PROJECT_NOT_FOUND: EXIT_CODES.error,
  NOT_INITIALIZED: EXIT_CODES.error,
  GIT_UNAVAILABLE: EXIT_CODES.unverifiable,
  EXECUTABLE_NOT_FOUND: EXIT_CODES.error,
  CHECK_TIMEOUT: EXIT_CODES.failed,
  CHECK_FAILED: EXIT_CODES.failed,
  LOCKED: EXIT_CODES.incomplete,
  PATH_UNSAFE: EXIT_CODES.error,
  STORAGE_FAILURE: EXIT_CODES.error,
  INTEGRATION_FAILED: EXIT_CODES.error,
  INTEGRATION_UNKNOWN: EXIT_CODES.usage,
  INTEGRATION_CONFLICT: EXIT_CODES.error,
  USER_CANCELLED: EXIT_CODES.incomplete,
  UNSUPPORTED: EXIT_CODES.error,
  NETWORK: EXIT_CODES.error,
  INTERNAL: EXIT_CODES.error,
}

export interface ProofGateErrorOptions {
  hint?: string
  cause?: unknown
  details?: Record<string, unknown>
  exitCode?: number
}

/** An expected, user-actionable failure. The CLI renders these without a stack trace. */
export class ProofGateError extends Error {
  readonly code: ProofGateErrorCode
  readonly hint?: string
  readonly details?: Record<string, unknown>
  readonly exitCode: number
  override readonly cause?: unknown

  constructor(code: ProofGateErrorCode, message: string, options: ProofGateErrorOptions = {}) {
    super(message)
    this.name = 'ProofGateError'
    this.code = code
    this.hint = options.hint
    this.details = options.details
    this.exitCode = options.exitCode ?? EXIT_BY_CODE[code]
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export function isProofGateError(error: unknown): error is ProofGateError {
  return error instanceof ProofGateError
}

export function toError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(typeof error === 'string' ? error : JSON.stringify(error))
}

export function errorMessage(error: unknown): string {
  return toError(error).message
}

export function exitCodeFor(error: unknown): number {
  if (isProofGateError(error)) return error.exitCode
  return EXIT_CODES.error
}
