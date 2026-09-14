import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

function privateAddress(value: string): boolean {
  if (isIP(value) === 4) {
    const [first, second] = value.split('.').map(Number)
    return first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second! >= 16 && second! <= 31) || (first === 192 && second === 168)
  }
  const normalized = value.toLowerCase()
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
}

/** Chromium rejects non-IP Host headers on its DevTools HTTP endpoint. */
export async function numericHttpEndpoint(value: string): Promise<string> {
  const endpoint = new URL(value)
  if (endpoint.protocol !== 'http:' || isIP(endpoint.hostname) || endpoint.hostname === 'localhost') return value
  let addresses: Array<{ address: string }>
  try { addresses = await lookup(endpoint.hostname, { all: true }) }
  catch { return value }
  const address = addresses.find((item) => privateAddress(item.address))?.address
  if (!address) return value
  endpoint.hostname = address
  return endpoint.toString()
}
