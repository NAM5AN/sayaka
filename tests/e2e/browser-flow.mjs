import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.env.OUT ?? ".";
const results = [];
const ok = (name, cond) => {
  results.push(`${cond ? "PASS" : "FAIL"} ${name}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] }).catch(async () => chromium.launch());
const consoleErrors = [];

async function session(viewport, name, password) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "ko-KR" });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text())) consoleErrors.push(`${name}: ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${name} pageerror: ${e.message}`));
  await page.goto(BASE);
  return { ctx, page };
}

// ── 데스크톱 (관리자) ──
{
  const { ctx, page } = await session({ width: 1360, height: 860 }, "desktop");
  await page.screenshot({ path: `${OUT}/01-login.png` });
  await page.fill("#pw", "wrong");
  await page.click("button[type=submit]");
  await page.waitForSelector(".err");
  ok("틀린 비밀번호 오류 표시", (await page.textContent(".err")).includes("맞지 않아요"));
  await page.fill("#pw", "admin-5678");
  await page.click("button[type=submit]");
  await page.waitForSelector(".side");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/02-empty.png` });

  await page.click(".side-new");
  await page.waitForSelector(".dialog");
  await page.screenshot({ path: `${OUT}/03-new-dialog.png` });
  await page.click(".choice >> nth=0");
  await page.waitForSelector(".turn-sayaka");
  ok("공식 시작문 표시", (await page.textContent(".turn-sayaka")).includes("누가 여기다 갖다 놓은 건지 알아?"));

  // IME 조합 중 Enter 는 전송 안 됨 (isComposing 시뮬레이션은 어려워 Shift+Enter 줄바꿈만 확인)
  await page.click("#composer");
  await page.keyboard.type("아니 난 모르지;");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("(꽃병을 슬쩍 본다)");
  ok("Shift+Enter 줄바꿈", (await page.inputValue("#composer")).includes("\n"));
  await page.keyboard.press("Enter");
  await page.waitForSelector(".badge-stub");
  ok("스텁 응답은 '실제 AI 아님' 배지", (await page.textContent(".badge-stub")).includes("실제 AI 응답 아님"));
  ok("사용자 입력 지문 옅게 표시", (await page.locator(".note .act").count()) >= 1);
  await page.fill("#composer", "너 누구야?");
  await page.click(".primary:has-text('보내기')");
  await page.waitForFunction(() => document.querySelectorAll(".turn-sayaka").length >= 3);
  await page.click(".tool-btn:has-text('진단') >> nth=-1");
  await page.waitForSelector(".diag");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04-chat-desktop.png` });
  await page.click(".ghost-btn:has-text('상태')");
  await page.waitForSelector(".sheet");
  await page.screenshot({ path: `${OUT}/05-state-sheet.png` });
  await page.keyboard.press("Escape");

  // 새로고침 후 복원
  await page.reload();
  await page.waitForSelector(".turn-user");
  ok("새로고침 후 대화 복원", (await page.locator(".turn-user").count()) === 2);
  ok("대화 제목 = 첫 메시지", (await page.textContent(".topbar-title h2")).startsWith("아니 난 모르지"));

  // 설정
  await page.click(".side-link");
  await page.waitForSelector(".dialog");
  await page.screenshot({ path: `${OUT}/06-settings.png` });
  await page.keyboard.press("Escape");

  // 삭제 확인
  await page.hover(".chat-item.active");
  await page.click(".chat-item.active .chat-del");
  await page.waitForSelector("[role=alertdialog]");
  await page.screenshot({ path: `${OUT}/07-delete-confirm.png` });
  await page.click(".danger:has-text('삭제')");
  await page.waitForSelector(".empty");
  ok("삭제 후 빈 화면", true);
  await ctx.close();
}

// ── 모바일 (일반 사용자) ──
{
  const { ctx, page } = await session({ width: 375, height: 740 }, "mobile");
  await page.fill("#pw", "play-1234");
  await page.click("button[type=submit]");
  await page.waitForSelector(".empty");
  await page.click(".empty .primary");
  await page.click(".choice >> nth=1");
  await page.waitForSelector(".turn-sayaka");
  ok("조용한 시작문", (await page.textContent(".turn-sayaka")).includes("유심히 들여다보고 있다"));
  await page.fill("#composer", "(한동안 말없이 함께 꽃을 바라본다)");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".badge-stub");
  ok("일반 사용자에게 진단 버튼 없음", (await page.locator(".tool-btn:has-text('진단')").count()) === 0);
  ok("일반 사용자에게 상태 버튼 없음", (await page.locator(".ghost-btn:has-text('상태')").count()) === 0);
  const composerBox = await page.locator(".composer").boundingBox();
  ok("모바일에서 입력창이 화면 안", composerBox && composerBox.y + composerBox.height <= 740 + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok("모바일 가로 스크롤 없음", !overflow);
  await page.screenshot({ path: `${OUT}/08-mobile-chat.png` });
  await page.click(".menu-btn");
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/09-mobile-drawer.png` });
  await ctx.close();
}

// ── API 직접: 출처 없는 변경 요청 거부 ──
{
  const r = await fetch(`${BASE}/api/chats`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  ok("로그인 없는 API 401", r.status === 401);
}

await browser.close();
console.log(results.join("\n"));
console.log(consoleErrors.length ? `CONSOLE ERRORS:\n${consoleErrors.join("\n")}` : "console errors: none");
