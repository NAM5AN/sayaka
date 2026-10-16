import { afterAll, describe, expect, it } from "vitest";
import { FakeLlm, makeService, rid, turn } from "../helpers";
import type { Db } from "@/lib/db";
import { PROMPT_VERSION } from "@/lib/engine/canon";

const dbs: Db[] = [];
afterAll(async () => { for (const db of dbs) await db.close().catch(() => undefined); });

const sayaka = (text: string) => [{ kind: "narration" as const, text }];
const words = (text: string) => [{ kind: "dialogue" as const, text }];
const initiative = (mode: "none" | "start" | "advance" | "wait" | "complete" | "abandon" | "moment",
  objective: string, next_step: string, evidence: string) =>
  ({ mode, objective, next_step, evidence });

describe("실제 대화방: 사야카가 자기 일을 시작하고 이어가기", () => {
  it("스스로 선택 → 실제 이동 → 대기 → 포기를 4턴에 걸쳐 지속하며 사용자 이동은 확정하지 않는다", async () => {
    const llm = new FakeLlm().push(
      turn({
        user_move: "request", action_intent: "intervene",
        initiative: initiative("start", "학교 앞 공원에 가 본다", "학교 정문까지 걸어간다", "사야카는 학교 출입구 쪽으로 걸어간다."),
        sayaka_position: "학교 출입구 앞",
        segments: [...sayaka("사야카는 학교 출입구 쪽으로 걸어간다."), ...words("가려면 와. 난 먼저 가.")],
      }),
      turn({
        user_move: "small_talk", action_intent: "intervene",
        initiative: initiative("advance", "", "정문까지 혼자 걸어간다", "사야카가 직접 복도 끝 문을 밀고 나선다."),
        sayaka_position: "학교 현관 앞",
        segments: sayaka("사야카가 직접 복도 끝 문을 밀고 나선다."),
      }),
      turn({
        user_move: "question_about_sayaka", action_intent: "observe",
        initiative: initiative("wait", "", "상대가 함께 움직일지 기다렸다가 판단한다", ""),
        segments: [...sayaka("사야카가 현관 앞에서 가방 끈을 고쳐 멘다."), ...words("……그래서 안 올 거야?")],
      }),
      turn({
        user_move: "other", action_intent: "refuse",
        initiative: initiative("abandon", "", "", "됐어. 오늘은 공원 안 가."),
        segments: words("됐어. 오늘은 공원 안 가."),
      }),
    );
    const { db, repo, service } = await makeService({ llm });
    dbs.push(db);
    const owner = "actor-ongoing-owner";
    const created = await service.createChat(owner, "quiet_v030");
    expect((await repo.getChat(owner, created.chat.id))?.prompt_version).toBe(PROMPT_VERSION);
    const texts = ["놀러 나가자", "그럼 가면서 정해", "그렇게 꼭 가고 싶어?", "나는 오늘 안 갈래"];

    for (let i = 0; i < 4; i++) {
      await service.sendMessage({ ownerId: owner, chatId: created.chat.id, text: texts[i], clientRequestId: rid(), admin: false });
      const st = await repo.loadState(created.chat.id);
      if (i === 0) {
        expect(st.scene.sayaka.activity?.objective).toContain("공원");
        expect(st.scene.sayaka.activity?.last_progress_turn).toBe(1);
        expect(st.scene.location).toBe("학교 복도");
      }
      if (i === 1) {
        expect(st.scene.sayaka.activity?.next_step).toContain("정문");
        expect(st.scene.sayaka.activity?.last_progress_turn).toBe(2);
        expect(st.scene.sayaka.position).toContain("현관");
        expect(st.scene.location).toBe("학교 복도");
      }
      if (i === 2) {
        expect(st.scene.sayaka.activity?.phase).toBe("waiting");
        expect(st.scene.location).toBe("학교 복도");
      }
      if (i === 3) {
        expect(st.scene.sayaka.activity).toBeNull();
        expect(st.scene.sayaka.last_activity_outcome).toContain("그만둠");
        expect(st.scene.location).toBe("학교 복도");
      }
    }
    expect(llm.prompts).toHaveLength(4);
    expect(llm.prompts[1].input.find((m) => m.role === "developer")?.content).toContain("다음에 사야카가 할 수 있는 구체적인 일: 학교 정문까지 걸어간다");
    expect(llm.prompts[2].input.find((m) => m.role === "developer")?.content).toContain("정문까지 혼자 걸어간다");
    const all = await repo.getMessages(created.chat.id);
    expect(all.filter((m) => m.role === "user")).toHaveLength(4);
  });

  it("두 채팅방의 개인 목표가 섞이지 않고 단발성 행동은 그 턴에서 끝난다", async () => {
    const llm = new FakeLlm().push(
      turn({ user_move: "small_talk", action_intent: "intervene",
        initiative: initiative("start", "책을 찾아본다", "책장을 넘겨 본다", "사야카가 책꽂이로 걸어간다."),
        segments: sayaka("사야카가 책꽂이로 걸어간다."),
      }),
      turn({ user_move: "small_talk", action_intent: "intervene",
        initiative: initiative("moment", "가방에서 공책 꺼내기", "", "사야카가 공책을 꺼내 펼친다."),
        segments: sayaka("사야카가 공책을 꺼내 펼친다."),
      }),
    );
    const { db, repo, service } = await makeService({ llm });
    dbs.push(db);
    const owner = "actor-isolated-owner";
    const a = await service.createChat(owner, "quiet_v030");
    const b = await service.createChat(owner, "quiet_v030");
    await service.sendMessage({ ownerId: owner, chatId: a.chat.id, text: "뭐 해?", clientRequestId: rid(), admin: false });
    await service.sendMessage({ ownerId: owner, chatId: b.chat.id, text: "하이", clientRequestId: rid(), admin: false });
    const aa = await repo.loadState(a.chat.id), bb = await repo.loadState(b.chat.id);
    expect(aa.scene.sayaka.activity?.objective).toContain("책");
    expect(bb.scene.sayaka.activity).toBeNull();
    expect(bb.scene.sayaka.last_activity_outcome).toContain("공책");
    expect(aa.scene.sayaka.last_activity_outcome).toBe("");
  });

  it("모델이 가짜 진행 증거를 제안하면 재생성하고 실행하지 않은 목표를 기록하지 않는다", async () => {
    const llm = new FakeLlm().push(
      turn({
        user_move: "small_talk", action_intent: "reply",
        initiative: initiative("start", "학교 매점에 가기", "계단으로 가기", "사야카가 매점으로 걸어간다."),
        segments: words("그래서?"),
      }),
      turn({
        user_move: "small_talk", action_intent: "reply",
        initiative: initiative("none", "", "", ""),
        segments: words("뭐. 난 별로 안 바빠."),
      }),
    );
    const { db, repo, service } = await makeService({ llm });
    dbs.push(db);
    const owner = "actor-retry-owner";
    const { chat } = await service.createChat(owner, "quiet_v030");
    await service.sendMessage({ ownerId: owner, chatId: chat.id, text: "하이. 뭐 해?", clientRequestId: rid(), admin: false });
    const scene = (await repo.loadState(chat.id)).scene;
    expect(scene.sayaka.activity).toBeNull();
    expect(llm.prompts).toHaveLength(2);
    expect(llm.lastPromptText()).toContain("실제 보이는 대사·지문에서 그대로 인용");
  });
});
