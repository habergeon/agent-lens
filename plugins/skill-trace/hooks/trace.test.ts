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
