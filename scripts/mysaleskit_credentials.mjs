import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const cwd = process.cwd();
const workDir = path.join(cwd, "work");
const credentialsPath = path.join(workDir, "mysaleskit_credentials.json");

const defaultPortalAccount = "";
const defaultMailAccount = "";
const portalPasswordService = process.env.MYSK_PORTAL_PASSWORD_SERVICE || "mysaleskit-portal-password";
const mailPasswordService = process.env.MYSK_MAIL_PASSWORD_SERVICE || "mysaleskit-mail-password";
const macPasswordService = process.env.MYSK_MAC_PASSWORD_SERVICE || "mysaleskit-mac-login-password";

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

export async function readCredentials() {
  try {
    const raw = await fs.readFile(credentialsPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeCredentials(nextCredentials) {
  await fs.mkdir(workDir, { recursive: true });
  const body = `${JSON.stringify(nextCredentials, null, 2)}\n`;
  await fs.writeFile(credentialsPath, body, { mode: 0o600 });
}

export async function saveAccount(kind, account) {
  const cleanAccount = String(account || "").trim();
  if (!cleanAccount) throw new Error("账号不能为空。");

  const credentials = await readCredentials();
  if (kind === "portal") {
    credentials.portalAccount = cleanAccount;
  } else if (kind === "mail") {
    credentials.mailAccount = cleanAccount;
  } else {
    throw new Error(`未知账号类型：${kind}`);
  }
  credentials.updatedAt = new Date().toISOString();
  await writeCredentials(credentials);
  return cleanAccount;
}

export async function getPortalAccount() {
  const credentials = await readCredentials();
  return firstNonEmpty(
    process.env.MYSK_PORTAL_ACCOUNT,
    credentials.portalAccount,
    process.env.MYSK_ACCOUNT,
    defaultPortalAccount,
  );
}

export async function getMailAccount() {
  const credentials = await readCredentials();
  return firstNonEmpty(
    process.env.MYSK_MAIL_ACCOUNT,
    credentials.mailAccount,
    process.env.MYSK_ACCOUNT,
    defaultMailAccount,
  );
}

export function getMacAccount() {
  return firstNonEmpty(process.env.MYSK_MAC_ACCOUNT, process.env.USER, process.env.LOGNAME);
}

async function keychainItemExists(service, account) {
  if (!account) return false;
  try {
    await execFileAsync("security", ["find-generic-password", "-s", service, "-a", account]);
    return true;
  } catch {
    return false;
  }
}

export async function getCredentialStatus() {
  const portalAccount = await getPortalAccount();
  const mailAccount = await getMailAccount();
  const macAccount = getMacAccount();
  return {
    configPath: credentialsPath,
    portalAccount,
    portalPasswordConfigured: await keychainItemExists(portalPasswordService, portalAccount),
    mailAccount,
    mailPasswordConfigured: await keychainItemExists(mailPasswordService, mailAccount),
    macAccount,
    macPasswordConfigured: await keychainItemExists(macPasswordService, macAccount),
  };
}

function statusText(status) {
  const yesNo = (value) => (value ? "已配置" : "未配置");
  const configuredText = (value) => value || "未配置";
  return [
    `MyWorkbench 账号：${configuredText(status.portalAccount)}`,
    `MyWorkbench 密码：${yesNo(status.portalPasswordConfigured)}`,
    "",
    `邮箱账号：${configuredText(status.mailAccount)}`,
    `邮箱密码：${yesNo(status.mailPasswordConfigured)}`,
    "",
    `电脑用户：${status.macAccount}`,
    `电脑密码：${yesNo(status.macPasswordConfigured)}`,
  ].join("\n");
}

async function runCli() {
  const [action, kind, value] = process.argv.slice(2);
  if (action === "get") {
    if (kind === "portal") {
      console.log(await getPortalAccount());
      return;
    }
    if (kind === "mail") {
      console.log(await getMailAccount());
      return;
    }
    if (kind === "mac") {
      console.log(getMacAccount());
      return;
    }
  }

  if (action === "save") {
    await saveAccount(kind, value);
    console.log("OK");
    return;
  }

  if (action === "status") {
    console.log(JSON.stringify(await getCredentialStatus(), null, 2));
    return;
  }

  if (action === "status-text") {
    console.log(statusText(await getCredentialStatus()));
    return;
  }

  throw new Error("用法：mysaleskit_credentials.mjs get portal|mail|mac | save portal|mail <account> | status | status-text");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
