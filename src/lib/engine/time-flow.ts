import type { SceneState } from "./types";

/**
 * Wall-clock mode is opt-in per chat.
 * This is a deferred catch-up hint, NOT a timer, worker, cron job,
 * background LLM action, or automatic change to private/offscreen lore.
 */
export function realTimeElapsedMinutes(scene: SceneState, now: Date = new Date()): number | null {
  const setting = scene.real_time;
  if (!setting?.enabled || !setting.anchor_at) return null;
  const anchor = Date.parse(setting.anchor_at);
  if (!Number.isFinite(anchor)) return null;
  const diff = now.getTime() - anchor;
  if (diff <= 0) return 0;
  return Math.min(30 * 24 * 60, Math.floor(diff / 60_000));
}

export function realTimePromptBlock(scene: SceneState, now: Date = new Date()): string | null {
  const elapsed = realTimeElapsedMinutes(scene, now);
  if (elapsed === null) return null;
  let duration: string;
  if (elapsed < 1) duration = "1분 미만";
  else if (elapsed < 60) duration = "약 " + elapsed + "분";
  else if (elapsed < 24 * 60) duration = "약 " + Math.floor(elapsed / 60) + "시간 " + (elapsed % 60) + "분";
  else if (elapsed >= 30 * 24 * 60) duration = "30일 이상 (표시 상한)";
  else duration = "약 " + Math.floor(elapsed / (24 * 60)) + "일 " + Math.floor((elapsed % (24 * 60)) / 60) + "시간";
  return [
    "# 현실 시간 흐름 (이 대화방에서만 ON)",
    "- 이전에 채팅에서 실제로 응답한 이후 현실에서 " + duration + "이 지났다.",
    "- ON 모드라도 백그라운드에서 모델을 호출하거나 실제 비공개 사건을 자동 생성하지 않는다. 다음 대화에서 시간 차이를 참고하기 위한 정보다.",
    "- 시간이 지났다는 사실만으로 사야카가 어디에 갔는지, 무엇을 했는지, 상대가 어떤 행동을 했는지 확정하지 않는다.",
    "- 사용자 캐릭터가 기다렸거나 따라왔다고 자동 가정하지 않는다. 사야카의 내면·관계·소지품·장소 상태도 근거 없이 바꾸지 않는다.",
    "- 이 정보는 내부 판단에만 사용하고, 시간 경과를 반드시 대사로 언급하거나 사건을 꾸며 넣지 않는다.",
  ].join("\n");
}

/** Called ONLY after successful generation, in the same DB state commit. */
export function resetRealTimeCheckpoint(scene: SceneState, now: Date = new Date()): void {
  if (scene.real_time?.enabled) {
    scene.real_time = { enabled: true, anchor_at: now.toISOString() };
  }
}
