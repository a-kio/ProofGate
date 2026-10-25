import { newEventId, nowIso } from './ids.js'

export type NormalizedEventType =
  | 'session_start'
  | 'session_end'
  | 'file_changed'
  | 'tool_executed'
  | 'agent_stop'
  | 'verify_requested'
  | 'unknown'

/**
 * Provider-agnostic event model. Integrations translate provider payloads into this
 * shape; unknown provider fields survive in `metadata` and never crash the pipeline.
 */
export interface NormalizedEvent {
  eventId: string
  eventType: NormalizedEventType
  provider: string
  providerVersion?: string
  sessionId?: string
  projectRoot?: string
  timestamp: string
  changedFiles?: string[]
  taskContext?: string
  correlationId?: string
  metadata?: Record<string, unknown>
}

export interface NormalizedEventInput {
  eventType: NormalizedEventType
  provider: string
  providerVersion?: string
  sessionId?: string
  projectRoot?: string
  changedFiles?: string[]
  taskContext?: string
  correlationId?: string
  metadata?: Record<string, unknown>
}

export function normalizeEvent(input: NormalizedEventInput): NormalizedEvent {
  return {
    eventId: newEventId(),
    eventType: input.eventType,
    provider: input.provider,
    providerVersion: input.providerVersion,
    sessionId: input.sessionId,
    projectRoot: input.projectRoot,
    timestamp: nowIso(),
    changedFiles: input.changedFiles,
    taskContext: input.taskContext,
    correlationId: input.correlationId,
    metadata: input.metadata,
  }
}
