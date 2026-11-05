import type { Trace } from '../types'

export const MAX = 30

/** mod 가 등록하는 이유 기록 도구: 모델에는 `mcp__skill-trace__reason` 으로 보인다. */
export const REASON_TOOL = 'mcp__skill-trace__reason'

// 도구 호출 직전의 본문은 요약된 narration(thinking)으로 저장돼 이유 줄이 사라지므로,
// 이유는 Skill 과 같은 응답에서 부르는 도구 인자로 받는다.
export const REASON_RULE =
  'Skill 도구를 호출할 때마다 같은 응답 안에서 `mcp__skill-trace__reason` 도구도 함께 호출해 ' +
  '{ skill: <Skill 에 넘긴 스킬명>, reason: <이 질문에 이 스킬을 고른 이유 한 줄> } 을 남긴다. ' +
  'skill-trace 패널이 이 값을 사용자에게 보여 준다.'

const REASON_LINE = /^[\s`*>\-•]*\[스킬근거\][*`]*\s*(\S+?)\s*:\s+(.+?)`?\s*$/gm

export const cut = (s: string, n: number): string => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat
}

const blank = (id: number, question: string): Trace => ({
  id, question, skills: [], mcp: [], agents: [], hooks: [], commands: [], pending: {},
})

export const startTrace = (list: Trace[], question: string): Trace[] => {
  const id = (list.length ? list[list.length - 1]!.id : 0) + 1
  const short = cut(question, 40)
  const t = blank(id, short)
  // 미리보기가 잘렸을 때만 전체를 둔다(줄바꿈 유지).
  if (short.endsWith('…')) t.full = question.trim().slice(0, 2000)
  return [...list, t].slice(-MAX)
}

export const title = (t: Trace): string => `Q${t.id} "${t.question}"`

export const onLatest = (list: Trace[], fn: (t: Trace) => Trace): Trace[] => {
  const base = list.length ? list : [blank(0, '(세션 시작)')]
  return [...base.slice(0, -1), fn(base[base.length - 1]!)]
}

// "brainstorming" 과 "superpowers:brainstorming" 을 같은 스킬로 본다.
export const same = (a: string, b: string): boolean =>
  a === b || a.endsWith(':' + b) || b.endsWith(':' + a)

const lastIndex = <T>(xs: readonly T[], ok: (x: T) => boolean): number => {
  for (let i = xs.length - 1; i >= 0; i--) if (ok(xs[i]!)) return i
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
  const server = m[1]!.startsWith('plugin_') ? m[1]!.slice('plugin_'.length).split('_')[0]! : m[1]!
  return { server, tool: m[2]! }
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
  const body = text.replace(/<\/?system-reminder>/g, '').replace(/^\s*\w+ hook additional context:\s*/, '')
  const head = cut(body.split('\n').find(l => l.trim() !== '') ?? '', 30)
  const i = t.hooks.findIndex(h => h.event === event && h.head === head)
  if (i >= 0) return { ...t, hooks: t.hooks.map((h, j) => (j === i ? { ...h, count: h.count + 1 } : h)) }
  return { ...t, hooks: [...t.hooks, { event, head, count: 1 }] }
}

export const parseReasons = (text: string): [string, string][] =>
  [...text.matchAll(REASON_LINE)].map(m => [m[1]!.replace(/[`*]/g, '').trim(), cut(m[2]!, 80)])

export const withReason = (t: Trace, name: string, reason: string): Trace => {
  const i = lastIndex(t.skills, s => same(s.name, name) && !s.reason)
  if (i >= 0) return { ...t, skills: t.skills.map((s, j) => (j === i ? { ...s, reason } : s)) }
  return { ...t, pending: { ...t.pending, [name]: reason } }
}

export type Line = { text: string; bold?: boolean; dim?: boolean }

const times = (n: number): string => (n > 1 ? ` ×${n}` : '')
const subTag = (sub?: boolean): string => (sub ? ' (sub)' : '')

/** 훅 이벤트 이름 → 그 이벤트에 훅을 등록한 곳(플러그인 이름, 'settings'). */
export type Sources = Record<string, string[]>

// hooks.json 이나 settings 의 `{ hooks: { PreToolUse: [...], ... } }` 에서 이벤트 이름을 꺼낸다.
export const hookEvents = (json: unknown): string[] => {
  const hooks = (json as { hooks?: unknown } | null)?.hooks
  return hooks && typeof hooks === 'object' && !Array.isArray(hooks) ? Object.keys(hooks) : []
}

// 훅 명령에서 알아볼 이름: 실행 파일·스크립트의 파일명(확장자 제외). 예) orca-agent-hook.exe claude → orca-agent-hook
export const commandName = (cmd: string): string => {
  const files = cmd.match(/[^\s"'\\/]+\.(exe|cmd|bat|ps1|mjs|cjs|js|ts|sh|py)\b/gi) ?? []
  const pick = files.filter(f => !/^(node|bun|deno|python3?|powershell|pwsh|bash|sh)\./i.test(f)).pop() ?? files.pop()
  return (pick ?? cmd.trim().split(/\s+/)[0] ?? cmd).replace(/\.[a-z0-9]+$/i, '')
}

// settings 의 hooks: 이벤트마다 그 이벤트에 걸린 명령 이름들.
export const settingsSources = (json: unknown): Sources => {
  let out: Sources = {}
  const hooks = (json as { hooks?: Record<string, { hooks?: { command?: string }[] }[]> } | null)?.hooks ?? {}
  for (const [ev, groups] of Object.entries(hooks)) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of g.hooks ?? []) if (h.command) out = addSource(out, [ev], commandName(h.command))
    }
  }
  return out
}

export const addSource = (s: Sources, events: string[], who: string): Sources => {
  const out = { ...s }
  for (const ev of events) if (!(out[ev] ?? []).includes(who)) out[ev] = [...(out[ev] ?? []), who]
  return out
}

// 펼친 질문의 본문 줄(제목 줄은 패널이 버튼으로 그린다).
export const detail = (t: Trace, sources: Sources = {}): Line[] => {
  const out: Line[] = []
  const section = (name: string, rows: Line[]) => {
    if (rows.length === 0) return
    out.push({ text: ` ${name}`, dim: true })
    for (const r of rows) out.push({ ...r, text: `  · ${r.text}` })
  }
  const plain = (xs: string[]): Line[] => xs.map(text => ({ text }))
  section('스킬', plain(t.skills.map(s => {
    const why = s.reason ?? (t.commands.some(c => same(c.slice(1), s.name)) ? '사용자 실행' : '이유 미기재')
    return `${s.name}${subTag(s.sub)} — ${why}`
  })))
  section('MCP', plain(t.mcp.map(m => `${m.server}: ${m.tool}${times(m.count)}${subTag(m.sub)}`)))
  section('서브에이전트', plain(t.agents.map(a => `${a.type}${times(a.count)}`)))
  // 엔진은 어느 플러그인의 훅이 돌았는지 mod 에 알려 주지 않는다: 그 이벤트에 훅을 등록한 곳을 "후보"로 붙인다.
  // 내용을 주입한 훅이 먼저, 실행만 한 훅(주입 없음)은 흐리게 뒤에.
  const from = (ev: string) => (sources[ev]?.length ? ` ← ${sources[ev]!.join(', ')}` : '')
  section('훅', [
    ...t.hooks.filter(h => h.head !== '').map(h => ({ text: `${h.event}: ${h.head}${times(h.count)}${from(h.event)}` })),
    ...t.hooks.filter(h => h.head === '').map(h => ({ text: `${h.event}${times(h.count)} (주입 없음)${from(h.event)}`, dim: true })),
  ])
  section('커맨드', plain(t.commands))
  if (out.length === 0) out.push({ text: '  (스킬·플러그인 기능 사용 없음)', dim: true })
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
