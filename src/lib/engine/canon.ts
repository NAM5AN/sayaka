import registryJson from "../../../data/lore_registry.json";
import canonJson from "../../../data/character_canon.json";
import openingsJson from "../../../data/openings.json";
import type { Emotion, SceneState, Segment, RelationshipState } from "./types";

export const PROMPT_VERSION = "web-0.1.0+plugin-v0.2.0-fidelity-fullcanon-voice-v2-autonomy-v1";
export const CHARACTER_VERSION: string = (canonJson as { canonical_version: string }).canonical_version;

export type Tier = "A" | "B" | "C" | "D";
export type RuntimeSend = "fact_and_projection" | "projection_only" | "gated_fact" | "never";

export interface LoreEntry {
  id: string;
  canon_status: string;
  visibility_tier: Tier;
  known_to_character: boolean;
  time_scope: string;
  tags: string[];
  fact: string;
  behavioral_projection: string;
  release_policy: string;
  runtime: {
    send: RuntimeSend;
    projection?: string;
    redacted?: string;
    min_trust?: number;
    evidence?: string[];
    leak_group?: string;
  };
  source?: string;
}

export interface LeakGuards {
  family_secret_terms: string[];
  unknown_figure_terms: string[];
  meta_terms: string[];
  future_terms: string[];
}

interface Registry {
  registry_version: string;
  entries: LoreEntry[];
  leak_guards: LeakGuards;
}

const registry = registryJson as unknown as Registry;

export const LORE: LoreEntry[] = registry.entries;
export const LEAK_GUARDS: LeakGuards = registry.leak_guards;
export const LORE_REGISTRY_VERSION = registry.registry_version;

/** 모델이 disclosure_ids 로 제안할 수 있는 B 등급 id */
export const DISCLOSABLE_IDS: string[] = LORE.filter((e) => e.visibility_tier === "B" && e.runtime.send === "gated_fact").map((e) => e.id);

export function loreById(id: string): LoreEntry | undefined {
  return LORE.find((e) => e.id === id);
}

export interface Opening {
  id: string;
  label: string;
  description: string;
  segments: Segment[];
  scene: { noticed_user: boolean; current_action: string; emotion: Emotion };
}

export const OPENINGS: Opening[] = (openingsJson as unknown as { openings: Opening[] }).openings;
export const DEFAULT_OPENING_ID = "official_v030";

export function getOpening(id: string | null | undefined): Opening {
  return OPENINGS.find((o) => o.id === id) ?? OPENINGS.find((o) => o.id === DEFAULT_OPENING_ID)!;
}

/** 초면 장면 상태 (handoff initial_scene_state.json 기준) */
export function initialScene(opening: Opening): SceneState {
  return {
    version: 1,
    scenario: "first_meeting_after_school",
    time_label: "방과 후",
    real_time: { enabled: false, anchor_at: null },
    location: "학교 복도",
    sayaka: {
      present: true,
      position: "창가 꽃병 앞",
      goal: "꽃병과 꽃을 살펴본다",
      current_action: opening.scene.current_action,
      activity: null,
      last_activity_outcome: "",
      emotion: opening.scene.emotion,
      noticed_user: opening.scene.noticed_user,
    },
    kinchaku_open: false,
    items: {
      vase: { location: "windowsill", shown_to_user: true },
      kinchaku: { location: "on_sayaka_person", shown_to_user: false },
      pocket_watch: { location: "inside_kinchaku", shown_to_user: false },
      mychew: { location: "in_sayaka_bag", shown_to_user: false },
      lacquer_comb: { location: "in_sayaka_bag", shown_to_user: false },
      urushi_pen: { location: "in_sayaka_bag", shown_to_user: false },
    },
  };
}

export function initialRelationship(): RelationshipState {
  return {
    wariness: 3,
    curiosity: 2,
    annoyance: 0,
    trust: 0,
    stage: "strangers",
    user_name: null,
    last_trust_up_turn: -100,
    last_wariness_down_turn: -100,
    history: [],
  };
}
