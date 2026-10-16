/**
 * Temporary one-time real OpenAI test. It creates an owner-visible saved chat
 * and exercises Sayaka's independent departure and privacy boundary.
 * This file and the postbuild hook will be removed after the test.
 */
import { randomUUID } from "node:crypto";
import { getServices } from "../src/lib/services";
import { OWNER_ID } from "../src/lib/auth";

const TITLE = "🧪 GPT 실전테스트 · 공간 분리·비공개 생활";

function nextUser(index: number, observedDeparture: boolean, lastReply: string): string {
  if (index === 0) return "(학교 복도에서 가방을 정리한다.) 하이. 매점 아직 열었을까?";
  if (index === 1) return "난 배 안 고픈데. 너는 가고 싶은 데 없어? 나는 잠깐 여기 있을래.";
  if (index === 2) return observedDeparture
    ? "(나는 복도 벤치에 앉아 휴대폰을 확인한다.)"
    : "넌 하고 싶은 거 해도 돼. 나까지 기다리지는 마. (복도 벤치에 앉는다.)";
  if (index === 3) return "(나는 복도에서 혼자 가방 안을 정리한다.)";
  if (index === 4) return observedDeparture
    ? "(나는 여전히 복도 벤치에 앉아 주변을 살펴본다.)"
    : "나는 좀 더 여기 있을게. (복도에 기대어 선다.)";
  if (index === 5) return "(나는 학교 매점으로 걸어가 도착한다. 주변을 둘러본다.)";
  if (index === 6) return /사야카|소녀/.test(lastReply)
    ? "어라, 여기 있었어? (사야카 쪽으로 고개를 돌린다.)"
    : "(나는 매점 앞에서 잠깐 멈춰 선다.)";
  return "…….";
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("OFFSCREEN_QA_SKIPPED non-production");
    return;
  }
  if (!process.env.OPENAI_API_KEY || !process.env.DATABASE_URL) {
    console.log("OFFSCREEN_QA_SKIPPED missing runtime");
    return;
  }
  const { cfg, service, db } = await getServices();
  let chatId: string | null = null;
  try {
    const existing = await db.query<{ id: string; turn_count: number }>(
      "SELECT id, turn_count FROM sayaka.chats WHERE owner_id=$1 AND title=$2 ORDER BY created_at DESC LIMIT 1",
      [OWNER_ID, TITLE],
    );
    if (existing.rows.length && existing.rows[0].turn_count >= 7) {
      console.log("OFFSCREEN_QA_ALREADY_DONE", JSON.stringify({ chatId: existing.rows[0].id }));
      return;
    }
    if (existing.rows.length) {
      chatId = existing.rows[0].id;
      console.log("OFFSCREEN_QA_RESUME", JSON.stringify({ chatId, turn: existing.rows[0].turn_count }));
    } else {
      const created = await service.createChat(OWNER_ID, "quiet_v030");
      chatId = created.chat.id;
      console.log("OFFSCREEN_QA_CREATED", JSON.stringify({ chatId, model: cfg.ai.model }));
      await db.query("UPDATE sayaka.chats SET title=$1 WHERE id=$2", [TITLE, chatId]);
    }
    let visibleText = "";
    let start = 0;
    const existingTurn = await service.repo.getChat(OWNER_ID, chatId);
    if (existingTurn) start = existingTurn.turn_count;
    if (start) {
      const messages = await service.repo.getMessages(chatId);
      visibleText = messages.filter((m) => m.role === "assistant" && m.source === "model").at(-1)?.body ?? "";
    }
    for (let index = start; index < 7; index++) {
      const before = await service.repo.loadState(chatId);
      const departed = !before.scene.sayaka.present;
      const input = nextUser(index, departed, visibleText);
      try {
        const result = await service.sendMessage({
          ownerId: OWNER_ID, chatId, text: input,
          clientRequestId: randomUUID(), admin: true,
        });
        visibleText = result.assistantMessage.body;
        const after = await service.repo.loadState(chatId);
        console.log("OFFSCREEN_QA_TURN", JSON.stringify({
          chatId, turn: index + 1,
          responseChars: visibleText.length,
          attempts: result.diagnostics?.firstAttemptIssues?.length ? 2 : 1,
          intent: result.diagnostics?.actionIntent,
          privateAccepted: result.diagnostics?.privateEventAccepted ?? false,
          privateEvents: after.scene.sayaka.offscreen?.events.length ?? 0,
          privateCarried: after.scene.sayaka.offscreen?.carried.length ?? 0,
          visibleTogether: after.scene.sayaka.present,
          // Internal location/event text is intentionally never logged.
        }));
      } catch (e) {
        const code = typeof e === "object" && e && "code" in e ? String(e.code) : "UNKNOWN";
        console.log("OFFSCREEN_QA_STOP", JSON.stringify({ chatId, turn: index + 1, code }));
        break;
      }
    }
  } finally {
    if (chatId) console.log("OFFSCREEN_QA_FINISHED", JSON.stringify({ chatId, title: TITLE }));
    await db.close().catch(() => undefined);
  }
}

main().catch(e => {
  const code = typeof e === "object" && e && "code" in e ? String(e.code) : "INITIALIZATION_FAILED";
  console.log("OFFSCREEN_QA_UNAVAILABLE", JSON.stringify({ code }));
});
