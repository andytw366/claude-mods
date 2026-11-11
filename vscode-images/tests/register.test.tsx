import { expect, test } from 'claude-code/testing'

/** A 400x200 red PNG. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAZAAAADICAIAAABJdyC1AAAC2ElEQVR4nO3OQQkAQRAEsfFves9C/4qDQATk3h3AL/QDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgFE/ABj1A4BRPwAY9QOAUT8AGPUDgNEHMitZuk04SKkAAAAASUVORK5CYII='

const TOOL = 'mcp__vscode-images__ShowImage'

const engine = (on: Parameters<Parameters<typeof test>[1]>[1], env: Record<string, string>) => {
  on('env.get', (_, e) => ({ value: env[(e as { name: string }).name] }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 800, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: { base64: PNG } }))
  on('fs.write', () => ({ value: undefined }))
}

test('outside VS Code, a picture is drawn inline under its tool row', async ($, on) => {
  engine(on, { HOME: '/home/u', TERM_PROGRAM: 'WezTerm' })
  const call = await $.tool.call({ tool: TOOL, paths: ['chart.png'], tool_use_id: 'tu1' } as never)
  expect(JSON.stringify(call)).toContain('inline')

  const ui = await $.ui.mount({
    plugin: 'vscode-images', surface: 'terminal', component: 'ToolUse', requestId: 'tu1',
    props: { tool_use_id: 'tu1', tool: TOOL, input: { paths: ['chart.png'] }, isRunning: false, isErrored: false, isInterrupted: false },
  } as never)
  const image = await ui.find({ type: 'Image' } as never)
  expect(image).toBeDefined()
  expect(JSON.stringify(image)).toContain('"columns"')
  await ui.unmount()
})

test('in a VS Code terminal, a picture goes to the floating window', async ($, on) => {
  engine(on, { HOME: '/home/u', TERM_PROGRAM: 'vscode', VSCODE_IPC_HOOK_CLI: '/tmp/x.sock', CLAUDE_IMAGES_WINDOW: 'w1' })
  const call = await $.tool.call({ tool: TOOL, paths: ['chart.png'] } as never)
  expect(JSON.stringify(call)).toContain('Asked VS Code')
})
