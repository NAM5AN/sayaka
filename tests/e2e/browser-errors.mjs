import { chromium } from "playwright-core";
const OUT = process.env.OUT ?? ".";
const results = [];
const ok = (name, cond) => results.push(`${cond ? "PASS" : "FAIL"} ${name}`);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });

// 1) 시간 초과 → 배너 + 같은 요청 ID 로 다시 보내기
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3101");
  await page.fill("#pw", "play-1234");
  await page.click("button[type=submit]");
  await page.waitForSelector(".side");
  await page.click(".side-new");
  await page.click(".choice >> nth=0");
  await page.waitForSelector(".turn-sayaka");
  const sentBodies = [];
  page.on("request", (r) => {
    if (r.url().includes("/messages")) sentBodies.push(JSON.parse(r.postData()));
  });
  await page.fill("#composer", "느리게 대답해 봐");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".banner.error", { timeout: 60000 });
  ok("시간 초과 오류 배너", (await page.textContent(".banner.error")).includes("너무 오래"));
  ok("실패 시 입력 내용 보존", (await page.inputValue("#composer")) === "느리게 대답해 봐");
  ok("실패한 메시지는 대화에 남지 않음", (await page.locator(".turn-user").count()) === 0);
  await page.screenshot({ path: `${OUT}/10-timeout-banner.png` });
  await page.click(".banner button:has-text('다시 보내기')");
  await page.waitForSelector(".turn-user", { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll(".turn-sayaka").length >= 2, null, { timeout: 60000 });
  ok("다시 보내기 성공", (await page.locator(".turn-sayaka").count()) === 2);
  ok("재전송은 같은 요청 ID", sentBodies.length === 2 && sentBodies[0].clientRequestId === sentBodies[1].clientRequestId);
  await page.screenshot({ path: `${OUT}/11-after-retry.png` });
  await ctx.close();
}

// 2) API 키 미설정 서버
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3102");
  await page.waitForSelector(".side");
  await page.click(".empty .primary");
  await page.click(".choice >> nth=0");
  await page.waitForSelector(".banner.info");
  ok("키 미설정 안내 배너", (await page.textContent(".banner.info")).includes("OPENAI_API_KEY"));
  await page.fill("#composer", "안녕");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".banner.info")?.textContent?.includes("응답을 만들 수 없어요") && !document.querySelector(".typing"), null, { timeout: 60000 });
  ok("키 미설정 시 전송하면 안내 오류", true);
  ok("키 미설정 시 가짜 응답 없음", (await page.locator(".turn-sayaka").count()) === 1 && (await page.locator(".turn-user").count()) === 0);
  ok("키 미설정 시 입력 내용 보존", (await page.inputValue("#composer")) === "안녕");
  await page.screenshot({ path: `${OUT}/12-no-key-mobile.png` });
  await ctx.close();
}
await browser.close();
console.log(results.join("\n"));
