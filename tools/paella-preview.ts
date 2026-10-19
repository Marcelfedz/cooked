// Renders the paella at five stages of doneness, and the bars, to a PNG:
//   node tools/paella-preview.ts cooked/assets/paella.png
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { paellaPixels, barCells, CLEAR } from '../cooked/hooks/paella.ts'

const SCALE = 12
const BG = 0x1f1f1f

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

type Tile = { w: number; h: number; px: Int32Array }
const tiles: Tile[][] = []

const sizes: [number, number][] = [[18, 12], [20, 12], [32, 20]]
for (const [w, h] of sizes) {
  const row: Tile[] = []
  for (const d of [0, 0.25, 0.5, 0.75, 1]) {
    row.push({ w, h, px: paellaPixels(w, h, { doneness: d, frame: 3, isCooking: d < 1 }) })
  }
  tiles.push(row)
}
// bars as pixel rows: each cell drawn as a 1x2 block with its char shape approximated
const barTile = (cols: number, fraction: number | null, frame: number): Tile => {
  const words = barCells(cols, { fraction, frame, isCooking: true })
  const px = new Int32Array(cols * 2 * 4).fill(CLEAR)
  for (let x = 0; x < cols; x++) {
    const [code, fg] = [words[x * 3]!, words[x * 3 + 1]!]
    if (code === 0x2501) { px[1 * cols * 2 + x * 2] = fg; px[1 * cols * 2 + x * 2 + 1] = fg }
    if (code === 0x2578) { px[1 * cols * 2 + x * 2] = fg }
  }
  return { w: cols * 2, h: 4, px }
}
tiles.push([barTile(30, 0.43, 4), barTile(30, null, 6), barTile(30, 1, 12)])

const gap = 3
const W = Math.max(...tiles.map(r => r.reduce((s, t) => s + t.w + gap, gap)))
const H = tiles.reduce((s, r) => s + Math.max(...r.map(t => t.h)) + gap, gap)
const img = new Int32Array(W * H).fill(BG)
let oy = gap
for (const r of tiles) {
  let ox = gap
  for (const t of r) {
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      const c = t.px[y * t.w + x]!
      if (c !== CLEAR) img[(oy + y) * W + ox + x] = c
    }
    ox += t.w + gap
  }
  oy += Math.max(...r.map(t => t.h)) + gap
}

const raw = Buffer.alloc((W * SCALE * 3 + 1) * H * SCALE)
let p = 0
for (let y = 0; y < H * SCALE; y++) {
  raw[p++] = 0
  for (let x = 0; x < W * SCALE; x++) {
    const c = img[Math.floor(y / SCALE) * W + Math.floor(x / SCALE)]!
    raw[p++] = (c >> 16) & 255; raw[p++] = (c >> 8) & 255; raw[p++] = c & 255
  }
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W * SCALE, 0); ihdr.writeUInt32BE(H * SCALE, 4)
ihdr[8] = 8; ihdr[9] = 2
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
])
const out = process.argv[2] ?? 'paella.png'
writeFileSync(out, png)
console.log(out, W * SCALE, H * SCALE)
