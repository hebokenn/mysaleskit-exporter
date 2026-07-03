#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
NODE="${NODE:-$(command -v node || true)}"
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  echo "未找到 Node.js，请先安装 Node.js 20+。"
  exit 127
fi

cd "$ROOT_DIR"

ACCOUNT="${MYSK_MAIL_ACCOUNT:-}"
if [[ -z "$ACCOUNT" ]]; then
  ACCOUNT="$("$NODE" scripts/mysaleskit_credentials.mjs get mail)"
fi
if [[ -z "$ACCOUNT" ]]; then
  echo "账号为空，请先在 app 里配置邮箱账号。"
  exit 1
fi
SERVICE="${MYSK_MAIL_PASSWORD_SERVICE:-mysaleskit-mail-password}"

printf "邮箱账号: %s\n" "$ACCOUNT"
PASSWORD="${MYSK_MAIL_PASSWORD:-}"
if [[ -z "$PASSWORD" ]]; then
  printf "请输入邮箱密码（输入时不会显示）: "
  IFS= read -rs PASSWORD
  printf "\n"
fi

if [[ -z "$PASSWORD" ]]; then
  echo "密码为空，已取消。"
  exit 1
fi

security add-generic-password \
  -a "$ACCOUNT" \
  -s "$SERVICE" \
  -w "$PASSWORD" \
  -U \
  -T /usr/bin/security >/dev/null

"$NODE" scripts/mysaleskit_credentials.mjs save mail "$ACCOUNT" >/dev/null
echo "邮箱密码已保存到 macOS Keychain：$SERVICE / $ACCOUNT"
