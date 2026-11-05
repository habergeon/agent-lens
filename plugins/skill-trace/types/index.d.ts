export type SkillUse = { name: string; reason?: string; sub?: boolean }
export type McpUse = { server: string; tool: string; count: number; sub?: boolean }
export type AgentUse = { type: string; count: number }
export type HookUse = { event: string; head: string; count: number }

/** 스킬로 이어질지 아직 모르는 슬래시 커맨드. */
export type Parked = { text: string; name: string }

export type Trace = {
  /** 질문 순번. 1부터. 0 은 질문 전에 일어난 일을 묶는 "(세션 시작)" 항목. */
  id: number
  question: string
  /** 질문이 미리보기(40자)보다 길 때의 전체 텍스트(최대 2000자). 펼친 항목에서 보여 준다. */
  full?: string
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
    /** open: 펼친 질문 id. null 이면 최신 질문, -1 이면 모두 접힘. */
    'skill-trace': { traces: Shaped<Trace[]>; parked: Shaped<Parked | null>; open: Shaped<number | null> }
  }
}
