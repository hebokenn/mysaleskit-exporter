#!/usr/bin/env bash
set -euo pipefail

SERVICE="${MYSK_MAC_PASSWORD_SERVICE:-mysaleskit-mac-login-password}"
ACCOUNT="${MYSK_MAC_ACCOUNT:-${USER:-$(id -un)}}"
KEYCHAIN="${MYSK_LOGIN_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"

PASSWORD="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null || true)"
if [[ -z "$PASSWORD" ]]; then
  echo "未配置电脑密码，跳过自动解锁 Keychain。"
  exit 2
fi

if security unlock-keychain -p "$PASSWORD" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "已尝试自动解锁 Keychain。"
else
  echo "Keychain 自动解锁失败。如弹出系统提示，请手动输入电脑密码。"
  exit 1
fi
