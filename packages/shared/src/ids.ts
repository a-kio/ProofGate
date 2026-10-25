import { randomBytes } from 'node:crypto'

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz'

/** Monotonic-ish ULID-style identifier: sortable by time, 26 chars. */
export function ulid(now = Date.now()): string {
  let time = ''
  let remaining = now
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[remaining % 32]! + time
    remaining = Math.floor(remaining / 32)
  }
  const bytes = randomBytes(16)
  let randomness = ''
  for (let i = 0; i < 16; i++) {
    randomness += CROCKFORD[(bytes[i] ?? 0) % 32]!
  }
  return time + randomness
}

export function runId(now = Date.now()): string {
  return `run_${ulid(now)}`
}

export function shortRunId(id: string): string {
  return id.startsWith('run_') ? id.slice(4, 12) : id.slice(0, 8)
}

export function taskId(now = Date.now()): string {
  return `task_${ulid(now)}`
}

export function installId(): string {
  return `install_${ulid()}`
}

export function isRunId(value: string): boolean {
  return /^run_[0-9a-z]{26}$/.test(value)
}

export function isUlid(value: string): boolean {
  return /^[0-9a-z]{26}$/.test(value)
}
