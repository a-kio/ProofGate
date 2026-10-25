import { SECRET_ENV_NAME_PATTERN } from './constants.js'

/**
 * Redaction is deliberately conservative: it removes values that look like
 * credentials from logs, evidence, and reports. It never redacts whole lines
 * unless the line is itself a credential assignment.
 */

const REDACTED = '[REDACTED]'

const RULES: Array<{ name: string; pattern: RegExp; replacement: string | ((m: string, ...g: string[]) => string) }> = [
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: REDACTED },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, replacement: REDACTED },
  { name: 'aws-secret-key', pattern: /\baws_secret_access_key\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi, replacement: `aws_secret_access_key=${REDACTED}` },
  { name: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, replacement: REDACTED },
  { name: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, replacement: REDACTED },
  { name: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replacement: REDACTED },
  { name: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replacement: REDACTED },
  { name: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, replacement: REDACTED },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replacement: REDACTED },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: REDACTED },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: REDACTED },
  { name: 'bearer', pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9+/=_.-]{16,}/gi, replacement: (_m, scheme: string) => `${scheme} ${REDACTED}` },
  { name: 'url-credentials', pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, replacement: (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@` },
  {
    name: 'key-value-secret',
    pattern:
      /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key|auth[_-]?token)[A-Za-z0-9_.-]*)\s*[=:]\s*["']?([^\s"',;]{6,})["']?/gi,
    replacement: (_m, key: string) => `${key}=${REDACTED}`,
  },
  {
    name: 'cli-secret-flag',
    pattern: /(--(?:token|password|secret|api-key|apikey|auth)(?:=|\s+))([^\s"']{6,})/gi,
    replacement: (_m, flag: string) => `${flag}${REDACTED}`,
  },
]

export interface RedactionResult {
  text: string
  redacted: boolean
  rules: string[]
}

export function redactSecrets(input: string): RedactionResult {
  let text = input
  const hit = new Set<string>()
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(text)) {
      rule.pattern.lastIndex = 0
      text = text.replace(rule.pattern, rule.replacement as string)
      hit.add(rule.name)
    }
  }
  return { text, redacted: hit.size > 0, rules: [...hit] }
}

/** Redact values in a record whose key looks like a credential. */
export function redactRecord(record: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue
    out[key] = SECRET_ENV_NAME_PATTERN.test(key) ? REDACTED : redactSecrets(value).text
  }
  return out
}

/** Names (never values) of environment variables that look sensitive. */
export function sensitiveEnvNames(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((key) => SECRET_ENV_NAME_PATTERN.test(key))
    .sort()
}

export function isSensitiveEnvName(name: string): boolean {
  return SECRET_ENV_NAME_PATTERN.test(name)
}

export { REDACTED }
