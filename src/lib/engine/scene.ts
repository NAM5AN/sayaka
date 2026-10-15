import type { Segment } from "./types";

/**
 * Scene.location describes the location shared by both characters, not
 * Sayaka's independent position or a destination she merely suggested.
 * Only a *player-authored* physical action plus a compatible *model-authored*
 * Sayaka movement permits a shared scene transition.
 */
export function groundedSharedSceneMove(
  userText: string,
  nextLocation: string,
  segments: Segment[],
  sayakaPosition = "",
): boolean {
  const next = nextLocation.trim();
  if (!next || next.length > 80 || /[\n\r]/.test(next)) return false;

  // "Let's go", "we should go", or "(Sayaka is already at the park)" are
  // NOT player movement. A user must actually narrate their own movement.
  const playerSubject = /(?:^|[\s(])(?:나는|난|내가|나도|우리(?:는|가|도)?|둘이(?:서|는)?|같이|함께|사야카를\s*따라|그녀를\s*따라)/;
  const completedMove = /(?:걸어가|걸어왔|걸어나|걸어들어|걸어|걷는다|걷기\s*시작|따라간|따라가|따라왔|나섰|나선다|나왔다|나온다|나간다|들어갔|들어간다|도착했|도착한다|발을\s*들였|건넜|건넌다|이동했|이동한다|뛰어간|뛰어왔)/;
  // In this roleplay "(공원에 도착한다)" normally narrates the player's
  // own movement even when they omit "나는". Named third-person Sayaka
  // actions still cannot be used as proof that the user followed her.
  const implicitPlayerAction = /(?:^|\n)\s*[(（](?!\s*(?:사야카|그녀|소녀|누군가|다른\s*학생)(?:는|가|의))[^)）]{0,100}(?:도착했|도착한다|걸어가|걸어왔|따라가|따라왔|나왔다|나간다|들어갔|들어간다)[)）]/;
  if (!(playerSubject.test(userText) || implicitPlayerAction.test(userText)) || !completedMove.test(userText)) return false;

  // Explicitly writing only Sayaka's actions doesn't make them true.
  if (/^\s*\(?\s*사야카(?:는|가|를)/.test(userText)
    && !/(?:나는|난|내가|나도|우리는|우리도|둘이서|나는\s*사야카를\s*따라)/.test(userText)) {
    return false;
  }
  const narration = segments.filter((s) => s.kind === "narration").map((s) => s.text).join(" ");
  const ownMovement = /(?:사야카|소녀|그녀).{0,80}(?:걸어|걷|들어서|들어가|나서|나갔|나온|도착|따라갔|따라가|건너|뛰어)/;
  if (!ownMovement.test(narration)) return false;

  // A destination is confirmed by a place name and an arrival/entry, not
  // the intention to head there. School gate and park are distinct scenes.
  // No closed list of places: the story may move to a bookstore, arcade,
  // station, friend's home, festival, etc. Match the distinctive place phrase.
  const placeWords = next.match(/[가-힣A-Za-z]{2,}/g) ?? [];
  const generic = new Set(["학교", "바로", "근처", "앞쪽", "주변", "안쪽", "바깥", "우리", "동네"]);
  const distinct = placeWords.filter((w) => !generic.has(w));
  const destination = distinct.sort((a, b) => b.length - a.length)[0]
    ?? (next.includes("집") ? "집" : placeWords.sort((a, b) => b.length - a.length)[0]);
  if (!destination || !(narration.includes(destination) || sayakaPosition.includes(destination))) return false;

  const arrival = /(?:도착|들어섰|들어서|들어갔|들어간다|나왔|나온다|건넜|건넌다|발을\s*들였|안에\s*섰|입구에\s*섰|앞에\s*섰)/;
  return arrival.test(narration);
}

/** Sayaka can leave and return voluntarily, but cannot teleport back on "stays". */
export function sayakaActuallyReturned(segments: Segment[]): boolean {
  const narr = segments.filter((s) => s.kind === "narration").map((s) => s.text).join(" ");
  return /(?:사야카|소녀|그녀).{0,80}(?:돌아왔|되돌아왔|다시\s*돌아오|다시\s*나타나|나타났|다시\s*마주|다시\s*들어왔)/.test(narr);
}

/** Prevent player narration from directly overwriting Sayaka's emotions or consent. */
export function userForcesSayakaState(userText: string): boolean {
  return /사야카(?:는|가|의).{0,90}(?:호감도|친밀도|신뢰도|좋아하게\s*된다|사랑하게\s*된다|고백한다|고백했|친밀감을\s*느낀다|사랑을\s*느낀다|반드시\s*좋아|강한\s*호감)/.test(userText);
}
