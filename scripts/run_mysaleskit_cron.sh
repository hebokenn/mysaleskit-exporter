#!/usr/bin/env bash
# ============================================================================
# mysaleskit daily cron entry — fully autonomous, no Codex/WorkBuddy dependency
#
# Flow:
#   1. auto-install npm deps if missing
#   2. try fetch with existing token
#   3. if token expired → refresh via portal + OWA email code
#   4. build xlsx with exceljs
#   5. verify output file freshness
#   6. log summary
#
# Failure modes:
#   - token refresh needs manual verification → opens visible browser and waits
#   - token refresh fails after visible login → prints [MYSALESKIT_CRON_ERROR] with fix steps
#   - xlsx build fails → prints error, exits non-zero
#   - output file missing/stale → prints VERIFY_FAIL/WARN
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${MYSK_ROOT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
NODE="${NODE:-$(command -v node || true)}"
NPM="${NPM:-$(command -v npm || true)}"

cd "$ROOT_DIR"
mkdir -p work downloads logs

timestamp="$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')"
safe_ts="${timestamp//[: ]/-}"
log_file="${MYSK_LOG_FILE:-$ROOT_DIR/logs/mysaleskit-${safe_ts}.log}"
mkdir -p "$(dirname "$log_file")"

# ---------- step 1: try fetch with existing token ----------
fetch_ok=0
refresh_ok=0

log()  { echo "[$(TZ=Asia/Shanghai date '+%H:%M:%S')] $*"; }
app_status() { echo "[$(TZ=Asia/Shanghai date '+%H:%M:%S')] [APP_STATUS] $*"; }
die()  { app_status "导出失败，请查看日志"; log "FATAL: $*"; exit 1; }

refresh_token_visible() {
  log "opening visible browser for manual login..."
  MYSK_PORTAL_HEADLESS=false \
    MYSK_MANUAL_LOGIN_WAIT_MS="${MYSK_MANUAL_LOGIN_WAIT_MS:-900000}" \
    $NODE scripts/refresh_mysaleskit_token_with_owa.mjs
}

{
  log "===== mysaleskit daily cron run ====="
  if [[ -z "$NODE" || ! -x "$NODE" ]]; then
    die "未找到 Node.js，请先安装 Node.js 20+"
  fi
  if [[ -z "$NPM" || ! -x "$NPM" ]]; then
    die "未找到 npm，请先安装 Node.js/npm"
  fi
  log "node: $($NODE --version)"
  log "cwd: $(pwd)"
  app_status "准备导出"

  if [ ! -f "node_modules/exceljs/package.json" ] || [ ! -f "node_modules/playwright/package.json" ]; then
    app_status "首次运行，正在安装依赖"
    log "[bootstrap] installing npm dependencies..."
    "$NPM" install --no-audit --no-fund
  fi

  # Clean up leftover development symlink that may interfere.
  [ -L "work/node_modules" ] && rm -f work/node_modules

  keychain_unlock_output="$(bash scripts/unlock_login_keychain.sh 2>&1 || true)"
  if [ -n "$keychain_unlock_output" ]; then
    log "$keychain_unlock_output"
    case "$keychain_unlock_output" in
      *自动解锁失败*) app_status "Keychain 自动解锁失败，如弹出提示请手动输入电脑密码" ;;
      *已尝试自动解锁*) app_status "已尝试自动解锁 Keychain" ;;
    esac
  fi

  log "--- step 1: fetch data with existing token ---"
  app_status "检查已有登录状态"
  if $NODE scripts/fetch_mysaleskit_data.mjs; then
    fetch_ok=1
    log "fetch OK (token valid)"
    app_status "已有登录有效，正在准备生成 Excel"
  else
    log "token expired/missing, refreshing..."
    app_status "登录已过期，正在刷新"
    # ---------- step 2: refresh token via portal + OWA ----------
    if $NODE scripts/refresh_mysaleskit_token_with_owa.mjs; then
      refresh_ok=1
      log "token refreshed, retrying fetch..."
      app_status "登录已刷新，正在拉取数据"
      if $NODE scripts/fetch_mysaleskit_data.mjs; then
        fetch_ok=1
        log "fetch OK (after refresh)"
      else
        die "fetch failed even after token refresh"
      fi
    else
      refresh_exit=$?
      if [ "${MYSK_PORTAL_HEADLESS:-}" != "false" ]; then
        log "token refresh needs visible login (headless exit=$refresh_exit)"
        app_status "需要可见浏览器登录，请按页面提示处理"
        if refresh_token_visible; then
          refresh_ok=1
          log "token refreshed through visible login, retrying fetch..."
          app_status "登录已刷新，正在拉取数据"
          if $NODE scripts/fetch_mysaleskit_data.mjs; then
            fetch_ok=1
            log "fetch OK (after visible login)"
          else
            die "fetch failed even after visible login"
          fi
        else
          refresh_exit=$?
          log "visible login/token refresh FAILED (exit=$refresh_exit)"
          app_status "可见浏览器登录失败"
          echo ""
          echo "============================================================"
          echo "[MYSALESKIT_CRON_ERROR]"
          echo "reason=visible_token_refresh_failed"
          echo "exit_code=${refresh_exit}"
          echo ""
          echo "Manual recovery steps:"
          echo "  1. Kill stale browser processes:"
          echo '     pkill -f "playwright" 2>/dev/null; pkill -f headless_shell 2>/dev/null'
          echo ""
          echo "  2. Run visible-browser login/export:"
          echo "     cd ${ROOT_DIR}"
          echo '     bash scripts/run_mysaleskit_daily_manual_login.sh'
          echo ""
          echo "  3. Complete the captcha/verification in the visible browser window"
          echo "     The script will continue automatically once login succeeds."
          echo "============================================================"
          die "visible token refresh failed — see above for recovery"
        fi
      else
        log "visible login/token refresh FAILED (exit=$refresh_exit)"
        app_status "可见浏览器登录失败"
        echo ""
        echo "============================================================"
        echo "[MYSALESKIT_CRON_ERROR]"
        echo "reason=visible_token_refresh_failed"
        echo "exit_code=${refresh_exit}"
        echo ""
        echo "Manual recovery steps:"
        echo "  1. Kill stale browser processes:"
        echo '     pkill -f "playwright" 2>/dev/null; pkill -f headless_shell 2>/dev/null'
        echo ""
        echo "  2. Re-run visible-browser login/export:"
        echo "     cd ${ROOT_DIR}"
        echo '     bash scripts/run_mysaleskit_daily_manual_login.sh'
        echo ""
        echo "  3. Complete the captcha/verification in the visible browser window"
        echo "     The script will continue automatically once login succeeds."
        echo "============================================================"
        die "visible token refresh failed — see above for recovery"
      fi
    fi
  fi

  # ---------- step 3: build xlsx ----------
  log "--- step 2: build xlsx ---"
  app_status "正在生成 Excel"
  if [ ! -f "work/mysaleskit_on_raw.json" ]; then
    die "work/mysaleskit_on_raw.json not found — fetch may have failed"
  fi
  $NODE scripts/build_xlsx.mjs
  log "xlsx build complete"

  # ---------- step 4: verify output ----------
  log "--- step 3: verify output ---"
  app_status "正在检查输出文件"
  output_file="mysaleskit 最新数据.xlsx"
  if [ -f "$output_file" ]; then
    mod_time=$(stat -f %m "$output_file")
    now=$(date +%s)
    age=$((now - mod_time))
    if [ "$age" -lt 600 ]; then
      log "VERIFY_OK: ${output_file} exists, modified ${age}s ago"
    else
      log "VERIFY_WARN: ${output_file} exists but modified ${age}s ago (may be stale)"
    fi
  else
    die "VERIFY_FAIL: ${output_file} not found"
  fi

  # ---------- step 5: audit summary ----------
  log "--- audit summary ---"
  if [ -f "work/mysaleskit_audit.json" ]; then
    python3 -c "
import json, sys
d = json.load(open('work/mysaleskit_audit.json'))
print(f'  sourceTotal: {d[\"sourceTotal\"]}')
print(f'  finalTotal: {d[\"finalTotal\"]}')
print(f'  byStudy: {json.dumps(d[\"byStudy\"], ensure_ascii=False)}')
print(f'  byPost: {json.dumps(d[\"byPost\"], ensure_ascii=False)}')
print(f'  updatedAt: {d[\"updatedAt\"]}')
"
  fi

  log "===== done ====="
  app_status "导出完成"
} 2>&1 | tee "$log_file"

echo "LOG_FILE=$log_file"
