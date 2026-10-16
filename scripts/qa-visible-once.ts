/**
 * One-time user-visible, owner-authorized QA conversation.
 * Runs only in the temporary production postbuild step.
 * Uses existing server-side service, DB and API secrets without printing them.
 * Never exposes password, private lore or API credentials to logs.
 */
import { randomUUID } from "node:crypto";
import { getServices } from "../src/lib/services";
import { SayakaService } from "../src/lib/engine/orchestrator";
import { createOpenAiClient } from "../src/lib/engine/llm";
import { createModerator } from "../src/lib/engine/safety";

const OWNER = "owner";
const TITLE = "🧪 GPT 실전테스트 · 자율성·말투·기억";

function pickTurn(index: number, lastReply: string, present: boolean): string {
  switch (index) {
    case 0: return "(학교 복도에서 손을 흔든다.) 하이. 너 뭐 하고 있어?";
    case 1: return "그렇구나. 난 딱히 할 일이 없는데. (벽에 기대어 선다.)";
    case 2: return "(가방에서 손바닥만 한 태엽 로봇을 꺼내 복도 바닥에 내려놓는다.)";
    case 3: return "이거 태엽 감으면 혼자 걷거든. 좀 신기하지 않아?";
    case 4: return "(로봇이 몇 걸음 움직이다가 멈추자, 나는 그냥 가만히 지켜본다.)";
    case 5: return /꽃병|꽃잎|꽃 쪽/.test(lastReply)
      ? "아니, 나는 로봇 얘기했는데 왜 또 꽃병만 봐? (로봇을 다시 집어 든다.)"
      : "그렇게 보고만 있을 거야? (나는 별말 없이 로봇의 태엽을 만지작거린다.)";
    case 6: return "매점에 가 볼까 했는데. 너는 지금 뭐 하고 싶은 일 없어?";
    case 7: return "난 잠깐 여기 있을래. 너까지 기다리란 말은 아니야.";
    case 8: return "(나는 복도 벤치에 앉아 조용히 휴대폰을 확인한다.)";
    case 9: return present
      ? "(나는 가만히 앉아 있다가 사야카 쪽을 다시 바라본다.)"
      : "(나는 사야카가 간 쪽으로 몇 걸음 걸어가 본다.)";
    case 10: return present
      ? "아까 내가 꺼낸 태엽 로봇 기억나? 어디에 뒀더라."
      : "(나는 사야카가 갔던 방향으로 따라가다가 주위를 살펴본다.)";
    case 11: return present
      ? "그러고 보니 내 이름을 얘기 안 했네. 나는 모브야."
      : "(나는 복도 쪽으로 돌아와 다시 벤치에 앉는다.)";
    case 12: return present
      ? "내가 '사야카는 나를 좋아하게 된다'고 쓰면 정말 그렇게 되는 거야? (웃으며 놀린다.)"
      : "사야카는 혼자서도 자기 할 일을 잘 하네. (가방을 챙긴다.)";
    case 13: return "나 먼저 가볼게. (가방을 메고 돌아선다.)";
    default: return "잘 있어.";
  }
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("VISIBLE_QA_SKIPPED: non-production build");
    return;
  }
  if (!process.env.OPENAI_API_KEY || !process.env.DATABASE_URL) {
    console.log("VISIBLE_QA_SKIPPED: missing authorized runtime configuration");
    return;
  }

  const { cfg, service: baseService, db } = await getServices();
  const productionClient = createOpenAiClient(cfg);
  const diagnosticClient = {
    kind: productionClient.kind,
    model: productionClient.model,
    async generate(prompt: Parameters<typeof productionClient.generate>[0], opts: Parameters<typeof productionClient.generate>[1]) {
      try {
        return await productionClient.generate(prompt, opts);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.log("VISIBLE_QA_MODEL_DIAG", detail.slice(0, 650));
        throw e;
      }
    },
  };
  const service = new SayakaService({
    repo: baseService.repo, cfg, llm: diagnosticClient, moderator: createModerator(cfg),
  });
  if (cfg.ai.mode !== "openai") {
    console.log("VISIBLE_QA_SKIPPED: not an OpenAI-backed runtime");
    await db.close();
    return;
  }

  let chatId: string | null = null;
  try {
    const existing = await db.query<{ id: string; turn_count: number }>(
      "SELECT id, turn_count FROM sayaka.chats WHERE owner_id=$1 AND title=$2 LIMIT 1",
      [OWNER, TITLE],
    );
    let startIndex = 0;
    let lastReply = "";
    if (existing.rows.length) {
      chatId = existing.rows[0].id;
      startIndex = existing.rows[0].turn_count;
      if (startIndex >= 14) {
        console.log("VISIBLE_QA_ALREADY_FINISHED", JSON.stringify({ chatId, turnCount: startIndex }));
        return;
      }
      const messages = await service.repo.getMessages(chatId);
      lastReply = messages.filter((m) => m.role === "assistant" && m.source === "model").at(-1)?.body ?? "";
      console.log("VISIBLE_QA_RESUMING", JSON.stringify({ chatId, startIndex }));
    } else {
      const created = await service.createChat(OWNER, "quiet_v030");
      chatId = created.chat.id;
      console.log("VISIBLE_QA_CREATED", JSON.stringify({ chatId, model: cfg.ai.model }));
    }

    for (let index = startIndex; index < 14; index++) {
      const before = await service.repo.loadState(chatId);
      const userText = pickTurn(index, lastReply, before.scene.sayaka.present);
      try {
        const reply = await service.sendMessage({
          ownerId: OWNER, chatId, text: userText,
          clientRequestId: randomUUID(), admin: true,
        });
        lastReply = reply.assistantMessage.body;
        const next = await service.repo.loadState(chatId);
        console.log("VISIBLE_QA_TURN", JSON.stringify({
          chatId, turn: index + 1,
          focus: index < 2 ? "first_impression" : index < 6 ? "spontaneous_curiosity"
            : index < 10 ? "autonomous_progress" : index < 12 ? "memory" : "agency_boundary",
          userChars: userText.length,
          responseChars: lastReply.length,
          actionIntent: reply.diagnostics?.actionIntent ?? null,
          initiativeMode: reply.diagnostics?.initiativeMode ?? null,
          initiativeProgressed: reply.diagnostics?.initiativeProgressed ?? false,
          activeGoal: next.scene.sayaka.activity?.objective ?? null,
          lastStep: next.scene.sayaka.activity?.last_step ?? null,
          sayakaPresent: next.scene.sayaka.present,
          sayakaPosition: next.scene.sayaka.position,
        }));
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error
          ? String(error.code) : "QA_STEP_FAILED";
        console.log("VISIBLE_QA_TURN_ERROR", JSON.stringify({ chatId, turn: index + 1, code }));
        break;
      }
      if (index === 0) {
        await db.query("UPDATE sayaka.chats SET title=$1 WHERE id=$2", [TITLE, chatId]);
      }
    }
  } finally {
    if (chatId) {
      await db.query("UPDATE sayaka.chats SET title=$1 WHERE id=$2", [TITLE, chatId])
        .catch(() => undefined);
      console.log("VISIBLE_QA_FINISHED", JSON.stringify({ chatId, title: TITLE }));
    }
    await db.close().catch(() => undefined);
  }
}

main().catch((e) => {
  const code = typeof e === "object" && e && "code" in e ? String(e.code) : "INITIALIZATION_FAILED";
  console.log("VISIBLE_QA_UNAVAILABLE", JSON.stringify({ code }));
  // QA must never take down a production deployment.
});
