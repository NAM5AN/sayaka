import { afterAll, describe, expect, it } from "vitest";
import { FakeLlm, makeService, rid, turn } from "../helpers";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import type { Db } from "@/lib/db";

describe("새 사야카 엔진의 채팅 DB 연속성", () => {
  const dbs: Db[] = [];
  afterAll(async () => { for (const db of dbs) await db.close(); });

  it("실제 동행으로 공원에 도착하면 다음 턴에도 장소·기억이 유지된다", async () => {
    const first = turn({
      action_intent: "intervene",
      user_move: "action_only",
      sayaka_want: "공원을 걷고 싶다",
      sayaka_goal: "공원에서 산책한다",
      sayaka_position: "학교 앞 공원",
      scene_location: "학교 앞 공원",
      segments: [{ kind: "narration", text: "사야카는 나츠키 옆에서 학교 앞 공원에 도착한다." },
                 { kind: "dialogue", text: "그래서. 여기서 뭐 할 건데." }],
    });
    const llm = new FakeLlm().push(first, turn({ action_intent: "reply",
      segments: [{ kind: "dialogue", text: "그냥 돌아다녀." }] }));
    const { db, service, repo } = await makeService({ llm });
    dbs.push(db);
    const created = await service.createChat("integration-user", "quiet_v030");
    expect((await repo.getChat("integration-user", created.chat.id))?.prompt_version).toBe(PROMPT_VERSION);
    await service.sendMessage({
      ownerId: "integration-user", chatId: created.chat.id,
      text: "(나는 사야카와 함께 공원까지 걸어가 도착한다.)", clientRequestId: rid(), admin: false,
    });
    let state = await repo.loadState(created.chat.id);
    expect(state.scene.location).toBe("학교 앞 공원");
    expect(state.memories.some(m => m.kind === "observed_event" && m.text.includes("공원"))).toBe(true);

    await service.sendMessage({
      ownerId: "integration-user", chatId: created.chat.id, text: "공원 좋아해?",
      clientRequestId: rid(), admin: false,
    });
    state = await repo.loadState(created.chat.id);
    expect(state.scene.location).toBe("학교 앞 공원");
    expect(llm.lastPromptText()).toContain("시간·장소: 방과 후 · 학교 앞 공원");
  });

  it("실제로 한 호감 표현은 주장으로 저장되고 사야카의 신뢰에는 영향이 없다", async () => {
    const { db, service, repo } = await makeService({
      llm: new FakeLlm().push(turn({
        user_move: "compliment", emotion: "uncertain", emotion_cause: "갑자기 고백을 들었다",
        action_intent: "partial_reply", sayaka_want: "갑작스러운 말을 경계한다",
        segments: [{ kind: "dialogue", text: "뭐? 너, 나 제대로 알지도 못하잖아." }],
        memory_candidates: [],
      })),
    });
    dbs.push(db);
    const { chat } = await service.createChat("claim-user", "quiet_v030");
    await service.sendMessage({
      ownerId: "claim-user", chatId: chat.id,
      text: "나는 사야카를 좋아해", clientRequestId: rid(), admin: false,
    });
    const state = await repo.loadState(chat.id);
    expect(state.memories.some(m => m.kind === "user_claim" && m.text.includes("사야카를 좋아"))).toBe(true);
    expect(state.relationship.trust).toBe(0);
  });
});
