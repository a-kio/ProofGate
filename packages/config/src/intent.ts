import { PROFILES, sha256Json, type AcceptanceCriterion, type Profile } from '@proofgate/shared'
import type { AcceptanceFile, PolicyConfig, ProofGateConfig } from './schema.js'

/** Bump only when the hash payload changes shape. */
export const INTENT_SCHEMA = 'proofgate-intent-v1'

export interface IntentPayload {
  schema: string
  profile: Profile
  checks: unknown[]
  criteria: AcceptanceCriterion[]
  task?: string
  policy: PolicyConfig
  guards: ProofGateConfig['guards']
  failureTimeoutSeconds: number
}

function checksForProfile(config: ProofGateConfig, profile: Profile): unknown[] {
  return config.checks
    .filter((check) => check.profiles.includes(profile))
    .map((check) => {
      // Title, description, and cache policy affect presentation, not intent.
      const { title: _title, description: _description, cache: _cache, ...rest } = check
      return rest
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

function canonicalCriteria(criteria: AcceptanceCriterion[]): AcceptanceCriterion[] {
  return [...criteria]
    .map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      kind: criterion.kind,
      required: criterion.required,
      ...(criterion.check ? { check: criterion.check } : {}),
      ...(criterion.artifacts ? { artifacts: [...criterion.artifacts].sort() } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function buildIntentPayload(
  config: ProofGateConfig,
  acceptance: AcceptanceFile,
  profile: Profile,
): IntentPayload {
  return {
    schema: INTENT_SCHEMA,
    profile,
    checks: checksForProfile(config, profile),
    criteria: canonicalCriteria(acceptance.criteria),
    task: acceptance.task,
    policy: config.policy,
    guards: config.guards,
    failureTimeoutSeconds: config.limits.timeoutSeconds,
  }
}

export function computeIntentHash(
  config: ProofGateConfig,
  acceptance: AcceptanceFile,
  profile: Profile,
): string {
  return sha256Json(buildIntentPayload(config, acceptance, profile))
}

export function computeAcceptanceHash(acceptance: AcceptanceFile): string {
  return sha256Json({
    version: acceptance.version,
    task: acceptance.task,
    criteria: canonicalCriteria(acceptance.criteria),
  })
}

export function profilesToApprove(profile?: Profile): Profile[] {
  return profile ? [profile] : [...PROFILES]
}
