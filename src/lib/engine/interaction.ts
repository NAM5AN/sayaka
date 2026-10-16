import type { TurnContext, UserMove } from "./types";

/** Player-to-Sayaka interaction semantics, not a list of preferred comebacks. */
export interface InteractionPressure {
  boundaryIntrusion: boolean;
  explicitProvocation: boolean;
  reason: "intrusive_gaze" | "unwanted_contact" | "verbal_provocation" | "ordinary";
}

const verbalRudeness = /(?:꼬맹|꼬마|멍청|바보|못생|만만|닥쳐|꺼져|약올리|시비|놀리|땅꼬마)/;
const forcedContact = /(?:붙잡|끌어|밀치|때리|뺨|발로\s*차|넘어뜨|후려|주먹|강제로|억지로)/;
const stareVerb = /(?:쳐다보|응시하|내려다보|노려보|빤히\s*보|뚫어지게\s*보)/;
const intrusive = /(?:빤히|계속|한동안|뚫어지게|대놓고|유심히|내려다보|얼굴\s*가까이)/;
const sayakaTarget = /(?:사야카|카네코|네\s*얼굴|너를|너의|네\s*쪽)/;
const otherTarget = /(?:꽃|화분|벽|노트|종이|시계|로봇|핸드폰|휴대폰|창문|천장|바닥|가방|책)(?:을|를|에|만)\s*[^.。!?]*?(?:쳐다보|응시|내려다보|바라보)/;

/**
 * A stare may be a direct boundary violation even when the model labels
 * the player input as "action_only". Purely observing an object is not.
 */
export function playerCrossesBoundary(text: string): InteractionPressure {
  const contact = forcedContact.test(text) && /(?:사야카|카네코|너|네\s*손|네\s*팔|손목|팔목)/.test(text);
  const invasiveLook = stareVerb.test(text) && intrusive.test(text)
    && (sayakaTarget.test(text) || /내려다보/.test(text)) && !otherTarget.test(text);
  if (contact) return { boundaryIntrusion: true, explicitProvocation: false, reason: "unwanted_contact" };
  if (invasiveLook) return { boundaryIntrusion: true, explicitProvocation: false, reason: "intrusive_gaze" };
  if (verbalRudeness.test(text)) return { boundaryIntrusion: false, explicitProvocation: true, reason: "verbal_provocation" };
  return { boundaryIntrusion: false, explicitProvocation: false, reason: "ordinary" };
}

export function isProvoked(ctx: Pick<TurnContext, "userText" | "history" | "relationship">, move: UserMove): boolean {
  if (move === "tease" || move === "provocation" || move === "command") return true;
  if (ctx.relationship.annoyance >= 3) return true;
  const recent = ctx.history.filter((m) => m.role === "user").slice(-3).map((m) => m.body);
  return [ctx.userText, ...recent].some((text) => {
    const hit = playerCrossesBoundary(text);
    return hit.boundaryIntrusion || hit.explicitProvocation;
  });
}
