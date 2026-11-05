export type SkillUse = { name: string; reason?: string; sub?: boolean }
export type McpUse = { server: string; tool: string; count: number; sub?: boolean }
export type AgentUse = { type: string; count: number }
export type HookUse = { event: string; head: string; count: number }
/** 기본 도구(Bash·Read·Edit …): MCP·Skill·Agent 는 각자의 섹션에서 센다. */
export type ToolUse = {
  name: string
  count: number
  sub?: boolean
  /** 파일을 받는 도구(Read·Edit·Write·NotebookEdit)가 다룬 파일: 절대 경로(/ 구분) → 횟수. */
  files?: Record<string, number>
}

/** 스킬로 이어질지 아직 모르는 슬래시 커맨드. */
export type Parked = { text: string; name: string }

export type Trace = {
  /** 질문 순번. 1부터. 0 은 질문 전에 일어난 일을 묶는 "(세션 시작)" 항목. */
  id: number
  question: string
  /** 질문이 미리보기(40자)보다 길 때의 전체 텍스트(최대 2000자). 펼친 항목에서 보여 준다. */
  full?: string
  /** 질문 시작 시각(ms). 메인 턴이 끝날 때마다 endedAt 이 갱신되고, 진행 중이면 비어 있다. */
  startedAt?: number
  endedAt?: number
  skills: SkillUse[]
  mcp: McpUse[]
  agents: AgentUse[]
  /** 0.1.6 에 추가: 그 전에 저장된 항목에는 없다. */
  tools?: ToolUse[]
  hooks: HookUse[]
  commands: string[]
  /** 스킬보다 먼저 도착한 이유: 스킬 이름 → 이유. 같은 이름의 스킬이 기록되면 소비된다. */
  pending: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    /** qopen: 질문 id → 사람이 정한 펼침 상태. 없으면 최신 질문만 펼침. */
    /** flip: 기본 펼침 상태(훅만 접힘)를 사람이 뒤집은 섹션 키 `${질문 id}:${섹션 key}`. */
    'skill-trace': {
      traces: Shaped<Trace[]>
      parked: Shaped<Parked | null>
      qopen: Shaped<Record<string, boolean>>
      flip: Shaped<string[]>
    }
  }
}
