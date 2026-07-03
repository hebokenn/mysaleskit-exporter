import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { getPortalAccount } from "./mysaleskit_credentials.mjs";

const execFileAsync = promisify(execFile);

const cwd = process.cwd();
const workDir = path.join(cwd, "work");
const debugDir = path.join(workDir, "portal-debug");
const account = await getPortalAccount();
if (!account) {
  throw new Error("未配置 MyWorkbench 账号。请先打开 app 的“配置 MyWorkbench”。");
}
const workbenchLoginUrl =
  process.env.MYSK_WORKBENCH_LOGIN_URL ||
  process.env.MYSK_PORTAL_URL ||
  "https://login.myworkbench.com/login/page/index.html#/LoginComponents";
const myTalentUrl = process.env.MYSK_MYTALENT_URL || "https://portal.mytalentsystem.com/";
const passwordService = process.env.MYSK_PORTAL_PASSWORD_SERVICE || "mysaleskit-portal-password";
const tokenService = process.env.MYSK_TOKEN_SERVICE || "mysaleskit-api-token";
const headless = process.env.MYSK_PORTAL_HEADLESS !== "false";
const debug = process.env.MYSK_PORTAL_DEBUG === "1";
const manualLoginWaitMs = Number.parseInt(process.env.MYSK_MANUAL_LOGIN_WAIT_MS || "600000", 10);

function appStatus(message) {
  console.log(`[APP_STATUS] ${message}`);
}

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

async function writeKeychain(service, accountName, value) {
  await execFileAsync("security", [
    "add-generic-password",
    "-a",
    accountName,
    "-s",
    service,
    "-w",
    value,
    "-U",
    "-T",
    "/usr/bin/security",
  ]);
}

async function saveDebug(page, label) {
  if (!debug) return;
  await fs.mkdir(debugDir, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-");
  await page
    .evaluate(() => {
      for (const input of document.querySelectorAll("input")) {
        const type = (input.getAttribute("type") || "").toLowerCase();
        const name = (input.getAttribute("name") || "").toLowerCase();
        const id = (input.getAttribute("id") || "").toLowerCase();
        const placeholder = (input.getAttribute("placeholder") || "").toLowerCase();
        const sensitive =
          type === "password" ||
          name.includes("user") ||
          name.includes("phone") ||
          name.includes("email") ||
          name.includes("code") ||
          id.includes("user") ||
          id.includes("phone") ||
          id.includes("email") ||
          id.includes("code") ||
          placeholder.includes("user") ||
          placeholder.includes("phone") ||
          placeholder.includes("email") ||
          placeholder.includes("密码") ||
          placeholder.includes("验证码");
        if (sensitive) input.setAttribute("value", "");
      }
    })
    .catch(() => {});
  const html = await page.content().catch((error) => `<!-- skipped while page was changing: ${error.message} -->`);
  await fs.writeFile(path.join(debugDir, `${safeLabel}.html`), html, "utf8");
  await page.screenshot({ path: path.join(debugDir, `${safeLabel}.png`), fullPage: true }).catch(() => {});
}

async function fillFirst(page, selectors, value, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      await locator.fill(value);
      return;
    }
  }
  throw new Error(`没有找到输入框：${label}`);
}

async function clickByText(page, text, options = {}) {
  const locator = page.getByText(text, { exact: options.exact ?? false }).first();
  await locator.waitFor({ state: "visible", timeout: options.timeout || 15000 });
  await locator.click();
}

async function clickByAnyText(page, texts, options = {}) {
  const errors = [];
  for (const text of texts) {
    try {
      await clickByText(page, text, { ...options, timeout: options.perTextTimeout || 3000 });
      return;
    } catch (error) {
      errors.push(error);
    }
  }

  const clicked = await page.evaluate((candidateTexts) => {
    const normalize = (value) => (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = candidateTexts.map(normalize);
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.width < window.innerWidth * 0.9 &&
        rect.height < window.innerHeight * 0.9 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        style.pointerEvents !== "none"
      );
    };

    const elements = Array.from(
      document.querySelectorAll("button,a,label,[role='button'],[role='radio'],[onclick],li,div,span"),
    )
      .filter(isVisible)
      .map((element) => ({
        element,
        text: normalize(element.textContent),
        area: element.getBoundingClientRect().width * element.getBoundingClientRect().height,
      }))
      .filter((item) => item.text && candidates.some((candidate) => item.text.includes(candidate)))
      .sort((left, right) => left.area - right.area);

    const target = elements[0]?.element;
    if (!target) return false;
    const clickable = target.closest("button,a,label,[role='button'],[role='radio'],[onclick]") || target;
    const rect = clickable.getBoundingClientRect();
    clickable.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
    return true;
  }, texts).catch(() => false);
  if (clicked) return;

  throw errors.at(-1) || new Error(`没有找到按钮：${texts.join(" / ")}`);
}

async function fillVerificationCode(page, code) {
  const preferredSelectors = [
    'input[placeholder*="验证码"]',
    'input[placeholder*="校验码"]',
    'input[placeholder*="认证码"]',
    'input[placeholder*="动态码"]',
    'input[placeholder*="code"]',
    'input[placeholder*="Code"]',
    'input[name*="code"]',
    'input[name*="Code"]',
    'input[id*="code"]',
    'input[id*="Code"]',
    'input[inputmode="numeric"]',
    'input[maxlength="6"]',
    'input[type="tel"]',
    'input[type="number"]',
  ];

  for (const selector of preferredSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 10);
    for (let index = 0; index < count; index += 1) {
      const input = locator.nth(index);
      if (await input.isVisible().catch(() => false)) {
        await input.fill(code);
        return;
      }
    }
  }

  const inputs = page.locator("input");
  const count = Math.min(await inputs.count().catch(() => 0), 30);
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if (!(await input.isVisible().catch(() => false))) continue;
    const metadata = await input
      .evaluate((element) => {
        const attr = (name) => (element.getAttribute(name) || "").toLowerCase();
        return {
          id: attr("id"),
          name: attr("name"),
          placeholder: attr("placeholder"),
          type: attr("type"),
          maxLength: element.maxLength,
          value: element.value || "",
        };
      })
      .catch(() => null);
    if (!metadata) continue;
    const combined = `${metadata.id} ${metadata.name} ${metadata.placeholder} ${metadata.type}`;
    const isAccountInput = /user|account|phone|mobile|email|mail|password|登录|账户|手机号|邮箱|密码/.test(combined);
    const looksLikeCodeInput =
      /code|验证码|校验码|认证码|动态码/.test(combined) ||
      metadata.type === "tel" ||
      metadata.type === "number" ||
      metadata.maxLength === 6 ||
      metadata.value.length <= 6;
    if (!isAccountInput && looksLikeCodeInput) {
      await input.fill(code);
      return;
    }
  }

  throw new Error("没有找到验证码输入框。");
}

async function submitVerificationCode(page) {
  await clickByAnyText(page, ["确认", "提交", "验证", "下一步", "完成", "登录", "Verify", "Confirm", "Submit", "Continue", "Sign In"], {
    exact: false,
    perTextTimeout: 3000,
  }).catch(async () => {
    await page.keyboard.press("Enter");
  });
}

async function dismissMicrosoftKmsi(page) {
  const kmsiTexts = [
    "Stay signed in",
    "保持登录状态",
    "Don't show again",
    "不再显示",
    "Yes",
    "是",
    "No",
    "否",
    "此组织正在管理你的设备",
    "your organization is managing your device",
  ];
  for (const text of kmsiTexts) {
    const btn = page.getByRole("button", { name: text, exact: false }).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
  const kmsiUrlPattern = /kmsi|StaySignedIn|device.?login|common\/login|login\.microsoftonline/i;
  if (kmsiUrlPattern.test(page.url())) {
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(2000);
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function dismissNoPermissionDialog(page) {
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (!/没有权限访问该项目|no permission to access/i.test(bodyText)) return false;

  const clicked = await page.evaluate(() => {
    const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
    if (!/没有权限访问该项目|no permission to access/i.test(document.body?.innerText || "")) return false;
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        style.pointerEvents !== "none"
      );
    };
    const candidates = Array.from(
      document.querySelectorAll(
        ".ant-modal button, .ant-modal-confirm-btns button, .el-message-box__btns button, .el-dialog button, [role='dialog'] button, button",
      ),
    )
      .filter(isVisible)
      .filter((element) => /确定|确认|知道|关闭|ok|confirm|close/i.test(normalize(element.textContent)))
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
      });
    const target = candidates[0];
    if (!target) return false;
    target.click();
    return true;
  }).catch(() => false);

  if (!clicked) {
    await page.keyboard.press("Enter").catch(() => {});
  }
  await page.waitForTimeout(1500);
  return true;
}

async function waitForManualLogin(page, reason) {
  if (headless) {
    throw new Error(`${reason}。请用 MYSK_PORTAL_HEADLESS=false 打开可见浏览器，手动完成登录验证后脚本会继续。`);
  }

  console.log(
    JSON.stringify({
      status: "waiting_for_manual_login",
      reason,
      timeoutMs: manualLoginWaitMs,
      action: "请在打开的浏览器里完成验证码/滑块/登录验证，脚本检测到跳出登录页后会继续。",
    }),
  );
  appStatus("等待人工完成登录验证");

  await page.waitForURL((url) => !/login\.myworkbench\.com\/login\//i.test(url.href), {
    timeout: manualLoginWaitMs,
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await dismissMicrosoftKmsi(page);
  await saveDebug(page, "manual-login-complete");
}

function isVerificationText(text) {
  return /二次认证|验证码|邮箱验证|短信验证|手机验证|multi-factor authentication|\bMFA\b|verification code|security verification|email verification|sms verification|email code|sms code|verify code|enter.*code|email\.code|mail\.code|sms\.code|phone\.code/i.test(
    text,
  );
}

function isCaptchaText(text) {
  return /slide to verify|滑动|captcha/i.test(text);
}

async function handleLoginBlocked(page) {
  if (!/login\.myworkbench\.com\/login\//i.test(page.url())) return;
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (isVerificationText(text)) {
    const handled = await completeTwoFactor(page);
    if (handled) return;
    await waitForManualLogin(page, "Workbench 登录需要验证码");
    return;
  }
  if (isCaptchaText(text)) {
    await waitForManualLogin(page, "Workbench 登录触发滑块验证码");
    return;
  }
  await waitForManualLogin(page, "Workbench 登录后仍停留在登录页，未进入 MyWorkbench");
}

async function maybeLogin(page, password) {
  await page.goto(workbenchLoginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .locator(
      [
        'input[placeholder*="登录"]',
        'input[placeholder*="账户"]',
        'input[placeholder*="手机号"]',
        "input#username",
        'input[name="username"]',
        'input[placeholder*="Username"]',
        'input[placeholder*="username"]',
        'input[placeholder*="Phone"]',
        'input[placeholder*="phone"]',
        'input[placeholder*="Email"]',
        'input[placeholder*="email"]',
        'input[title*="username"]',
        'input[type="text"]',
      ].join(","),
    )
    .first()
    .waitFor({ state: "visible", timeout: 45000 })
    .catch(() => {});
  await saveDebug(page, "01-workbench-or-login");

  if (/login\.myworkbench\.com\/login\//i.test(page.url()) || (await page.locator('input[placeholder*="登录"]').count())) {
    await fillFirst(
      page,
      [
        'input[placeholder*="登录"]',
        'input[placeholder*="账户"]',
        'input[placeholder*="手机号"]',
        "input#username",
        'input[name="username"]',
        'input[placeholder*="Username"]',
        'input[placeholder*="username"]',
        'input[placeholder*="Phone"]',
        'input[placeholder*="phone"]',
        'input[placeholder*="Email"]',
        'input[placeholder*="email"]',
        'input[title*="username"]',
        'input[type="text"]',
      ],
      account,
      "账号",
    );
    await fillFirst(
      page,
      ['input[placeholder*="密码"]', 'input[type="password"]'],
      password,
      "密码",
    );
    await clickByAnyText(page, ["登录", "Sign In"], { exact: true, perTextTimeout: 5000 });
    await Promise.race([
      page.waitForURL((url) => !/login\.myworkbench\.com\/login\//i.test(url.href), { timeout: 60000 }),
      page.waitForFunction(
        () => {
          const text = document.body?.innerText || "";
          return /二次认证|验证码|邮箱验证|短信验证|手机验证|multi-factor authentication|\bMFA\b|verification code|security verification|email verification|sms verification|email code|sms code|verify code|enter.*code|email\.code|mail\.code|sms\.code|phone\.code|slide to verify|滑动|captcha/i.test(
            text,
          );
        },
        { timeout: 60000 },
      ),
    ]).catch(() => {});
    await page.waitForTimeout(1000);
    await saveDebug(page, "02-after-password-login");
    await handleLoginBlocked(page);
  }
}

async function clickAppEntry(page, context, { label, aliases, expectedUrl, debugLabel, permissionRetries = 1 }) {
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);

  for (const alias of aliases) {
    await page.getByText(alias, { exact: false }).first().hover({ timeout: 3000 }).catch(() => {});
  }

  const popupPromise = context.waitForEvent("page", { timeout: 30000 }).catch(() => null);
  const navPromise = expectedUrl
    ? page.waitForURL(expectedUrl, { timeout: 20000 }).then(() => page).catch(() => null)
    : Promise.resolve(null);
  const target = await page.evaluate(({ aliases: appAliases }) => {
    const buttonLabels = ["进入系统", "进入", "立即进入", "打开", "访问", "Enter", "Launch"];
    const normalize = (value) => (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const normalizedAliases = appAliases.map(normalize);
    const normalizedButtons = buttonLabels.map(normalize);
    const cardSelectors = [
      ".project-content-item:not(.project-item-disable)",
      ".project-content-item",
      ".ant-card",
      ".el-card",
      "[class*='application-card']",
      "[class*='applicationCard']",
      "[class*='ApplicationCard']",
      "[class*='application-item']",
      "[class*='applicationItem']",
      "[class*='ApplicationItem']",
      "[class*='app-card']",
      "[class*='appCard']",
      "[class*='AppCard']",
      "[class*='app-item']",
      "[class*='appItem']",
      "[class*='AppItem']",
      "[class*='card']",
      "[class*='Card']",
      "li",
    ];
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        style.pointerEvents !== "none"
      );
    };
    const isPageSized = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.8;
    };
    const includesAlias = (element) => {
      const text = normalize(element.textContent);
      return normalizedAliases.some((alias) => text.includes(alias));
    };
    const includesButton = (element) => {
      const text = normalize(element.textContent);
      return normalizedButtons.some((button) => text === button || (text.length <= 30 && text.includes(button)));
    };
    const area = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width * rect.height;
    };
    const center = (element) => {
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return {
        x: Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
        y: Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
        text: (element.textContent || "").trim().slice(0, 80),
      };
    };
    const closestCard = (element) => {
      for (const selector of cardSelectors) {
        const card = element.closest(selector);
        if (card && card !== document.body && card !== document.documentElement && isVisible(card) && !isPageSized(card) && includesAlias(card)) {
          return card;
        }
      }
      return null;
    };

    const elements = Array.from(document.querySelectorAll("body *")).filter(isVisible);
    const appElements = elements
      .filter(includesAlias)
      .sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length);
    const scopes = [];
    const seen = new Set();
    const appCards = [];
    const seenCards = new Set();

    for (const element of appElements) {
      const card = closestCard(element);
      if (card && !seenCards.has(card)) {
        seenCards.add(card);
        appCards.push(card);
      }

      let scope = element;
      for (let depth = 0; scope && depth < 7; depth += 1) {
        if (scope === document.body || scope === document.documentElement) break;
        if (!seen.has(scope) && !isPageSized(scope)) {
          seen.add(scope);
          scopes.push(scope);
        }
        scope = scope.parentElement;
      }
    }

    scopes.sort((left, right) => area(left) - area(right));
    appCards.sort((left, right) => area(left) - area(right));

    for (const element of appElements) {
      let scope = element;
      for (let depth = 0; scope && depth < 8; depth += 1) {
        if (scope === document.body || scope === document.documentElement || isPageSized(scope)) break;
        if (includesAlias(scope)) {
          const button = Array.from(
            scope.querySelectorAll("button,a,[role='button'],[onclick],.ant-btn,.el-button,div,span"),
          )
            .filter(isVisible)
            .find(includesButton);
          if (button) return center(button);
        }
        scope = scope.parentElement;
      }
    }

    for (const scope of [...appCards, ...scopes]) {
      const candidates = Array.from(
        scope.querySelectorAll("button,a,[role='button'],[onclick],.ant-btn,.el-button,div,span"),
      ).filter(isVisible);
      const button = candidates.find(includesButton);
      if (button) return center(button);
    }

    const appElementInCard = appElements.find((element) => closestCard(element));
    if (appElementInCard) return center(appElementInCard);

    if (appCards[0]) return center(appCards[0]);

    for (const element of appElements) {
      const clickable =
        element.closest("a,button,[role='button'],[onclick]") ||
        Array.from(element.querySelectorAll("a,button,[role='button'],[onclick]")).find(isVisible);
      if (clickable && isVisible(clickable)) return center(clickable);
    }

    const card = scopes.find((scope) => {
      const className = typeof scope.className === "string" ? scope.className : "";
      return /project-content-item|application.*(card|item)|app.*(card|item)|card/i.test(className) && !/header-project/i.test(className) && includesAlias(scope);
    });
    if (card) return center(card);

    if (appElements[0]) return center(appElements[0]);

    return null;
  }, { aliases });

  if (!target) {
    await saveDebug(page, `missing-${label}`);
    throw new Error(`没有找到 ${label} 的进入系统按钮。`);
  }

  appStatus(`正在进入 ${label}`);
  console.log(`clicking ${label}: "${target.text}" at ${Math.round(target.x)},${Math.round(target.y)}`);
  await page.mouse.click(target.x, target.y);
  let targetPage = (await Promise.race([popupPromise, navPromise])) || page;

  if (expectedUrl) {
    if (targetPage === page && !expectedUrl.test(page.url())) {
      const allPages = context.pages();
      const matched = allPages.find((p) => expectedUrl.test(p.url()));
      if (matched) targetPage = matched;
    }
    if (!expectedUrl.test(targetPage.url())) {
      try {
        await targetPage.waitForURL(expectedUrl, { timeout: 20000 });
      } catch (error) {
        const bodyText = await targetPage.locator("body").innerText({ timeout: 3000 }).catch(() => "");
        if (/没有权限访问该项目|no permission to access/i.test(bodyText)) {
          await saveDebug(targetPage, `permission-${label}`).catch(() => {});
          if (permissionRetries > 0) {
            console.log(`detected no-permission dialog after clicking ${label}, closing it and retrying...`);
            await dismissNoPermissionDialog(targetPage);
            if (targetPage !== page) await targetPage.close().catch(() => {});
            return clickAppEntry(page, context, {
              label,
              aliases,
              expectedUrl,
              debugLabel,
              permissionRetries: permissionRetries - 1,
            });
          }
          throw new Error(`${label} 打开失败：页面提示没有权限访问该项目。已自动关闭弹窗并重试过一次，仍未成功。`);
        }
        if (targetPage !== page) throw error;
        const retryPopupPromise = context.waitForEvent("page", { timeout: 30000 }).catch(() => null);
        const retryNavPromise = page.waitForURL(expectedUrl, { timeout: 60000 }).then(() => page).catch(() => null);
        const clicked = await clickAppEntryDomFallback(page, aliases);
        if (!clicked) throw error;
        targetPage = (await Promise.race([retryPopupPromise, retryNavPromise])) || page;
        if (!expectedUrl.test(targetPage.url())) {
          const allPages = context.pages();
          const matched = allPages.find((p) => expectedUrl.test(p.url()));
          if (matched) targetPage = matched;
        }
        if (!expectedUrl.test(targetPage.url())) {
          await targetPage.waitForURL(expectedUrl, { timeout: 60000 });
        }
      }
    }
  }
  await targetPage.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
  await targetPage.waitForTimeout(5000);
  await saveDebug(targetPage, debugLabel);
  return targetPage;
}

async function completeTwoFactor(page) {
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (!isVerificationText(text)) return false;

  const emailOptionSelected = await clickByAnyText(page, ["选择邮箱验证码", "邮箱验证码", "邮箱", "邮件验证码", "email.code", "mail.code", "Email verification", "Email Code", "Email"], {
      exact: false,
      perTextTimeout: 3000,
    })
    .then(() => true)
    .catch(() => false);
  if (emailOptionSelected) {
    await page.waitForTimeout(2000);
  }

  const refreshedText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => text);
  await clickByAnyText(page, ["获取验证码", "发送验证码", "收取验证码", "send.code", "get.code", "send.email.code", "发送", "获取", "Send code", "Get code", "Receive code", "Send", "Get"], {
    exact: false,
    perTextTimeout: 2000,
  }).catch(() => {});
  await saveDebug(page, "03-email-code-triggered");
  appStatus("正在读取邮箱验证码");

  const shouldReadEmail =
    emailOptionSelected ||
    (/二次认证|邮箱|邮件|email|mail/i.test(refreshedText) && !(/短信|手机|SMS/i.test(refreshedText) && !/邮箱|email/i.test(refreshedText)));
  if (!shouldReadEmail) {
    await waitForManualLogin(page, "Workbench 登录需要手动输入验证码");
    return true;
  }

  const nodePath = process.execPath;
  const { stdout } = await execFileAsync(nodePath, ["scripts/read_owa_verification_code.mjs"], {
    cwd,
    env: { ...process.env, MYSK_OWA_RETURN_CODE: "1" },
    maxBuffer: 1024 * 1024,
  });
  const resultLine = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith("{"));
  if (!resultLine) throw new Error("OWA 读取器没有返回验证码 JSON。");

  const code = JSON.parse(resultLine).code;
  if (!/^\d{6}$/.test(code)) throw new Error("OWA 读取器返回的验证码格式不正确。");

  await fillVerificationCode(page, code);
  await submitVerificationCode(page);
  await page.waitForURL((url) => !/login\.myworkbench\.com\/login\//i.test(url.href), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await saveDebug(page, "04-after-two-factor");
  return true;
}

async function waitForWorkbenchPortal(page) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  try {
    await page.waitForSelector(".project-content, .homepage", { timeout: 20000 });
    await page.waitForFunction(() => {
      const mask = document.getElementById("loading-mask");
      return !mask || mask.style.display === "none" || window.getComputedStyle(mask).display === "none";
    }, { timeout: 20000 });
  } catch {
  }
  await page.waitForTimeout(2000);
}

async function openMyTalentDirect(context) {
  const page = await context.newPage();
  try {
    await page.goto(myTalentUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    if (
      /portal\.mytalentsystem\.com/i.test(page.url()) &&
      /MyTalent|Mytalent|MySalesKit|进入系统/.test(bodyText) &&
      !/login\.myworkbench\.com\/login\//i.test(page.url())
    ) {
      console.log("opened MyTalent directly, skipping Workbench card click");
      await saveDebug(page, "06-mytalent-direct");
      return page;
    }
  } catch (error) {
    console.log(`direct MyTalent open failed: ${error.message}`);
  }

  await saveDebug(page, "06-mytalent-direct-failed").catch(() => {});
  await page.close().catch(() => {});
  return null;
}

async function clickAppEntryDomFallback(page, aliases) {
  return page.evaluate(({ aliases: appAliases }) => {
    const buttonLabels = ["进入系统", "进入", "立即进入", "打开", "访问", "Enter", "Launch"];
    const normalize = (value) => (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const normalizedAliases = appAliases.map(normalize);
    const normalizedButtons = buttonLabels.map(normalize);
    const includesAlias = (element) => normalizedAliases.some((alias) => normalize(element.textContent).includes(alias));
    const includesButton = (element) => {
      const text = normalize(element.textContent);
      return normalizedButtons.some((button) => text === button || (text.length <= 30 && text.includes(button)));
    };
    const canUseScope = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.width < window.innerWidth * 0.95 &&
        rect.height < window.innerHeight * 0.8 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const dispatchClick = (element) => {
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      const options = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };
      for (const eventName of ["mouseover", "mouseenter", "mousedown", "mouseup", "click"]) {
        element.dispatchEvent(new MouseEvent(eventName, options));
      }
      if (typeof element.click === "function") element.click();
      return true;
    };

    const appElements = Array.from(document.querySelectorAll("body *"))
      .filter(includesAlias)
      .sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length);

    for (const element of appElements) {
      let scope = element;
      for (let depth = 0; scope && depth < 8; depth += 1) {
        if (scope === document.body || scope === document.documentElement) break;
        if (canUseScope(scope) && includesAlias(scope)) {
          const button = Array.from(
            scope.querySelectorAll("button,a,[role='button'],[onclick],.ant-btn,.el-button,div,span,p"),
          ).find(includesButton);
          if (button) return dispatchClick(button.closest("button,a,[role='button'],[onclick]") || button);
        }
        scope = scope.parentElement;
      }
    }
    return false;
  }, { aliases }).catch(() => false);
}

async function openMysaleskit(page, context) {
  let currentPage = page;
  const url = currentPage.url();

  if (url.includes("login.myworkbench.com") && !url.includes("/login/")) {
    const bodyText = await currentPage.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/application portal|applications|all applications|myworkbench/i.test(bodyText) && /myworkbench/i.test(bodyText)) {
      console.log("detected intermediate app launcher, clicking myworkbench...");
      currentPage = await clickAppEntry(currentPage, context, {
        label: "MyWorkbench",
        aliases: ["MyWorkbench", "myworkbench", "My Workbench"],
        expectedUrl: /^https?:\/\/(?!login\.)(?:[^/]+\.)?myworkbench\.com/i,
        debugLabel: "intermediate-myworkbench",
      });
      await dismissMicrosoftKmsi(currentPage);
    }
  }

  await waitForWorkbenchPortal(currentPage);
  await saveDebug(currentPage, "05-workbench-home");
  await handleLoginBlocked(currentPage);

  let myTalentPage = currentPage.url().includes("portal.mytalentsystem.com") ? currentPage : null;
  if (!myTalentPage) {
    try {
      myTalentPage = await clickAppEntry(currentPage, context, {
        label: "MyTalent",
        aliases: ["MyTalent", "My Talent", "mytalent", "人才系统", "人才"],
        expectedUrl: /portal\.mytalentsystem\.com/,
        debugLabel: "06-mytalent-home",
      });
    } catch (error) {
      console.log(`Workbench MyTalent card click failed: ${error.message}`);
      myTalentPage = await openMyTalentDirect(context);
      if (!myTalentPage) throw error;
    }
  }

  await saveDebug(myTalentPage, "06-mytalent-home");

  return clickAppEntry(myTalentPage, context, {
    label: "MySalesKit",
    aliases: ["MySalesKit", "My Sales Kit", "mysaleskit"],
    expectedUrl: /mysaleskit-admin\.mytalentsystem\.com/,
    debugLabel: "07-mysaleskit-admin",
  });
}

async function extractToken(page) {
  const token = await page
    .waitForFunction(() => {
      const raw = localStorage.getItem("sales-kit-user");
      if (!raw) return "";
      try {
        return JSON.parse(JSON.parse(raw)).token || "";
      } catch {
        return "";
      }
    }, { timeout: 60000 })
    .then((handle) => handle.jsonValue());

  if (!token) throw new Error("进入 MySalesKit 后没有读取到 API token。");
  return token;
}

await fs.mkdir(workDir, { recursive: true });

const password = process.env.MYSK_PORTAL_PASSWORD || (await readKeychain(passwordService, account));
if (!password) {
  throw new Error("没有找到门户密码。请先运行 scripts/store_portal_password.sh 存入 Keychain。");
}

const context = await chromium.launchPersistentContext(path.join(workDir, "portal-profile"), {
  headless,
  ignoreHTTPSErrors: true,
  viewport: { width: 1366, height: 900 },
});

try {
  const page = context.pages()[0] || (await context.newPage());
  await maybeLogin(page, password);
  await completeTwoFactor(page);
  const mysaleskitPage = await openMysaleskit(page, context);
  const token = await extractToken(mysaleskitPage);
  await writeKeychain(tokenService, account, token);
  await fs.writeFile(path.join(workDir, ".mysaleskit_token"), token, { mode: 0o600 });
  console.log(JSON.stringify({ status: "ok", tokenStored: true, source: "portal_owa" }));
} finally {
  await context.close();
}
