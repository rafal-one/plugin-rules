// Pure helpers: frontmatter, rule classification, glob matching. No engine access.

export type Mode = 'always' | 'glob' | 'model' | 'manual'

export type Rule = {
  plugin: string
  path: string
  name: string
  mode: Mode
  globs: string[]
  description: string
  body: string
}

type Value = string | boolean | string[]

const unquote = (s: string): string => {
  const t = s.trim()
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]
    ? t.slice(1, -1)
    : t
}

const scalar = (raw: string): Value => {
  const t = raw.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t.startsWith('[') && t.endsWith(']')) {
    return t
      .slice(1, -1)
      .split(',')
      .map(unquote)
      .filter(s => s !== '')
  }
  return unquote(t)
}

/** Splits `---` frontmatter off a file. Unknown YAML shapes are ignored, not fatal. */
export function parseFrontmatter(text: string): { data: Record<string, Value>; body: string } {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src)
  if (!m) return { data: {}, body: src }
  const data: Record<string, Value> = {}
  let listKey: string | undefined
  for (const line of m[1].split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') continue
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && listKey !== undefined) {
      const cur = data[listKey]
      data[listKey] = [...(Array.isArray(cur) ? cur : []), unquote(item[1])]
      continue
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    if (kv[2].trim() === '') {
      listKey = kv[1]
      data[kv[1]] = []
    } else {
      listKey = undefined
      data[kv[1]] = scalar(kv[2])
    }
  }
  return { data, body: src.slice(m[0].length) }
}

const asList = (v: Value | undefined): string[] => {
  if (v === undefined || typeof v === 'boolean') return []
  const items = Array.isArray(v) ? v : v.split(',')
  return items.map(s => unquote(s)).filter(s => s !== '')
}

const asText = (v: Value | undefined): string => (typeof v === 'string' ? v : '')

/**
 * Maps the three frontmatter dialects to one activation mode.
 * Claude: `paths:`. Cursor: `alwaysApply`, `globs`, `description`.
 * Antigravity: `trigger: always_on | glob | model_decision | manual`.
 */
export function classify(
  plugin: string,
  path: string,
  text: string,
): Rule {
  const { data, body } = parseFrontmatter(text)
  const file = path.split('/').pop() ?? path
  const name = file.replace(/\.(mdc|md|markdown)$/i, '')
  const globs = [...asList(data.paths), ...asList(data.globs)]
  const description = asText(data.description).trim()
  const trigger = asText(data.trigger).toLowerCase()
  let mode: Mode
  if (trigger === 'always_on' || trigger === 'always') mode = 'always'
  else if (trigger === 'glob') mode = globs.length > 0 ? 'glob' : 'manual'
  else if (trigger === 'model_decision') mode = 'model'
  else if (trigger === 'manual') mode = 'manual'
  else if (data.alwaysApply === true) mode = 'always'
  else if (globs.length > 0) mode = 'glob'
  else if (description !== '' && 'alwaysApply' in data) mode = 'model'
  else if (Object.keys(data).length === 0 || 'paths' in data) mode = 'always'
  else mode = description !== '' ? 'model' : 'always'
  return { plugin, path, name, mode, globs, description, body: body.trim() }
}

/** .md and .mdc twins (same basename) collapse to the one that carries activation metadata. */
export function dedupe(rules: Rule[]): Rule[] {
  const seen = new Map<string, Rule>()
  const score = (r: Rule): number =>
    (r.globs.length > 0 || r.description !== '' ? 2 : 0) + (r.path.endsWith('.md') ? 1 : 0)
  for (const r of rules) {
    const key = `${r.plugin}\u0000${r.name}`
    const cur = seen.get(key)
    if (!cur || score(r) > score(cur)) seen.set(key, r)
  }
  return [...seen.values()]
}

const escapeRe = (c: string): string => c.replace(/[.+^$()|[\]\\]/g, '\\$&')

export function globToRegExp(glob: string): RegExp {
  let re = ''
  let depth = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      depth++
      re += '(?:'
    } else if (c === '}' && depth > 0) {
      depth--
      re += ')'
    } else if (c === ',' && depth > 0) re += '|'
    else re += escapeRe(c)
  }
  return new RegExp(`^${re}$`)
}

/** Matches a project-relative path. A pattern without `/` matches the basename anywhere. */
export function matchesGlob(globs: string[], relPath: string): boolean {
  const path = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  const base = path.split('/').pop() ?? path
  return globs.some(g => {
    const pat = g.trim().replace(/^\.\//, '')
    if (pat === '') return false
    const re = globToRegExp(pat)
    return re.test(path) || (!pat.includes('/') && re.test(base))
  })
}

export function relativeTo(cwd: string, file: string): string {
  const root = cwd.replace(/\/+$/, '')
  return file.startsWith(root + '/') ? file.slice(root.length + 1) : file
}

export function splitList(s: unknown): string[] {
  return typeof s === 'string' ? s.split(',').map(x => x.trim()).filter(x => x !== '') : []
}

export const RULE_FILE = /\.(md|mdc|markdown)$/i

export function formatRule(r: Rule): string {
  return `Rule "${r.name}" from plugin ${r.plugin} (${r.path}):\n\n${r.body}`
}

export function availableIndex(rules: Rule[]): string {
  if (rules.length === 0) return ''
  const lines = rules.map(
    r => `- ${r.path}: ${r.description !== '' ? r.description : r.name}`,
  )
  return `Plugin rules you may Read when relevant:\n${lines.join('\n')}`
}
