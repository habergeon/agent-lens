import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Parked, SessionInfo, Trace } from '../types'
import {
  OVERHEAD_TOKENS, REASON_RULE, REASON_TOOL, REASON_TOOL_SPEC, addAgent, addReasonCall, addRequest, addTool, estimateTokens, addCommand, addHook, addMcp, addSkill, addSource, counts, cut,
  hookEvents, markSub, onLatest, parseReasons, same, sections, settingsSources, startTrace, timing, title,
  turnEnded, turnStarted, withReason,
} from './trace'
import type { Sources } from './trace'

const PANE = 'skill-trace'
const TITLE = 'Skill Trace'
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

// 질문마다 사람이 정한 펼침 상태(질문 id → 펼침). 정하지 않은 질문은 최신만 펼침.
// 질문끼리는 서로 영향을 주지 않는다(아코디언이 아님).
const qopen = atom({ plugin: 'skill-trace', key: 'qopen' } as const, {} as Record<string, boolean>, {
  shape: 'qopen-1',
})

// 기본 펼침 상태(훅 섹션만 접힘)를 사람이 뒤집은 섹션 키들.
const flip = atom({ plugin: 'skill-trace', key: 'flip' } as const, [] as string[], {
  shape: 'flip-1',
})
const FOLDED_BY_DEFAULT = new Set(['tool', 'hook'])

// 패널 맨 위 Session 영역. 펼침은 flip 의 'session' 키로 뒤집는다(기본 펼침).
const session = atom({ plugin: 'skill-trace', key: 'session' } as const, {} as SessionInfo, {
  shape: 'session-1',
})

// 세션 id 는 /clear 뒤에, 모델은 /model 뒤에 바뀐다: 시작할 때와 프롬프트마다 다시 읽는다.
const refresh = async ($: EngineInterface) => {
  const ask = async <T,>(f: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await f()
    } catch {
      return undefined // 못 읽은 값은 비워 두고 나머지만 보인다
    }
  }
  const [id, model, cwd] = await Promise.all([
    ask(() => $.session.id()), ask(() => $.session.model()), ask(() => $.session.cwd()),
  ])
  await update($, session, s => ({ ...s, ...(id && { id }), ...(model && { model }), ...(cwd && { cwd }) }))
}

// 권한 모드를 묻는 API 는 없다: settings 훅 입력의 permission_mode 에서 읽는다.
const noteMode = async ($: EngineInterface, e: unknown) => {
  const mode = (e as { permission_mode?: unknown }).permission_mode
  if (typeof mode === 'string' && mode) await update($, session, s => (s.mode === mode ? s : { ...s, mode }))
}

const latest = ($: EngineInterface, fn: (t: Trace) => Trace) =>
  update($, traces, list => onLatest(list, fn))

const begin = ($: EngineInterface, fn: (list: Trace[]) => Trace[]) => update($, traces, fn)

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
  // cost: 토큰·비용 기록. reason 이 켜져 있을 때만 켤 수 있다(reason 이 꺼지면 함께 꺼짐).
  const trackCost = askReason && options?.cost !== 'off'
  let lastModel: string | undefined // 가장 최근 요청의 모델: 이유 호출의 출력을 그 모델 가격으로 센다
  let sources: Sources = {}
  let cwd: string | undefined // 세션 작업 폴더: 파일 경로를 상대 경로로 보여 줄 때 쓴다
  // 진행 중인 Skill 호출: 스킬 이름 → 그 호출 안에서 skill.prompt 가 이미 기록했는지.
  const calling = new Map<string, boolean>()

  on('session.start', async ($, e, next) => {
    sources = await loadSources($)
    cwd = e.cwd
    await refresh($)
    if (askReason) {
      await $.tool.register(REASON_TOOL_SPEC as never)
    }
    await $.command.register({
      name: 'skill-trace',
      description: 'Open the pane listing the skills and plugin features each question used',
    })
    if (autoOpen) void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'skill-trace' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Skill Trace pane opened.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!askReason || e.surfaces.length === 0 || !e.tools.includes('Skill')) return r
    return {
      ...r,
      sections: [...r.sections, { id: 'skill-trace-reason', text: REASON_RULE, scope: 'session' as const }],
    }
  })

  // 사용자가 shift+tab 으로 바꾼 모드는 다음 프롬프트나 도구 호출에서 보인다.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e)
    return next(e)
  })
  on('classic.PostToolUse', async ($, e, next) => {
    await noteMode($, e)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await refresh($)
    await update($, parked, () => null)
    if (!e.isMeta && !NOT_ASKED.has(e.origin?.kind)) {
      if (e.command) {
        const hold = { text: e.text, name: e.command.name }
        await update($, parked, () => hold)
      } else {
        await begin($, list => startTrace(list, e.text, Date.now()))
      }
    }
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    const hold = await read($, parked)
    if (hold) {
      await update($, parked, () => null)
      if (same(hold.name, e.skill)) {
        await begin($, list => onLatest(startTrace(list, hold.text, Date.now()), t => addCommand(t, hold.name)))
      }
    }
    await latest($, t => addSkill(t, e.skill))
    for (const k of calling.keys()) if (same(k, e.skill)) calling.set(k, true)
    return next(e)
  })

  // 이유 기록 도구: 엔진 아래로 내려보내지 않고 여기서 답한다.
  on('tool.call', { tool: REASON_TOOL }, async ($, e) => {
    const { skill, reason } = e as { skill?: unknown; reason?: unknown }
    if (typeof skill !== 'string' || typeof reason !== 'string' || !skill.trim() || !reason.trim()) {
      return { result: 'ignored: skill and reason are required' }
    }
    await latest($, t => withReason(t, skill.trim(), cut(reason, 80)))
    if (trackCost && lastModel) {
      // 이 호출을 쓴 출력: 인자 JSON + tool_use 블록 틀(≈20 토큰), 추정.
      const out = estimateTokens(JSON.stringify({ skill, reason })) + 20
      const model = lastModel
      await latest($, t => addReasonCall(t, model, out))
    }
    return { result: 'ok' }
  })

  // 모델 요청마다 API 가 알려 준 사용량을 기록한다(메인·서브에이전트 모두). 응답은 그대로 흘려보낸다.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (trackCost && r.usage) {
      const usage = r.usage
      lastModel = usage.model
      await latest($, t => addRequest(t, usage, OVERHEAD_TOKENS))
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const sub = e.agentId !== undefined
    if (e.tool.startsWith('mcp__') && e.tool !== REASON_TOOL) await latest($, t => addMcp(t, e.tool, sub))
    if (e.tool === 'Agent') {
      const type = (e as { subagent_type?: string }).subagent_type ?? 'general-purpose'
      await latest($, t => addAgent(t, type))
    } else if (e.tool !== 'Skill' && !e.tool.startsWith('mcp__')) {
      // 파일을 받는 도구: Read·Edit·Write 는 file_path, NotebookEdit 는 notebook_path.
      const { file_path, notebook_path } = e as { file_path?: unknown; notebook_path?: unknown }
      const file = typeof file_path === 'string' ? file_path : typeof notebook_path === 'string' ? notebook_path : undefined
      await latest($, t => addTool(t, e.tool, sub, file))
    }
    // 같은 스킬을 다시 부르면 엔진이 본문을 다시 펼치지 않아 skill.prompt 가 안 올 수 있다:
    // 호출 동안 skill.prompt 가 기록하지 않았으면 여기서 기록한다(겹치면 한 번만).
    // (같은 훅 안에서 next 뒤에 state 를 다시 읽으면 갱신이 안 보여서, 메모리 표시로 판단한다.)
    const name = e.tool === 'Skill' ? (e as { skill?: unknown }).skill : undefined
    if (typeof name === 'string' && name) calling.set(name, false)
    const ran = await next(e)
    if (typeof name === 'string' && name) {
      const recorded = calling.get(name) === true
      calling.delete(name)
      if (!recorded) await latest($, t => addSkill(t, name))
      if (sub) await latest($, t => markSub(t, name))
    }
    return ran
  })

  // 질문의 시작은 prompt.submit 시각, 끝은 그 질문의 마지막 메인 턴이 끝난 시각.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await latest($, turnStarted)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await latest($, t => turnEnded(t, Date.now()))
    return next(e)
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
    const flipped = await read($, flip)
    const toggle = (k: string) => void update($, flip, ks => (ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k]))

    // Session 영역: 펼치면 항목마다 한 줄(라벨 흐림, 값 기본색), 접으면 머리줄 옆에 모델·모드만.
    const info = await read($, session)
    const rows = ([['ID', info.id], ['Model', info.model], ['Permissions', info.mode], ['Folder', info.cwd]] as [string, string | undefined][])
      .filter((r): r is [string, string] => !!r[1])
    const sOpen = !flipped.includes('session')
    const head = rows.length === 0 ? null : (
      <Box key="session" flexDirection="column" marginBottom={1}>
        <Button key="b:session" plain onPress={() => toggle('session')}>
          <Text bold>{`${sOpen ? '▾' : '▸'} Session`}</Text>
          {sOpen ? null : <Text dimColor wrap="truncate-end">{` · ${[info.model, info.mode].filter(Boolean).join(' · ')}`}</Text>}
        </Button>
        {sOpen &&
          rows.map(([k, v], i) => (
            <Box key={`r:${k}`} flexDirection="row" paddingLeft={2}>
              <Text dimColor>{`${i === rows.length - 1 ? '└' : '├'} ${k.padEnd(12)}`}</Text>
              <Box flexShrink={1}>
                <Text wrap="wrap">{v}</Text>
              </Box>
            </Box>
          ))}
      </Box>
    )

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          {head}
          <Text dimColor>No questions recorded yet.</Text>
        </Box>
      )
    }
    const newest = list[list.length - 1]!.id
    const chosen = await read($, qopen)

    // 트리: 질문(▾/▸) → 섹션(▾/▸) → 항목(├/└) → 설명(들여 쓴 흐린 줄).
    // 대비 규칙: 질문·항목은 기본 글자색, 색은 섹션 제목에만, 흐림(dim)은 메타(시각·개수·출처)에만.
    // 접힌 질문은 한 줄로 패널 폭에서 … 으로 자르고, 펼친 질문은 머리줄에 번호·시간, 본문에 질문 전체.
    return (
      <Box flexDirection="column">
        {head}
        {[...list].reverse().map(t => {
          const isOpen = chosen[String(t.id)] ?? t.id === newest
          const press = () => void update($, qopen, m => ({ ...m, [String(t.id)]: !isOpen }))
          const when = timing(t, isOpen)
          const secs = isOpen ? sections(t, sources, cwd) : []
          if (!isOpen) {
            return (
              <Box key={`t${t.id}`} flexDirection="column">
                <Button key={`q${t.id}`} plain onPress={press}>
                  <Text wrap="truncate-end">{`▸ ${title(t)}`}</Text>
                </Button>
                <Box paddingLeft={2}>
                  <Text dimColor wrap="truncate-end">{[when, counts(t)].filter(Boolean).join(' · ')}</Text>
                </Box>
              </Box>
            )
          }
          return (
            <Box key={`t${t.id}`} flexDirection="column" marginBottom={1}>
              <Button key={`q${t.id}`} plain onPress={press}>
                <Text bold>{`▾ Q${t.id}`}</Text>
                {when ? <Text dimColor>{` · ${when}`}</Text> : null}
              </Button>
              <Box paddingLeft={2} marginBottom={secs.length ? 1 : 0}>
                <Text wrap="wrap">{t.full ?? t.question}</Text>
              </Box>
              {isOpen && secs.length === 0 && (
                <Box paddingLeft={2}>
                  <Text dimColor>(no skills or plugin features used)</Text>
                </Box>
              )}
              {secs.map(s => {
                const k = `${t.id}:${s.key}`
                const shown = FOLDED_BY_DEFAULT.has(s.key) === flipped.includes(k)
                return (
                  <Box key={`s${k}`} flexDirection="column" paddingLeft={1}>
                    <Button key={`b${k}`} plain onPress={() => toggle(k)}>
                      <Text color={s.color} bold>{`${shown ? '▾' : '▸'} ${s.title}`}</Text>
                      <Text dimColor>{` ${s.badge ?? s.count}`}</Text>
                    </Button>
                    {shown &&
                      s.items.map((it, i) => (
                        <Box key={`i${k}:${i}`} flexDirection="row" paddingLeft={2}>
                          <Text dimColor>{i === s.items.length - 1 ? '└ ' : '├ '}</Text>
                          <Box flexDirection="column" flexShrink={1}>
                            <Text wrap="wrap">{it.text}</Text>
                            {it.sub && <Text dimColor wrap="wrap">{it.sub}</Text>}
                            {it.lines && (
                              <Box flexDirection="column" paddingLeft={2}>
                                {it.lines.map(l => (
                                  <Text wrap="wrap">{l}</Text>
                                ))}
                              </Box>
                            )}
                          </Box>
                        </Box>
                      ))}
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>
    )
  })
}
