// Pixel art for the paella and the progress bar, drawn as Raster cells.
// Pure functions: no engine calls, so the same code renders a PNG preview in Node.

/** A pixel nothing paints: the terminal's own background shows through. */
export const CLEAR = -1

/** Raster's "terminal default" colour (bit 24 alone). */
const DEFAULT = 0x01000000

const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584

export type PaellaLook = {
  /** 0 raw rice, 1 cooked with socarrat and lemon. */
  doneness: number
  /** Animation step; one per tick. */
  frame: number
  /** Flames and steam on. */
  isCooking: boolean
}

type Rgb = [number, number, number]

const RIM = 0x55555f
const RIM_LIGHT = 0x9a9aa6
const RIM_DARK = 0x2e2e35
const WALL = 0x3b3b43
const RAW: Rgb = [236, 206, 120]
const SAFFRON: Rgb = [246, 184, 52]
const GOLDEN: Rgb = [226, 146, 36]
const SOCARRAT: Rgb = [146, 74, 24]
const FLAME = [0xffd23f, 0xff9a1f, 0xf0641e, 0xc8361a]

// Ingredients in polar coordinates over the rice (angle in degrees, radius 0..1),
// added to the pan as it cooks: a paella seen from above, prawns fanned round the centre.
const INGREDIENTS: { a: number; r: number; at: number; px: [number, number, number][] }[] = [
  // peas and green beans, there from the start
  { a: 200, r: 0.55, at: 0, px: [[0, 0, 0x6dbe45]] },
  { a: 20, r: 0.6, at: 0, px: [[0, 0, 0x5aa83a]] },
  { a: 110, r: 0.45, at: 0, px: [[0, 0, 0x6dbe45]] },
  { a: 300, r: 0.5, at: 0.1, px: [[0, 0, 0x5aa83a]] },
  { a: 250, r: 0.85, at: 0.15, px: [[0, 0, 0x6dbe45]] },
  { a: 70, r: 0.9, at: 0.15, px: [[0, 0, 0x5aa83a]] },
  // red pepper strips
  { a: 160, r: 0.75, at: 0.2, px: [[0, 0, 0xd93a2b], [1, 0, 0xb52a20]] },
  { a: 340, r: 0.8, at: 0.3, px: [[0, 0, 0xd93a2b], [0, 1, 0xb52a20]] },
  // prawns, fanned round the centre
  { a: 45, r: 0.45, at: 0.4, px: [[0, 0, 0xf2683a], [1, 0, 0xffa58a]] },
  { a: 135, r: 0.5, at: 0.5, px: [[0, 0, 0xffa58a], [1, 0, 0xf2683a]] },
  { a: 225, r: 0.45, at: 0.55, px: [[0, 0, 0xf2683a], [1, 0, 0xffa58a]] },
  { a: 315, r: 0.5, at: 0.6, px: [[0, 0, 0xffa58a], [1, 0, 0xf2683a]] },
  // mussels round the edge
  { a: 0, r: 0.82, at: 0.7, px: [[0, 0, 0x26262e], [0, 1, 0xf0a050]] },
  { a: 180, r: 0.85, at: 0.75, px: [[0, 0, 0x26262e], [0, 1, 0xf0a050]] },
  { a: 270, r: 0.8, at: 0.8, px: [[0, 0, 0x26262e], [1, 0, 0x34343e]] },
  // lemon in the middle, once it is cooked
  { a: 0, r: 0, at: 1, px: [[0, 0, 0xfff1a0], [1, 0, 0xf7dc4a]] },
]

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

const pack = ([r, g, b]: Rgb): number =>
  (Math.max(0, Math.min(255, Math.round(r))) << 16) |
  (Math.max(0, Math.min(255, Math.round(g))) << 8) |
  Math.max(0, Math.min(255, Math.round(b)))

/** A stable pseudo-random number in [0, 1) for a pixel and a seed. */
const hash = (x: number, y: number, seed = 0): number => {
  let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  n ^= n >>> 16
  return (n >>> 0) / 4294967296
}

/** Rice is already saffron when it starts to cook; it goes golden, then the socarrat. */
const riceColour = (doneness: number): Rgb => {
  const t = 0.35 + 0.65 * doneness
  return t < 0.6 ? mix(RAW, SAFFRON, t / 0.6) : mix(SAFFRON, GOLDEN, (t - 0.6) / 0.4)
}

/**
 * The paella as a grid of pixels, `width` by `height` (even), row-major: a
 * round pan seen from above at an angle, handles either side, steam rising
 * over it and flames licking its lower edge while it cooks.
 */
export function paellaPixels(width: number, height: number, look: PaellaLook): Int32Array {
  const pixels = new Int32Array(width * height).fill(CLEAR)
  const set = (x: number, y: number, colour: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) pixels[y * width + x] = colour
  }
  const get = (x: number, y: number) => (x >= 0 && x < width && y >= 0 && y < height ? pixels[y * width + x] : CLEAR)
  const doneness = Math.max(0, Math.min(1, look.doneness))
  const steamRows = height >= 16 ? 3 : 1
  const panRows = height - steamRows - 1 // one row under the pan for the flames
  const handle = width >= 26 ? 3 : 2
  const ry = panRows / 2
  const rx = Math.min(ry * 1.3, width / 2 - handle - 0.5)
  const cx = (width - 1) / 2
  const cy = steamRows + (panRows - 1) / 2
  // Distance from the centre in units of the ellipse: 1 on its edge.
  const reach = (x: number, y: number, ax: number, ay: number) => Math.hypot((x - cx) / ax, (y - cy) / ay)
  const irx = rx - 1.15
  const iry = ry - 1.05
  const base = riceColour(doneness)
  const socarrat = doneness > 0.55 ? (doneness - 0.55) / 0.45 : 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (reach(x, y, rx, ry) > 1) continue
      const inner = reach(x, y, irx, iry)
      if (inner > 1) {
        // The rim, lit from the upper left.
        const nx = (x - cx) / rx
        const ny = (y - cy) / ry
        const light = (-0.55 * nx - 0.85 * ny) / Math.max(0.001, Math.hypot(nx, ny))
        set(x, y, light > 0.45 ? RIM_LIGHT : light < -0.35 ? RIM_DARK : RIM)
        continue
      }
      // The far inner wall shows as a thin dark band along the top.
      if (y < cy && reach(x, y + 1, irx, iry) > 1) {
        set(x, y, WALL)
        continue
      }
      let rice = mix(base, [255, 250, 225], 0.12 * (1 - inner))
      rice = mix(rice, [255, 255, 255], (hash(x, y) - 0.5) * 0.16)
      if (inner > 0.7) rice = mix(rice, SOCARRAT, socarrat * 0.75 * ((inner - 0.7) / 0.3))
      if (look.isCooking && hash(x, y, look.frame) > 0.95) rice = mix(rice, [255, 246, 220], 0.5)
      set(x, y, pack(rice))
    }
  }

  for (const piece of INGREDIENTS) {
    if (doneness < piece.at) continue
    const rad = (piece.a * Math.PI) / 180
    const x0 = Math.round(cx + Math.cos(rad) * piece.r * (irx - 0.6))
    const y0 = Math.round(cy + Math.sin(rad) * piece.r * (iry - 0.6))
    for (const [dx, dy, colour] of piece.px) {
      const x = x0 + dx
      const y = y0 + dy
      if (reach(x, y, irx, iry) <= 0.98 && get(x, y) !== WALL) set(x, y, colour)
    }
  }

  // Handles: a loop either side, level with the middle, flush with the rim.
  const handleY = Math.round(cy)
  let leftEdge = 0
  while (leftEdge < width && reach(leftEdge, handleY, rx, ry) > 1) leftEdge++
  for (let i = 1; i <= handle; i++) {
    const colour = i === handle ? RIM_LIGHT : RIM
    set(leftEdge - i, handleY, colour)
    set(width - 1 - leftEdge + i, handleY, colour)
    if (i === handle && handle > 2) {
      set(leftEdge - i, handleY - 1, RIM)
      set(width - 1 - leftEdge + i, handleY - 1, RIM)
    }
  }

  if (look.isCooking) {
    // Flames lick the lower half of the pan from outside its edge.
    for (let y = Math.ceil(cy); y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (get(x, y) !== CLEAR || y < cy + ry * 0.45) continue
        const out = reach(x, y, rx + 1.4, ry + 1.2)
        if (out > 1 || reach(x, y, rx, ry) <= 1) continue
        const roll = hash(x, y, look.frame + 7)
        const isLow = y >= height - 1
        if (roll < (isLow ? 0.2 : 0.35)) continue
        set(x, y, FLAME[Math.min(3, Math.floor(roll * 4.2 - (isLow ? 0 : 0.8)))] ?? FLAME[0]!)
      }
    }
  }

  if (look.isCooking || doneness >= 1) {
    // Steam: loose puffs that rise off the rice, drift and fade; never a column.
    const wisps = width >= 26 ? 3 : 2
    for (let w = 0; w < wisps; w++) {
      const baseX = cx + ((w + 0.5) / wisps - 0.5) * rx * 1.2
      for (let y = 0; y < steamRows; y++) {
        const phase = (look.frame * 0.3 + w * 1.7 + (steamRows - y)) % 2.4
        if (phase > 1) continue
        const drift = Math.round(Math.sin(look.frame * 0.15 + w * 2.1 + y) * 1.2)
        const fade = (y + 1) / (steamRows + 1)
        set(Math.round(baseX) + drift, y, pack(mix([62, 62, 68], [150, 150, 158], fade * (1 - phase * 0.5))))
      }
    }
  }

  return pixels
}

/** Two stacked pixels per cell, drawn with half blocks: `width` columns, `height / 2` rows. */
export function pixelsToCells(pixels: Int32Array, width: number, height: number): Uint32Array {
  const rows = Math.ceil(height / 2)
  const words = new Uint32Array(width * rows * 3)
  for (let row = 0; row < rows; row++) {
    for (let x = 0; x < width; x++) {
      const top = pixels[row * 2 * width + x] ?? CLEAR
      const bottom = row * 2 + 1 < height ? (pixels[(row * 2 + 1) * width + x] ?? CLEAR) : CLEAR
      const at = (row * width + x) * 3
      if (top === CLEAR && bottom === CLEAR) words.set([0x20, DEFAULT, DEFAULT], at)
      else if (top === CLEAR) words.set([LOWER_HALF, bottom, DEFAULT], at)
      else words.set([UPPER_HALF, top, bottom === CLEAR ? DEFAULT : bottom], at)
    }
  }
  return words
}

export type BarLook = {
  /** 0..1 for a known share of the plan done; null when there is no plan. */
  fraction: number | null
  frame: number
  isCooking: boolean
  hasErrors?: boolean
}

const BAR_FROM: Rgb = [128, 128, 138]
const BAR_TO: Rgb = [222, 222, 230]
const TRACK = 0x3a3a40
const LINE = 0x2501
const HALF_LINE = 0x2578

/**
 * One row of cells: a thin bar that fills grey to white. With no plan it
 * is a pulse sweeping the track while cooking, so it never claims a share it
 * does not know.
 */
export function barCells(columns: number, look: BarLook): Uint32Array {
  const words = new Uint32Array(columns * 3)
  const colourAt = (x: number) => pack(mix(BAR_FROM, BAR_TO, columns > 1 ? x / (columns - 1) : 1))
  const put = (x: number, code: number, fg: number) => words.set([code, fg, DEFAULT], x * 3)

  if (look.fraction === null) {
    const span = Math.max(3, Math.round(columns / 6))
    const travel = columns + span
    const head = look.isCooking ? (look.frame % travel) - span : -span - 1
    for (let x = 0; x < columns; x++) {
      const into = x - head
      const isLit = into >= 0 && into < span
      put(x, LINE, isLit ? pack(mix([88, 88, 96], [236, 236, 242], 1 - Math.abs(into - span / 2) / span)) : TRACK)
    }
    return words
  }

  const halves = Math.round(Math.max(0, Math.min(1, look.fraction)) * columns * 2)
  const shine = look.isCooking ? look.frame % Math.max(1, columns + 8) : -10
  for (let x = 0; x < columns; x++) {
    const filled = halves - x * 2
    let fg = colourAt(x)
    if (Math.abs(x - shine) <= 1 && filled > 0) fg = pack(mix(BAR_TO, [255, 255, 255], 0.7))
    if (look.hasErrors && filled > 0 && x === Math.floor((halves - 1) / 2)) fg = 0xe0443a
    if (filled >= 2) put(x, LINE, fg)
    else if (filled === 1) put(x, HALF_LINE, fg)
    else put(x, LINE, TRACK)
  }
  return words
}

/** Raster's `cells`: the words as little-endian bytes, base64. */
export function encodeCells(words: Uint32Array): string {
  // The runtime has Uint8Array#toBase64; lib es2023 does not declare it yet.
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength) as Uint8Array & { toBase64(): string }
  return bytes.toBase64()
}
