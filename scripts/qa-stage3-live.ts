
import {randomUUID} from "node:crypto";
import {getServices} from "../src/lib/services";
import {Repo} from "../src/lib/db/repo";
import {SayakaService} from "../src/lib/engine/orchestrator";
import {createOpenAiClient,type LlmClient} from "../src/lib/engine/llm";
import {createModerator} from "../src/lib/engine/safety";
import {PROMPT_VERSION} from "../src/lib/engine/canon";
const KRW_USD=1332.2,BUDGET_KRW=350,MAX_CALLS=45,MAX_TURNS=25;
const meter={calls:0,turns:0,usd:0,input:0,cached:0,output:0};
const stories=[
{id:"personality",name:"성격·어휘·풍부한 행동지문",turns:[
"안녕.",
"(복도 창가를 지나가던 나는 멈춰 서서 네 옆에 놓인 꽃병을 잠깐 봤다가 다시 네 얼굴로 시선을 옮긴다.) 어, 너 카네코 맞지? 이렇게 마주친 건 처음인 것 같은데.",
"(가방에서 직접 만든 팝업 종이책을 꺼내 펼친다. 좁고 긴 종이 계단이 튀어나오지만 윗부분 한 칸이 비뚤어져 있고, 아무리 손으로 눌러도 한쪽으로 기울어진다. 잠깐 고개를 숙여 고쳐 보려다가 손을 멈춘다.) 어제 저녁 내내 붙잡고 있었는데 또 이 모양이야. 근데 아깝게 버리기 싫어서 자꾸 만지게 되네. 너도 보면 한쪽으로 쓰러진 거 같지 않아? 뭐가 잘못된 것 같아?",
"흥. 네가 더 잘 만들 자신은 있고?",
"(나는 종이책을 덮었다가 다시 열어 본다. 한쪽 끝이 심하게 구겨져 있어서 손톱으로 펴는데 생각보다 잘 안 된다.) 사실 오늘 발표 순서도 까먹어서 완전 망쳤어. 쓸데없이 위로받고 싶은 기분은 아닌데, 이거까지 망가지니까 좀 짜증나네. 사야카, 넌 내가 이런 걸로 속상해하는 게 바보 같아?",
"(나는 책을 무릎 위에 놓고 말없이 접힌 종이의 각도를 조금씩 바꿔 본다. 갑자기 계단이 이전보다 똑바로 서자 놀라서 고개를 든다.) 어, 잠깐. 이건 된 것 같은데? 더 건드리면 다시 망가질까 봐 손대기 무섭다."
]},
{id:"movement",name:"동선·재회·시점",turns:[
"나 배고파. 매점 갈래?",
"(벤치에 털썩 앉아 가방을 발치에 내려놓는다.) 네가 매점에 가고 싶으면 먼저 가. 나는 다리가 좀 아파서 여기서 쉬었다가 움직일래. 나 때문에 기다릴 필요는 없어.",
"(나는 벤치에 남아 공책을 펼치고 낙서를 한참 구경한다. 지우개가 떨어져 바닥을 구르자 몸을 숙여 주워 들고, 잠깐 창밖도 바라본다. 그동안 사야카를 따라가거나 부르지 않는다.)",
"(나는 벤치에서 일어나 가방을 어깨에 메고 복도를 따라 계단을 내려 매점 문 앞에 선다. 계단을 내려오는 동안 사야카의 모습을 볼 수 없어 뒤쪽 복도를 한 번 돌아봤지만, 다른 학생들만 지나갔다. 아직 매점 안에 들어가지는 않았다.) 여기가 매점 맞지?",
"(나는 매점 문을 열고 안쪽을 둘러본다. 진열대와 계산대가 있는 방향으로 고개를 돌린다.) 사야카, 혹시 여기 있어?",
"(나는 매점 안으로 발을 들여 문가에 서서 조용히 주변을 살펴본다. 사야카가 안에 있는지는 아직 확실하지 않다.) 나도 간식 하나 고르려고 왔는데, 뭐가 남았나?"
]},
{id:"family-memory",name:"가족·비밀·기억·장문",turns:[
"안녕. 내 이름은 리오야.",
"(복도 끝에서 다가오다가 손에 든 메모장을 펼쳐 봤다가 덮는다.) 오늘 아빠랑 좀 다퉜거든. 그래서 괜히 궁금해졌는데, 너는 엄마랑 아빠 좋아해?",
"그럼 네 아버지는 무슨 일 하셔? 아, 말하기 싫으면 말 안 해도 돼.",
"(벽에 기댄 채 휴대전화 화면을 껐다가 가방에 넣는다. 아버지랑 싸웠던 일이 계속 머릿속에 남아 있지만, 그 기분까지 사야카가 알아줘야 할 이유는 없다고 생각한다.) 사실 그냥 궁금해서 물어본 거였어. 네가 말하기 싫으면 더 캐묻진 않을게. 나는 누가 우리 집 일 물어보면 좀 귀찮거든. 너도 그럴 때 있어?",
"(주머니를 뒤적여 작은 종이 장식을 하나 꺼내 손바닥 위에 올린다. 장식은 값싼 색종이로 만들었지만 어젯밤 정성껏 접었다.) 이거 그냥 만든 건데, 네가 좋아할 것 같기도 해서. 꼭 받을 필요는 없어. 보고 싶으면 봐.",
"아까 내 이름이 뭐라고 했는지 기억해?",
"(나는 아직 건네지 않은 종이 장식을 주머니에 다시 넣고 복도 끝을 바라본다. 창문에 비친 그림자가 길어지고, 조금 전에 웃고 떠들던 아이들도 하나둘 사라졌다.) 처음엔 네가 좀 무서울 거라고 생각했는데, 아직 너를 어떤 애라고 확실히 알 수는 없겠네. 다음에 다시 만나면 그때도 너는 이런 식으로 말을 할까? 뭐, 그건 그때 보면 알겠지."
]}];
function guard(){if(meter.calls>=MAX_CALLS||meter.turns>=MAX_TURNS||meter.usd*KRW_USD>=BUDGET_KRW)throw Error("S3_BUDGET_STOP "+JSON.stringify(meter));}
async function run(){
 const {cfg,db}=await getServices();
 if(cfg.ai.mode!=="openai"||cfg.ai.model!=="gpt-6-luna"||!cfg.ai.apiKey||!cfg.db.url||!PROMPT_VERSION.endsWith("-actor-v2"))throw Error("S3_UNEXPECTED_CONFIG");
 const base=createOpenAiClient(cfg);
 const llm:LlmClient={kind:"openai",model:base.model,async generate(p,opts){
  guard();meter.calls++;const result=await base.generate(p,opts);
  const a=result.usage.inputTokens??0,b=result.usage.cachedTokens??0,c=result.usage.outputTokens??0;
  meter.input+=a;meter.cached+=b;meter.output+=c;meter.usd+=(Math.max(0,a-b)*.10+b*.01+c*.50)/1e6;
  console.log("QA_USAGE "+JSON.stringify({calls:meter.calls,turns:meter.turns,input:a,cached:b,output:c,krw:+(meter.usd*KRW_USD).toFixed(2)}));
  return result;
 }};
 const repo=new Repo(db),cfg2={...cfg,limits:{...cfg.limits,perMinute:120,perDay:10000}};
 const svc=new SayakaService({repo,cfg:cfg2,llm,moderator:createModerator(cfg)});
 const all:unknown[]=[];
 console.log("QA_START "+JSON.stringify({model:cfg.ai.model,prompt:PROMPT_VERSION,source:"stage3 isolated branch",maxKrw:BUDGET_KRW,maxTurns:MAX_TURNS,maxCalls:MAX_CALLS}));
 try{
  for(const s of stories){guard();
   const {chat}=await svc.createChat("owner","quiet_v030");
   const chatId=chat.id, title="🧪 S3 "+s.name+" (QA · 이어쓰기 금지)";
   console.log("QA_CHAT_START "+JSON.stringify({case:s.id,chatId,title,url:"https://sayaka-five.vercel.app/?chat="+chatId}));
   let ok=0,errors=0,branch="";
   for(let i=0;i<s.turns.length;i++){
    if(s.id==="movement"&&i===2){
     const current=await repo.loadState(chatId);
     if(current.scene.sayaka.present){branch="did_not_leave";console.log("QA_CONDITIONAL_STOP "+JSON.stringify({case:s.id,reason:branch}));break;}
    }
    const user=s.turns[i];
    try{guard();meter.turns++;
     const r=await svc.sendMessage({ownerId:"owner",chatId,text:user,clientRequestId:"s3-"+randomUUID(),admin:true});
     ok++;const d=r.diagnostics;
     console.log("QA_TURN "+JSON.stringify({case:s.id,turn:i+1,chatId,chars:user.length,length:user.length<70?"short":user.length<170?"medium":"long",
       user,reply:r.assistantMessage.body,source:r.assistantMessage.source,recovered:d?.recoveredPlayerView??false,issues:d?.issues,firstIssues:d?.firstAttemptIssues,
       corrections:d?.corrections,action:d?.actionIntent,emotion:d?.emotion,initiative:d?.initiativeMode}));
    }catch(e){errors++;console.log("QA_TURN_ERROR "+JSON.stringify({case:s.id,turn:i+1,chatId,chars:user.length,error:e instanceof Error?e.message:String(e),code:(e as any)?.code}));if(String(e).includes("S3_BUDGET_STOP"))throw e;}
   }
   await db.query("update sayaka.chats set title=$1,updated_at=now() where id=$2",[title,chatId]);
   const state=await repo.loadState(chatId);
   const summary={case:s.id,chatId,ok,errors,branch,position:state.scene.location,sayakaPresent:state.scene.sayaka.present,sayakaPosition:state.scene.sayaka.position};
   console.log("QA_CHAT_COMPLETE "+JSON.stringify(summary));all.push(summary);
  }
  console.log("QA_COMPLETE "+JSON.stringify({chats:all,usage:meter,krw:+(meter.usd*KRW_USD).toFixed(2)}));
 }finally{await db.close();}
}
if(process.env.VERCEL_ENV!=="production")console.log("QA_SKIP_PREVIEW");
else run().catch(e=>console.log("QA_FATAL "+(e instanceof Error?e.stack:String(e)))).finally(()=>{console.error("QA_DEPLOY_STOP: intentional failure; production alias unchanged.");process.exitCode=1;});
