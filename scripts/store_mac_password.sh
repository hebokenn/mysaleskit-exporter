#!/usr/bin/env bash
set -euo pipefail

SERVICE="${MYSK_MAC_PASSWORD_SERVICE:-mysaleskit-mac-login-password}"
ACCOUNT="${MYSK_MAC_ACCOUNT:-${USER:-$(id -un)}}"

printf "电脑用户: %s\n" "$ACCOUNT"
PASSWORD="${MYSK_MAC_PASSWORD:-}"
if [[ -z "$PASSWORD" ]]; then
  printf "请输入这台 Mac 的登录密码（输入时不会显示）: "
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

echo "电脑密码已保存到 macOS Keychain：$SERVICE / $ACCOUNT"
