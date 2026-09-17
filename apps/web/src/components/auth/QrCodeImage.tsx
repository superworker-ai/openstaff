const eccPerBlock = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18]
const blockCount = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4]

const rawModules = (version: number) => {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) { const align = Math.floor(version / 7) + 2; result -= (25 * align - 10) * align - 55; if (version >= 7) result -= 36 }
  return result
}
const multiply = (x: number, y: number) => { let result = 0; for (let i = 7; i >= 0; i -= 1) { result = (result << 1) ^ ((result >>> 7) * 0x11d); result ^= ((y >>> i) & 1) * x } return result }
const divisor = (degree: number) => { const result = new Array<number>(degree).fill(0); result[degree - 1] = 1; let root = 1; for (let i = 0; i < degree; i += 1) { for (let j = 0; j < degree; j += 1) { result[j] = multiply(result[j]!, root); if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]! } root = multiply(root, 2) } return result }
const remainder = (data: number[], polynomial: number[]) => { const result = new Array<number>(polynomial.length).fill(0); for (const byte of data) { const factor = byte ^ result.shift()!; result.push(0); for (let i = 0; i < result.length; i += 1) result[i] = result[i]! ^ multiply(polynomial[i]!, factor) } return result }
const appendBits = (value: number, length: number, bits: number[]) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1) }

function codewords(text: string) {
  const bytes = [...new TextEncoder().encode(text)]
  const version = Array.from({ length: 10 }, (_, index) => index + 1).find((candidate) => {
    const capacity = Math.floor(rawModules(candidate) / 8) - eccPerBlock[candidate]! * blockCount[candidate]!
    return 4 + (candidate < 10 ? 8 : 16) + bytes.length * 8 <= capacity * 8
  })
  if (!version) throw new Error('Authenticator URI is too long for the QR renderer')
  const blocks = blockCount[version]!, eccLength = eccPerBlock[version]!, rawCodewords = Math.floor(rawModules(version) / 8), dataCapacity = rawCodewords - blocks * eccLength
  const bits: number[] = []; appendBits(4, 4, bits); appendBits(bytes.length, version < 10 ? 8 : 16, bits); for (const byte of bytes) appendBits(byte, 8, bits)
  appendBits(0, Math.min(4, dataCapacity * 8 - bits.length), bits); while (bits.length % 8) bits.push(0)
  const data = Array.from({ length: bits.length / 8 }, (_, index) => bits.slice(index * 8, index * 8 + 8).reduce((value, bit) => value * 2 + bit, 0))
  for (let pad = 0; data.length < dataCapacity; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11)
  const shortBlocks = blocks - rawCodewords % blocks, shortLength = Math.floor(rawCodewords / blocks), generator = divisor(eccLength), pieces: Array<{ data: number[]; ecc: number[] }> = []
  let offset = 0
  for (let index = 0; index < blocks; index += 1) { const length = shortLength - eccLength + (index < shortBlocks ? 0 : 1), chunk = data.slice(offset, offset + length); offset += length; pieces.push({ data: chunk, ecc: remainder(chunk, generator) }) }
  const result: number[] = [], longest = Math.max(...pieces.map((piece) => piece.data.length))
  for (let index = 0; index < longest; index += 1) for (const piece of pieces) if (index < piece.data.length) result.push(piece.data[index]!)
  for (let index = 0; index < eccLength; index += 1) for (const piece of pieces) result.push(piece.ecc[index]!)
  return { version, result }
}

const alignmentPositions = (version: number, size: number) => {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2, step = version === 32 ? 26 : Math.ceil((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2
  const result = [6]; for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position)
  return result
}
const maskBit = (mask: number, x: number, y: number) => [((x + y) % 2) === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, x * y % 2 + x * y % 3 === 0, (x * y % 2 + x * y % 3) % 2 === 0, ((x + y) % 2 + x * y % 3) % 2 === 0][mask]!

function matrix(text: string) {
  const encoded = codewords(text), size = encoded.version * 4 + 17, modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false)), functions = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setFunction = (x: number, y: number, dark: boolean) => { if (x >= 0 && x < size && y >= 0 && y < size) { modules[y]![x] = dark; functions[y]![x] = true } }
  const finder = (cx: number, cy: number) => { for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) { const distance = Math.max(Math.abs(dx), Math.abs(dy)); setFunction(cx + dx, cy + dy, distance !== 2 && distance !== 4) } }
  for (let index = 0; index < size; index += 1) { setFunction(6, index, index % 2 === 0); setFunction(index, 6, index % 2 === 0) }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  const positions = alignmentPositions(encoded.version, size)
  for (const y of positions) for (const x of positions) if (!functions[y]![x]) for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  const format = (mask: number) => {
    const data = (1 << 3) | mask; let rem = data
    for (let index = 0; index < 10; index += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = (data << 10 | rem) ^ 0x5412, bit = (index: number) => ((bits >>> index) & 1) !== 0
    for (let index = 0; index <= 5; index += 1) setFunction(8, index, bit(index)); setFunction(8, 7, bit(6)); setFunction(8, 8, bit(7)); setFunction(7, 8, bit(8))
    for (let index = 9; index < 15; index += 1) setFunction(14 - index, 8, bit(index))
    for (let index = 0; index < 8; index += 1) setFunction(size - 1 - index, 8, bit(index))
    for (let index = 8; index < 15; index += 1) setFunction(8, size - 15 + index, bit(index)); setFunction(8, size - 8, true)
  }
  format(0)
  if (encoded.version >= 7) { let rem = encoded.version; for (let index = 0; index < 12; index += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25); const bits = encoded.version << 12 | rem; for (let index = 0; index < 18; index += 1) { const dark = ((bits >>> index) & 1) !== 0, a = size - 11 + index % 3, b = Math.floor(index / 3); setFunction(a, b, dark); setFunction(b, a, dark) } }
  let bitIndex = 0, upward = true
  for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vertical = 0; vertical < size; vertical += 1) { const y = upward ? size - 1 - vertical : vertical; for (let offset = 0; offset < 2; offset += 1) { const x = right - offset; if (!functions[y]![x] && bitIndex < encoded.result.length * 8) { modules[y]![x] = ((encoded.result[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1) !== 0; bitIndex += 1 } } } upward = !upward }
  const applyMask = (mask: number) => { for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!functions[y]![x] && maskBit(mask, x, y)) modules[y]![x] = !modules[y]![x] }
  const penalty = () => {
    let score = 0
    for (let axis = 0; axis < 2; axis += 1) for (let outer = 0; outer < size; outer += 1) { let run = 0, previous = false, line = ''; for (let inner = 0; inner < size; inner += 1) { const dark = axis === 0 ? modules[outer]![inner]! : modules[inner]![outer]!; line += dark ? '1' : '0'; if (inner === 0 || dark !== previous) run = 1; else { run += 1; if (run === 5) score += 3; else if (run > 5) score += 1 } previous = dark } if (line.includes('00001011101') || line.includes('10111010000')) score += 40 }
    for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) if (modules[y]![x] === modules[y]![x + 1] && modules[y]![x] === modules[y + 1]![x] && modules[y]![x] === modules[y + 1]![x + 1]) score += 3
    const dark = modules.flat().filter(Boolean).length; score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
    return score
  }
  let bestMask = 0, bestScore = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask += 1) { applyMask(mask); format(mask); const score = penalty(); if (score < bestScore) { bestMask = mask; bestScore = score } applyMask(mask) }
  applyMask(bestMask); format(bestMask)
  return modules
}

export function QrCodeImage({ value }: { value: string }) {
  const modules = matrix(value), border = 4, size = modules.length + border * 2
  const path = modules.flatMap((row, y) => row.map((dark, x) => dark ? `M${x + border},${y + border}h1v1h-1z` : '')).join('')
  return <svg role="img" aria-label="Authenticator QR code" viewBox={`0 0 ${size} ${size}`} className="mx-auto h-52 w-52 rounded-xl bg-white p-2" shapeRendering="crispEdges"><path fill="#fff" d={`M0 0h${size}v${size}H0z`} /><path fill="#000" d={path} /></svg>
}
