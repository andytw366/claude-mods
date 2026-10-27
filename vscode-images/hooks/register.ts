import type { Register } from 'claude-code'

/** Files VS Code's built-in image preview opens. */
const PICTURE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i

const DESCRIPTION = `Show pictures to the user in a floating VS Code window, one tab each. Reading a picture with Read does not show it to the user; call this when you want the user to look at one, for example a chart you just made or a screenshot you are talking about. Paths are absolute or relative to the working directory.`

/**
 * The ShowImage tool asks the Claude Image Opener extension to show pictures. Each request is a small
 * JSON file in ~/.claude/vscode-images, carrying the id the extension gave this session's terminal
 * (CLAUDE_IMAGES_WINDOW), so the picture opens from the window that runs the session.
 */
export const register: Register = on => {
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
    if ((await $.env.get('VSCODE_IPC_HOOK_CLI')) === undefined) return { deny: 'Claude Code is not running in a VS Code terminal, so there is no window to show pictures in.' }
    const given = (e as { paths?: unknown }).paths
    const paths = Array.isArray(given) ? given.filter((p): p is string => typeof p === 'string') : []
    if (paths.length === 0) return { deny: 'paths must list at least one picture.' }
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
    const window = (await $.env.get('CLAUDE_IMAGES_WINDOW')) ?? ''
    const cwd = await $.session.cwd()
    const shown: string[] = []
    const problems: string[] = []
    for (const [i, given] of paths.entries()) {
      const path = given.startsWith('/') ? given : `${cwd}/${given}`
      if (!PICTURE.test(path)) { problems.push(`${given}: not a picture VS Code previews`); continue }
      if (!(await $.fs.exists(path)) || (await $.fs.stat(path)).kind !== 'file') { problems.push(`${given}: no such file`); continue }
      await $.fs.write(`${config}/vscode-images/${Date.now()}-${e.tool_use_id}-${i}.json`, JSON.stringify({ window, path }))
      shown.push(given)
    }
    if (shown.length === 0) return { deny: problems.join('\n') }
    const lines = [`Asked VS Code to show ${shown.length} picture(s): ${shown.join(', ')}`, ...problems]
    // A terminal opened before the extension started has no window id; then only the workspace's pictures open.
    if (window === '') lines.push('This terminal predates the Claude Image Opener extension, so only pictures inside the open workspace are shown.')
    return { result: lines.join('\n') }
  })
}
