#!/usr/bin/env bash
# UI 端到端验证编排：
#   1. 用生产产物构建一次（避免测到过期 out/）
#   2. 在独立临时 userData 里预置 config / 明文 key / 模型缓存
#   3. 起 mock DeepSeek + 带调试端口的应用
#   4. CDP 驱动真实键盘事件，断言流式渲染
# 真实用户数据（~/.config/my-deepseek-chat）完全不被触碰。
set -u
cd "$(dirname "$0")/.."

DIR=${E2E_DATA_DIR:-/tmp/my-deepseek-chat-e2e}
PORT=${MOCK_PORT:-8787}
DEBUG_PORT=${CDP_PORT:-9222}
LOG=/tmp/my-deepseek-chat-e2e.log

echo "==> 构建生产产物"
pnpm build >/dev/null 2>&1 || { echo "构建失败"; pnpm build; exit 1; }

echo "==> 准备临时数据目录 $DIR"
python3 - "$DIR" "$PORT" <<'PY'
import json, pathlib, shutil, sys
root = pathlib.Path(sys.argv[1]); port = sys.argv[2]
if root.exists():
    shutil.rmtree(root)
root.mkdir(parents=True)
(root / 'config.json').write_text(json.dumps({
    "version": 1, "baseUrl": f"http://127.0.0.1:{port}", "defaultModelId": "mock-flash",
    "defaultThinking": True, "defaultEffort": "high", "theme": "dark", "autoTitle": True,
    "window": {"width": 1180, "height": 800, "x": 120, "y": 90, "maximized": False,
               "sidebarWidth": 240, "panelWidth": 280,
               "sidebarCollapsed": False, "panelCollapsed": False}
}, indent=2) + "\n", encoding="utf-8")
# secret.json 的明文分支是 SecretService 支持的降级路径，用它绕过对系统密钥链的依赖
(root / 'secret.json').write_text(json.dumps({"plain": "sk-e2e-test"}) + "\n", encoding="utf-8")
(root / 'models.json').write_text(json.dumps({"fetchedAt": 0, "models": [
    {"id": "mock-flash", "name": "Mock Flash", "contextWindow": 1048576, "maxOutputTokens": None}
]}) + "\n", encoding="utf-8")
PY

# 端口被占用时必须直接失败：否则会连到一个旧的 mock 上，
# 表现成"莫名其妙的断言失败"，排查成本极高
if curl -s -m 1 -o /dev/null "http://127.0.0.1:$PORT/models" 2>/dev/null; then
  echo "✗ 端口 $PORT 已被占用：请先停掉残留的 mock 服务"
  exit 1
fi

echo "==> 启动 mock 服务"
MOCK_PORT="$PORT" node scripts/mock-deepseek.mjs >/tmp/mock-deepseek.log 2>&1 &
MOCK_PID=$!

ready=0
for _ in $(seq 1 30); do
  if curl -s -m 1 -o /dev/null -H 'authorization: Bearer sk-e2e'       "http://127.0.0.1:$PORT/models" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.3
done
if [ "$ready" != "1" ]; then
  echo "✗ mock 服务未就绪"
  cat /tmp/mock-deepseek.log 2>/dev/null
  exit 1
fi

echo "==> 启动应用（调试端口 $DEBUG_PORT）"
: >"$LOG"
setsid ./node_modules/electron/dist/electron . \
  --user-data-dir="$DIR" --remote-debugging-port="$DEBUG_PORT" >"$LOG" 2>&1 &
APP_PID=$!

cleanup() {
  kill -TERM -- -"$APP_PID" 2>/dev/null || kill -TERM "$APP_PID" 2>/dev/null || true
  sleep 1
  kill -KILL -- -"$APP_PID" 2>/dev/null || true
  kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 7
CDP_ENDPOINT="http://127.0.0.1:$DEBUG_PORT" node scripts/e2e-ui.mjs
RESULT=$?

echo "==> 渲染层错误检查"
if grep -qiE 'uncaught|ERR_FILE_NOT_FOUND|Failed to load resource' "$LOG"; then
  grep -iE 'uncaught|ERR_FILE_NOT_FOUND|Failed to load resource' "$LOG" | head -5
  RESULT=1
else
  echo "  ✓ 无渲染层致命错误"
fi

exit $RESULT
