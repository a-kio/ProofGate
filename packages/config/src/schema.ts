import { PROFILES, type Profile } from '@proofgate/shared'
import { z } from 'zod'

export const profileSchema = z.enum(PROFILES)

const checkIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, {
    message: 'must contain only letters, digits, ".", "_", "-" and start with an alphanumeric character',
  })

const relativePathSchema = (field: string) =>
  z
    .string()
    .min(1)
    .max(512)
    .refine((value) => !/^(?:[A-Za-z]:|[\\/]|~)/.test(value), {
      message: `${field} must be relative to the project root`,
    })
    .refine((value) => !value.replace(/\\/g, '/').split('/').includes('..'), {
      message: `${field} must not escape the project root`,
    })

const globSchema = (field: string) => relativePathSchema(field).refine((value) => !value.startsWith('!'), {
  message: `${field} must be a positive glob; use the dedicated ignore list for exclusions`,
})

const regexSchema = (field: string) =>
  z.string().min(1).max(1000).refine(
    (value) => {
      try {
        new RegExp(value)
        return true
      } catch {
        return false
      }
    },
    { message: `${field} must be a valid regular expression` },
  )

const commonCheckShape = {
  id: checkIdSchema,
  title: z.string().min(1).max(80).optional(),
  required: z.boolean().default(true),
  profiles: z.array(profileSchema).min(1).default([...PROFILES] as Profile[]),
  timeoutSeconds: z.number().int().min(1).max(3600).optional(),
  cache: z.boolean().default(true),
  appliesTo: z.array(globSchema('appliesTo')).min(1).max(50).optional(),
  dependsOn: z.array(checkIdSchema).max(32).optional(),
  description: z.string().max(400).optional(),
}

export const commandCheckSchema = z
  .object({
    ...commonCheckShape,
    type: z.literal('command'),
    /** argv array, executed without a shell. */
    run: z.array(z.string().min(1).max(4096)).min(1).max(64),
    cwd: relativePathSchema('cwd').optional(),
    env: z.record(z.string().min(1).max(128), z.string().max(8192)).optional(),
    expectExitCode: z.array(z.number().int().min(0).max(255)).min(1).max(8).default([0]),
    expectStdout: regexSchema('expectStdout').optional(),
    expectStderr: regexSchema('expectStderr').optional(),
  })
  .strict()

export const httpCheckSchema = z
  .object({
    ...commonCheckShape,
    type: z.literal('http'),
    url: z
      .string()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), { message: 'url must use http or https' }),
    method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
    headers: z.record(z.string().min(1).max(128), z.string().max(4096)).optional(),
    body: z.string().max(100_000).optional(),
    expectStatus: z.array(z.number().int().min(100).max(599)).min(1).max(10).default([200]),
    expectBodyContains: z.array(z.string().min(1).max(500)).max(10).optional(),
    allowRemote: z.boolean().default(false),
  })
  .strict()

const fileExpectationSchema = z
  .object({
    pattern: globSchema('pattern'),
    minBytes: z.number().int().min(0).optional(),
    maxBytes: z.number().int().min(0).optional(),
    mustNotExist: z.boolean().default(false),
  })
  .strict()
  .refine((value) => value.minBytes === undefined || value.maxBytes === undefined || value.minBytes <= value.maxBytes, {
    message: 'minBytes must be less than or equal to maxBytes',
    path: ['minBytes'],
  })

export const filesCheckSchema = z
  .object({
    ...commonCheckShape,
    type: z.literal('files'),
    files: z.array(fileExpectationSchema).min(1).max(50),
  })
  .strict()

const secretPatternSchema = z
  .object({
    id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    description: z.string().max(200).optional(),
    pattern: regexSchema('pattern'),
  })
  .strict()

export const secretScanCheckSchema = z
  .object({
    ...commonCheckShape,
    type: z.literal('secret-scan'),
    /** Files to scan. Prefer a broad glob; ignores are applied automatically. */
    paths: z.array(globSchema('paths')).min(1).max(50).default(['**/*']),
    allow: z.array(globSchema('allow')).max(100).optional(),
    maxFileBytes: z.number().int().min(1024).max(5_000_000).default(512_000),
    patterns: z.array(secretPatternSchema).max(50).optional(),
  })
  .strict()

export const checkSchema = z.discriminatedUnion('type', [
  commandCheckSchema,
  httpCheckSchema,
  filesCheckSchema,
  secretScanCheckSchema,
])

export type CommandCheckConfig = z.infer<typeof commandCheckSchema>
export type HttpCheckConfig = z.infer<typeof httpCheckSchema>
export type FilesCheckConfig = z.infer<typeof filesCheckSchema>
export type SecretScanCheckConfig = z.infer<typeof secretScanCheckSchema>
export type CheckConfig = z.infer<typeof checkSchema>

export const limitsSchema = z
  .object({
    timeoutSeconds: z.number().int().min(1).max(7200).default(600),
    maxParallelChecks: z.number().int().min(1).max(32).default(4),
    maxOutputBytes: z.number().int().min(4096).max(64 * 1024 * 1024).default(2 * 1024 * 1024),
  })
  .strict()

export const policySchema = z
  .object({
    /** report never blocks the agent; block adds provider-specific blocking feedback. */
    onFailure: z.enum(['report', 'block']).default('report'),
    concurrentRuns: z.enum(['dedupe', 'fail']).default('dedupe'),
    failureFeedback: z.enum(['summary', 'none']).default('summary'),
    /** Additional agent repair cycles allowed by a blocking hook. */
    retryLimit: z.number().int().min(0).max(10).default(2),
    /**
     * block: a failing optional check makes the run INCOMPLETE.
     * warn: the failure is reported but the run can still be VERIFIED.
     */
    optionalFailures: z.enum(['block', 'warn']).default('block'),
  })
  .strict()

export const guardsSchema = z
  .object({
    /** Changed files matching these globs block verification outright. */
    forbiddenPaths: z.array(globSchema('forbiddenPaths')).max(100).default([]),
    maxChangedFiles: z.number().int().min(1).max(50_000).optional(),
    /** Refuse to run when acceptance criteria changed without approval. */
    protectAcceptance: z.boolean().default(true),
  })
  .strict()

export const cacheSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxEntries: z.number().int().min(1).max(10_000).default(500),
    /** Entries older than this are pruned; age alone never validates a cache hit. */
    maxAgeDays: z.number().int().min(1).max(365).default(30),
  })
  .strict()

export const retentionSchema = z
  .object({
    maxRuns: z.number().int().min(1).max(10_000).default(100),
    maxAgeDays: z.number().int().min(1).max(3650).default(90),
  })
  .strict()

export const verificationSchema = z
  .object({
    profile: profileSchema.default('balanced'),
    changedProfile: profileSchema.default('fast'),
    /** Git ref to diff against for `verify --changed --base`. */
    base: z.string().max(200).optional(),
    /** Additional globs excluded from change detection and secret scanning. */
    ignorePaths: z.array(globSchema('ignorePaths')).max(200).default([]),
  })
  .strict()

export const projectSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
  })
  .strict()

export const integrationsSchema = z
  .object({
    scope: z.enum(['project', 'user']).default('project'),
    invoker: z.enum(['auto', 'npx', 'global', 'node-entry']).default('auto'),
  })
  .strict()

export const configSchema = z
  .object({
    version: z.literal(1),
    project: projectSchema.prefault({}),
    verification: verificationSchema.prefault({}),
    checks: z.array(checkSchema).max(200).default([]),
    limits: limitsSchema.prefault({}),
    policy: policySchema.prefault({}),
    guards: guardsSchema.prefault({}),
    cache: cacheSchema.prefault({}),
    retention: retentionSchema.prefault({}),
    integrations: integrationsSchema.prefault({}),
  })
  .strict()
  .superRefine((config, ctx) => {
    const ids = new Map<string, number>()
    config.checks.forEach((check, index) => {
      const seen = ids.get(check.id)
      if (seen !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate check id "${check.id}" (also defined at checks.${seen})`,
          path: ['checks', index, 'id'],
        })
      } else {
        ids.set(check.id, index)
      }
    })
    config.checks.forEach((check, index) => {
      for (const dependency of check.dependsOn ?? []) {
        if (dependency === check.id) {
          ctx.addIssue({
            code: 'custom',
            message: `check "${check.id}" cannot depend on itself`,
            path: ['checks', index, 'dependsOn'],
          })
        } else if (!ids.has(dependency)) {
          ctx.addIssue({
            code: 'custom',
            message: `dependsOn references unknown check "${dependency}"`,
            path: ['checks', index, 'dependsOn'],
          })
        }
      }
    })
    if (config.checks.length > 0 && !config.checks.some((check) => check.required)) {
      ctx.addIssue({
        code: 'custom',
        message: 'at least one check must be required; an all-optional plan cannot verify anything',
        path: ['checks'],
      })
    }
  })

export type ProofGateConfig = z.infer<typeof configSchema>
export type LimitsConfig = z.infer<typeof limitsSchema>
export type PolicyConfig = z.infer<typeof policySchema>
export type GuardsConfig = z.infer<typeof guardsSchema>
export type CacheConfig = z.infer<typeof cacheSchema>

export const acceptanceCriterionSchema = z
  .object({
    id: checkIdSchema,
    description: z.string().min(1).max(400),
    kind: z.enum(['check', 'artifact', 'manual']),
    check: checkIdSchema.optional(),
    artifacts: z.array(globSchema('artifacts')).min(1).max(50).optional(),
    required: z.boolean().default(true),
  })
  .strict()
  .superRefine((criterion, ctx) => {
    if (criterion.kind === 'check' && !criterion.check) {
      ctx.addIssue({ code: 'custom', message: 'kind=check requires a "check" field', path: ['check'] })
    }
    if (criterion.kind === 'artifact' && !criterion.artifacts) {
      ctx.addIssue({ code: 'custom', message: 'kind=artifact requires an "artifacts" field', path: ['artifacts'] })
    }
    if (criterion.kind !== 'artifact' && criterion.artifacts) {
      ctx.addIssue({ code: 'custom', message: '"artifacts" is only valid for kind=artifact', path: ['artifacts'] })
    }
    if (criterion.kind !== 'check' && criterion.check) {
      ctx.addIssue({ code: 'custom', message: '"check" is only valid for kind=check', path: ['check'] })
    }
  })

export const acceptanceSchema = z
  .object({
    version: z.literal(1),
    task: z.string().max(300).optional(),
    criteria: z.array(acceptanceCriterionSchema).min(1).max(200),
  })
  .strict()
  .superRefine((acceptance, ctx) => {
    const ids = new Set<string>()
    acceptance.criteria.forEach((criterion, index) => {
      if (ids.has(criterion.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate criterion id "${criterion.id}"`,
          path: ['criteria', index, 'id'],
        })
      }
      ids.add(criterion.id)
    })
    if (!acceptance.criteria.some((criterion) => criterion.required)) {
      ctx.addIssue({
        code: 'custom',
        message: 'at least one criterion must be required',
        path: ['criteria'],
      })
    }
  })

export type AcceptanceFile = z.infer<typeof acceptanceSchema>

export interface ConfigIssue {
  path: string
  message: string
  suggestion?: string
}

export class ConfigError extends Error {
  readonly issues: ConfigIssue[]

  constructor(message: string, issues: ConfigIssue[] = []) {
    super(message)
    this.name = 'ConfigError'
    this.issues = issues
  }
}
