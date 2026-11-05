import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Parked, Trace } from '../types'
import {
  REASON_RULE, REASON_TOOL, addAgent, cut, addCommand, addHook, addMcp, addSkill, detail,
  addSource, hookEvents, markSub, settingsSources, onLatest, parseReasons, same, startTrace, summary, title, withReason,
} from './trace'
import type { Sources } from './trace'

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

// 펼친 질문 id. null: 최신 질문을 따라감, -1: 모두 접힘.
const open = atom({ plugin: 'skill-trace', key: 'open' } as const, null as number | null, {
  shape: 'open-1',
})

const latest = ($: EngineInterface, fn: (t: Trace) => Trace) =>
  update($, traces, list => onLatest(list, fn))

// 새 질문이 생기면 펼침 상태를 최신 질문으로 되돌린다.
const begin = async ($: EngineInterface, fn: (list: Trace[]) => Trace[]) => {
  await update($, traces, fn)
  await update($, open, () => null)
}

// 훅 출처 후보: settings 의 hooks(명령 이름으로)와, 켜진 플러그인마다 등록한 훅 이벤트(플러그인 이름으로).
// 플러그인의 훅 파일은 plugin.json 의 hooks(경로·경로 목록·인라인)가 있으면 그것, 없으면 hooks/hooks.json.
// 마켓플레이스로 설치된 경우에만 동작한다(플러그인 폴더에서 ~/.claude/plugins 를 찾는다).
// ponytail: matcher(도구별 필터)는 보지 않는다 — 이벤트 단위 후보까지만.
const loadSources = async ($: EngineInterface): Promise<Sources> => {
  try {
    const [base] = $.plugin.root.split(/[\\/]plugins[\\/]cache[\\/]/)
    if (!base || base === $.plugin.root) return {}
    const settings = (await $.settings.read()) as { hooks?: unknown; enabledPlugins?: Record<string, unknown> }
    let out = settingsSources(settings)
    const installed = JSON.parse(await $.fs.read(`${base}/plugins/installed_plugins.json`)) as {
      plugins?: Record<string, { installPath?: string }[]>
    }
    const json = async (path: string): Promise<unknown> => JSON.parse(await $.fs.read(path))
    for (const [id, entries] of Object.entries(installed.plugins ?? {})) {
      const root = entries[0]?.installPath
      if (settings.enabledPlugins?.[id] !== true || !root) continue
      const name = id.split('@')[0]!
      try {
        const declared = ((await json(`${root}/.claude-plugin/plugin.json`).catch(() => ({}))) as { hooks?: unknown }).hooks
        const files = typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared : []
        if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
          out = addSource(out, hookEvents({ hooks: declared }), name)
        } else {
          for (const f of files.length ? files : ['./hooks/hooks.json']) {
            out = addSource(out, hookEvents(await json(`${root}/${String(f).replace(/^\.\//, '')}`)), name)
          }
        }
      } catch {
        // 훅 파일이 없는 플러그인
      }
    }
    return out
  } catch {
    return {} // 출처를 못 읽어도 패널은 그대로 동작한다
  }
}

const textOf = (blocks: readonly { type: string; [k: string]: unknown }[]): string =>
  blocks.filter(b => b.type === 'text').map(b => String(b.text ?? '')).join('\n')

export const register: Register = (on, options) => {
  // userConfig: start(패널 자동 열기), reason(이유 규칙 주입). 기본은 둘 다 on.
  const autoOpen = options?.start !== 'off'
  const askReason = options?.reason !== 'off'
  let sources: Sources = {}

  on('session.start', async ($, e, next) => {
    sources = await loadSources($)
    if (askReason) {
      await $.tool.register({
        name: 'reason',
        description:
          'Record why you chose a skill, for the skill-trace pane. Call it in the same response as each Skill call, ' +
          'with the same skill name and a one-line reason (in the user\'s language). Cheap and silent.',
        inputSchema: {
          type: 'object',
          properties: {
            skill: { type: 'string', description: 'The skill name exactly as passed to the Skill tool.' },
            reason: { type: 'string', description: 'One line: why this skill fits this question.' },
          },
          required: ['skill', 'reason'],
        },
        isDeferred: false,
      })
    }
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
        await begin($, list => startTrace(list, e.text))
      }
    }
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    const hold = await read($, parked)
    if (hold) {
      await update($, parked, () => null)
      if (same(hold.name, e.skill)) {
        await begin($, list => onLatest(startTrace(list, hold.text), t => addCommand(t, hold.name)))
      }
    }
    await latest($, t => addSkill(t, e.skill))
    return next(e)
  })

  // 이유 기록 도구: 엔진 아래로 내려보내지 않고 여기서 답한다.
  on('tool.call', { tool: REASON_TOOL }, async ($, e) => {
    const { skill, reason } = e as { skill?: unknown; reason?: unknown }
    if (typeof skill !== 'string' || typeof reason !== 'string' || !skill.trim() || !reason.trim()) {
      return { result: 'ignored: skill and reason are required' }
    }
    await latest($, t => withReason(t, skill.trim(), cut(reason, 80)))
    return { result: 'ok' }
  })

  on('tool.call', async ($, e, next) => {
    const sub = e.agentId !== undefined
    if (e.tool.startsWith('mcp__') && e.tool !== REASON_TOOL) await latest($, t => addMcp(t, e.tool, sub))
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, traces)
    if (list.length === 0) return <Text dimColor>아직 기록된 질문이 없습니다.</Text>
    const chosen = (await read($, open)) ?? list[list.length - 1]!.id
    // 질문 줄을 누르면 펼치고, 펼친 질문을 다시 누르면 접는다.
    return (
      <Box flexDirection="column">
        {[...list].reverse().map(t =>
          t.id === chosen ? (
            <Box flexDirection="column">
              <Button key={`q${t.id}`} plain label={`▾ ${title(t)}`} onPress={() => void update($, open, () => -1)} />
              {t.full && <Text wrap="wrap">{t.full}</Text>}
              {detail(t, sources).map(l => (
                <Text bold={l.bold} dimColor={l.dim} wrap="wrap">{l.text}</Text>
              ))}
            </Box>
          ) : (
            <Button key={`q${t.id}`} plain dimColor label={summary(t)} onPress={() => void update($, open, () => t.id)} />
          ),
        )}
      </Box>
    )
  })
}
