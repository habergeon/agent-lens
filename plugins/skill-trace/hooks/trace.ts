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

export const startTrace = (list: Trace[], question: string, now?: number): Trace[] => {
  const id = (list.length ? list[list.length - 1]!.id : 0) + 1
  // question: 한 줄로 편 질문(접힌 줄에 쓰고, 패널 폭에서 … 으로 잘린다).
  // full: 줄바꿈이 있거나 한 줄 상한을 넘을 때만 원문(펼친 질문 본문에 쓴다).
  const short = cut(question, 300)
  const t = blank(id, short)
  if (short !== question.trim()) t.full = question.trim().slice(0, 2000)
  if (now !== undefined) t.startedAt = now
  return [...list, t].slice(-MAX)
}

// 메인 턴이 시작하면 "진행 중", 끝나면 끝난 시각. 한 질문에 턴이 여럿이면 마지막 턴의 끝이 질문의 끝.
export const turnStarted = (t: Trace): Trace => ({ ...t, endedAt: undefined })
export const turnEnded = (t: Trace, now: number): Trace => (t.startedAt === undefined ? t : { ...t, endedAt: now })

const pad = (n: number): string => String(n).padStart(2, '0')
export const clock = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
export const span = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s % 60}s`
}
/** 펼친 질문: 시작 → 끝 · 소요. 접힌 질문: 시작 · 소요. */
export const timing = (t: Trace, full: boolean): string => {
  if (t.startedAt === undefined) return ''
  if (t.endedAt === undefined) return `${clock(t.startedAt)} · running`
  const took = span(t.endedAt - t.startedAt)
  return full ? `${clock(t.startedAt)} → ${clock(t.endedAt)} · ${took}` : `${clock(t.startedAt)} · ${took}`
}

export const title = (t: Trace): string => `Q${t.id} ${t.question}`

export const onLatest = (list: Trace[], fn: (t: Trace) => Trace): Trace[] => {
  const base = list.length ? list : [blank(0, '(session start)')]
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

// 기본 도구(Bash·Read·Edit …)는 이름별 횟수. 서브에이전트 안의 호출은 따로 센다.
export const addTool = (t: Trace, name: string, sub: boolean): Trace => {
  const tools = t.tools ?? []
  const i = tools.findIndex(x => x.name === name && (x.sub === true) === sub)
  if (i >= 0) return { ...t, tools: tools.map((x, j) => (j === i ? { ...x, count: x.count + 1 } : x)) }
  return { ...t, tools: [...tools, sub ? { name, count: 1, sub: true } : { name, count: 1 }] }
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

/** 트리의 잎: 이름 줄과, 그 아래 들여 쓴 설명 줄(이유·출처 후보). */
export type Item = { text: string; sub?: string }
/** 트리의 가지: 질문 아래 섹션. key 는 접힘 상태를 기억하는 데 쓴다. */
export type Section = { key: string; title: string; color: string; count: number; items: Item[] }

const sum = (xs: { count: number }[]): number => xs.reduce((n, x) => n + x.count, 0)

// 펼친 질문 아래의 섹션들(빈 섹션은 뺀다). 색은 터미널 테마 키.
export const sections = (t: Trace, sources: Sources = {}): Section[] => {
  // 엔진은 어느 플러그인의 훅이 돌았는지 mod 에 알려 주지 않는다: 그 이벤트에 훅을 등록한 곳을 "후보"로 붙인다.
  const from = (ev: string) => (sources[ev]?.length ? `← ${sources[ev]!.join(', ')}` : undefined)
  const byUser = (name: string) => t.commands.some(c => same(c.slice(1), name))
  const all: Section[] = [
    {
      key: 'skill', title: 'Skills', color: 'suggestion', count: t.skills.length,
      items: t.skills.map(s => ({
        text: `${s.name}${subTag(s.sub)}`,
        sub: s.reason ?? (byUser(s.name) ? 'run by user' : 'no reason given'),
      })),
    },
    {
      key: 'mcp', title: 'MCP', color: 'ide', count: sum(t.mcp),
      items: t.mcp.map(m => ({ text: `${m.server}: ${m.tool}${times(m.count)}${subTag(m.sub)}` })),
    },
    {
      key: 'agent', title: 'Subagents', color: 'planMode', count: sum(t.agents),
      items: t.agents.map(a => ({ text: `${a.type}${times(a.count)}` })),
    },
    {
      key: 'tool', title: 'Tools', color: 'success', count: sum(t.tools ?? []),
      items: (t.tools ?? []).map(x => ({ text: `${x.name}${times(x.count)}${subTag(x.sub)}` })),
    },
    {
      // 내용을 주입한 훅이 먼저, 실행만 한 훅(주입 없음)은 흐리게 뒤에.
      key: 'hook', title: 'Hooks', color: 'warning', count: sum(t.hooks),
      items: [
        ...t.hooks.filter(h => h.head !== '').map(h => ({ text: `${h.event}: ${h.head}${times(h.count)}`, sub: from(h.event) })),
        ...t.hooks.filter(h => h.head === '').map(h => ({ text: `${h.event}${times(h.count)}`, sub: ['nothing injected', from(h.event)].filter(Boolean).join(' · ') })),
      ],
    },
    { key: 'command', title: 'Commands', color: 'claude', count: t.commands.length, items: t.commands.map(text => ({ text })) },
  ]
  return all.filter(s => s.items.length > 0)
}

/** 접힌 질문 아래 한 줄 요약: "스킬 1 · MCP 6 · 훅 135". */
export const counts = (t: Trace): string =>
  sections(t).map(s => `${s.key === 'agent' ? 'Agents' : s.title} ${s.count}`).join(' · ')
