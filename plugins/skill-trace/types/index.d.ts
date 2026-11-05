export type SkillUse = { name: string; reason?: string; sub?: boolean }
export type McpUse = { server: string; tool: string; count: number; sub?: boolean }
export type AgentUse = { type: string; count: number }
export type HookUse = { event: string; head: string; count: number }

export type Trace = {
  /** 질문 순번. 1부터. 0 은 질문 전에 일어난 일을 묶는 "(세션 시작)" 항목. */
  id: number
  question: string
  skills: SkillUse[]
  mcp: McpUse[]
  agents: AgentUse[]
  hooks: HookUse[]
  commands: string[]
  /** 스킬보다 먼저 도착한 이유: 스킬 이름 → 이유. 같은 이름의 스킬이 기록되면 소비된다. */
  pending: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    'skill-trace': { traces: Shaped<Trace[]> }
  }
}
