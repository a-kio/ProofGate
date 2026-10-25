/**
 * Redaction of obvious secret material before anything is persisted into evidence.
 * This is best-effort hygiene for reports and logs — never a security boundary.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp; replace: string }> = [
  { name: 'aws-access-key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: '$1••••••••' },
  { name: 'openai-key', re: /\bsk-(proj-)?[A-Za-z0-9_-]{16,}\b/g, replace: 'sk-••••redacted••••' },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, replace: 'sk-ant-••••redacted••••' },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, replace: 'gh_••••redacted••••' },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: 'xox-••••redacted••••' },
  { name: 'url-credentials', re: /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, replace: '$1•••:•••@' },
  {
    name: 'bearer',
    re: /\b(bearer|authorization)\s*[:=]\s*\S+/gi,
    replace: '$1: ••••redacted••••',
  },
  { name: 'pem-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: '-----PRIVATE KEY (redacted)-----' },
]

export function redactSecrets(input: string): string {
  let out = input
  for (const { re, replace } of SECRET_PATTERNS) {
    out = out.replace(re, replace)
  }
  return out
}

export const OUTPUT_PREVIEW_LINES = 60
export const OUTPUT_PREVIEW_BYTES = 8 * 1024

/** Tail an output string for evidence, redacting secrets. */
export function tailOutput(output: string, lines = OUTPUT_PREVIEW_LINES): string {
  const flat = output.replace(/\r\n/g, '\n')
  const parts = flat.split('\n')
  const tail = parts.length > lines ? parts.slice(-lines) : parts
  return redactSecrets(tail.join('\n'))
}
