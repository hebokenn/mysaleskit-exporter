import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPortalAccount } from "./mysaleskit_credentials.mjs";

const execFileAsync = promisify(execFile);

const cwd = process.cwd();
const workDir = path.join(cwd, "work");
const downloadsDir = path.join(cwd, "downloads");

const apiBase = "https://mysaleskit-api.mytalentsystem.com";
const referer = "https://mysaleskit-admin.mytalentsystem.com/";
const origin = "https://mysaleskit-admin.mytalentsystem.com";
const account = await getPortalAccount();
if (!account) {
  throw new Error("未配置 MyWorkbench 账号。请先打开 app 的“配置 MyWorkbench”。");
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

async function getToken() {
  if (process.env.MYSK_TOKEN) return process.env.MYSK_TOKEN.trim();

  const keychainToken = await readKeychain("mysaleskit-api-token", account);
  if (keychainToken) return keychainToken;

  const tokenPath = path.join(workDir, ".mysaleskit_token");
  try {
    return (await fs.readFile(tokenPath, "utf8")).trim();
  } catch {
    throw new Error(
      "没有找到 MySalesKit API token。请先登录一次并把 token 存入 Keychain，或设置 MYSK_TOKEN。",
    );
  }
}

async function postJson(pathname, token, payload) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      token,
      origin,
      referer,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`接口返回不是 JSON：HTTP ${response.status}`);
  }
  return { response, json };
}

async function downloadOfficialExport(token, payload) {
  const response = await fetch(`${apiBase}/management/trainee/learningDetail/download`, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      token,
      origin,
      referer,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`官方导出失败：HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const headers = {};
  for (const [key, value] of response.headers.entries()) headers[key] = value;

  await fs.mkdir(downloadsDir, { recursive: true });
  await fs.writeFile(path.join(downloadsDir, "mysaleskit_raw_encrypted.xlsx"), buffer);
  await fs.writeFile(
    path.join(downloadsDir, "mysaleskit_raw_headers.json"),
    JSON.stringify(headers, null, 2),
    "utf8",
  );
}

await fs.mkdir(workDir, { recursive: true });

const token = await getToken();
const queryPayload = { pageNum: 1, pageSize: 1000, workStatus: "ON" };
const exportPayload = { workStatus: "ON" };

const { json } = await postJson("/management/trainee/queryTrainee", token, queryPayload);
if (json?.message?.code !== "00000" || !json?.payload?.list) {
  throw new Error(`拉取在职数据失败：${json?.message?.hint || json?.message?.descriptionCN || "未知错误"}`);
}

await fs.writeFile(
  path.join(workDir, "mysaleskit_on_raw.json"),
  JSON.stringify(json, null, 2),
  "utf8",
);

await downloadOfficialExport(token, exportPayload);

console.log(
  JSON.stringify(
    {
      status: "ok",
      sourceTotal: json.payload.total,
      rows: json.payload.list.length,
      rawPath: path.join(workDir, "mysaleskit_on_raw.json"),
      encryptedExportPath: path.join(downloadsDir, "mysaleskit_raw_encrypted.xlsx"),
    },
    null,
    2,
  ),
);
