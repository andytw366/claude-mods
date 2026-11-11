import type { EngineInterface, Register } from 'claude-code'

/** Files VS Code's built-in image preview opens, and the ones the terminal path converts to PNG. */
const PICTURE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i

/** The terminal's Image element takes at most 2 MiB of PNG; bigger pictures are scaled down first. */
const MAX_PNG_BYTES = 2 * 1024 * 1024

/** Largest side, in pixels, a converted picture is scaled down to. */
const MAX_SIDE = 1600

const DESCRIPTION = `Show pictures to the user. In a VS Code terminal they open in a floating VS Code window, one tab each; in any other terminal (WezTerm, kitty, Ghostty, iTerm2), locally, over SSH or in WSL, they are drawn inline under this tool call. Reading a picture with Read does not show it to the user; call this when you want the user to look at one, for example a chart you just made or a screenshot you are talking about. Paths are absolute or relative to the working directory.`

/** One picture drawn inline: PNG bytes and its size in pixels. */
type Inline = { path: string; png: string; width: number; height: number }

/** The width and height of a PNG, from its IHDR chunk. */
const pngSize = (base64: string): { width: number; height: number } | undefined => {
  const head = decode(base64.slice(0, 32))
  if (head.length < 24 || head[0] !== 0x89 || head[1] !== 0x50) return undefined
  const u32 = (at: number) => ((head[at] ?? 0) * 2 ** 24) + ((head[at + 1] ?? 0) << 16) + ((head[at + 2] ?? 0) << 8) + (head[at + 3] ?? 0)
  return { width: u32(16), height: u32(20) }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Decodes a base64 head whose length is a multiple of 4 and holds no padding. */
const decode = (text: string): number[] => {
  const bytes: number[] = []
  for (let i = 0; i + 4 <= text.length; i += 4) {
    const n = (B64.indexOf(text[i] ?? '') << 18) | (B64.indexOf(text[i + 1] ?? '') << 12) | (B64.indexOf(text[i + 2] ?? '') << 6) | B64.indexOf(text[i + 3] ?? '')
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  return bytes
}

const isAbsolute = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')

/** How many cells a picture takes: as wide as fits, a terminal cell being about twice as tall as wide. */
const cells = (width: number, height: number, columns: number, rows: number) => {
  const maxColumns = Math.max(10, Math.min(100, columns - 6))
  const maxRows = Math.max(6, Math.min(40, rows - 10))
  const aspect = height / width / 2
  let c = maxColumns
  let r = Math.round(c * aspect)
  if (r > maxRows) { r = maxRows; c = Math.round(r / aspect) }
  return { columns: Math.min(255, Math.max(1, c)), rows: Math.min(255, Math.max(1, r)) }
}

/**
 * The ShowImage tool. In a VS Code terminal it asks the Claude Image Opener extension to show pictures
 * in a floating window: each request is a small JSON file in ~/.claude/vscode-images, carrying the id
 * the extension gave this session's terminal (CLAUDE_IMAGES_WINDOW). Anywhere else it draws the
 * pictures inline under the tool call's row with the terminal's Image element, whose bytes travel in
 * the terminal stream and so reach WezTerm through SSH and WSL alike.
 */
export const register: Register = on => {
  /** The pictures each ShowImage call draws inline, by tool_use_id. Gone after a reload: the row then reads its alt. */
  const inline = new Map<string, Inline[]>()

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'ShowImage',
      description: DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: { paths: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'The pictures to show' } },
        required: ['paths'],
      },
    })
    return next(e)
  })

  on('tool.call', { tool: /^mcp__.*vscode-images__ShowImage$/ }, async ($, e) => {
    const given = (e as { paths?: unknown }).paths
    const paths = Array.isArray(given) ? given.filter((p): p is string => typeof p === 'string') : []
    if (paths.length === 0) return { deny: 'paths must list at least one picture.' }
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    const isVscode = (await $.env.get('VSCODE_IPC_HOOK_CLI')) !== undefined && (await $.env.get('TERM_PROGRAM')) === 'vscode'
    const cwd = await $.session.cwd()
    const shown: string[] = []
    const problems: string[] = []
    const found: { given: string; path: string }[] = []
    for (const given of paths) {
      const path = isAbsolute(given) ? given : `${cwd}/${given}`
      if (!PICTURE.test(path)) { problems.push(`${given}: not a PNG, JPEG, GIF, WebP, BMP, ICO or SVG picture`); continue }
      if (!(await $.fs.exists(path)) || (await $.fs.stat(path)).kind !== 'file') { problems.push(`${given}: no such file`); continue }
      found.push({ given, path })
    }

    if (isVscode) {
      const window = (await $.env.get('CLAUDE_IMAGES_WINDOW')) ?? ''
      for (const [i, { given, path }] of found.entries()) {
        await $.fs.write(`${config}/vscode-images/${Date.now()}-${e.tool_use_id}-${i}.json`, JSON.stringify({ window, path }))
        shown.push(given)
      }
      if (shown.length === 0) return { deny: problems.join('\n') }
      const lines = [`Asked VS Code to show ${shown.length} picture(s): ${shown.join(', ')}`, ...problems]
      // A terminal opened before the extension started has no window id; then only the workspace's pictures open.
      if (window === '') lines.push('This terminal predates the Claude Image Opener extension, so only pictures inside the open workspace are shown.')
      return { result: lines.join('\n') }
    }

    const pictures: Inline[] = []
    for (const [i, { given, path }] of found.entries()) {
      const picture = await toPng($, path, `${config}/vscode-images/inline/${i}.png`).catch((err: unknown) => `could not read it (${String(err)})`)
      if (typeof picture === 'string') { problems.push(`${given}: ${picture}`); continue }
      pictures.push({ path: given, ...picture })
      shown.push(given)
    }
    if (pictures.length === 0) return { deny: problems.join('\n') }
    inline.set(e.tool_use_id, pictures)
    return { result: [`Drew ${shown.length} picture(s) inline in the terminal: ${shown.join(', ')}`, ...problems].join('\n') }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (!/ShowImage$/.test(e.props.tool)) return row
    const pictures = inline.get(e.props.tool_use_id)
    if (pictures === undefined || e.surface !== 'terminal') return row
    const { Box, Image } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 80
    const rows = e.viewport?.rows ?? 40
    return (
      <Box flexDirection="column">
        {row}
        {pictures.map((p, i) => {
          const size = cells(p.width, p.height, columns, rows)
          return (
            <Box key={`pic-${i}`} paddingLeft={2} marginTop={i === 0 ? 0 : 1}>
              <Image source={{ png: p.png }} columns={size.columns} rows={size.rows} alt={`[picture: ${p.path} — this terminal cannot draw pictures]`} />
            </Box>
          )
        })}
      </Box>
    )
  })
}

/**
 * A picture as PNG bytes the terminal's Image element takes: a PNG under 2 MiB as it is, anything else
 * converted and scaled down with ImageMagick (or rsvg-convert for SVG, ffmpeg otherwise). Answers why not, as words.
 */
const toPng = async (
  $: EngineInterface,
  path: string,
  out: string,
): Promise<{ png: string; width: number; height: number } | string> => {
  if (/\.png$/i.test(path) && (await $.fs.stat(path)).size <= MAX_PNG_BYTES) {
    const { base64 } = await $.fs.read(path, { as: 'bytes' })
    const size = pngSize(base64)
    if (size !== undefined) return { png: base64, ...size }
  }
  await $.fs.write(out, '')
  const fit = `${MAX_SIDE}x${MAX_SIDE}>`
  const tries: string[][] = [
    ['magick', `${path}[0]`, '-resize', fit, `png:${out}`],
    ['convert', `${path}[0]`, '-resize', fit, `png:${out}`],
    ...(/\.svg$/i.test(path) ? [['rsvg-convert', '-w', `${MAX_SIDE}`, '-a', '-o', out, path]] : []),
    ['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-frames:v', '1', '-vf', `scale='min(${MAX_SIDE},iw)':-1`, '-f', 'image2', '-c:v', 'png', out],
  ]
  for (const argv of tries) {
    const ran = await $.process.run(argv, { timeoutMs: 20000 }).catch(() => undefined)
    if (ran === undefined || ran.exitCode !== 0) continue
    const { base64 } = await $.fs.read(out, { as: 'bytes' })
    const size = pngSize(base64)
    if (size === undefined) continue
    if (base64.length * 3 / 4 > MAX_PNG_BYTES) return 'still over 2 MiB after scaling down'
    return { png: base64, ...size }
  }
  return 'not a PNG under 2 MiB, and no converter (ImageMagick, rsvg-convert or ffmpeg) could turn it into one'
}
