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

/** Keep an offscreen destination only when Sayaka visibly departed that way. */
export function groundedSayakaDeparture(position: string, segments: Segment[]): boolean {
  const pos = position.trim();
  if (!pos || pos === "자리를 떠남") return false;
  const narration = segments.filter((s) => s.kind === "narration").map((s) => s.text).join(" ");
  if (!/(?:사야카|소녀|그녀).{0,100}(?:걸어|달려|뛰어|나서|나가|나왔|떠나|들어가|도착)/.test(narration)) return false;
  const words = (pos.match(/[가-힣A-Za-z]{2,}/g) ?? [])
    .filter((word) => !["학교", "그쪽", "방향", "중인", "가는", "도착", "근처", "앞쪽", "쪽으로"].includes(word));
  if (!words.some((word) => narration.includes(word))) return false;
  // "공원에 간다" is not the same as having arrived at the park.
  const enRoute = /(?:가는 중|향하는 중|방향|쪽으로)/.test(pos);
  return enRoute || /(?:도착|들어서|들어갔|나왔|나선다|나섰|앞에\s*섰|입구에\s*섰)/.test(narration);
}

/** User may catch up to Sayaka after she voluntarily left the shared scene. */
export function userCatchesUpToSayaka(userText: string, segments: Segment[], knownPosition: string): boolean {
  if (!knownPosition || knownPosition === "자리를 떠남") return false;
  const movingPlayer = /(?:나는|난|내가|나도|사야카를\s*따라|그녀를\s*따라|^\s*[(（]\s*따라).{0,100}(?:따라|쫓아|걸어|뛰어|도착|들어간|나간|나온)/.test(userText);
  if (!movingPlayer) return false;
  const narration = segments.filter((s) => s.kind === "narration").map((s) => s.text).join(" ");
  const sayakaVisible = /(?:사야카|소녀|그녀).{0,100}(?:서\s*있|기다리|눈에\s*들어|보인다|보였|발견|마주치)/.test(narration);
  if (!sayakaVisible) return false;
  const tokens = (knownPosition.match(/[가-힣A-Za-z]{2,}/g) ?? [])
    .filter((word) => !["학교", "밖으로", "방향", "가는", "중인", "근처", "앞쪽"].includes(word));
  return tokens.some((word) => narration.includes(word));
}

/**
 * Scene.location is always the location the *player can observe*, even when
 * Sayaka is elsewhere. Only the player's own completed physical movement
 * can change that location. No assistant-authored player action is evidence.
 */
/**
 * Interpret movement from the player's own narrated actions, not an arbitrary
 * destination suggested by the model. A quotation, a proposed trip and an
 * instruction about Sayaka's actions cannot move the player's viewpoint.
 *
 * The movement verbs are only a grammatical signal. There is deliberately no
 * allow-list of destinations: locations are grounded by words in the player's
 * own narration.
 */
function playerActionClauses(text: string): string[] {
  const actions = Array.from(text.matchAll(/[(（]([^()（）]{1,350})[)）]/g), (match) => match[1].trim())
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?。？！])\s*/).map((clause) => clause.trim()).filter(Boolean));
  const spoken = text.replace(/[(（][^()（）]*[)）]/g, " ").split(/[.!?。\n]/)
    .map((part) => part.trim())
    .filter((part) => /(?:^|[\s,，])(?:나는|난|내가|나도|우리는|우리도|둘이서|사야카를\s*따라|그녀를\s*따라)/.test(part));
  return [...actions, ...spoken].filter((part) => {
    if (!part || /^["“'「]/.test(part)) return false;
    // "사야카를 따라" makes Sayaka the object of the player's movement;
    // "사야카는 걸어간다" cannot make that movement the player's.
    if (/^(?:사야카|그녀|소녀|다른\s*학생|그\s*학생)(?:는|가|의)(?:\s|[,，])/.test(part)) return false;
    return true;
  });
}

const COMPLETED_PLAYER_MOVE =
  /(?:걸어\s*(?:가|왔|나가|들어가|내려가|올라가)|걸어가|걸어왔|걷다|걷는다|걷기\s*시작|뛰어(?:가|왔)|따라(?:가|갔|왔)|쫓아(?:가|갔)|내려(?:가|갔|간|와)|올라(?:가|갔|간|와)|계단(?:을|으로)?\s*내려|계단(?:을|으로)?\s*올라|도착(?:했|한다|하여|해서|해|한)|들어(?:간|갔|간다|섰|서|선다)|나(?:왔|간다|갔|섰|선다)|이동(?:했|한다)|발(?:을)?\s*(?:들여|들였)|(?:문|입구)\s*앞에\s*(?:선다|섰|서서|도착)|문(?:을)?\s*열고\s*(?:안(?:으로)?\s*들어|들어서))/;

function locationAnchors(place: string): string[] {
  return (place.match(/[가-힣A-Za-z0-9]{2,}/g) ?? [])
    .filter((word) => !["학교", "동네", "근처", "주변", "바로", "여기", "저기", "안쪽", "앞쪽", "문앞", "입구", "방향"].includes(word));
}

/** The model may propose a destination, but the user must author the trip. */
export function groundedPlayerMove(userText: string, nextLocation: string): boolean {
  const target = nextLocation.trim();
  if (!target || target.length > 80 || /[\n\r]/.test(target)) return false;
  const anchors = locationAnchors(target);
  if (!anchors.length) return false;
  const authored = playerAuthoredDestination(userText);
  // Reaching the threshold is not an entry to the interior.
  if (authored && /(?:문\s*앞|입구)/.test(authored)
    && !/(?:문\s*앞|입구)/.test(target)) return false;
  if (!authored && playerActionClauses(userText).some(uncompletedMovement)) return false;
  return playerActionClauses(userText).some((action) =>
    COMPLETED_PLAYER_MOVE.test(action)
    && !uncompletedMovement(action)
    && anchors.some((word) => action.includes(word))
    && !/(?:가려고만|가고\s*싶|갈\s*예정|도착하려다|가볼까|간다고\s*했)/.test(action));
}

/**
 * Recover an explicit arrival from the player's own narration even if the
 * model forgot scene_location. It never guesses a new location from a desire.
 */
/** Negated or merely contemplated travel does not change physical position. */
function uncompletedMovement(clause: string): boolean {
  const joined = clause.replace(/\s+/g, "");
  return /(?:들어|도착|내려|올라|이동|따라|쫓아|걸어|발을들여).{0,16}?(?:지(?:는)?않|지못|지말|기만|려다|려고만)/.test(joined)
    || /(?:안|못)(?:들어가|도착|걸어가|따라가|나가|내려가|올라가)/.test(joined);
}

/**
 * Resolve the LAST completed player-authored destination in the message.
 * Segmenting actions by sentences makes "arrived at the door" independent
 * of the following "I have not entered" statement.
 */
export function playerAuthoredDestination(userText: string, fromLocation = ""): string | null {
  let confirmed: string | null = null;
  for (const action of playerActionClauses(userText)) {
    if (!COMPLETED_PLAYER_MOVE.test(action) || uncompletedMovement(action)) continue;

    const inside = action.match(/([가-힣A-Za-z0-9]{2,})\s*(?:안으로|안쪽으로|내부로|안에)\s*(?:발(?:을)?\s*들여|들어|걸어\s*들어|입장)/);
    if (inside && locationAnchors(inside[1]).length && !["열고", "열어", "문을", "닫고", "발을", "손을"].includes(inside[1])) {
      confirmed = inside[1];
      continue;
    }
    const doorway = action.match(/([가-힣A-Za-z0-9]{2,})\s*(?:문|출입문|입구)\s*앞에\s*(?:선다|섰|서서|도착)/);
    if (doorway) {
      confirmed = doorway[1] + " 문 앞";
      continue;
    }
    const at = action.match(/([가-힣A-Za-z0-9]{2,})(?:에|으로|까지)\s*(?:도착(?:했|한다|해서|한)|들어(?:갔|간다|선다)|걸어(?:갔|가)|뛰어(?:갔|가))/);
    if (at && locationAnchors(at[1]).length) {
      confirmed = at[1];
      continue;
    }

    // The actor can cross the same threshold in a subsequent sentence, or
    // from the already-grounded doorway stored in the scene.
    const threshold: string = confirmed || fromLocation;
    if (/(?:문을?\s*(?:열고|열어|밀어\s*열고))?.{0,30}(?:안으로\s*(?:들어가|들어서|걸어)|발(?:을)?\s*들여)/.test(action)
      && /(?:문\s*앞|입구)/.test(threshold)) {
      confirmed = threshold.replace(/\s*(?:문\s*앞|입구).*$/, "");
    }
  }
  return confirmed;
}

/**
 * Opening a door and looking inside creates a real line of sight, NOT an
 * automatic claim that the player walked into the building.
 */
export function playerOpensSightline(userText: string, knownPlace: string, fromLocation: string): boolean {
  if (!sameSpecificPlace(knownPlace, fromLocation)) return false;
  return playerActionClauses(userText).some((action) =>
    /(?:문|출입문|문짝)(?:을|를)?\s*(?:열고|열어|연다|열었다|밀어\s*열고|밀고)/.test(action)
    && /(?:안쪽|내부|안을|안으로|속)을?\s*(?:둘러보|들여다보|바라보|살펴보|보았다|본다)|(?:안쪽|내부|안을|속).{0,20}(?:둘러|살피|바라|본다)/.test(action));
}

/** Check location equivalence without making generic 'school' a match. */
export function sameSpecificPlace(a: string, b: string): boolean {
  if (!a || !b || a === "자리를 떠남" || b === "자리를 떠남") return false;
  const generic = new Set(["학교", "동네", "근처", "주변", "안쪽", "바깥", "바로", "방향", "가는", "중인", "교내"]);
  const aa = (a.match(/[가-힣A-Za-z]{2,}/g) ?? []).filter((w) => !generic.has(w));
  const bb = (b.match(/[가-힣A-Za-z]{2,}/g) ?? []).filter((w) => !generic.has(w));
  return aa.some((x) => bb.some((y) => x === y || (x.length >= 3 && y.includes(x)) || (y.length >= 3 && x.includes(y))));
}

/** A narrated direct encounter, with a grounded arrival or line of sight. */
export function groundedReunion(
  userText: string,
  nextPlayerLocation: string,
  sayakaLocation: string,
  segments: Segment[],
  previousPlayerLocation: string,
): boolean {
  if (sayakaActuallyReturned(segments)) return true;
  const spoken = segments.filter((s) => s.kind === "dialogue").map((s) => s.text).join(" ");
  const visible = segments.filter((s) => s.kind === "narration").map((s) => s.text).join(" ");
  const encounter = /(?:사야카|소녀|그녀).{0,90}(?:마주|눈에\s*들|보인다|발견|서\s*있|기다리|알아보|쳐다보|다가오|인사)|(?:마주\s*친|마주\s*쳤|발견했|보였).{0,60}(?:사야카|소녀|그녀)/.test(visible);
  if (/전화|문자|스피커|무전기/.test(spoken)) return false;
  const arrival = nextPlayerLocation !== previousPlayerLocation
    && groundedPlayerMove(userText, nextPlayerLocation)
    && sameSpecificPlace(nextPlayerLocation, sayakaLocation)
    // Merely standing outside a room does not reveal everything inside it.
    && !(/(?:문\s*앞|입구)/.test(nextPlayerLocation) && /(?:매점|실내|안쪽|내부)/.test(sayakaLocation));
  const sightline = playerOpensSightline(userText, sayakaLocation, previousPlayerLocation);
  // When the player can physically see the known location, Sayaka speaking
  // is itself a directly witnessed encounter. No prose-format requirement
  // to say "사야카가 서 있다" before a perfectly audible first sentence.
  // Unverified long-distance audio still cannot become a reunion.
  const groundedAccess = arrival || sightline;
  return groundedAccess && (encounter || spoken.trim().length > 0);
}
