import {describe,expect,it} from "vitest";
import {groundedPlayerMove,playerAuthoredDestination,playerOpensSightline,groundedReunion} from "@/lib/engine/scene";
import {normalizeSegments,renderBody} from "@/lib/engine/format";
import {validateTurn} from "@/lib/engine/validate";
import {applyTurn} from "@/lib/engine/state";
import {ctxFor,turn} from "../helpers";
import {PROMPT_VERSION} from "@/lib/engine/canon";

describe("3단계: 실제 사용자 행동과 사야카 상태를 분리한다",()=>{
  it("문 앞에 선 실제 행동은 사용자 위치로 반영한다",()=>{
    const text="(나는 복도 벤치에서 일어나 천천히 계단을 내려 매점 문 앞에 선다.)";
    expect(groundedPlayerMove(text,"매점 문 앞")).toBe(true);
    expect(playerAuthoredDestination(text)).toBe("매점 문 앞");
    const ctx=ctxFor({promptVersion:PROMPT_VERSION,userText:text});
    ctx.scene.sayaka.present=false;
    ctx.scene.sayaka.position="학교 매점";
    ctx.scene.sayaka.offscreen={location:"학교 매점",carried:[],events:[]};
    const r=applyTurn(ctx,turn({scene_location:"",segments:[{kind:"narration",text:"학교 매점의 문 앞에 도착했다."}]}),[{kind:"narration",text:"주변은 조용하다."}]);
    expect(r.scene.location).toBe("매점 문 앞");
    expect(r.scene.sayaka.present).toBe(false);
  });
  it("문을 열어 들여다보면 보이는 사야카와 대화할 수 있지만 순간이동은 아니다",()=>{
    const text="(나는 매점 문을 열고 안쪽을 둘러본다.) 사야카, 여기 있어?";
    const segments=[{kind:"narration" as const,text:"사야카가 매점 계산대 앞에 서 있다."}];
    expect(groundedPlayerMove(text,"학교 매점")).toBe(false);
    expect(playerOpensSightline(text,"학교 매점","매점 문 앞")).toBe(true);
    expect(groundedReunion(text,"학교 매점","학교 매점",segments,"매점 문 앞")).toBe(true);
    expect(groundedReunion(text,"학교 매점","학교 매점",segments,"학교 복도")).toBe(false);
  });
  it("말로 목적지만 제안해도, 사야카가 움직인다고 적어도 사용자 이동이 아니다",()=>{
    expect(groundedPlayerMove("매점 갈까?","학교 매점")).toBe(false);
    expect(groundedPlayerMove("(사야카는 매점으로 걸어간다.)","학교 매점")).toBe(false);
    expect(groundedPlayerMove("(나는 꽃병을 빤히 쳐다본다.)","학교 매점")).toBe(false);
  });
  it("개인 공간을 침범한 시선은 원형 설정상 진짜 화나는 사건이다",()=>{
    const ctx=ctxFor({promptVersion:PROMPT_VERSION,userText:"(나는 사야카를 한동안 빤히 내려다본다.)"});
    const segments=[{kind:"dialogue" as const,text:"뭘 그렇게 봐?"}];
    const issues=validateTurn({ctx,turn:turn({user_move:"action_only",emotion:"angry",emotion_cause:"계속 내려다본다",segments}),segments,hadSpeakerLabel:false});
    expect(issues.some(x=>x.code==="unprovoked_anger")).toBe(false);
    ctx.userText="(나는 시계를 한동안 빤히 내려다본다.)";
    expect(validateTurn({ctx,turn:turn({user_move:"action_only",emotion:"angry",segments}),segments,hadSpeakerLabel:false})
      .some(x=>x.code==="unprovoked_anger")).toBe(true);
  });
  it("사야카의 실제 퇴장 지문과 모델의 잔류 상태가 모순되면 차단한다",()=>{
    const ctx=ctxFor({promptVersion:PROMPT_VERSION,userText:"빤히 쳐다본다"});
    const segments=[{kind:"narration" as const,text:"사야카는 복도 끝으로 걸어간다."}];
    const t=turn({action_intent:"leave",sayaka_present:"stays",segments});
    const issues=validateTurn({ctx,turn:t,segments,hadSpeakerLabel:false});
    expect(issues.some(i=>i.code==="scene_exit_mismatch"&&i.severity==="block")).toBe(true);
  });
});

describe("3단계: 지문 속 잘못 들어간 실제 대사는 분리한다",()=>{
  it("시도, 직접 발화, 후속 이동을 서로 다른 segment로 보존한다",()=>{
    const raw=[{kind:"narration" as const,text:'(사야카는 가방 끈을 고쳐 메고 등을 돌린다. "나 간다." 복도 끝으로 걸어간다.)'}];
    const s=normalizeSegments(raw).segments;
    expect(s.map(x=>x.kind)).toEqual(["narration","dialogue","narration"]);
    expect(s[1].text).toBe("나 간다.");
    const body=renderBody(s);
    expect(body).toContain('"나 간다."');
    expect(body).not.toContain('("나 간다.")');
  });
  it("인용한 물건 이름은 직접 발화로 오인하지 않는다",()=>{
    const s=normalizeSegments([{kind:"narration",text:'사야카는 "마이쮸"를 책상 위에 올려놓는다.'}]).segments;
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe("narration");
  });
});
