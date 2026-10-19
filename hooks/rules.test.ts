import { test, expect } from 'claude-code/testing'

import { availableIndex, classify, dedupe, globToRegExp, matchesGlob, parseFrontmatter, relativeTo } from './rules'

test('frontmatter: scalars, inline and block lists, quotes', () => {
  const { data, body } = parseFrontmatter(
    '---\ndescription: "Use when X"\nalwaysApply: false\nglobs: ["src/**/*.ts", \'*.tsx\']\npaths:\n  - a/**\n  - b\n---\nBody\n',
  )
  expect(data.description).toBe('Use when X')
  expect(data.alwaysApply).toBe(false)
  expect(data.globs).toEqual(['src/**/*.ts', '*.tsx'])
  expect(data.paths).toEqual(['a/**', 'b'])
  expect(body).toBe('Body\n')
})

test('frontmatter: absent or unterminated is plain body', () => {
  expect(parseFrontmatter('hello').body).toBe('hello')
  expect(parseFrontmatter('---\nnever closed').data).toEqual({})
  expect(parseFrontmatter('---\r\nk: v\r\n---\r\nx').data.k).toBe('v')
})

test('classify: cursor alwaysApply', () => {
  const r = classify('p', '/x/rules/a.mdc', '---\nalwaysApply: true\n---\nDo it')
  expect(r.mode).toBe('always')
  expect(r.name).toBe('a')
  expect(r.body).toBe('Do it')
})

test('classify: cursor globs as comma string', () => {
  const r = classify('p', '/x/b.mdc', '---\nglobs: src/**/*.ts, *.tsx\nalwaysApply: false\n---\nX')
  expect(r.mode).toBe('glob')
  expect(r.globs).toEqual(['src/**/*.ts', '*.tsx'])
})

test('classify: cursor description only is model-decided', () => {
  const r = classify('p', '/x/c.mdc', '---\ndescription: When writing SQL\nalwaysApply: false\n---\nX')
  expect(r.mode).toBe('model')
  expect(r.description).toBe('When writing SQL')
})

test('classify: antigravity triggers', () => {
  expect(classify('p', 'a.md', '---\ntrigger: always_on\n---\nX').mode).toBe('always')
  expect(classify('p', 'a.md', '---\ntrigger: glob\nglobs: "*.py"\n---\nX').mode).toBe('glob')
  expect(classify('p', 'a.md', '---\ntrigger: glob\n---\nX').mode).toBe('manual')
  expect(classify('p', 'a.md', '---\ntrigger: model_decision\ndescription: d\n---\nX').mode).toBe('model')
  expect(classify('p', 'a.md', '---\ntrigger: manual\n---\nX').mode).toBe('manual')
})

test('classify: claude paths and plain files', () => {
  expect(classify('p', 'a.md', '---\npaths:\n  - "src/**"\n---\nX').mode).toBe('glob')
  expect(classify('p', 'a.md', 'Just text').mode).toBe('always')
})

test('dedupe: prefers the twin with metadata, then .md', () => {
  const md = classify('p', '/r/flutter.md', 'plain')
  const mdc = classify('p', '/r/flutter.mdc', '---\nglobs: "*.dart"\n---\nplain')
  expect(dedupe([md, mdc])).toEqual([mdc])
  const a = classify('p', '/r/x.md', 'a')
  const b = classify('p', '/r/x.mdc', 'a')
  expect(dedupe([b, a])[0].path).toBe('/r/x.md')
  expect(dedupe([classify('q', '/r/x.md', 'a'), a]).length).toBe(2)
})

test('glob matching', () => {
  expect(matchesGlob(['**/*.ts'], 'src/a/b.ts')).toBe(true)
  expect(matchesGlob(['**/*.ts'], 'b.ts')).toBe(true)
  expect(matchesGlob(['src/*.ts'], 'src/a/b.ts')).toBe(false)
  expect(matchesGlob(['*.py'], 'deep/dir/x.py')).toBe(true)
  expect(matchesGlob(['src/**'], 'src/a/b.ts')).toBe(true)
  expect(matchesGlob(['*.{ts,tsx}'], 'a/b.tsx')).toBe(true)
  expect(matchesGlob(['*.{ts,tsx}'], 'a/b.js')).toBe(false)
  expect(matchesGlob(['a?.md'], 'ab.md')).toBe(true)
  expect(matchesGlob(['./lib/**/*.dart'], 'lib/x/y.dart')).toBe(true)
  expect(matchesGlob([''], 'x')).toBe(false)
  expect(globToRegExp('a.b').test('axb')).toBe(false)
})

test('relativeTo and index', () => {
  expect(relativeTo('/p/', '/p/src/a.ts')).toBe('src/a.ts')
  expect(relativeTo('/p', '/other/a.ts')).toBe('/other/a.ts')
  expect(availableIndex([])).toBe('')
  expect(availableIndex([classify('p', '/r/s.mdc', '---\ndescription: SQL\n---\nx')])).toContain('/r/s.mdc: SQL')
})
