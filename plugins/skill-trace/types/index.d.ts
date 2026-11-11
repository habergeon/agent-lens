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

/**
 * 한 모델의 사용량과 비용(질문 하나 안에서). input…cacheWrite 는 API 가 알려 준 실제 토큰.
 * cost 는 그 토큰의 API 정가 환산(가격을 모르는 모델이면 없음).
 * mod* 는 그 가운데 skill-trace 가 더한 몫의 추정: 요청마다 따라간 규칙·도구 정의(modIn), 이유 호출의 출력(modOut).
 */
export type Spend = {
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost?: number
  modIn: number
  modOut: number
  modCalls: number
  modCost?: number
}

/**
 * 패널 맨 위 Session 영역(0.3.0): 지금 세션의 id·모델·권한 모드·작업 폴더.
 * mode 는 묻는 API 가 없어 settings 훅 입력의 permission_mode 에서 읽는다(프롬프트·도구 호출마다 갱신).
 * effort(0.5.0)는 메인 루프의 모델 요청(turn.step)이 실제로 보내는 수준: low…max, effort 를 받지 않는 모델이면 없음.
 */
export type SessionInfo = { id?: string; model?: string; effort?: string; mode?: string; cwd?: string }

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
  /** 0.4.0 에 추가: 질문 프롬프트가 대화에 저장된 행의 id. 패널에서 대화 창의 그 줄로 스크롤할 때 쓴다. */
  msg?: string
  skills: SkillUse[]
  mcp: McpUse[]
  agents: AgentUse[]
  /** 0.1.6 에 추가: 그 전에 저장된 항목에는 없다. */
  tools?: ToolUse[]
  /** 0.2.0 에 추가(cost 옵션): 모델 id → 사용량·비용. */
  spend?: Record<string, Spend>
  hooks: HookUse[]
  commands: string[]
  /** 스킬보다 먼저 도착한 이유: 스킬 이름 → 이유. 같은 이름의 스킬이 기록되면 소비된다. */
  pending: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    /** qopen: 질문 id → 사람이 정한 펼침 상태. 없으면 최신 질문만 펼침. */
    /** flip: 기본 펼침 상태(훅만 접힘)를 사람이 뒤집은 섹션 키 `${질문 id}:${섹션 key}`, Session 영역은 `session`. */
    'skill-trace': {
      traces: Shaped<Trace[]>
      parked: Shaped<Parked | null>
      qopen: Shaped<Record<string, boolean>>
      flip: Shaped<string[]>
      session: Shaped<SessionInfo>
    }
  }
}
