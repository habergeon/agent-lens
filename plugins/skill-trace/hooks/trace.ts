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
