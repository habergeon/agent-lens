import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'skill-trace',
  component: 'Pane',
  requestId: 'skill-trace',
  props: {
    title: 'Skill Trace',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// 플러그인 아래에는 아무것도 없다: 이 훅들이 엔진 역할을 한다.
const engine = (on: On, opened: string[] = []) => {
  on('command.register', () => ({ value: { command: 'skill-trace' } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__skill-trace__${e.name}` } }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.compose', () => ({ sections: [] }))
  on('session.id', () => ({ value: 'sess-1234' }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.cwd', () => ({ value: 'C:/work/repo' }))
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
    await $.prompt.submit({ text: 'mod 만들 수 있어?' } as never)
    await $.session.append(said('[스킬근거] plugin-authoring: mod API 확인 필요') as never)
    await $.skill.prompt({ skill: 'plugin-authoring', text: '...', frontmatter: {}, source: 'built-in' } as never)
    await $.tool.call({ tool: 'mcp__plugin_context-mode_context-mode__ctx_execute' } as never)
    await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', prompt: 'p', description: 'd' } as never)

    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', text: /^▾ Q1 · \d\d:\d\d:\d\d · running$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^mod 만들 수 있어\?$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: 'plugin-authoring' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: 'mod API 확인 필요' })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /context-mode: ctx_execute/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /Explore/ }))).toBeTruthy()
    expect(await ui.find({ type: 'Button', text: /^▸ Q0 \(session start\)$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: 'Hooks 1' })).toBeTruthy()
    await ui.unmount()
  })
}

for (const order of ['reason-first', 'skill-first'] as const) {
  test(`이유 도구(${order})의 값이 스킬에 붙고, MCP 목록에는 나오지 않는다`, async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.prompt.submit({ text: '패널 확인' } as never)
    const reason = () => $.tool.call({ tool: 'mcp__skill-trace__reason', skill: 'ponytail:ponytail-help', reason: '부작용 없는 확인용' } as never)
    const skill = () => $.skill.prompt({ skill: 'ponytail:ponytail-help', text: '...', frontmatter: {}, source: 'plugin' } as never)
    if (order === 'reason-first') { await reason(); await skill() } else { await skill(); await reason() }

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: 'ponytail:ponytail-help' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: '부작용 없는 확인용' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /skill-trace: reason/ })).toBeFalsy()
    await ui.unmount()
  })
}

test('reason=off 면 이유 도구를 등록하지 않는다', { options: { reason: 'off' } }, async ($, on) => {
  const tools: string[] = []
  on('command.register', () => ({ value: { command: 'skill-trace' } }))
  on('tool.register', (_$, e) => {
    tools.push(e.name)
    return { value: { tool: `mcp__skill-trace__${e.name}` } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(tools).toEqual([])
})

test('질문마다 펼침·접힘이 따로 유지되고(아코디언 아님), 펼친 질문은 전체 텍스트를 보인다', async ($, on) => {
  engine(on)
  const long = '그누보드랑 php 사용하는녀석들을 PC에 보관 했던거지? 대상과 명세 기준에 접속 방법 등을 정리해서 알려줄래?'
  await $.prompt.submit({ text: long } as never)
  await $.prompt.submit({ text: '두 번째 질문' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shown = async (id: number) => Boolean(await ui.find({ type: 'Button', text: new RegExp(`^▾ Q${id}(\\D|$)`) }))
  const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

  // 처음엔 최신(Q2)만 펼쳐지고 Q1 은 접힌 한 줄.
  expect([await shown(2), await shown(1)]).toEqual([true, false])
  expect(await ui.find({ type: 'Text', text: exact(long) })).toBeFalsy()

  // Q1 을 펼쳐도 Q2 는 그대로 펼쳐져 있다.
  await ui.press({ key: 'q1' })
  expect([await shown(2), await shown(1)]).toEqual([true, true])
  expect(await ui.find({ type: 'Text', text: exact(long) })).toBeTruthy()

  // Q2 를 접어도 Q1 은 그대로.
  await ui.press({ key: 'q2' })
  expect([await shown(2), await shown(1)]).toEqual([false, true])

  // 새 질문(Q3)은 펼쳐지고, 사람이 정한 Q2(접힘)·Q1(펼침)은 그대로 남는다.
  await $.prompt.submit({ text: '세 번째' } as never)
  expect([await shown(3), await shown(2), await shown(1)]).toEqual([true, false, true])

  // 손대지 않은 Q3 은 다음 질문이 오면 기본대로 접힌다.
  await $.prompt.submit({ text: '네 번째' } as never)
  expect([await shown(4), await shown(3)]).toEqual([true, false])
  await ui.unmount()
})

test('슬래시 커맨드는 커맨드로 기록되고, 그 스킬은 "run by user"이 된다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '/superpowers:brainstorming 아이디어', command: { name: 'superpowers:brainstorming', args: '아이디어' } } as never)
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '...', frontmatter: {}, source: 'plugin' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'run by user' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '/superpowers:brainstorming' })).toBeTruthy()
  await ui.unmount()
})

test('prompt.compose 에 이유 규칙 섹션이 맨 끝에 붙는다', async ($, on) => {
  engine(on)
  const r = await $.prompt.compose({
    model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: ['Skill'], outputStyle: null, traits: [],
  })
  const last = r.sections[r.sections.length - 1]!
  expect(last.id).toBe('skill-trace-reason')
  expect(last.scope).toBe('session')
  expect(last.text).toContain('mcp__skill-trace__reason')
})

test('reason=off 면 이유 규칙을 붙이지 않는다', { options: { reason: 'off' } }, async ($, on) => {
  engine(on)
  const r = await $.prompt.compose({
    model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: ['Skill'], outputStyle: null, traits: [],
  })
  expect(r.sections.some(x => x.id === 'skill-trace-reason')).toBe(false)
})

for (const [start, opens] of [['on', true], ['off', false]] as const) {
  test(`start=${start} 이면 세션 시작 때 패널을 ${opens ? '연다' : '열지 않는다'}`, { options: { start } }, async ($, on) => {
    const opened: string[] = []
    engine(on, opened)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(opened.includes('skill-trace')).toBe(opens)
  })
}

test('Skill 도구가 없는 루프에는 이유 규칙을 붙이지 않는다', async ($, on) => {
  engine(on)
  const r = await $.prompt.compose({
    model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [],
  })
  expect(r.sections.some(x => x.id === 'skill-trace-reason')).toBe(false)
})

test('스킬로 이어지지 않는 슬래시 커맨드는 질문으로 기록되지 않는다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '/skill-trace', command: { name: 'skill-trace', args: '' } } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'No questions recorded yet.' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', text: /^[▾▸] Q/ })).toBeFalsy()
  await ui.unmount()
})

test('슬래시 커맨드 뒤 다른 프롬프트가 오면 보류한 커맨드는 버려진다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '/model', command: { name: 'model', args: '' } } as never)
  await $.prompt.submit({ text: '진짜 질문' } as never)
  await $.skill.prompt({ skill: 'model', text: '...', frontmatter: {}, source: 'built-in' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^진짜 질문$/ }))).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '/model' })).toBeFalsy()
  await ui.unmount()
})

test('백그라운드·피어 프롬프트는 질문으로 기록되지 않는다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '작업 끝', origin: { kind: 'task-notification' } } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'No questions recorded yet.' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', text: /^[▾▸] Q/ })).toBeFalsy()
  await ui.unmount()
})

test('hook-context 가 아닌 door 의 훅 행도 훅으로 센다', async ($, on) => {
  engine(on)
  await $.session.append({
    message: { type: 'attachment', content: [{ type: 'text', text: '<system-reminder>\nSessionStart hook additional context: PONYTAIL MODE ACTIVE\n</system-reminder>' }] },
    door: 'attachment',
    origin: { kind: 'hook', event: 'SessionStart' },
    uuid: crypto.randomUUID(),
  } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // 훅 섹션은 기본으로 접혀 있다: 섹션 줄을 눌러 펼친다.
  expect(await ui.find({ type: 'Text', text: 'SessionStart: PONYTAIL MODE ACTIVE' })).toBeFalsy()
  await ui.press({ key: 'b0:hook' })
  expect(await ui.find({ type: 'Text', text: 'SessionStart: PONYTAIL MODE ACTIVE' })).toBeTruthy()
  await ui.press({ key: 'b0:hook' })
  expect(await ui.find({ type: 'Text', text: 'SessionStart: PONYTAIL MODE ACTIVE' })).toBeFalsy()
  await ui.unmount()
})

test('Skill 호출은 skill.prompt 가 와도 안 와도 정확히 한 번 기록된다', async ($, on) => {
  // 엔진 역할: expands 가 true 면 Skill 호출 안에서 skill.prompt 를 올린다(처음 펼칠 때),
  // false 면 올리지 않는다(이미 불러온 스킬을 다시 부를 때).
  let expands = true
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', async (_$, e) => {
    const skill = (e as { skill?: string }).skill
    if (e.tool === 'Skill' && expands && skill) {
      await $.skill.prompt({ skill, text: '...', frontmatter: {}, source: 'plugin' } as never)
    }
    return { result: {} }
  })
  const skillRows = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const n = (await ui.findAll({ type: 'Text', text: 'ponytail:ponytail-help' })).length
    await ui.unmount()
    return n
  }

  await $.prompt.submit({ text: '처음 호출' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'ponytail:ponytail-help' } as never)
  expect(await skillRows()).toBe(1)

  expands = false
  await $.prompt.submit({ text: '다시 호출' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'ponytail:ponytail-help' } as never)
  expect(await skillRows()).toBe(1)
})

test('메인 턴이 끝나면 질문의 시작·끝·소요 시간이 보인다', async ($, on) => {
  engine(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.prompt.submit({ text: '시간 확인' } as never)
  await $.turn.start({ text: '시간 확인', turnId: 't1' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /· running$/ })).toBeTruthy()
  // 서브에이전트 턴의 끝은 질문의 끝이 아니다.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 's1', agentId: 'a1', reason: 'answer' } as never)
  expect(await ui.find({ type: 'Text', text: /· running$/ })).toBeTruthy()
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(await ui.find({ type: 'Text', text: /\d\d:\d\d:\d\d → \d\d:\d\d:\d\d · \d+s$/ })).toBeTruthy()
  await ui.unmount()
})

test('기록이 없으면 안내 문구를 보인다', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'No questions recorded yet.' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', text: /^[▾▸] Q/ })).toBeFalsy()
  await ui.unmount()
})

test('기본 도구는 접힌 Tools 섹션에 횟수로 보이고, Skill·Agent·MCP 는 섞이지 않는다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '도구 확인' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pwd' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'x:y' } as never)
  await $.tool.call({ tool: 'mcp__plugin_context-mode_context-mode__ctx_search' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /Tools 3/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Bash ×2' })).toBeFalsy() // 기본으로 접힘
  await ui.press({ key: 'b1:tool' })
  expect(await ui.find({ type: 'Text', text: 'Bash ×2' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Skill/ })).toBeFalsy()
  await ui.unmount()
})

test('Tools 항목 아래에 읽고 고친 파일이 작업 폴더 기준 경로로 보인다', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: String.raw`C:\work\proj`, surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: '파일 확인' } as never)
  await $.tool.call({ tool: 'Read', file_path: String.raw`C:\work\proj\hooks\trace.ts` } as never)
  await $.tool.call({ tool: 'Edit', file_path: String.raw`C:\work\proj\README.md`, old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: String.raw`C:\work\proj\README.md`, old_string: 'b', new_string: 'c' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'b1:tool' })
  expect(await ui.find({ type: 'Text', text: 'hooks/trace.ts' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'README.md ×2' })).toBeTruthy()
  await ui.unmount()
})

const stepUsage = {
  model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 100000, cache_creation_input_tokens: 5000,
}
const stepEngine = (on: On) => {
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: stepUsage } as never
  })
}
const runStep = async ($: { turn: { step: (e: never) => AsyncIterable<unknown> } }) => {
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)) void chunk
}

test('모델 요청의 사용량이 Cost 섹션에 모델·토큰·금액으로 쌓인다', async ($, on) => {
  engine(on)
  stepEngine(on)
  await $.prompt.submit({ text: '비용 확인' } as never)
  await runStep($ as never)
  await runStep($ as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Chat $0.208' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^claude-opus-5-5 ×2 · in 2\.0k · out 4\.0k/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^skill-trace \$[\d.]+ \(est\.\)$/ })).toBeTruthy()
  await ui.unmount()
})

for (const options of [{ cost: 'off' }, { reason: 'off', cost: 'on' }] as Record<string, string>[]) {
  test(`비용 기록 꺼짐: ${JSON.stringify(options)}`, { options }, async ($, on) => {
    engine(on)
    stepEngine(on)
    await $.prompt.submit({ text: '비용 확인' } as never)
    await runStep($ as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /^Chat / })).toBeFalsy()
    await ui.unmount()
  })
}

test('Session 영역: id·모델·권한 모드·폴더를 보이고, 접으면 모델·모드만 한 줄로 남는다', async ($, on) => {
  engine(on)
  on('classic.UserPromptSubmit', () => ({}) as never)
  await $.session.start({ cwd: 'C:/work/repo', surface: 'desktop', isInteractive: true })
  await $.classic.UserPromptSubmit({ prompt: '질문', permission_mode: 'plan' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '▾ Session' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'sess-1234' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'plan' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'C:/work/repo' })).toBeTruthy()
  await ui.press({ key: 'b:session' })
  expect(await ui.find({ type: 'Text', text: '▸ Session' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'sess-1234' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: ' · Opus 5.5 · plan' })).toBeTruthy()
  await ui.unmount()
})

test('두 번째 질문(스킬·이유 호출 포함)에도 비용이 쌓인다', async ($, on) => {
  engine(on)
  stepEngine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: '첫 질문' } as never)
  await runStep($ as never)
  await $.prompt.submit({ text: '둘째 질문' } as never)
  await runStep($ as never)
  await $.tool.call({ tool: 'mcp__skill-trace__reason', skill: 'ce-handoff', reason: '인수인계' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'ce-handoff' } as never)
  await runStep($ as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^claude-opus-5-5 ×2 / })).toBeTruthy()
  await ui.press({ key: 'q1' })
  expect(await ui.find({ type: 'Text', text: /^claude-opus-5-5 ×1 / })).toBeTruthy()
  await ui.unmount()
})
