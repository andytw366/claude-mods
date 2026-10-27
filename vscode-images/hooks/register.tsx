import type { Register } from 'claude-code'

/** `$.fs.read` and `Image` both take at most this many bytes. */
const MAX_BYTES = 2 * 1024 * 1024

/** Wider pictures are slow to redraw, since the terminal is sent the whole picture on every frame. */
const MAX_COLUMNS = 100

/** Pixels across one cell in VS Code's terminal; it resamples a picture to this, whatever it is sent. */
const CELL_PIXELS = 7

/**
 * Shrinks a PNG to at most the pixels its widest box shows (MAX_COLUMNS cells of CELL_PIXELS) and to
 * 256 colours, which keeps a chart's look and cuts the bytes sent on every frame. Needs Pillow.
 */
const SHRINK = `
import sys
from PIL import Image
src, dst, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGB")
if im.width > width:
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
im.quantize(256).save(dst, optimize=True)
`

type Shot = { png: string; width: number; height: number; path: string }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The first bytes of a base64 string; 32 characters hold 24 bytes, the PNG header up to IHDR's size. */
function headBytes(base64: string): number[] {
  const out: number[] = []
  for (let i = 0; i + 4 <= Math.min(base64.length, 32); i += 4) {
    const n = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | Math.max(0, B64.indexOf(base64[i + k])), 0)
    out.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  return out
}

/** Width and height from a PNG's IHDR chunk, or undefined when the bytes are not a PNG. */
function pngSize(base64: string): { width: number; height: number } | undefined {
  const b = headBytes(base64)
  const sig = [0x89, 0x50, 0x4e, 0x47]
  if (b.length < 24 || sig.some((x, i) => b[i] !== x)) return undefined
  const u32 = (o: number): number => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
  return { width: u32(16), height: u32(20) }
}

/** Cell height over width; VS Code's terminal reports 7x17 pixels. */
const CELL_ASPECT = 17 / 7

/**
 * The cells a picture takes: as wide as fits, but never taller than three quarters of the screen,
 * because an iTerm2 image that does not fit on screen is not sent at all.
 *
 * The terminal keeps the picture's shape inside the box, and a cell the picture leaves uncovered
 * shows the characters beneath it, so the rows are rounded up: the picture always fills the width
 * and at most part of the last row is left over.
 */
function box(shot: Shot, maxColumns: number, screenRows: number): { columns: number; rows: number } {
  const maxRows = Math.max(4, Math.floor((screenRows * 3) / 4))
  const rowsFor = (columns: number): number => Math.ceil((columns * shot.height) / shot.width / CELL_ASPECT)
  let columns = Math.max(10, maxColumns)
  if (rowsFor(columns) > maxRows) {
    columns = Math.max(10, Math.floor((maxRows * CELL_ASPECT * shot.width) / shot.height))
  }
  return { columns, rows: Math.max(1, Math.min(255, rowsFor(columns))) }
}

export const register: Register = on => {
  const shots = new Map<string, Shot>()

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true || !/\.png$/i.test(e.file_path)) return r
    try {
      const st = await $.fs.stat(e.file_path)
      if (st.kind !== 'file' || (st.size ?? 0) > MAX_BYTES) return r
      const small = `${((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')}/inline-png-${e.tool_use_id}.png`
      const shrunk = await $.process.run(['python3', '-P', '-c', SHRINK, e.file_path, small, String(MAX_COLUMNS * CELL_PIXELS)], { timeoutMs: 20_000 })
      const { base64 } = await $.fs.read(shrunk.exitCode === 0 ? small : e.file_path, { as: 'bytes' })
      if (shrunk.exitCode !== 0) $.ui.log(`sent the picture unshrunk: ${shrunk.stderr.trim().split('\n').pop() ?? ''}`)
      const size = pngSize(base64)
      if (size === undefined) return r
      shots.set(e.tool_use_id, { png: base64, ...size, path: e.file_path })
      $.ui.invalidate('ui.render')
    } catch (err) {
      $.ui.log(`a picture was not drawn: ${err instanceof Error ? err.message : String(err)}`)
    }
    return r
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const shot = shots.get(e.requestId)
    if (shot === undefined) return next(e)
    const drawn = await next(e)
    const { Box, Image } = $.ui.resolve(e)
    const { columns, rows } = box(shot, Math.min(MAX_COLUMNS, (e.viewport?.columns ?? 84) - 4), e.viewport?.rows ?? 40)
    return (
      <Box flexDirection="column">
        {drawn}
        <Image source={{ png: shot.png }} columns={columns} rows={rows} alt={`[picture: ${shot.path}]`} />
      </Box>
    )
  })
}
