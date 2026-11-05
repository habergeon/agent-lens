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
