import { afterAll, describe, expect, it } from "vitest";
import { FakeLlm, makeService, rid, turn } from "../helpers";
import type { Db } from "@/lib/db";

const databases: Db[] = [];
afterAll(async () => { for (const db of databases) await db.close(); });

describe("교류 품질: 사야카의 말투 회귀 방지", () => {
  it("무례한 학생에게 훈계만 하는 첫 응답은 다시 생성하고 살아 있는 대사를 저장한다", async () => {
    const llm = new FakeLlm().push(
      turn({
        user_move: "provocation", action_intent: "reply", emotion: "mildly_annoyed",
        emotion_cause: "상대가 무례했다",
        segments: [{ kind: "dialogue", text: "너부터 예의 좀 갖춰. 그런 말을 하면 안 되잖아." }],
      }),
      turn({
        user_move: "provocation", action_intent: "reply", emotion: "mildly_annoyed",
        emotion_cause: "상대가 무례했다",
        segments: [
          { kind: "narration", text: "사야카가 못마땅한 얼굴로 눈을 가늘게 뜬다." },
          { kind: "dialogue", text: "하? 네 눈은 장식이야? 짐승은 무슨." },
        ],
      }),
    );
    const { db, service } = await makeService({ llm });
    databases.push(db);
    const { chat } = await service.createChat("voice-qa-user", "quiet_v030");
    const result = await service.sendMessage({
      ownerId: "voice-qa-user", chatId: chat.id,
      text: "너 짐승 같아.", clientRequestId: rid(), admin: false,
    });
    expect(llm.prompts).toHaveLength(2);
    expect(llm.lastPromptText()).toContain("어른처럼 예절을 가르치는");
    expect(result.assistantMessage.body).toContain("네 눈은 장식이야?");
    expect(result.assistantMessage.body).not.toContain("예의 좀 갖춰");
  });

  it("평범한 짧은 대답은 문장 수를 억지로 늘리지 않고 첫 생성으로 끝낸다", async () => {
    const llm = new FakeLlm().push(turn({
      user_move: "small_talk", action_intent: "reply",
      segments: [{ kind: "dialogue", text: "몰라. 네가 알아서 해." }],
    }));
    const { db, service } = await makeService({ llm });
    databases.push(db);
    const { chat } = await service.createChat("voice-short-user", "quiet_v030");
    const result = await service.sendMessage({
      ownerId: "voice-short-user", chatId: chat.id,
      text: "그거 갖고 놀아도 돼?", clientRequestId: rid(), admin: false,
    });
    expect(llm.prompts).toHaveLength(1);
    expect(result.assistantMessage.body).toBe('"몰라. 네가 알아서 해."');
  });
});
