/**
 * 실제 OpenAI API 로 tests/scenarios.json 시나리오를 돌려 사람이 채점할 기록을 남긴다.
 *   npm run eval:live                 # 전체
 *   npm run eval:live -- --case TMI-01,QUESTION-01 --repeat 2
 *
 * - OPENAI_API_KEY / OPENAI_MODEL 이 없으면 실행하지 않고 '미검증'으로 끝난다(통과로 보고하지 않음).
 * - 메모리 내장 DB 를 쓰므로 운영 DB 에 아무것도 쓰지 않는다.
 * - 정답 대사 일치가 아니라 속성(질문 수, 누출 검출, 행동 선택, 감정)을 기록한다. 최종 판단은 사람이 한다.
 * - 비용이 발생한다: 대략 (시나리오 턴 수 × 반복 수 × 1~2회 호출).
 */
import fs from "node:fs";
import path from "node:path";
import scenarios from "../tests/scenarios.json";
import { loadConfig } from "../src/lib/config";
import { createPgliteDb, migrate } from "../src/lib/db";
import { Repo } from "../src/lib/db/repo";
import { SayakaService, ServiceError, type TurnDiagnostics } from "../src/lib/engine/orchestrator";
import { createOpenAiClient } from "../src/lib/engine/llm";
import { createModerator } from "../src/lib/engine/safety";
import { PROMPT_VERSION } from "../src/lib/engine/canon";

interface Case {
  id: string;
  category: string;
  user_turns: string[];
  expected_properties: string[];
  failure_signals: string[];
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const cfg = loadConfig();
  if (cfg.ai.mode !== "openai" || !cfg.ai.apiKey || !cfg.ai.model) {
    console.log("OPENAI_API_KEY 또는 OPENAI_MODEL 이 없어 라이브 평가를 실행하지 않았어요. (결과: 미검증)");
    return;
  }
  const only = arg("case")?.split(",").map((s) => s.trim());
  const repeat = Math.max(1, Number(arg("repeat") ?? 1));
  const cases = (scenarios.cases as Case[]).filter((c) => !only || only.includes(c.id));

  const db = await createPgliteDb();
  await migrate(db);
  // 평가용으로 한도를 넉넉히
  const evalCfg = { ...cfg, limits: { ...cfg.limits, perMinute: 1000, perDay: 100000 } };
  const service = new SayakaService({ repo: new Repo(db), cfg: evalCfg, llm: createOpenAiClient(cfg), moderator: createModerator(cfg) });
  const owner = "eval";

  const records: unknown[] = [];
  const md: string[] = [
    `# 라이브 평가 기록`,
    ``,
    `- 실행: ${new Date().toISOString()}`,
    `- 모델: ${cfg.ai.model} / 추론: ${cfg.ai.reasoningEffort ?? "기본"} / 프롬프트: ${PROMPT_VERSION}`,
    `- 판정: 자동 수치는 진단용. 각 항목의 '사람 채점' 칸(캐릭터 일관성·자율성·자연스러움·상호작용 여지, 1~5)을 직접 채워 주세요.`,
    ``,
  ];

  for (const c of cases) {
    for (let r = 1; r <= repeat; r++) {
      let chat = (await service.createChat(owner, "official_v030")).chat;
      md.push(`## ${c.id} (${c.category})${repeat > 1 ? ` — 반복 ${r}` : ""}`, ``, `기대: ${c.expected_properties.join(" / ")}`, `실패 신호: ${c.failure_signals.join(" / ")}`, ``);
      const turns: unknown[] = [];
      for (let t of c.user_turns) {
        if (t.includes("(새 대화방 생성)")) {
          chat = (await service.createChat(owner, "official_v030")).chat;
          md.push(`> _(새 대화방 생성)_`, ``);
          continue;
        }
        t = t.replace(/^\(다음에 같은 대화방에서\)\s*/, "");
        try {
          const res = await service.sendMessage({ ownerId: owner, chatId: chat.id, text: t, clientRequestId: `eval-${c.id}-${r}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, admin: true });
          const d = res.diagnostics as TurnDiagnostics;
          turns.push({ user: t, reply: res.assistantMessage.body, diagnostics: d });
          md.push(
            `**사용자:** ${t}`,
            ``,
            res.assistantMessage.body
              .split("\n")
              .map((l) => `> ${l}`)
              .join("\n"),
            ``,
            `- 행동 ${d.actionIntent} / 감정 ${d.emotion} / 입력 ${d.userMove} / 물음표 ${d.questionCount}${d.endsWithQuestion ? " (질문으로 끝남)" : ""} / 검수 ${d.issues.map((i) => i.code).join(",") || "없음"}${d.firstAttemptIssues.length ? ` / 1차 반려 ${d.firstAttemptIssues.map((i) => i.code).join(",")}` : ""}`,
            `- 보낸 설정: ${d.loreIds.join(", ")}`,
            ``,
          );
        } catch (e) {
          const code = e instanceof ServiceError ? e.code : "ERROR";
          turns.push({ user: t, error: code, message: e instanceof Error ? e.message : String(e) });
          md.push(`**사용자:** ${t}`, ``, `> ⚠ 오류 ${code}: ${e instanceof Error ? e.message : e}`, ``);
        }
      }
      md.push(`사람 채점: 일관성 __ / 자율성 __ / 자연스러움 __ / 상호작용 여지 __ / 통과 여부 __ / 메모: `, ``);
      records.push({ caseId: c.id, repeat: r, model: cfg.ai.model, promptVersion: PROMPT_VERSION, turns, manualScore: null });
      console.log(`완료: ${c.id} #${r}`);
    }
  }

  const dir = path.join(process.cwd(), "eval-results");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(dir, `eval-${stamp}.json`), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(dir, `eval-${stamp}.md`), md.join("\n"));
  console.log(`기록: eval-results/eval-${stamp}.md (+ .json)`);
  await db.close();
}

main().catch((e) => {
  console.error("평가 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
