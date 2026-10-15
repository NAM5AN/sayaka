import canon from "../../../../../data/character_canon.json";
import { json } from "@/lib/http";
import { guarded } from "@/lib/route-helpers";
import { CHARACTER_VERSION, LEAK_GUARDS, LORE, LORE_REGISTRY_VERSION, OPENINGS, PROMPT_VERSION } from "@/lib/engine/canon";
import { STABLE_INSTRUCTIONS } from "@/lib/engine/prompt";
import { turnJsonSchema } from "@/lib/engine/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 관리자용 읽기 전용 보기: 지금 서버에 들어 있는 캐릭터 정보·고정 지침·설정 등급표·첫 장면·출력 형식.
 * 제작자 메타(B/C/D 원문 포함)가 들어 있으므로 관리자 세션에만 준다. GPT 요청과는 무관한 화면용 응답.
 */
export async function GET(req: Request) {
  return guarded(
    req,
    async () =>
      json({
        versions: { character: CHARACTER_VERSION, prompt: PROMPT_VERSION, lore: LORE_REGISTRY_VERSION },
        instructions: STABLE_INSTRUCTIONS,
        canon,
        lore: LORE,
        leakGuards: LEAK_GUARDS,
        openings: OPENINGS,
        schema: turnJsonSchema(),
      }),
    { admin: true },
  );
}
