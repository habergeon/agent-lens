import { expect, test } from 'claude-code/testing'
import type { Trace } from '../types'
import {
  MAX, addAgent, addTool, addCommand, addHook, addMcp, addSkill, addSource, commandName, counts, hookEvents, markSub,
  onLatest, parseMcp, parseReasons, sections, settingsSources, span, startTrace, timing, title, turnEnded, turnStarted, withReason,
} from './trace'

const one = (q = '질문'): Trace => startTrace([], q)[0]!

test('startTrace numbers questions and keeps the last 30', async () => {
  let list: Trace[] = []
  for (let i = 0; i < MAX + 1; i++) list = startTrace(list, `q${i}`)
  expect(list.length).toBe(MAX)
  expect(list[0]!.id).toBe(2)
  expect(list[MAX - 1]!.id).toBe(MAX + 1)
})

test('startTrace flattens the question to one line (the pane truncates it by width), capped at 300', async () => {
  const t = one('가'.repeat(50) + '\n둘째 줄')
  expect(t.question).toBe('가'.repeat(50) + ' 둘째 줄')
  expect(one('나'.repeat(400)).question.length).toBe(300)
  expect(one('나'.repeat(400)).question.endsWith('…')).toBe(true)
})

test('onLatest makes a "(session start)" trace when none exists', async () => {
  const list = onLatest([], t => addHook(t, 'SessionStart', 'PONYTAIL MODE ACTIVE'))
  expect(list[0]!.id).toBe(0)
  expect(list[0]!.question).toBe('(session start)')
  expect(list[0]!.hooks[0]).toEqual({ event: 'SessionStart', head: 'PONYTAIL MODE ACTIVE', count: 1 })
})

test('a reason that arrives after the skill attaches to it', async () => {
  const t = withReason(addSkill(one(), 'superpowers:brainstorming'), 'brainstorming', '설계 먼저')
  expect(t.skills[0]!.reason).toBe('설계 먼저')
})

test('a reason that arrives before the skill waits in pending', async () => {
  const early = withReason(one(), 'superpowers:brainstorming', '설계 먼저')
  expect(early.pending['superpowers:brainstorming']).toBe('설계 먼저')
  const t = addSkill(early, 'superpowers:brainstorming')
  expect(t.skills[0]!.reason).toBe('설계 먼저')
  expect(Object.keys(t.pending).length).toBe(0)
})

test('parseReasons finds every tagged line', async () => {
  const text = '먼저 확인합니다.\n[스킬근거] plugin-authoring: mod API 확인 필요\n본문\n[스킬근거] superpowers:brainstorming: 설계 먼저: 근거\n- `[스킬근거] ponytail:ponytail: 최소 구현`'
  expect(parseReasons(text)).toEqual([
    ['plugin-authoring', 'mod API 확인 필요'],
    ['superpowers:brainstorming', '설계 먼저: 근거'],
    ['ponytail:ponytail', '최소 구현'],
  ])
})

test('parseReasons accepts a name wrapped in backticks or bold', async () => {
  expect(parseReasons('[스킬근거] `superpowers:brainstorming`: 설계')).toEqual([['superpowers:brainstorming', '설계']])
  expect(parseReasons('[스킬근거]** ponytail:ponytail**: 최소')).toEqual([['ponytail:ponytail', '최소']])
})

test('addHook strips system-reminder tags and the hook prefix', async () => {
  const t = addHook(one(), 'SessionStart', '<system-reminder>\nSessionStart hook additional context: PONYTAIL MODE ACTIVE\n</system-reminder>')
  expect(t.hooks[0]!.head).toBe('PONYTAIL MODE ACTIVE')
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

test('sections show fallbacks; counts summarise them', async () => {
  let t = addCommand(one('mod 검토해줘'), 'superpowers:brainstorming')
  t = addSkill(t, 'superpowers:brainstorming')
  t = addSkill(t, 'plugin-authoring')
  expect(title(t)).toBe('Q1 mod 검토해줘')
  const [skills, commands] = sections(t)
  expect(skills).toMatchObject({ key: 'skill', title: 'Skills', count: 2 })
  expect(skills!.items).toEqual([
    { text: 'superpowers:brainstorming', sub: 'run by user' },
    { text: 'plugin-authoring', sub: 'no reason given' },
  ])
  expect(commands!.items).toEqual([{ text: '/superpowers:brainstorming' }])
  expect(counts(t)).toBe('Skills 2 · Commands 1')
  expect(sections(one())).toEqual([])
})

test('timing: start → end · duration, or 진행 중', async () => {
  const at = new Date(2026, 10, 5, 14, 53, 2).getTime()
  let t = startTrace([], '질문', at)[0]!
  expect(timing(t, true)).toBe('14:53:02 · running')
  t = turnEnded(t, at + 169_000)
  expect(timing(t, true)).toBe('14:53:02 → 14:55:51 · 2m 49s')
  expect(timing(t, false)).toBe('14:53:02 · 2m 49s')
  expect(timing(turnStarted(t), false)).toBe('14:53:02 · running')
  expect(span(13_400)).toBe('13s')
  expect(span(3_725_000)).toBe('1h 2m')
  expect(timing(one(), true)).toBe('') // 시작 시각 없음(세션 시작 항목)
  expect(turnEnded(onLatest([], x => x)[0]!, at).endedAt).toBe(undefined)
})

test('a long question keeps its full text; a short one does not', async () => {
  const long = '그누보드랑 php 사용하는녀석들을 PC에 보관 했던거지?\n대상과 명세 기준에 접속 방법 등을 정리해서 알려줄래?'
  expect(one(long).full).toBe(long)
  expect(one(long).question).toBe(long.replace('\n', ' '))
  expect(one('짧은 질문').full).toBe(undefined)
})

test('settings hooks are named by their command', async () => {
  expect(commandName('C:/Users/x/.orca/agent-hooks/orca-agent-hook.exe claude')).toBe('orca-agent-hook')
  expect(commandName('codegraph.cmd prompt-hook')).toBe('codegraph')
  expect(commandName('"C:/fnm/node.exe" "C:/Users/x/.claude/hooks/context-mode-cache-heal.mjs"')).toBe('context-mode-cache-heal')
  expect(commandName('powershell -NoProfile -File "C:\\h\\herdr-agent-state.ps1" session')).toBe('herdr-agent-state')
  expect(settingsSources({ hooks: {
    PreToolUse: [{ matcher: '', hooks: [{ command: 'a.exe' }, { command: 'b.cmd x' }] }],
    Stop: [{ hooks: [{ command: 'a.exe' }] }],
  } })).toEqual({ PreToolUse: ['a', 'b'], Stop: ['a'] })
})

test('hook rows carry their source candidates; quiet ones say so in the sub line', async () => {
  let s = addSource({}, hookEvents({ hooks: { PreToolUse: [], SessionStart: [] } }), 'context-mode')
  s = addSource(s, hookEvents({ hooks: { PreToolUse: [] } }), 'settings')
  s = addSource(s, hookEvents({ modules: ['./register.tsx'] }), 'some-mod')
  expect(s).toEqual({ PreToolUse: ['context-mode', 'settings'], SessionStart: ['context-mode'] })

  let t = addHook(one(), 'SessionStart', 'PONYTAIL MODE ACTIVE')
  t = addHook(addHook(t, 'PreToolUse', ''), 'PreToolUse', '')
  const [hooks] = sections(t, s)
  expect(hooks).toMatchObject({ key: 'hook', count: 3 })
  expect(hooks!.items).toEqual([
    { text: 'SessionStart: PONYTAIL MODE ACTIVE', sub: '← context-mode' },
    { text: 'PreToolUse ×2', sub: 'nothing injected · ← context-mode, settings' },
  ])
})

test('built-in tools are counted per name, subagent calls apart, in a Tools section', async () => {
  let t = addTool(addTool(one(), 'Bash', false), 'Bash', false)
  t = addTool(addTool(t, 'Read', false), 'Bash', true)
  const tools = sections(t).find(s => s.key === 'tool')
  expect(tools).toMatchObject({ title: 'Tools', count: 4 })
  expect(tools!.items).toEqual([{ text: 'Bash ×2' }, { text: 'Read' }, { text: 'Bash (sub)' }])
  expect(counts(t)).toBe('Tools 4')
  // 0.1.6 이전에 저장된 항목(tools 없음)도 그대로 그려진다.
  const { tools: _, ...old } = one()
  expect(sections(old as never)).toEqual([])
})
