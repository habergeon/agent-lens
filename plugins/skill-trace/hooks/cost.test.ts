import { expect, test } from 'claude-code/testing'
import type { Trace } from '../types'
import { OVERHEAD_TOKENS, addReasonCall, addRequest, counts, estimateTokens, kilo, money, priceOf, sections, startTrace } from './trace'

const one = (): Trace => startTrace([], '질문')[0]!
const usage = (model: string, input: number, output: number, cacheRead: number, cacheWrite: number) => ({
  model, input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite,
})
const close = (a: number | undefined, b: number) => expect(Math.abs((a ?? NaN) - b) < 1e-9).toBe(true)

test('prices follow the model table, with the Haiku 5.5 long-prompt tier and no guess for unknown models', async () => {
  expect(priceOf('claude-opus-5-5')).toEqual([4, 20, 0.2, 8])
  expect(priceOf('claude-fable-5-1')).toEqual([10, 50, 0.25, 20])
  expect(priceOf('claude-sonnet-5-5')).toEqual([2, 10, 0.2, 4])
  expect(priceOf('claude-haiku-5-5', 50_000)).toEqual([0.1, 0.5, 0.01, 0.2])
  expect(priceOf('claude-haiku-5-5', 150_000)).toEqual([0.5, 2.5, 0.05, 1])
  expect(priceOf('some-other-model')).toBe(undefined)
})

test('a request adds its API usage at list price, and the skill-trace overhead at the cache-read price', async () => {
  const t = addRequest(one(), usage('claude-opus-5-5', 1000, 2000, 100_000, 5000), 300)
  const s = t.spend!['claude-opus-5-5']!
  expect([s.requests, s.input, s.output, s.cacheRead, s.cacheWrite, s.modIn]).toEqual([1, 1000, 2000, 100_000, 5000, 300])
  close(s.cost, (1000 * 4 + 2000 * 20 + 100_000 * 0.2 + 5000 * 8) / 1e6) // 0.104
  close(s.modCost, (300 * 0.2) / 1e6)
})

test('a reason call adds its output at the output price', async () => {
  const t = addReasonCall(addRequest(one(), usage('claude-opus-5-5', 0, 0, 0, 0), 0), 'claude-opus-5-5', 40)
  const s = t.spend!['claude-opus-5-5']!
  expect([s.modCalls, s.modOut]).toEqual([1, 40])
  close(s.modCost, (40 * 20) / 1e6)
})

test('the Cost section shows Chat and the skill-trace share; the summary shows the chat total', async () => {
  let t = addRequest(one(), usage('claude-opus-5-5', 1000, 2000, 100_000, 5000), 300)
  t = addRequest(t, usage('mystery-model', 10, 10, 0, 0), 300)
  const cost = sections(t).find(s => s.key === 'cost')!
  expect(cost.badge).toBe('$0.104')
  expect(cost.items[0]).toEqual({
    text: 'Chat $0.104',
    sub: 'API-reported usage at list price · price unknown: mystery-model',
    lines: [
      'claude-opus-5-5 ×1 · in 1.0k · out 2.0k · cache read 100.0k · write 5.0k',
      'mystery-model ×1 · in 10 · out 10 · cache read 0 · write 0',
    ],
  })
  expect(cost.items[1]!.text).toBe('skill-trace $0.0001 (est.)')
  expect(counts(t)).toBe('$0.104')
  expect(sections(one()).find(s => s.key === 'cost')).toBe(undefined)
})

test('helpers: token estimate, money and kilo formats', async () => {
  expect(estimateTokens('abcd')).toBe(1)
  expect(estimateTokens('가나')).toBe(2)
  expect(OVERHEAD_TOKENS > 100 && OVERHEAD_TOKENS < 1000).toBe(true)
  expect([money(0), money(0.00006), money(0.104), money(12.5)]).toEqual(['$0', '$0.0001', '$0.104', '$12.50'])
  expect([kilo(999), kilo(1500), kilo(2_300_000)]).toEqual(['999', '1.5k', '2.3M'])
})
