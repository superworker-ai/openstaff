const LIMIT = 16 * 1024
const marker = '\n[output truncated]'
export function capOutput(value: string): string {
  if (Buffer.byteLength(value) <= LIMIT) return value
  const prefix = new TextDecoder().decode(Buffer.from(value).subarray(0, LIMIT - Buffer.byteLength(marker)), { stream: true })
  return prefix + marker
}
