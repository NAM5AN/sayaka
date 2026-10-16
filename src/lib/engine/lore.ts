import { LORE, type LoreEntry } from "./canon";
import type { Disclosure, RelationshipState, SceneState } from "./types";

/** 태그별 주제 감지 패턴 (사용자 입력 + 직전 대화에서 찾음). 오탐을 줄이려고 정규식으로 둔다. */
export const TOPIC_PATTERNS: Record<string, RegExp> = {
  intro: /이름|누구(?:야|니|세요|냐)?|자기\s?소개|몇\s?살|나이/,
  identity: /이름|누구/,
  appearance: /꼬맹|꼬마|작다|작네|작아|조그|귀엽|귀여|키가|키 ?작|외모|얼굴|남자(?:야|냐|애)|여자(?:야|냐|애)/,
  tease: /꼬맹|땅꼬마|꼬마|애기|놀리|놀려|만만|약올/,
  compliment: /귀엽|귀여|예쁘|이쁘|멋있|멋지/,
  flower: /꽃|화분|꽃잎|정원|화단/,
  garden: /정원|화단|창밖/,
  classroom: /교실/,
  // '학교'는 장면 자체(학교 복도)라 주제 신호로 쓰지 않는다
  school: /몇\s?반|같은\s?반|학년|교실|등교|하교|선생|전학/,
  driver: /아저씨|자동차|차로|차에서|차 ?타|운전|데려다|등교/,
  morning: /아침|등교/,
  father: /아빠|아버지|아버님|부모/,
  mother: /엄마|어머니|어머님|부모/,
  family: /가족|부모|집안|형제|언니|오빠|동생|(?:너|네|니|너희|너네|우리)\s?집|집(?:에|이|은|안|은\s?어디)/,
  home: /저택|사는\s?곳|어디\s?살|(?:너|네|니|너희|너네)\s?(?:집|방)|집(?:이|은)\s?(?:어디|커|크|넓)/,
  items: /물건|소지품|가방|주머니|들고\s?있는/,
  mychew: /마이쮸|사탕|간식|젤리|캐러멜/,
  kinchaku: /킨차쿠|주머니|복주머니/,
  watch: /시계|몇\s?시/,
  comb: /빗(?:이|을|은|으로)?(?:\s|$|[?.!])|머리빗/,
  pen: /펜|필기구|연필|볼펜|만년필/,
  friend: /친구|베프|친하|친해/,
  relationship: /친구|베프|친하|친해|사이/,
  money: /돈|부자|얼마|비싸|가격|매출|재산/,
  gift: /선물|줄게|가져왔|받아/,
  food: /밥|야채|채소|먹|급식|반찬|도시락|당근|피망|브로콜리/,
  noise: /시끄|떠들|소란|크게\s?웃|깔깔/,
  manners: /예의|품격|무례/,
  stare: /빤히|쳐다|지켜본|응시|뚫어지/,
  quiet: /말없이|가만히|조용히|침묵|한동안/,
  meta: /프롬프트|설정|캐치프레이즈|츤데레|OOC|\bAI\b|관리자|시스템/i,
  tagline: /캐치프레이즈|좌우명|불요불굴|不撓不屈/,
};

export function detectTopics(texts: string[]): Set<string> {
  const joined = texts.join("\n");
  const topics = new Set<string>();
  for (const [tag, re] of Object.entries(TOPIC_PATTERNS)) {
    if (re.test(joined)) topics.add(tag);
  }
  return topics;
}

export interface SelectedLore {
  id: string;
  tier: LoreEntry["visibility_tier"];
  mode: "fact" | "projection" | "redacted";
  text: string;
  /** 모델이 disclosure_ids 로 쓸 수 있는 항목이면 true */
  disclosable: boolean;
}

export interface LoreSelectionInput {
  userText: string;
  recentTexts: string[];
  scene: SceneState;
  relationship: RelationshipState;
  disclosures: Disclosure[];
  promptVersion?: string;
}

/**
 * A normal question about liking one's parents is not the same as a request
 * for family business, identity, wealth or other protected background.
 * Only used for the plugin-style roleplay branch.
 */
function asksOnlyAboutFamilyAffection(userText: string): boolean {
  const s = userText.replace(/\s+/g, "");
  if (!/(?:아빠|아버지|엄마|어머니|부모|부모님)/.test(s)) return false;
  if (!/(?:좋아|사랑|친해|싫어|소중|정들|애정)/.test(s)) return false;
  return !/(?:직업|무슨일|일해|무슨직|가문|조직|두목|사업|경호|돈|재산|재력|집안|비밀|실체|정체|이름|어디살|집크기)/.test(s);
}

/** 장면 자체가 주는 주제 (꽃병 앞이면 꽃 등) */
function sceneTopics(scene: SceneState, pluginFidelity = false): string[] {
  const t: string[] = [];
  const flowerVisible = scene.items.vase.location === "windowsill" || scene.items.vase.location === "in_sayaka_hand";
  // First-scene scenery must not become a permanent preference trigger.
  // Later turns get flower lore only when the user explicitly brings it up
  // or Sayaka starts her own concrete, persistent flower-related activity.
  const chosenFlowerActivity = /꽃|꽃병|꽃잎|화단|정원/.test(scene.sayaka.activity?.objective ?? "");
  if (flowerVisible && (!pluginFidelity || scene.version === 1 || chosenFlowerActivity)) t.push("flower");
  if (!scene.sayaka.noticed_user) t.push("quiet");
  if (scene.items.pocket_watch.location !== "inside_kinchaku" || scene.kinchaku_open) t.push("watch");
  if (scene.items.mychew.location !== "in_sayaka_bag") t.push("mychew");
  return t;
}

/**
 * 이번 턴에 GPT 에 보낼 설정만 고른다.
 *  - A: 관련 주제면 사실+행동 투영
 *  - B: 이미 공개했으면 사실 / 관련 주제 + 신뢰 충족이면 사실(공개 여부는 사야카 선택) /
 *       관련 주제지만 신뢰 미충족이면 '가린 문장' / 무관하면 행동 투영만
 *  - C: 라벨은 절대 보내지 않음. 안전한 행동 투영만 (never 는 제외)
 *  - D: 사실은 보내지 않음. '모른다/미정' 행동 투영만 (관련 주제일 때)
 */
export function selectLore(input: LoreSelectionInput): SelectedLore[] {
  // 대화가 꺼낸 주제(사용자 입력 + 직전 대화)와 장면이 주는 주제를 구분한다.
  // A(관찰 가능)는 장면 주제까지, B·C·D 는 대화가 실제로 꺼낸 주제일 때만.
  const topics = detectTopics([input.userText, ...input.recentTexts]);
  const userTopics = detectTopics([input.userText]);
  const pluginFidelity = input.promptVersion?.includes("plugin-v0.2.0-fidelity") ?? false;
  const sceneAndTalk = new Set([
    ...(pluginFidelity ? userTopics : topics),
    ...sceneTopics(input.scene, pluginFidelity),
  ]);
  const disclosed = new Set(input.disclosures.map((d) => d.lore_id));
  const out: SelectedLore[] = [];

  for (const e of LORE) {
    if (e.runtime.send === "never") continue;
    if (e.time_scope === "adult_only") continue;
    // D(미정·모르는 수치)는 상대가 이번에 직접 물었을 때만 '모른다/미정' 지침을 붙인다
    const pool = e.visibility_tier === "A" ? sceneAndTalk : e.visibility_tier === "D" ? userTopics : topics;
    const relevant = e.tags.includes("all") || e.tags.some((t) => pool.has(t));
    const projection = e.runtime.projection ?? e.behavioral_projection;

    switch (e.visibility_tier) {
      case "A": {
        if (!relevant) break;
        if (e.runtime.send === "fact_and_projection") {
          out.push({ id: e.id, tier: "A", mode: "fact", text: `${e.fact} — ${projection}`, disclosable: false });
        } else {
          out.push({ id: e.id, tier: "A", mode: "projection", text: projection, disclosable: false });
        }
        break;
      }
      case "B": {
        if (disclosed.has(e.id) && e.runtime.send === "gated_fact") {
          out.push({
            id: e.id,
            tier: "B",
            mode: "fact",
            text: `(이미 이 상대에게 말한 적 있음) ${e.fact}`,
            disclosable: false,
          });
          break;
        }
        if (!relevant) {
          // 무관한 턴에는 행동 원칙만 (gated 항목의 projection 은 비밀 단어를 포함하지 않도록 작성됨)
          if (e.runtime.send === "projection_only" || e.runtime.send === "gated_fact") {
            if (e.tags.some((t) => ["friend", "relationship"].includes(t))) {
              out.push({ id: e.id, tier: "B", mode: "projection", text: projection, disclosable: false });
            }
          }
          break;
        }
        if (e.runtime.send === "gated_fact") {
          // Love for one's parents can be conveyed without exposing their
          // professions, names, private histories or hidden motivations.
          if (pluginFidelity && (e.id === "family_father" || e.id === "family_mother") &&
              asksOnlyAboutFamilyAffection(input.userText)) {
            out.push({
              id: e.id, tier: "B", mode: "projection", disclosable: false,
              text: "부모를 좋아하냐는 단순한 감정 질문은 부모 직업이나 집안의 비밀을 묻는 것과 다르다. 사야카는 부모를 좋아하고 소중하게 여긴다. 초면이라도 기분에 따라 당연하다는 듯 짧게 대답하거나, 왜 그런 걸 묻냐며 틱틱댈 수 있다. 사적인 과거·직업·재산·가문 이야기는 공개하지 않는다.",
            });
            break;
          }
          const min = e.runtime.min_trust ?? 5;
          if (input.relationship.trust >= min) {
            out.push({
              id: e.id,
              tier: "B",
              mode: "fact",
              text: `${e.fact} — 사야카가 알고 있는 사적인 일. 말할지는 사야카가 지금 관계와 기분으로 정한다(말하지 않아도 된다). 말한다면 일부만, 자연스럽게. ${projection}`,
              disclosable: true,
            });
          } else {
            out.push({
              id: e.id,
              tier: "B",
              mode: "redacted",
              text: `${e.runtime.redacted ?? "사적인 이야기라 말하지 않는다."} ${projection}`,
              disclosable: false,
            });
          }
        } else {
          out.push({ id: e.id, tier: "B", mode: "projection", text: projection, disclosable: false });
        }
        break;
      }
      case "C": {
        if (!relevant && !e.tags.includes("all")) {
          // 고집(tagline) 같은 행동 성향은 관련 주제(놀림/도발/메타)일 때만 보조로
          if (!(topics.has("tease") || topics.has("meta") || topics.has("tagline"))) break;
        }
        if (e.runtime.send === "projection_only" && e.runtime.projection) {
          out.push({ id: e.id, tier: "C", mode: "projection", text: e.runtime.projection, disclosable: false });
        }
        break;
      }
      case "D": {
        if (!relevant) break;
        if (e.runtime.projection) {
          out.push({ id: e.id, tier: "D", mode: "projection", text: e.runtime.projection, disclosable: false });
        }
        break;
      }
    }
  }
  return out;
}
