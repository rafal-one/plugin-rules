import type { EngineInterface, Register } from 'claude-code'

import {
  RULE_FILE,
  availableIndex,
  classify,
  dedupe,
  formatRule,
  matchesGlob,
  relativeTo,
  splitList,
  type Rule,
} from './rules'

type Installed = { plugins?: Record<string, Array<{ installPath?: string }> | { installPath?: string }> }

const SCOPED_TOOLS = ['Read', 'Edit', 'Write'] as const
const MAX_RULE_CHARS = 20000

type Opts = { extraDirs: string[]; skip: Set<string> }

async function readRules(
  $: EngineInterface,
  plugin: string,
  dir: string,
  out: Rule[],
): Promise<void> {
  const entries = await $.fs.list(dir).catch(() => [])
  for (const ent of entries) {
    const full = `${dir.replace(/\/+$/, '')}/${ent.name}`
    if (ent.kind === 'dir') await readRules($, plugin, full, out)
    else if (ent.kind === 'file' && RULE_FILE.test(ent.name)) {
      const text = await $.fs.read(full).catch(() => undefined)
      if (text !== undefined) out.push(classify(plugin, full, text.slice(0, MAX_RULE_CHARS)))
    }
  }
}

async function scan($: EngineInterface, opts: Opts): Promise<Rule[]> {
  const home = await $.env.get('HOME')
  const out: Rule[] = []
  const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
  const enabled = (settings as { enabledPlugins?: Record<string, boolean> }).enabledPlugins ?? {}
  const raw = await $.fs
    .read(`${home ?? ''}/.claude/plugins/installed_plugins.json`)
    .catch(() => '{}')
  let installed: Installed = {}
  try {
    installed = JSON.parse(raw) as Installed
  } catch {
    installed = {}
  }
  for (const [key, value] of Object.entries(installed.plugins ?? {})) {
    const name = key.split('@')[0]
    if (enabled[key] === false || opts.skip.has(name)) continue
    const list = Array.isArray(value) ? value : [value]
    for (const item of list) {
      if (item?.installPath) await readRules($, name, `${item.installPath}/rules`, out)
    }
  }
  const cwd = await $.session.cwd()
  for (const dir of opts.extraDirs) {
    const abs = dir.startsWith('/') ? dir : `${cwd}/${dir}`
    await readRules($, 'extra', abs, out)
  }
  return dedupe(out).filter(r => r.body !== '' || r.mode === 'model')
}

export const register: Register = (on, options) => {
  const extraDirs = splitList(options?.extraDirs)
  const skip = new Set(splitList(options?.disabledPlugins))
  const opts: Opts = { extraDirs, skip }
  const delivered = new Set<string>()
  let cache: Rule[] | undefined

  on('session.start', async ($, e, next) => {
    delivered.clear()
    cache = undefined
    await $.command.register({
      name: 'plugin-rules',
      description: 'List the plugin rules that are loaded and why',
    })
    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    cache = await scan($, opts)
    const rules = cache
    const always = rules.filter(r => r.mode === 'always')
    const listed = rules.filter(r => r.mode === 'model' || r.mode === 'manual')
    const files = always.map(r => ({
      path: r.path,
      kind: 'user' as const,
      content: r.body,
    }))
    const index = availableIndex(listed)
    if (index !== '') files.push({ path: 'plugin-rules:index', kind: 'user', content: index })
    if (files.length === 0) return next(e)
    if (e.instructionFiles !== undefined) {
      return next({ ...e, instructionFiles: [...e.instructionFiles, ...files] })
    }
    const text = files.map(f => f.content).join('\n\n')
    return next({ ...e, blocks: [...e.blocks, { name: 'pluginRules', text }] })
  })

  for (const tool of SCOPED_TOOLS) {
    on('tool.call', { tool }, async ($, e, next) => {
      const ran = await next(e)
      if (ran.deny !== undefined) return ran
      const file = (e as { file_path?: string }).file_path
      if (!file) return ran
      cache = cache ?? (await scan($, opts))
      const rules = cache
      const cwd = await $.session.cwd()
      const rel = relativeTo(cwd, file)
      const hits = rules.filter(
        r => r.mode === 'glob' && !delivered.has(r.path) && matchesGlob(r.globs, rel),
      )
      if (hits.length === 0) return ran
      for (const r of hits) delivered.add(r.path)
      return { ...ran, context: [...(ran.context ?? []), ...hits.map(formatRule)] }
    }).catch(($, e, next) => next(e))
  }

  on('command.run', { command: 'plugin-rules' }, async $ => {
    const rules = await scan($, opts)
    if (rules.length === 0) return { text: 'No plugin ships a rules/ folder (and no extra directories are set).' }
    const lines = rules.map(r => {
      const why =
        r.mode === 'glob'
          ? `when a file matching ${r.globs.join(', ')} is read or edited${delivered.has(r.path) ? ' (delivered)' : ''}`
          : r.mode === 'always'
            ? 'always, in the instructions'
            : 'listed; Claude may Read it'
      return `${r.plugin}/${r.name}: ${why}`
    })
    return { text: lines.join('\n') }
  })
}
