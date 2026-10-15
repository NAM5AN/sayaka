// 설정: 캐릭터·지침 보기 모달, 비밀번호 변경 (서버: AI_MODE=stub APP_PASSWORD=play-1234 ADMIN_PASSWORD=admin-5678, :3100)
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.env.OUT ?? ".";
const results = [];
const ok = (name, cond) => results.push(`${cond ? "PASS" : "FAIL"} ${name}`);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const errors = [];

async function open(viewport, password) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.fill("#pw", password);
  await page.click("button[type=submit]");
  await page.waitForSelector(".side");
  return { ctx, page };
}

// 관리자: 보기 모달
{
  const { ctx, page } = await open({ width: 1280, height: 860 }, "admin-5678");
  if (await page.locator(".empty .primary").count()) {
    await page.click(".empty .primary");
    await page.click(".choice >> nth=0");
  }
  await page.waitForSelector(".turn-sayaka");
  await page.fill("#composer", "안녕");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".badge-stub");

  await page.click(".side-link");
  await page.waitForSelector(".btn-grid");
  ok("설정에 보기 버튼 6개 (대화방 열림)", (await page.locator(".tile-btn").count()) === 6);
  await page.screenshot({ path: `${OUT}/s1-settings-admin.png` });

  await page.click(".tile-btn:has-text('캐릭터 정보')");
  await page.waitForSelector(".v-section");
  ok("캐릭터 정보 모달", (await page.textContent(".viewer-body")).includes("카네코 사야카"));
  await page.screenshot({ path: `${OUT}/s2-character.png` });
  await page.keyboard.press("Escape");
  ok("Esc 는 보기 모달만 닫음", (await page.locator(".dialog.wide").count()) === 0 && (await page.locator(".btn-grid").count()) === 1);

  await page.click(".tile-btn:has-text('설정 등급표')");
  await page.waitForSelector(".lore-item");
  await page.click(".lore-item:has-text('family_father') summary");
  ok("등급표에 B 항목 가린 문장 표시", (await page.textContent(".lore-item[open]")).includes("신뢰 미달일 때"));
  await page.screenshot({ path: `${OUT}/s3-lore.png` });
  await page.click(".viewer-head .ghost-btn");

  await page.click(".tile-btn:has-text('고정 지침')");
  await page.waitForSelector(".v-text h4");
  ok("고정 지침 모달", (await page.textContent(".viewer-body")).includes("말보다 행동을 먼저"));
  await page.screenshot({ path: `${OUT}/s4-instructions.png` });
  await page.click(".viewer-head .ghost-btn");

  await page.click(".tile-btn:has-text('현재 상태 블록')");
  await page.waitForSelector(".viewer-body .v-text");
  ok("현재 상태 블록 미리보기", (await page.textContent(".viewer-body")).includes("현재 장면"));
  await page.screenshot({ path: `${OUT}/s5-preview.png` });
  await page.click(".viewer-head .ghost-btn");

  for (const k of ["첫 장면", "출력 형식"]) {
    await page.click(`.tile-btn:has-text('${k}')`);
    await page.waitForSelector(".viewer-body > *:not(.fineprint)");
    ok(`${k} 모달`, (await page.locator(".viewer-body").innerText()).length > 50);
    await page.click(".viewer-head .ghost-btn");
  }

  // 비밀번호 변경
  await page.click(".set-row .ghost-btn");
  await page.waitForSelector("#pw-title");
  await page.screenshot({ path: `${OUT}/s6-password.png` });
  const inputs = page.locator("form.dialog input[type=password]");
  await inputs.nth(0).fill("wrong-pass");
  await inputs.nth(1).fill("new-play-9999");
  await inputs.nth(2).fill("new-play-9999");
  await page.click("form.dialog button[type=submit]");
  await page.waitForSelector(".field-err");
  ok("틀린 현재 비밀번호 오류", (await page.textContent(".field-err")).includes("현재 비밀번호가 맞지 않아요"));
  await inputs.nth(0).fill("admin-5678");
  await page.click("form.dialog button[type=submit]");
  await page.waitForSelector("text=비밀번호를 바꿨어요");
  ok("비밀번호 변경 완료 안내", true);
  await page.click("form.dialog .primary");
  await page.reload();
  ok("변경 후 이 기기 로그인 유지", (await page.locator(".side").count()) === 1);
  await ctx.close();
}

// 새 비밀번호로 일반 로그인, 옛 비밀번호 실패, 일반 사용자에게 보기 버튼 없음
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.fill("#pw", "play-1234");
  await page.click("button[type=submit]");
  await page.waitForSelector(".err");
  ok("옛 접속 비밀번호 거부", true);
  await page.fill("#pw", "new-play-9999");
  await page.click("button[type=submit]");
  await page.waitForSelector(".side");
  await page.click(".menu-btn");
  await page.click(".side-link");
  await page.waitForSelector(".dialog");
  ok("일반 사용자: 보기 버튼 없음", (await page.locator(".tile-btn").count()) === 0);
  ok("일반 사용자: 비밀번호 변경 없음", (await page.locator(".set-row").count()) === 0);
  await page.screenshot({ path: `${OUT}/s7-settings-player-mobile.png` });
  const r = await page.evaluate(async () => (await fetch("/api/admin/config")).status);
  ok("일반 사용자 API 403", r === 403);
  await ctx.close();
}

// 모바일 관리자: 보기 모달 화면 안에 들어오는지
{
  const { ctx, page } = await open({ width: 375, height: 740 }, "admin-5678");
  await page.click(".menu-btn");
  await page.click(".side-link");
  await page.click(".tile-btn:has-text('설정 등급표')");
  await page.waitForSelector(".lore-item");
  const box = await page.locator(".dialog.wide").boundingBox();
  ok("모바일 보기 모달이 화면 안", box && box.x >= 0 && box.x + box.width <= 375 + 1 && box.y + box.height <= 740 + 1);
  await page.screenshot({ path: `${OUT}/s8-lore-mobile.png` });
  await ctx.close();
}

await browser.close();
console.log(results.join("\n"));
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "page errors: none");
