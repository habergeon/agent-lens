import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'skill-trace',
  component: 'Pane',
  requestId: 'skill-trace',
  props: {
    title: '스킬 추적',
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
    expect((await ui.find({ type: 'Button', text: /Q1 "mod 만들 수 있어\?"/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /plugin-authoring — mod API 확인 필요/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /context-mode: ctx_execute/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /Explore/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Button', text: /Q0 "\(세션 시작\)" · 훅 1/ }))).toBeTruthy()
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
    expect(await ui.find({ type: 'Text', text: /ponytail:ponytail-help — 부작용 없는 확인용/ })).toBeTruthy()
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

test('질문 줄을 눌러 펼치고 접으며, 펼친 질문은 전체 텍스트를 보인다', async ($, on) => {
  engine(on)
  const long = '그누보드랑 php 사용하는녀석들을 PC에 보관 했던거지? 대상과 명세 기준에 접속 방법 등을 정리해서 알려줄래?'
  await $.prompt.submit({ text: long } as never)
  await $.prompt.submit({ text: '두 번째 질문' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // 처음엔 최신(Q2)이 펼쳐지고 Q1 은 접힌 한 줄.
  expect(await ui.find({ type: 'Button', text: /^▾ Q2/ })).toBeTruthy()
  expect(await ui.find({ type: 'Button', text: /^▸ Q1/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: long })).toBeFalsy()

  // Q1 을 누르면 Q1 이 펼쳐지고 전체 질문이 보인다.
  await ui.press({ key: 'q1' })
  expect(await ui.find({ type: 'Button', text: /^▾ Q1/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: long })).toBeTruthy()
  expect(await ui.find({ type: 'Button', text: /^▸ Q2/ })).toBeTruthy()

  // 펼친 Q1 을 다시 누르면 모두 접힌다.
  await ui.press({ key: 'q1' })
  expect(await ui.find({ type: 'Button', text: /^▾/ })).toBeFalsy()

  // 새 질문이 오면 다시 최신이 펼쳐진다.
  await $.prompt.submit({ text: '세 번째' } as never)
  expect(await ui.find({ type: 'Button', text: /^▾ Q3/ })).toBeTruthy()
  await ui.unmount()
})

test('슬래시 커맨드는 커맨드로 기록되고, 그 스킬은 "사용자 실행"이 된다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '/superpowers:brainstorming 아이디어', command: { name: 'superpowers:brainstorming', args: '아이디어' } } as never)
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '...', frontmatter: {}, source: 'plugin' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /superpowers:brainstorming — 사용자 실행/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^  · \/superpowers:brainstorming$/ }))).toBeTruthy()
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
  expect((await ui.find({ type: 'Text' }))?.text).toBe('아직 기록된 질문이 없습니다.')
  await ui.unmount()
})

test('슬래시 커맨드 뒤 다른 프롬프트가 오면 보류한 커맨드는 버려진다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '/model', command: { name: 'model', args: '' } } as never)
  await $.prompt.submit({ text: '진짜 질문' } as never)
  await $.skill.prompt({ skill: 'model', text: '...', frontmatter: {}, source: 'built-in' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /Q1 "진짜 질문"/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^  · \/model$/ }))).toBeFalsy()
  await ui.unmount()
})

test('백그라운드·피어 프롬프트는 질문으로 기록되지 않는다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '작업 끝', origin: { kind: 'task-notification' } } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('아직 기록된 질문이 없습니다.')
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
  expect((await ui.find({ type: 'Text', text: /SessionStart: PONYTAIL MODE ACTIVE/ }))).toBeTruthy()
  await ui.unmount()
})

test('기록이 없으면 안내 문구를 보인다', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('아직 기록된 질문이 없습니다.')
  await ui.unmount()
})
