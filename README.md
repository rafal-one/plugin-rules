# plugin-rules

A Claude Code [mod](https://code.claude.com/docs/en/plugins) that loads the `rules/` folder of every installed plugin.
Claude Code has no `rules` plugin component today ([claude-code#14200](https://github.com/anthropics/claude-code/issues/14200), 120+ reactions), so rules that plugin authors ship for Cursor or Antigravity, or that a team ships as a shared coding standard, never reach Claude. This mod closes that gap.

## Install

```
/plugin marketplace add rafal-one/plugin-rules
/plugin install plugin-rules@plugin-rules
```

Needs a Claude Code build with mods (function hooks). Run `/plugin-rules` to see what loaded and why.

## What it does

For each enabled plugin it reads `<plugin>/rules/**/*.{md,mdc}` and activates every rule by its frontmatter:

| Frontmatter | Meaning | What this mod does |
| --- | --- | --- |
| none, or `alwaysApply: true`, or `trigger: always_on` | always on | added to Claude's instruction files |
| `paths:` (Claude), `globs:` (Cursor), `trigger: glob` + `globs:` (Antigravity) | path scoped | appended to the result of the first `Read`/`Edit`/`Write` of a matching file, once per session |
| `description:` only, `trigger: model_decision` | model decides | listed with its path and description, so Claude can `Read` it |
| `trigger: manual` | manual | listed like the above |

`foo.md` and `foo.mdc` twins (as in flutter/agent-plugins) are collapsed into one rule. Globs support `*`, `**`, `?` and `{a,b}`; a glob without `/` matches the file name anywhere.

## Options

Set in the plugin config menu or `pluginConfigs` in settings:

- `extraDirs`: comma-separated directories with rule files, for example a team standards checkout.
- `disabledPlugins`: comma-separated plugin names whose rules must not load.

A plugin disabled in `enabledPlugins` is skipped automatically.

## Limits

- The mods API is early access and may change between releases.
- Plugins are found through `~/.claude/plugins/installed_plugins.json`. Rule files over 20,000 characters are truncated.
- `prompt.context` hooks do not run in plugins a person installs where an organization manages Claude Code; the path-scoped rules still do.
- If Anthropic ships native plugin rules, use those and uninstall this.

## Development

```
claude plugin validate .
claude plugin test .                      # 10 unit tests (frontmatter, dialects, globs)
claude -p --plugin-dir . --settings s.json "..."   # live run, see below
```

Live check (2026-10-19): with `extraDirs` pointing at a folder holding an `alwaysApply` rule and a `globs: src/**/*.py` rule, Claude answered the codeword from the always rule and received the path rule when it read `src/m.py`.

## Support

If it saves you time, you can support development: [PayPal](https://paypal.me/RafalBaranowski).

MIT licensed.
