/**
 * Strip credentials out of anything headed for a log or a stored record.
 *
 * Tool arguments are audited verbatim, and `connect_meta_account` takes the
 * business's App Secret and access token as arguments — so without this the
 * audit log would hold every tenant's Meta credentials in plain text.
 *
 * Only string values under a credential-looking key are replaced; numbers
 * (token counts, budgets) pass through untouched.
 */

const SECRET_KEY = /secret|token|password|passwd|api[_-]?key|authorization|bearer|credential|private[_-]?key/i

export const REDACTED = '[redacted]'

export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as T

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = typeof v === 'string' && v.length > 0 && SECRET_KEY.test(key)
      ? REDACTED
      : redactSecrets(v, depth + 1)
  }
  return out as T
}

// Credentials pasted into free text (a chat message during onboarding):
// Meta access tokens, OpenAI/Anthropic keys, bearer headers, 32-hex app secrets.
const SECRET_TEXT = [
  /\bEAA[A-Za-z0-9]{20,}\b/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b[a-f0-9]{32}\b/gi,
]

export function redactSecretText(text: string): string {
  return SECRET_TEXT.reduce((t, re) => t.replace(re, REDACTED), text)
}
