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
const engine = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('command.register', () => ({ value: { command: 'skill-trace' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
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
    await $.prompt.submit({ text: 'mod 만들 수 있어?' })
    await $.session.append(said('[스킬근거] plugin-authoring: mod API 확인 필요') as never)
    await $.skill.prompt({ skill: 'plugin-authoring', text: '...', frontmatter: {}, source: 'built-in' } as never)
    await $.tool.call({ tool: 'mcp__plugin_context-mode_context-mode__ctx_execute' } as never)
    await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', prompt: 'p', description: 'd' } as never)

    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Q1 "mod 만들 수 있어\?"/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /plugin-authoring — mod API 확인 필요/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /context-mode: ctx_execute/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /Explore/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /Q0 "\(세션 시작\)" · 훅 1/ }))).toBeTruthy()
    await ui.unmount()
  })
}

test('슬래시 커맨드는 커맨드로 기록되고, 그 스킬은 "사용자 실행"이 된다', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '/superpowers:brainstorming 아이디어', command: { name: 'superpowers:brainstorming', args: '아이디어' } })
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '...', frontmatter: {}, source: 'plugin' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /superpowers:brainstorming — 사용자 실행/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^  · \/superpowers:brainstorming$/ }))).toBeTruthy()
  await ui.unmount()
})

test('prompt.compose 에 이유 규칙 섹션이 맨 끝에 붙는다', async ($, on) => {
  engine(on)
  const r = await $.prompt.compose({
    model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [],
  })
  const last = r.sections[r.sections.length - 1]
  expect(last.id).toBe('skill-trace-reason')
  expect(last.scope).toBe('session')
  expect(last.text).toContain('[스킬근거]')
})

test('기록이 없으면 안내 문구를 보인다', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('아직 기록된 질문이 없습니다.')
  await ui.unmount()
})
