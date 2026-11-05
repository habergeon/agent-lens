# agent-lens

[Claude Code](https://claude.com/claude-code)용 mod 모음입니다. 마켓플레이스 이름은 `agent-lens`이고, `plugins/` 아래 각 항목이 독립 플러그인이라 필요한 것만 설치하면 됩니다.

| Plugin | Type | What it does |
| --- | --- | --- |
| [skill-trace](plugins/skill-trace) | mod | 질문마다 Claude가 고른 스킬과 그 이유, 사용한 MCP 도구·서브에이전트·훅·슬래시 커맨드를 옆 패널에 보여 줍니다. |

## Install

### From the marketplace

```
/plugin marketplace add habergeon/agent-lens
/plugin install skill-trace@agent-lens
```

### By hand

```bash
git clone https://github.com/habergeon/agent-lens.git ~/agent-lens
claude --plugin-dir ~/agent-lens/plugins/skill-trace
```

모든 세션에 적용하려면 `~/.claude/settings.json` 의 `env` 에 `"CLAUDE_CODE_PLUGIN_DIRS": "~/agent-lens/plugins/skill-trace"` 를 넣습니다.

Mods are built on function hooks (`hooks/register.tsx`), an early-access Claude Code API: tested on Claude Code 2.1.318, and it may change between releases.

## Layout

```
.claude-plugin/marketplace.json   the catalog `/plugin marketplace add` reads
plugins/<name>/
  .claude-plugin/plugin.json      manifest
  hooks/hooks.json                points at the hooks module
  hooks/register.tsx              the module itself
  hooks/*.test.ts(x)              `claude plugin test plugins/<name>`
  types/index.d.ts                its $.state contract
docs/specs, docs/plans            design notes
```

Check before publishing: `claude plugin validate plugins/<name>` and `claude plugin validate .`.

## License

MIT
