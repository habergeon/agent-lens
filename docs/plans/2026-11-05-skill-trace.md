# skill-trace 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 질문 1건마다 그 질문에 쓰인 스킬(과 고른 이유)과 플러그인 기능(MCP·서브에이전트·훅·커맨드)을 옆 패널에 보여 주는 Claude Code mod `skill-trace`를 만든다.

**Architecture:** 순수 로직(`hooks/trace.ts`)이 `Trace[]`를 다루는 불변 함수들을 제공한다. 훅 모듈(`hooks/register.tsx`)은 엔진 이벤트를 받아 이 함수들로 `$.state` atom 하나를 갱신하고, 패널은 그 atom을 읽어 그린다. 이유는 `prompt.compose`로 넣은 규칙에 따라 모델이 쓴 `[스킬근거]` 줄을 `session.append`에서 파싱해 얻는다.

**Tech Stack:** Claude Code 2.1.318 mod API (function hooks, `claude-code`, `claude-code/testing`), TypeScript/TSX, `claude plugin validate|test`, `npx -p typescript@5.6 tsc`.

## Global Constraints

- 저장소: `C:\workspace\personal\claude-mods`, 브랜치 `main`, 커밋 계정 `habergeon <hefa91@gmail.com>` (local config 설정됨)
- 형태: `johnnyvizz/claude-kit` 와 같은 다중 플러그인 마켓플레이스. 플러그인은 `plugins/<name>/`
- 마켓플레이스 이름 `agent-lens`, 플러그인 이름 `skill-trace`, GitHub `habergeon/agent-lens`, 라이선스 MIT
- 이유 줄 형식(고정): `[스킬근거] <스킬명>: <이유 한 줄>`
- 질문 최대 30건 보관, 질문 미리보기 40자, 훅 첫 줄 30자, 이유 80자
- 패널 id `skill-trace`, 제목 `스킬 추적`, 명령 `/skill-trace`
- 관찰 전용: 어떤 훅도 `deny`·입력 변경을 하지 않는다. 기록은 `next(e)` **앞**에서 한다(이벤트 순서를 보존하려고. 훅이 throw 하면 엔진이 그 훅만 건너뛰고 체인을 계속하므로 본동작은 영향받지 않는다)
- 모듈에는 DOM·Node 가 없다. `import()`·`require` 금지, 플러그인 파일은 정적 `import` 로만
- 대상 엔진 이외의 런타임 API(`Array.prototype.findLastIndex` 등 최신 내장)에 기대지 않는다

## File Structure

| 파일 | 책임 |
|---|---|
| `.claude-plugin/marketplace.json` | 카탈로그 (`agent-lens`) |
| `.gitignore`, `LICENSE`, `README.md` | 저장소 공통 |
| `plugins/skill-trace/.claude-plugin/plugin.json` | 매니페스트 |
| `plugins/skill-trace/types/index.d.ts` | `Trace` 타입과 `PluginState` 계약 |
| `plugins/skill-trace/hooks/trace.ts` | 순수 함수: 질문 시작, 항목 추가, 이유 짝맞춤, MCP 이름 파싱, 표시 줄 생성 |
| `plugins/skill-trace/hooks/trace.test.ts` | 순수 함수 테스트 |
| `plugins/skill-trace/hooks/hooks.json` | 모듈 지정 |
| `plugins/skill-trace/hooks/register.tsx` | 이벤트 연결 · 규칙 주입 · 패널 · 명령 |
| `plugins/skill-trace/hooks/register.test.tsx` | 엔진 연결 테스트 |
| `plugins/skill-trace/README.md` | 플러그인 설명 |

---

### Task 1: 저장소 골격과 매니페스트

**Files:**
- Create: `.claude-plugin/marketplace.json`, `.gitignore`, `LICENSE`, `plugins/skill-trace/.claude-plugin/plugin.json`, `plugins/skill-trace/hooks/hooks.json`, `plugins/skill-trace/types/index.d.ts`, `plugins/skill-trace/hooks/register.tsx`(빈 register)

**Interfaces:**
- Produces: 타입 `Trace`, `SkillUse`, `McpUse`, `AgentUse`, `HookUse` (`plugins/skill-trace/types/index.d.ts`), state 키 `'skill-trace'.traces`

- [ ] **Step 1: 카탈로그 작성** — `.claude-plugin/marketplace.json`

```json
{
  "name": "agent-lens",
  "owner": { "name": "habergeon", "url": "https://github.com/habergeon" },
  "metadata": { "description": "Claude Code mods that show what the agent is doing and why." },
  "plugins": [
    {
      "name": "skill-trace",
      "source": "./plugins/skill-trace",
      "description": "Mod: a side pane listing, per question, the skills Claude chose (with its reason) and the plugin features it used: MCP tools, subagents, hooks, slash commands.",
      "version": "0.1.0",
      "category": "mod"
    }
  ]
}
```

- [ ] **Step 2: `.gitignore`**

```
.DS_Store
node_modules/
*.log
# Generated per machine by the engine
**/.claude-plugin/types/
tsconfig.json
```

- [ ] **Step 3: `LICENSE`** — MIT 전문, 첫 줄 `MIT License`, 저작권 줄 `Copyright (c) 2026 habergeon`

- [ ] **Step 4: 매니페스트** — `plugins/skill-trace/.claude-plugin/plugin.json`

```json
{
  "name": "skill-trace",
  "version": "0.1.0",
  "description": "Side pane: per question, the skills Claude chose and why, plus the MCP tools, subagents, hooks and slash commands it used.",
  "author": { "name": "habergeon", "url": "https://github.com/habergeon" },
  "types": "./types/index.d.ts",
  "homepage": "https://github.com/habergeon/agent-lens/tree/main/plugins/skill-trace",
  "repository": "https://github.com/habergeon/agent-lens",
  "keywords": ["skills", "trace", "mod", "pane"],
  "license": "MIT"
}
```

- [ ] **Step 5: `plugins/skill-trace/hooks/hooks.json`**

```json
{ "modules": ["./register.tsx"] }
```

- [ ] **Step 6: 타입 계약** — `plugins/skill-trace/types/index.d.ts`

```ts
export type SkillUse = { name: string; reason?: string; sub?: boolean }
export type McpUse = { server: string; tool: string; count: number; sub?: boolean }
export type AgentUse = { type: string; count: number }
export type HookUse = { event: string; head: string; count: number }

export type Trace = {
  /** 질문 순번. 1부터. 0 은 질문 전에 일어난 일을 묶는 "(세션 시작)" 항목. */
  id: number
  question: string
  skills: SkillUse[]
  mcp: McpUse[]
  agents: AgentUse[]
  hooks: HookUse[]
  commands: string[]
  /** 스킬보다 먼저 도착한 이유: 스킬 이름 → 이유. 같은 이름의 스킬이 기록되면 소비된다. */
  pending: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    'skill-trace': { traces: Shaped<Trace[]> }
  }
}
```

- [ ] **Step 7: 빈 register** — `plugins/skill-trace/hooks/register.tsx`

```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 8: 검증**

Run: `cd C:/workspace/personal/claude-mods && claude plugin validate . && claude plugin validate plugins/skill-trace`
Expected: 두 번 모두 오류 없이 통과. `agent-lens` 이름이 예약어로 거부되면 멈추고 사용자에게 알린다.

- [ ] **Step 9: Commit**

```bash
git add .claude-plugin .gitignore LICENSE plugins/skill-trace
git commit -m "chore: agent-lens 마켓플레이스와 skill-trace 골격"
```

---

### Task 2: 순수 로직 `trace.ts`

**Files:**
- Create: `plugins/skill-trace/hooks/trace.ts`
- Test: `plugins/skill-trace/hooks/trace.test.ts`

**Interfaces:**
- Consumes: `Trace` 등 (Task 1)
- Produces (모두 `hooks/trace.ts` 의 named export):
  - `MAX = 30`, `REASON_RULE: string`
  - `cut(s: string, n: number): string`
  - `startTrace(list: Trace[], question: string): Trace[]`
  - `onLatest(list: Trace[], fn: (t: Trace) => Trace): Trace[]`
  - `addCommand(t: Trace, name: string): Trace`
  - `addSkill(t: Trace, name: string): Trace`
  - `markSub(t: Trace, name: string): Trace`
  - `addMcp(t: Trace, tool: string, sub: boolean): Trace`
  - `addAgent(t: Trace, type: string): Trace`
  - `addHook(t: Trace, event: string, text: string): Trace`
  - `parseReasons(text: string): [string, string][]`
  - `withReason(t: Trace, name: string, reason: string): Trace`
  - `parseMcp(tool: string): { server: string; tool: string } | undefined`
  - `type Line = { text: string; bold?: boolean; dim?: boolean }`
  - `detail(t: Trace): Line[]`, `summary(t: Trace): string`

- [ ] **Step 1: 실패하는 테스트 작성** — `plugins/skill-trace/hooks/trace.test.ts`

```ts
import { expect, test } from 'claude-code/testing'
import type { Trace } from '../types'
import {
  MAX, addAgent, addCommand, addHook, addMcp, addSkill, detail, markSub,
  onLatest, parseMcp, parseReasons, startTrace, summary, withReason,
} from './trace'

const one = (q = '질문'): Trace => startTrace([], q)[0]

test('startTrace numbers questions and keeps the last 30', async () => {
  let list: Trace[] = []
  for (let i = 0; i < MAX + 1; i++) list = startTrace(list, `q${i}`)
  expect(list.length).toBe(MAX)
  expect(list[0].id).toBe(2)
  expect(list[MAX - 1].id).toBe(MAX + 1)
})

test('startTrace cuts the question to 40 chars on one line', async () => {
  const t = one('가'.repeat(50) + '\n둘째 줄')
  expect(t.question.length).toBe(40)
  expect(t.question.endsWith('…')).toBe(true)
})

test('onLatest makes a "(세션 시작)" trace when none exists', async () => {
  const list = onLatest([], t => addHook(t, 'SessionStart', 'PONYTAIL MODE ACTIVE'))
  expect(list[0].id).toBe(0)
  expect(list[0].question).toBe('(세션 시작)')
  expect(list[0].hooks[0]).toEqual({ event: 'SessionStart', head: 'PONYTAIL MODE ACTIVE', count: 1 })
})

test('a reason that arrives after the skill attaches to it', async () => {
  const t = withReason(addSkill(one(), 'superpowers:brainstorming'), 'brainstorming', '설계 먼저')
  expect(t.skills[0].reason).toBe('설계 먼저')
})

test('a reason that arrives before the skill waits in pending', async () => {
  const early = withReason(one(), 'superpowers:brainstorming', '설계 먼저')
  expect(early.pending['superpowers:brainstorming']).toBe('설계 먼저')
  const t = addSkill(early, 'superpowers:brainstorming')
  expect(t.skills[0].reason).toBe('설계 먼저')
  expect(Object.keys(t.pending).length).toBe(0)
})

test('parseReasons finds every tagged line', async () => {
  const text = '먼저 확인합니다.\n[스킬근거] plugin-authoring: mod API 확인 필요\n본문\n[스킬근거] a:b: 콜론 포함'
  expect(parseReasons(text)).toEqual([
    ['plugin-authoring', 'mod API 확인 필요'],
    ['a', 'b: 콜론 포함'],
  ])
})

test('parseMcp reads the server from plugin and plain names', async () => {
  expect(parseMcp('mcp__plugin_context-mode_context-mode__ctx_execute')).toEqual({ server: 'context-mode', tool: 'ctx_execute' })
  expect(parseMcp('mcp__savvy-progress__step')).toEqual({ server: 'savvy-progress', tool: 'step' })
  expect(parseMcp('Bash')).toBe(undefined)
})

test('addMcp, addAgent and addHook count repeats', async () => {
  let t = one()
  t = addMcp(t, 'mcp__plugin_context-mode_context-mode__ctx_execute', false)
  t = addMcp(t, 'mcp__plugin_context-mode_context-mode__ctx_execute', false)
  t = addMcp(t, 'mcp__plugin_context-mode_context-mode__ctx_execute', true)
  t = addAgent(addAgent(t, 'Explore'), 'Explore')
  t = addHook(addHook(t, 'PreToolUse', 'tip\nmore'), 'PreToolUse', 'tip')
  expect(t.mcp).toEqual([
    { server: 'context-mode', tool: 'ctx_execute', count: 2 },
    { server: 'context-mode', tool: 'ctx_execute', count: 1, sub: true },
  ])
  expect(t.agents).toEqual([{ type: 'Explore', count: 2 }])
  expect(t.hooks).toEqual([{ event: 'PreToolUse', head: 'tip', count: 2 }])
})

test('markSub flags the newest skill of that name', async () => {
  const t = markSub(addSkill(addSkill(one(), 'x'), 'x'), 'x')
  expect(t.skills.map(s => s.sub === true)).toEqual([false, true])
})

test('detail shows fallbacks and summary counts', async () => {
  let t = addCommand(one('mod 검토해줘'), 'superpowers:brainstorming')
  t = addSkill(t, 'superpowers:brainstorming')
  t = addSkill(t, 'plugin-authoring')
  const text = detail(t).map(l => l.text).join('\n')
  expect(text).toContain('Q1 "mod 검토해줘"')
  expect(text).toContain('superpowers:brainstorming — 사용자 실행')
  expect(text).toContain('plugin-authoring — 이유 미기재')
  expect(text).toContain('/superpowers:brainstorming')
  expect(summary(t)).toBe('▸ Q1 "mod 검토해줘" · 스킬 2 · 커맨드 1')
  expect(detail(one()).map(l => l.text)).toContain('  (스킬·플러그인 기능 사용 없음)')
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test plugins/skill-trace`
Expected: FAIL — `./trace` 모듈 없음

- [ ] **Step 3: 구현** — `plugins/skill-trace/hooks/trace.ts`

```ts
import type { Trace } from '../types'

export const MAX = 30

export const REASON_RULE =
  'Skill 도구를 호출하기 직전, 응답 본문에 다음 형식의 한 줄을 쓴다: ' +
  '`[스킬근거] <스킬명>: <이 질문에 이 스킬을 고른 이유 한 줄>`. ' +
  '이 줄은 skill-trace 패널이 읽어 사용자에게 보여 준다.'

const REASON_LINE = /^\[스킬근거\]\s*([^:\n]+?)\s*:\s*(.+)$/gm

export const cut = (s: string, n: number): string => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat
}

const blank = (id: number, question: string): Trace => ({
  id, question, skills: [], mcp: [], agents: [], hooks: [], commands: [], pending: {},
})

export const startTrace = (list: Trace[], question: string): Trace[] => {
  const id = (list.length ? list[list.length - 1].id : 0) + 1
  return [...list, blank(id, cut(question, 40))].slice(-MAX)
}

export const onLatest = (list: Trace[], fn: (t: Trace) => Trace): Trace[] => {
  const base = list.length ? list : [blank(0, '(세션 시작)')]
  return [...base.slice(0, -1), fn(base[base.length - 1])]
}

// "brainstorming" 과 "superpowers:brainstorming" 을 같은 스킬로 본다.
const same = (a: string, b: string): boolean =>
  a === b || a.endsWith(':' + b) || b.endsWith(':' + a)

const lastIndex = <T>(xs: readonly T[], ok: (x: T) => boolean): number => {
  for (let i = xs.length - 1; i >= 0; i--) if (ok(xs[i])) return i
  return -1
}

export const addCommand = (t: Trace, name: string): Trace => ({
  ...t, commands: [...t.commands, `/${name}`],
})

export const addSkill = (t: Trace, name: string): Trace => {
  const key = Object.keys(t.pending).find(k => same(k, name))
  const pending = { ...t.pending }
  if (key !== undefined) delete pending[key]
  const reason = key === undefined ? undefined : t.pending[key]
  return { ...t, pending, skills: [...t.skills, reason ? { name, reason } : { name }] }
}

export const markSub = (t: Trace, name: string): Trace => {
  const i = lastIndex(t.skills, s => same(s.name, name))
  if (i < 0) return t
  return { ...t, skills: t.skills.map((s, j) => (j === i ? { ...s, sub: true } : s)) }
}

export const parseMcp = (tool: string): { server: string; tool: string } | undefined => {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (!m) return undefined
  const server = m[1].startsWith('plugin_') ? m[1].slice('plugin_'.length).split('_')[0] : m[1]
  return { server, tool: m[2] }
}

export const addMcp = (t: Trace, tool: string, sub: boolean): Trace => {
  const p = parseMcp(tool)
  if (!p) return t
  const i = t.mcp.findIndex(m => m.server === p.server && m.tool === p.tool && (m.sub === true) === sub)
  if (i >= 0) return { ...t, mcp: t.mcp.map((m, j) => (j === i ? { ...m, count: m.count + 1 } : m)) }
  return { ...t, mcp: [...t.mcp, sub ? { ...p, count: 1, sub: true } : { ...p, count: 1 }] }
}

export const addAgent = (t: Trace, type: string): Trace => {
  const i = t.agents.findIndex(a => a.type === type)
  if (i >= 0) return { ...t, agents: t.agents.map((a, j) => (j === i ? { ...a, count: a.count + 1 } : a)) }
  return { ...t, agents: [...t.agents, { type, count: 1 }] }
}

export const addHook = (t: Trace, event: string, text: string): Trace => {
  const head = cut(text.split('\n').find(l => l.trim() !== '') ?? '', 30)
  const i = t.hooks.findIndex(h => h.event === event && h.head === head)
  if (i >= 0) return { ...t, hooks: t.hooks.map((h, j) => (j === i ? { ...h, count: h.count + 1 } : h)) }
  return { ...t, hooks: [...t.hooks, { event, head, count: 1 }] }
}

export const parseReasons = (text: string): [string, string][] =>
  [...text.matchAll(REASON_LINE)].map(m => [m[1].trim(), cut(m[2], 80)])

export const withReason = (t: Trace, name: string, reason: string): Trace => {
  const i = lastIndex(t.skills, s => same(s.name, name) && !s.reason)
  if (i >= 0) return { ...t, skills: t.skills.map((s, j) => (j === i ? { ...s, reason } : s)) }
  return { ...t, pending: { ...t.pending, [name]: reason } }
}

export type Line = { text: string; bold?: boolean; dim?: boolean }

const times = (n: number): string => (n > 1 ? ` ×${n}` : '')
const subTag = (sub?: boolean): string => (sub ? ' (sub)' : '')

export const detail = (t: Trace): Line[] => {
  const out: Line[] = [{ text: `▾ Q${t.id} "${t.question}"`, bold: true }]
  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return
    out.push({ text: ` ${title}`, dim: true })
    for (const r of rows) out.push({ text: `  · ${r}` })
  }
  section('스킬', t.skills.map(s => {
    const why = s.reason ?? (t.commands.some(c => same(c.slice(1), s.name)) ? '사용자 실행' : '이유 미기재')
    return `${s.name}${subTag(s.sub)} — ${why}`
  }))
  section('MCP', t.mcp.map(m => `${m.server}: ${m.tool}${times(m.count)}${subTag(m.sub)}`))
  section('서브에이전트', t.agents.map(a => `${a.type}${times(a.count)}`))
  section('훅', t.hooks.map(h => `${h.event}: ${h.head}${times(h.count)}`))
  section('커맨드', t.commands)
  if (out.length === 1) out.push({ text: '  (스킬·플러그인 기능 사용 없음)', dim: true })
  return out
}

export const summary = (t: Trace): string => {
  const sum = (xs: { count: number }[]) => xs.reduce((n, x) => n + x.count, 0)
  const parts: [string, number][] = [
    ['스킬', t.skills.length], ['MCP', sum(t.mcp)], ['에이전트', sum(t.agents)],
    ['훅', sum(t.hooks)], ['커맨드', t.commands.length],
  ]
  return [`▸ Q${t.id} "${t.question}"`, ...parts.filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`)].join(' · ')
}
```

- [ ] **Step 4: 통과 확인**

Run: `claude plugin test plugins/skill-trace`
Expected: `trace.test.ts` 10개 PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/skill-trace/hooks/trace.ts plugins/skill-trace/hooks/trace.test.ts
git commit -m "feat(skill-trace): 질문별 기록·이유 짝맞춤·표시 줄 순수 로직"
```

---

### Task 3: 이벤트 연결 · 규칙 주입 · 패널 · 명령

**Files:**
- Modify: `plugins/skill-trace/hooks/register.tsx` (전체 교체)
- Test: `plugins/skill-trace/hooks/register.test.tsx`

**Interfaces:**
- Consumes: Task 2 의 모든 export, state 키 `'skill-trace'.traces`
- Produces: 패널 `Pane`/`skill-trace`, 명령 `skill-trace`, system 섹션 id `skill-trace-reason`

- [ ] **Step 1: 실패하는 테스트 작성** — `plugins/skill-trace/hooks/register.test.tsx`

```tsx
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'skill-trace',
  component: 'Pane',
  requestId: 'skill-trace',
  props: {
    title: '스킬 추적',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// 플러그인 아래에는 아무것도 없다: 이 훅들이 엔진 역할을 한다.
const engine = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('command.register', () => ({ value: { command: 'skill-trace' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.compose', () => ({ sections: [] }))
}

const said = (text: string) => ({
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  door: 'response',
  origin: { kind: 'model', model: 'test' },
  uuid: crypto.randomUUID(),
}) as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: 한 질문의 스킬·이유·MCP·에이전트·훅·커맨드가 패널에 보인다`, async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.session.append({
      message: { type: 'attachment', content: [{ type: 'text', text: 'PONYTAIL MODE ACTIVE — level: full' }] },
      door: 'hook-context',
      origin: { kind: 'hook', event: 'SessionStart' },
      uuid: crypto.randomUUID(),
    } as never)
    await $.prompt.submit({ text: 'mod 만들 수 있어?' })
    await $.session.append(said('[스킬근거] plugin-authoring: mod API 확인 필요') as never)
    await $.skill.prompt({ skill: 'plugin-authoring', text: '...', frontmatter: {}, source: 'built-in' } as never)
    await $.tool.call({ tool: 'mcp__plugin_context-mode_context-mode__ctx_execute' } as never)
    await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', prompt: 'p', description: 'd' } as never)

    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Q1 "mod 만들 수 있어\?"/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /plugin-authoring — mod API 확인 필요/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /context-mode: ctx_execute/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /Explore/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /Q0 "\(세션 시작\)" · 훅 1/ }))).toBeTruthy()
    await ui.unmount()
  })
}

test('슬래시 커맨드는 커맨드로 기록되고, 그 스킬은 "사용자 실행"이 된다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '/superpowers:brainstorming 아이디어', command: { name: 'superpowers:brainstorming', args: '아이디어' } })
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '...', frontmatter: {}, source: 'plugin' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /superpowers:brainstorming — 사용자 실행/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^  · \/superpowers:brainstorming$/ }))).toBeTruthy()
  await ui.unmount()
})

test('prompt.compose 에 이유 규칙 섹션이 맨 끝에 붙는다', async ($, on) => {
  engine(on)
  const r = await $.prompt.compose({
    model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [],
  })
  const last = r.sections[r.sections.length - 1]
  expect(last.id).toBe('skill-trace-reason')
  expect(last.scope).toBe('session')
  expect(last.text).toContain('[스킬근거]')
})

test('기록이 없으면 안내 문구를 보인다', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('아직 기록된 질문이 없습니다.')
  await ui.unmount()
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test plugins/skill-trace`
Expected: `register.test.tsx` FAIL (패널이 아무것도 그리지 않음), `trace.test.ts` PASS

- [ ] **Step 3: 구현** — `plugins/skill-trace/hooks/register.tsx`

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Trace } from '../types'
import {
  REASON_RULE, addAgent, addCommand, addHook, addMcp, addSkill, detail,
  markSub, onLatest, parseReasons, startTrace, summary, withReason,
} from './trace'

const PANE = 'skill-trace'
const TITLE = '스킬 추적'
// Trace 필드가 바뀌면 태그를 올린다: 이전 버전이 저장한 값을 거절한다.
const traces = atom({ plugin: 'skill-trace', key: 'traces' } as const, [] as Trace[], {
  shape: 'traces-1',
})

const latest = ($: EngineInterface, fn: (t: Trace) => Trace) =>
  update($, traces, list => onLatest(list, fn))

const textOf = (blocks: readonly { type: string; [k: string]: unknown }[]): string =>
  blocks.filter(b => b.type === 'text').map(b => String(b.text ?? '')).join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skill-trace',
      description: '질문별로 쓰인 스킬·플러그인 기능 패널을 엽니다',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'skill-trace' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: '스킬 추적 패널을 열었습니다.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return {
      ...r,
      sections: [...r.sections, { id: 'skill-trace-reason', text: REASON_RULE, scope: 'session' as const }],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta) {
      const command = e.command
      await update($, traces, list => {
        const started = startTrace(list, e.text)
        return command ? onLatest(started, t => addCommand(t, command.name)) : started
      })
    }
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    await latest($, t => addSkill(t, e.skill))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const sub = e.agentId !== undefined
    if (e.tool.startsWith('mcp__')) await latest($, t => addMcp(t, e.tool, sub))
    if (e.tool === 'Agent') {
      const type = (e as { subagent_type?: string }).subagent_type ?? 'general-purpose'
      await latest($, t => addAgent(t, type))
    }
    const ran = await next(e)
    if (e.tool === 'Skill' && sub) {
      const name = (e as { skill?: string }).skill
      if (name) await latest($, t => markSub(t, name))
    }
    return ran
  })

  on('session.append', async ($, e, next) => {
    if (e.door === 'response') {
      const found = parseReasons(textOf(e.message.content))
      if (found.length) await latest($, t => found.reduce((acc, [n, r]) => withReason(acc, n, r), t))
    } else if (e.door === 'hook-context' && e.origin.kind === 'hook') {
      const event = (e.origin as { event: string }).event
      await latest($, t => addHook(t, event, textOf(e.message.content)))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, traces)
    if (list.length === 0) return <Text dimColor>아직 기록된 질문이 없습니다.</Text>
    const newest = list[list.length - 1]
    const older = list.slice(0, -1).reverse()
    return (
      <Box flexDirection="column">
        {detail(newest).map(l => (
          <Text bold={l.bold} dimColor={l.dim} wrap="truncate-end">{l.text}</Text>
        ))}
        {older.map(t => (
          <Text dimColor wrap="truncate-end">{summary(t)}</Text>
        ))}
      </Box>
    )
  })
}
```

- [ ] **Step 4: 통과 확인**

Run: `claude plugin test plugins/skill-trace`
Expected: 전부 PASS.
타입 오류(예: `EngineInterface` 이름, `Text` 의 `bold` prop, `e.origin` 좁히기)로 실패하면 `C:/Users/johjh/AppData/Local/Temp/claude/bundled-skills/2.1.318/94c8e9b995c30010c298afb37968743a/plugin-authoring/types/claude-code.d.ts` 에서 해당 이름을 grep 해 맞춘다 (동작 변경 없이 타입만).

- [ ] **Step 5: 정적 검증**

Run: `claude plugin validate plugins/skill-trace`
Expected: 훅 목록에 `session.start, command.run, prompt.compose, prompt.submit, skill.prompt, tool.call, session.append, ui.render` 가 나오고 거절 항목 없음

- [ ] **Step 6: Commit**

```bash
git add plugins/skill-trace/hooks/register.tsx plugins/skill-trace/hooks/register.test.tsx
git commit -m "feat(skill-trace): 이벤트 수집·이유 규칙·패널·/skill-trace"
```

---

### Task 4: 문서와 실제 세션 확인

**Files:**
- Create: `README.md`, `plugins/skill-trace/README.md`

- [ ] **Step 1: 루트 README** — `README.md`

````markdown
# claude-mods

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
git clone https://github.com/habergeon/agent-lens.git ~/claude-mods
claude --plugin-dir ~/claude-mods/plugins/skill-trace
```

모든 세션에 적용하려면 `~/.claude/settings.json` 의 `env` 에 `"CLAUDE_CODE_PLUGIN_DIRS": "~/claude-mods/plugins/skill-trace"` 를 넣습니다.

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
````

- [ ] **Step 2: 플러그인 README** — `plugins/skill-trace/README.md`

````markdown
# skill-trace

Claude가 질문마다 어떤 스킬을 왜 골랐는지, 어떤 플러그인 기능을 썼는지 옆 패널에 보여 주는 Claude Code mod입니다.

- **패널** (`/skill-trace` 로 다시 열기): 최신 질문을 펼쳐 보여 주고, 지난 질문은 한 줄 요약으로 접습니다. 최근 30건까지 보관합니다.
  - 스킬: 이름과 고른 이유. 사용자가 `/명령`으로 직접 실행한 스킬은 "사용자 실행", 이유 줄이 없으면 "이유 미기재"
  - MCP: 서버(플러그인)·도구별 호출 횟수
  - 서브에이전트: 타입별 호출 횟수
  - 훅: 훅 이벤트와 주입된 텍스트 첫 줄
  - 커맨드: 실행한 슬래시 커맨드
  - 서브에이전트 안에서 일어난 것은 `(sub)` 표시
- **이유 규칙**: 시스템 프롬프트에 한 섹션을 더해, Claude가 Skill 도구를 부르기 직전 `[스킬근거] <스킬명>: <이유>` 한 줄을 쓰게 합니다. 이 줄은 채팅에도 보입니다.

## 한계

- 이유는 모델의 자기 보고입니다. 실제 판단 과정의 기록이 아닙니다.
- 훅 개입은 어느 플러그인의 것인지 엔진이 알려 주지 않아, 주입 텍스트 첫 줄로 알아봅니다.
- "검토했지만 쓰지 않은 스킬"은 관찰할 수 없습니다.
- 세션 도중 mod 를 처음 켜거나 끄면 시스템 프롬프트가 바뀌어 프롬프트 캐시가 한 번 초기화됩니다.
- 터미널 폭이 좁으면 패널은 자리가 날 때까지 기다립니다.

Install instructions are in the [repository README](../../README.md).
````

- [ ] **Step 3: 타입 검사**

Run: `claude --plugin-dir C:/workspace/personal/claude-mods/plugins/skill-trace -p "ok"` (엔진이 `.claude-plugin/types/` 와 `tsconfig.json` 을 쓰게 한 번 로드) 후
`cd C:/workspace/personal/claude-mods && npx -y -p typescript@5.6 tsc -p plugins/skill-trace --noEmit`
Expected: 오류 0. 로드 후에도 `plugins/skill-trace/tsconfig.json` 이 없으면 types 파일 머리말이 안내하는 tsconfig 를 저장소 밖(스크래치)에 만들어 같은 검사를 한다.

- [ ] **Step 4: 실제 세션 확인 (사용자와 함께)**

```
claude plugin marketplace add C:\workspace\personal\claude-mods
claude plugin install skill-trace@agent-lens
```

새 세션(터미널 폭 ≥ 110칸)에서: ① 패널 "스킬 추적"이 열린다 ② 스킬이 필요할 만한 질문을 하면 채팅에 `[스킬근거] …` 줄이 나오고 패널에 이유가 붙는다 ③ `/skill-trace` 가 패널을 연다. 결과를 사용자에게 그대로 보고한다.

- [ ] **Step 5: 최종 검증과 Commit**

Run: `claude plugin validate . && claude plugin validate plugins/skill-trace && claude plugin test plugins/skill-trace`
Expected: 모두 통과

```bash
git add README.md plugins/skill-trace/README.md
git commit -m "docs: README 와 skill-trace 설명"
```
