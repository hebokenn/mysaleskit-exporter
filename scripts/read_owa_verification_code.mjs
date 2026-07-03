import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { getMailAccount } from "./mysaleskit_credentials.mjs";

const execFileAsync = promisify(execFile);

const cwd = process.cwd();
const workDir = path.join(cwd, "work");
const debugDir = path.join(workDir, "owa-debug");
const account = await getMailAccount();
if (!account) {
  throw new Error("未配置邮箱账号。请先打开 app 的“配置邮箱”。");
}
const owaUsername = process.env.MYSK_OWA_USERNAME || account;
const owaUrl = process.env.MYSK_OWA_URL || "https://mail.aisidi.com/owa/";
const passwordService = process.env.MYSK_MAIL_PASSWORD_SERVICE || "mysaleskit-mail-password";
const headless = process.env.MYSK_OWA_HEADLESS !== "false";
const debug = process.env.MYSK_OWA_DEBUG === "1";
const waitSeconds = Number(process.env.MYSK_CODE_WAIT_SECONDS || "180");
const pollMs = Number(process.env.MYSK_CODE_POLL_MS || "10000");

const keywords = [
  "验证码",
  "二次认证",
  "身份验证",
  "IDaaS",
  "MyWorkbench",
  "verify",
  "verification",
  "code",
];

async function readKeychain(service, accountName) {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      accountName,
      "-w",
    ]);
    return stdout.trim();
  } catch {
    return "";
  }
}

function hasKeyword(text) {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function extractCode(text) {
  const compact = text.replace(/\s+/g, " ");
  const patterns = [
    /(?:验证码|校验码|动态码|认证码|verification code|verify code|code)[^\d]{0,40}(\d{6})/i,
    /(\d{6})[^\d]{0,40}(?:验证码|校验码|动态码|认证码|verification code|verify code|code)/i,
  ];
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match) return match[1];
  }
  if (hasKeyword(compact)) {
    const fallback = compact.match(/(?<!\d)\d{6}(?!\d)/);
    if (fallback) return fallback[0];
  }
  return "";
}

async function saveDebug(page, label) {
  if (!debug) return;
  await fs.mkdir(debugDir, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-");
  try {
    await fs.writeFile(path.join(debugDir, `${safeLabel}.html`), await page.content(), "utf8");
  } catch {
    // Page can be mid-navigation while debugging.
  }
  try {
    await page.screenshot({ path: path.join(debugDir, `${safeLabel}.png`), fullPage: true });
  } catch {
    // Page can be mid-navigation while debugging.
  }
}

async function fillFirst(page, selectors, value, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      await locator.fill(value);
      return;
    }
  }
  throw new Error(`没有找到 OWA ${label}输入框。`);
}

async function frameTexts(page) {
  const texts = [];
  for (const frame of page.frames()) {
    try {
      const body = frame.locator("body");
      if ((await body.count()) > 0) texts.push(await body.innerText({ timeout: 3000 }));
    } catch {
      // Ignore inaccessible or still-loading frames.
    }
  }
  return texts;
}

async function loginIfNeeded(page, password) {
  await page.goto(`${owaUrl}?layout=light`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .waitForSelector('#password, input[name="password"], input[type="password"]', { timeout: 15000 })
    .catch(() => {});
  await saveDebug(page, "01-login-page");

  const passwordInput = page.locator('#password, input[name="password"], input[type="password"]').first();
  if ((await passwordInput.count()) === 0) return;

  await fillFirst(
    page,
    ['#username', 'input[name="username"]', 'input[name="userName"]', 'input[name="UserName"]', 'input[type="text"]'],
    owaUsername,
    "账号",
  );
  await passwordInput.fill(password);

  await page
    .locator('input[name="forcedownlevel"]')
    .evaluate((el) => {
      el.value = "1";
    })
    .catch(() => {});

  await page
    .locator('input[name="flags"]')
    .evaluate((el) => {
      const current = Number.parseInt(el.value || "4", 10);
      el.value = String(current | 1);
    })
    .catch(() => {});

  const submitted = await page.evaluate(() => {
    const form = document.forms.logonForm || document.querySelector("form");
    if (!form) return false;
    HTMLFormElement.prototype.submit.call(form);
    return true;
  });
  if (!submitted) {
    await page
      .locator('input[type="submit"], button, text=/sign in|log in|登录/i')
      .first()
      .click({ timeout: 10000 });
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});

  await page.waitForTimeout(3000);
  await saveDebug(page, "02-after-login");

  const pageText = (await frameTexts(page)).join("\n");
  if (pageText.includes("The user name or password you entered isn't correct")) {
    throw new Error("OWA 登录失败：邮箱账号或密码不正确。");
  }
  if (await page.locator('#username, input[name="username"], input[type="password"]').count()) {
    throw new Error("OWA 登录后仍停留在登录页，可能需要域账号格式或邮箱策略限制。");
  }
}

async function findCodeInCurrentPage(page) {
  const texts = await frameTexts(page);
  for (const text of texts) {
    const code = extractCode(text);
    if (code) return code;
  }
  return "";
}

async function clickCandidateMessages(page) {
  const messageRows = await page.locator('a[onclick*="onClkRdMsg"]').evaluateAll((anchors) => {
    return anchors
      .map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        const row = anchor.closest("tr");
        const checkbox = row?.querySelector('input[name="chkmsg"]');
        return {
          subject: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
          id: checkbox?.value || "",
          rowText: (row?.textContent || anchor.textContent || "").replace(/\s+/g, " ").trim(),
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((item) => item.visible && item.subject && item.id);
  });

  for (const item of messageRows.filter((row) => hasKeyword(`${row.subject} ${row.rowText}`)).slice(0, 10)) {
    const itemUrl = new URL(owaUrl);
    itemUrl.search = `?ae=Item&t=IPM.Note&id=${encodeURIComponent(item.id)}&slUsng=0`;
    await page.goto(itemUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    await saveDebug(page, "03-candidate-message");
    const code = await findCodeInCurrentPage(page);
    if (code) return code;
    await page.goto(`${owaUrl}?layout=light`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  const selectors = [
    "a",
    "tr",
    '[role="option"]',
    '[role="listitem"]',
    ".lvHighlightAllClass",
    ".lvRow",
  ];
  const candidates = [];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 40);
    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      const text = await item.innerText({ timeout: 1000 }).catch(() => "");
      if (text && hasKeyword(text)) candidates.push(item);
    }
  }

  for (const item of candidates.slice(0, 10)) {
    await item.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await saveDebug(page, "03-candidate-message");
    const code = await findCodeInCurrentPage(page);
    if (code) return code;
  }
  return "";
}

async function pollForCode(page) {
  const deadline = Date.now() + waitSeconds * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    await page.goto(`${owaUrl}?layout=light`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);

    let code = await findCodeInCurrentPage(page);
    if (code) return { code, attempt };

    code = await clickCandidateMessages(page);
    if (code) return { code, attempt };

    await page.waitForTimeout(pollMs);
  }
  return { code: "", attempt };
}

await fs.mkdir(workDir, { recursive: true });

const password = process.env.MYSK_MAIL_PASSWORD || (await readKeychain(passwordService, account));
if (!password) {
  throw new Error("没有找到邮箱密码。请先运行 scripts/store_mail_password.sh 存入 Keychain。");
}

const profileDir = path.join(workDir, "owa-profile");
const context = await chromium.launchPersistentContext(profileDir, {
  headless,
  ignoreHTTPSErrors: true,
  viewport: { width: 1366, height: 900 },
});

try {
  const page = context.pages()[0] || (await context.newPage());
  await loginIfNeeded(page, password);
  const result = await pollForCode(page);
  if (!result.code) {
    await saveDebug(page, "99-no-code");
    throw new Error(`在 ${waitSeconds} 秒内没有从 OWA 邮箱页面识别到验证码邮件。`);
  }

  const output = {
    status: "ok",
    code: result.code,
    attempts: result.attempt,
    source: "owa",
  };
  await fs.writeFile(
    path.join(workDir, "latest_owa_code.json"),
    JSON.stringify({ ...output, code: "******" }, null, 2),
    "utf8",
  );
  const stdoutOutput =
    process.env.MYSK_OWA_RETURN_CODE === "1"
      ? output
      : { status: output.status, codeDetected: true, code: "******", attempts: output.attempts, source: output.source };
  console.log(JSON.stringify(stdoutOutput));
} finally {
  await context.close();
}
