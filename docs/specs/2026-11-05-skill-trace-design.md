# skill-trace 설계

- 날짜: 2026-11-05
- 상태: 설계 승인됨
- 대상 빌드: Claude Code 2.1.318 (mod API)
- 위치: `plugins/skill-trace/` (마켓플레이스 `agent-lens`)

## 목적

사용자가 스킬을 직접 지정하지 않아도 Claude는 설치된 스킬과 플러그인 기능을 스스로 골라 씁니다. 그런데 무엇을 왜 썼는지는 화면에 드러나지 않습니다. `skill-trace`는 **질문 1건마다** 다음 세 가지를 옆 패널에 보여 줍니다.

1. 쓰인 스킬과 그 스킬을 고른 이유
2. 쓰인 플러그인 기능: MCP 도구, 서브에이전트, 훅 개입, 슬래시 커맨드
3. 위 항목이 어떤 질문에 딸린 것인지

작업 진행 타임라인은 이번 범위에 넣지 않습니다.

## 범위 밖 (YAGNI)

- 세션을 넘어서는 기록과 통계 (`$.store`). 기록이 쌓인 뒤 "어떤 스킬이 자주 헛도는지" 같은 분석이 필요해지면 추가합니다.
- 훅이 주입한 내용이 어느 플러그인 것인지 대응하는 표. 주입 텍스트의 첫 줄만 보여 주면 사람이 알아볼 수 있습니다.
- "검토했지만 쓰지 않은 스킬". 엔진이 관찰할 수 있게 해 주지 않습니다.
- 모델 thinking에서 근거를 뽑는 방식. thinking은 요약되거나 가려질 수 있습니다.

## 저장소 구조

여러 mod를 한 repo에 담는 마켓플레이스인 `johnnyvizz/claude-kit`의 형태를 따릅니다.

```
agent-lens/
├─ .claude-plugin/marketplace.json   name "agent-lens", owner {name,url}, metadata.description,
│                                    plugins: [{ name, source: "./plugins/skill-trace", description, version, category: "mod" }]
├─ .gitignore                        **/.claude-plugin/types/, tsconfig.json, node_modules/
├─ LICENSE                           MIT
├─ README.md                         플러그인 표 · 설치(마켓플레이스 / 수동) · 폴더 구조
├─ docs/specs/                       설계 문서
└─ plugins/skill-trace/
   ├─ .claude-plugin/plugin.json     name, version, description, author, types, homepage, repository, license
   ├─ README.md                      기능 · 표시 항목 · 한계
   ├─ hooks/hooks.json               { "modules": ["./register.tsx"] }
   ├─ hooks/register.tsx             훅 모듈 (수집 + 패널 + 명령)
   ├─ hooks/register.test.tsx        테스트
   └─ types/index.d.ts               PluginState 계약
```

설치 명령: `/plugin marketplace add habergeon/agent-lens` → `/plugin install skill-trace@agent-lens`

개발 중에는 `claude plugin marketplace add C:\workspace\personal\agent-lens`로 등록한 뒤 설치합니다. 이렇게 하면 설치본을 복사하지 않고 이 폴더를 직접 읽으므로, 파일을 고친 뒤 `/reload-plugins`만 실행하면 반영됩니다.

## 데이터 모델

```ts
type Trace = {
  id: number;              // 질문 순번 (1부터, "(세션 시작)" 항목은 0)
  question: string;        // 사용자 질문 앞부분 (최대 40자)
  skills: { name: string; reason?: string; sub?: boolean }[];
  mcp: { server: string; tool: string; count: number; sub?: boolean }[];
  agents: { type: string; count: number }[];
  hooks: { event: string; head: string; count: number }[];   // head: 주입 텍스트 첫 줄 30자. PreToolUse 팁처럼 반복되는 주입은 count로 합침
  commands: string[];                          // "/name"
  pending: Record<string, string>;             // 스킬보다 먼저 온 이유 (질문이 바뀌면 함께 버려짐)
};
// $.state 키: skill-trace.traces: Trace[] (최근 30건) 하나
```

이유 줄은 스킬 호출보다 먼저 도착할 수 있습니다. 그래서 짝이 없는 이유는 그 Trace의 `pending`에 이름을 키로 잠시 보관하고, 같은 이름의 스킬이 기록되면 그때 붙입니다. 반대로 스킬이 먼저 기록된 상태에서 이유가 도착하면, 아직 이유가 없는 같은 이름의 스킬 중 가장 최근 것에 붙입니다.

## 수집: 이벤트별 처리

| 수집 대상 | 이벤트 | 처리 |
|---|---|---|
| 질문 | `prompt.submit` | 새 Trace를 만듭니다. 슬래시 커맨드(`e.command`)는 바로 만들지 않고 보류했다가, 같은 이름의 `skill.prompt`가 오면 그때 질문으로 만들고 `commands`에 `/name`을 추가합니다. 백그라운드 알림·피어·예약 등 사람이 낸 것이 아닌 `origin`은 건너뜁니다. |
| 스킬 | `skill.prompt` | `skills`에 `{ name: e.skill }`를 추가합니다. Skill 도구, `/명령`형 스킬, 미리 로드 경로가 모두 이 이벤트로 들어옵니다. |
| 채택 이유 | `session.append`, `door: 'response'` | 텍스트 블록에서 `/^[\s`*>\-•]*\[스킬근거\][*`]*\s*(\S+?)\s*:\s+(.+?)`?\s*$/gm`에 맞는 줄을 찾아 해당 스킬과 짝을 맞춥니다. |
| MCP 도구 | `tool.call`, 도구 이름이 `mcp__`로 시작 | `mcp__<server>__<tool>` 형식을 분해하고 `plugin_<p>_<s>`에서 `<p>`를 서버 표시 이름으로 씁니다. 같은 항목이면 `count`를 늘립니다. |
| 서브에이전트 | `tool.call`, 도구 `Agent` | 입력의 `subagent_type`을 기록합니다. 값이 없으면 `general-purpose`로 둡니다. |
| 훅 개입 | `session.append`, `door`가 `response`가 아님 | `origin.kind === 'hook'`이면 `origin` 이벤트 이름과 텍스트 첫 줄(`<system-reminder>` 태그와 `… hook additional context:` 접두어 제거 후)을 기록합니다. |
| 서브에이전트 내부 | 스킬(`Skill` 도구 호출)과 MCP 도구 호출 중 `agentId`가 있는 것 | 같은 Trace에 `sub: true`로 표시해 기록합니다. |

질문 없이 일어난 일(SessionStart 주입 등)은 `id: 0`, `question: "(세션 시작)"` 항목에 묶습니다.

## 이유 규칙 주입

`prompt.compose`에서 `next(e)`로 받은 `sections` 맨 끝에 `scope: 'session'` 섹션 하나를 추가합니다.

> Skill 도구를 호출하기 직전, 응답 본문에 한 줄을 쓴다: `[스킬근거] <스킬명>: <이 질문에 이 스킬을 고른 이유 한 줄>`

섹션 문구는 바뀌지 않는 고정 문자열이라, 세션 도중에 프롬프트 캐시가 깨지지 않습니다. 예외가 하나 있습니다. 세션 도중에 mod를 처음 켜거나 끄면 시스템 프롬프트가 바뀌어서, 그 시점에 캐시와 thinking이 한 번 초기화됩니다.

## 표시: 옆 패널

- `session.start`에서 `$.ui.open({ id: 'skill-trace', title: '스킬 추적' })`를 호출합니다. 터미널 폭이 좁으면 엔진이 패널을 띄우지 않고 기다립니다.
- `/skill-trace` 명령으로 패널을 다시 엽니다.
- `ui.render` 훅의 `{ component: 'Pane', requestId: 'skill-trace' }`에서 `traces` atom을 읽어 그립니다.
- 가장 최근 Trace를 맨 위에 펼쳐서 보여 주고, 내용이 있는 칸만 스킬, MCP, 서브에이전트, 훅, 커맨드 순서로 그립니다.
- 이전 Trace는 `▸ Q{id} "{question}" · 스킬 n · MCP n` 한 줄로 접어 둡니다.
- 이유가 없는 스킬은 "이유 미기재", 같은 질문에서 `/명령`으로 직접 실행된 스킬은 "사용자 실행"으로 표시합니다. 훅은 `{event}: {첫 줄}` 형태로 보여 줍니다.
- 긴 텍스트는 말줄임표로 자릅니다.

## 예외 처리

- 수집 훅은 기록을 **`next(e)` 앞에서** 합니다. `next`가 서브에이전트 실행이나 턴 전체를 감쌀 수 있어서, 뒤에서 기록하면 순서가 뒤바뀌기 때문입니다. 기록 중에 예외가 나면 엔진이 그 훅만 건너뛰고 체인을 계속 진행하므로 본래 동작에는 영향이 없습니다. 이 mod는 관찰만 하므로 아무것도 막거나 바꾸지 않습니다.
- 정규식과 맞지 않는 응답은 무시합니다.
- 최근 30건만 보관합니다.
- 다시 로드돼도 `$.state`는 유지됩니다. 모듈 안의 변수에는 아무것도 저장하지 않습니다.

## 테스트 (`claude plugin test plugins/skill-trace`)

1. 질문 → 이유 줄 → `skill.prompt` 순서로 들어올 때, 스킬과 이유가 짝지어지는지 (이유가 먼저 오는 경우와 나중에 오는 경우 모두)
2. `mcp__plugin_context-mode_context-mode__ctx_execute`를 두 번 호출하면 → `context-mode / ctx_execute ×2`로 기록되는지
3. `hook-context` 행 → `{ event: 'SessionStart', head }`가 기록되는지
4. 31번째 질문 → 가장 오래된 1건이 빠지는지
5. 패널을 `terminal`과 `desktop` 두 화면에 각각 마운트했을 때 오류 없이 렌더링되는지

검증 순서: `claude plugin validate` → `tsc` (tsconfig 는 엔진이 생성하고 gitignore 되므로 타입 정의 파일 머리말의 tsconfig 로 검사) → `claude plugin test`.
