import { randomBytes, randomUUID } from 'node:crypto'

/** Short collision-resistant id used for run ids and event ids. */
export function shortId(size = 6): string {
  return randomBytes(Math.ceil(size / 2))
    .toString('hex')
    .slice(0, size)
}

export function newEventId(): string {
  return `evt_${randomUUID()}`
}

export function newRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${stamp}-${shortId(6)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
