import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Parked, Trace } from '../types'
import {
  REASON_RULE, addAgent, addCommand, addHook, addMcp, addSkill, detail,
  markSub, onLatest, parseReasons, same, startTrace, summary, withReason,
} from './trace'

const PANE = 'skill-trace'
const TITLE = '스킬 추적'
// Trace 필드가 바뀌면 태그를 올린다: 이전 버전이 저장한 값을 거절한다.
const traces = atom({ plugin: 'skill-trace', key: 'traces' } as const, [] as Trace[], {
  shape: 'traces-1',
})

// 슬래시 커맨드는 스킬로 이어질 때만 질문이 된다: 그때까지 여기에 보류한다.
const parked = atom({ plugin: 'skill-trace', key: 'parked' } as const, null as Parked | null, {
  shape: 'parked-1',
})

// 사람이 직접 낸 프롬프트가 아닌 것(백그라운드 알림·피어·예약 등)은 질문으로 세지 않는다.
const NOT_ASKED = new Set([
  'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay',
  'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation',
])

const latest = ($: EngineInterface, fn: (t: Trace) => Trace) =>
  update($, traces, list => onLatest(list, fn))

const textOf = (blocks: readonly { type: string; [k: string]: unknown }[]): string =>
  blocks.filter(b => b.type === 'text').map(b => String(b.text ?? '')).join('\n')

export const register: Register = (on, options) => {
  // userConfig: start(패널 자동 열기), reason(이유 규칙 주입). 기본은 둘 다 on.
  const autoOpen = options?.start !== 'off'
  const askReason = options?.reason !== 'off'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skill-trace',
      description: '질문별로 쓰인 스킬·플러그인 기능 패널을 엽니다',
    })
    if (autoOpen) void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'skill-trace' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: '스킬 추적 패널을 열었습니다.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!askReason || e.surfaces.length === 0 || !e.tools.includes('Skill')) return r
    return {
      ...r,
      sections: [...r.sections, { id: 'skill-trace-reason', text: REASON_RULE, scope: 'session' as const }],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, parked, () => null)
    if (!e.isMeta && !NOT_ASKED.has(e.origin?.kind)) {
      if (e.command) {
        const hold = { text: e.text, name: e.command.name }
        await update($, parked, () => hold)
      } else {
        await update($, traces, list => startTrace(list, e.text))
      }
    }
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    const hold = await read($, parked)
    if (hold) {
      await update($, parked, () => null)
      if (same(hold.name, e.skill)) {
        await update($, traces, list =>
          onLatest(startTrace(list, hold.text), t => addCommand(t, hold.name)))
      }
    }
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
    } else if (e.origin.kind === 'hook') {
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
        {detail(newest!).map(l => (
          <Text bold={l.bold} dimColor={l.dim} wrap="truncate-end">{l.text}</Text>
        ))}
        {older.map(t => (
          <Text dimColor wrap="truncate-end">{summary(t)}</Text>
        ))}
      </Box>
    )
  })
}
