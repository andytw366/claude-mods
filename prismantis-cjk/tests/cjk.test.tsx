import { expect, test } from 'claude-code/testing'

import { mermaidText } from '../hooks/mermaid'
import { width } from '../hooks/render'

// Every row of a box must end its right border at the same column as the top border.
const borderColumns = (art: string) =>
  art.split('\n').flatMap(line => {
    const at = line.lastIndexOf('│') === -1 ? line.lastIndexOf('┐') : line.lastIndexOf('│')
    return at === -1 ? [] : [width(line.slice(0, at))]
  })

test('CJK flowchart labels fit their boxes', () => {
  const art = mermaidText('flowchart LR\n  A[表格歪掉] --> B[OK]', false, 120)!
  expect(art).not.toContain('')
  const rows = art.split('\n')
  const top = rows[0]!
  const label = rows.find(r => r.includes('表格歪掉'))!
  expect(width(top.slice(0, top.indexOf('┐')))).toBe(width(label.slice(0, label.indexOf('├'))))
})

test('CJK sequence participants line up', () => {
  const art = mermaidText('sequenceDiagram\n  participant U as 使用者\n  participant V as VS Code\n  U->>V: 開啟終端機', false, 120)!
  expect(art).not.toContain('')
  const rows = art.split('\n')
  const top = rows[0]!
  const name = rows.find(r => r.includes('使用者'))!
  expect(width(top.slice(0, top.indexOf('┐')))).toBe(width(name.slice(0, name.indexOf('│', name.indexOf('使用者')))))
})

test('CJK chart categories keep their width', () => {
  const art = mermaidText('xychart-beta\n  x-axis ["中文", "框線", "全形"]\n  bar [1, 2, 3]', false, 120)!
  expect(art).not.toContain('')
  expect(art).toContain('中文')
  expect(borderColumns(art).length).toBeGreaterThan(0)
})
