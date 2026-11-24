# AGENTS.md

本地运行的 DeepSeek 桌面聊天助手：Electron + React + TypeScript，数据全部留在本机。

> **当前阶段：设计已定稿，代码尚未开始。** 第一个动作是 `docs/05-路线图.md` 的 **M0**，不是写 UI。

## 一、动手前先读文档

不要凭常识或训练数据里的"Electron 聊天应用"经验开工，本项目有明确规格。

| 你要做的事 | 先读 |
|---|---|
| 定范围、判断某功能该不该做 | `docs/01-产品需求.md` |
| 动请求、IPC、进程、错误处理、打包 | `docs/02-系统架构.md` |
| 动表结构、查询、持久化、导出 | `docs/03-数据模型.md` |
| 动界面、颜色、间距、组件、动效 | `docs/04-视觉规范.md` |
| 决定做哪一步、评估工作量 | `docs/05-路线图.md` |
| 想知道某个选择为什么这么定 | `docs/README.md` 的决策记录（ADR-01~15）|

## 二、当前阶段

- 里程碑顺序：M0 骨架 → M1 能聊 → M2 数据完整 → M3 体验成型 → M4 交付
- **禁止跳过里程碑**：M0 未完成（DB 通、迁移通、窗口起得来）不得开始 M1 之外的 UI 工作
- 每个里程碑都有 DoD，见 `docs/05-路线图.md` §1。完成后在 `docs/05-路线图.md` 勾选，不要自己另起清单

## 三、不可违反的约束（违反即 Bug，不接受"先这样后面再改"）

1. **渲染层禁止出网**。所有 HTTP 请求在主进程发出；CSP 固定 `connect-src 'none'`。
2. **API Key 永不进入 renderer**。`secret:*` 通道只返回 `{ hasKey: boolean }`；测试连接在主进程内实调。
3. **模型名零字面量**。代码里不得出现 `deepseek-v4-pro`、`deepseek-chat` 等字符串；一律来自 `/models` 缓存或用户手填。
4. **`reasoning_content` 必须落库**（`messages.reasoning`）。它是 DeepSeek 带 `tools` 时的回传前提，不是 UI 临时状态。
5. **禁止逐 token `setState`**。流式帧用 `requestAnimationFrame` 每帧最多合并一次渲染，且只更新正在增长的那一条消息。
6. **同一会话禁止并发请求**。UI 层置灰 + 主进程层二次校验。
7. **数据库只在主进程访问**。一律参数化 SQL，禁止字符串拼接。
8. **所有 IPC 入参过 zod**，返回统一信封 `{ ok, data } | { ok: false, code, message }`。
9. **颜色只用 CSS 变量令牌**（`--accent` 等）。组件里禁止硬编码 hex；明暗两套值改在 `tokens.css`。
10. **禁止 `outline: none` 裸奔**。焦点环统一 `2px --accent` + `2px offset`。
11. **图标只用 Font Awesome**，且在 `src/renderer/src/components/icons.ts` 的 `Icon` 映射里登记后取用；**禁止手写 SVG path，禁止拿 `▸ ✓ × ⋯ ✦` 等字符当图标**（字体回退会让它们在不同机器上漂移）。新增图标先登记再使用。
12. **输入区结构固定**：整条带（`bg-canvas` + 顶部 1px `--border`）与对话区分层；输入框占满中栏、最小两行；开关与发送键在输入框**之外**单独一行右对齐。不要把控件塞回输入框内部。

## 四、决策不可复议

`docs/README.md` 的 ADR 表已与产品 owner 逐项确认。**不要重新论证技术选型**（Electron vs Tauri、better-sqlite3 vs node:sqlite、树形 vs 线性会话等已定）。

确有必要变更时：先在 ADR 表追加一行（新 ID + 结论 + 触发原因），再改代码，再同步受影响的文档章节。

## 五、代码约定

- TypeScript `strict: true`；禁止 `any`，用 `unknown` + zod 收窄
- 路径别名：`@main/*`、`@preload/*`、`@renderer/*`、`@shared/*`
- 跨进程共享的类型放 `src/shared`；**renderer 不得反向 import main**
- 错误一律映射到 `AppErrorCode`（`docs/02` §7），不把裸 `Error`/堆栈透给 UI
- React 函数组件 + 具名导出，一个文件一个主组件
- 组件文件 `PascalCase.tsx`，其余 `camelCase.ts`
- 样式：Tailwind + CSS 变量；复杂条件 class 用 `cx()`，不拼模板字符串
- 注释只解释**为什么**，不复述代码在做什么
- 引入第三方库前先看 `docs/02` §1 技术栈表；**禁止引入整套组件库**（antd / MUI / Chakra），只用 Radix 原语

## 六、命令（M0 已可跑）

```bash
pnpm install      # 首次装依赖；若 electron 二进制缺失见下方“坑”
pnpm dev          # electron-vite 开发（渲染层 HMR，主进程改动自动重启）
pnpm typecheck    # tsc --noEmit，分 node / web 两侧
pnpm build        # typecheck + 产物输出到 out/
pnpm rebuild      # electron-rebuild -f -w better-sqlite3（改原生依赖后必须跑）
pnpm preview      # 用生产产物启动

pnpm test:migrations # 迁移测试：为每个历史版本造库 → 升级 → 断言数据/幂等/原子回滚/FTS 回填
pnpm smoke        # 主进程冒烟：真 ChatService + SQLite + 帧广播，自起 mock SSE，数据写临时目录
pnpm e2e:ui       # UI 端到端：CDP 驱动真实键盘事件，断言流式渲染（自动起 mock、临时 userData）
pnpm mock         # 单独起 mock DeepSeek（127.0.0.1:8787，Authorization 传 sk-fail-<status> 可注入故障）
```

**验证手段的优先级**：`smoke` 覆盖后端链路（协议/落库/中止/重生成/并发），`e2e:ui` 覆盖渲染层（帧合并、折叠块、输入框状态）。两者都不需要真实 API Key——因此改完代码先跑这两条，再让用户用真 Key 验收。

包管理器约定为 **pnpm 12**。若改用 npm/yarn，同步更新本节。

**两个已踩过的坑（不要再花时间排查）**

1. **pnpm 12 的构建脚本白名单键名是 `allowBuilds`**，写在 `pnpm-workspace.yaml`；旧的 `package.json` → `pnpm.onlyBuiltDependencies` 已完全不被读取（只会打 warning）。
2. **`electron` 的二进制下载脚本可能没被触发**（`node_modules/electron/dist/` 为空、无 `path.txt`）。补救：`node node_modules/electron/install.js`。判断方法：`ls node_modules/electron/path.txt`。
3. **e2e 的 mock 端口被残留进程占用**时，会连到旧版本 mock，表现成"莫名其妙的前端断言失败"。`scripts/run-e2e-ui.sh` 已加端口占用检查与就绪等待，看到它就先去清理残留进程。
4. **Vite 大版本必须与 `@vitejs/plugin-react` 对齐**：plugin-react 6.x 要求 Vite 8（用到 `vite/internal` 导出），装成 Vite 7 会在加载配置时报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

## 七、反模式清单（本项目最容易犯的）

| 反模式 | 正确做法 |
|---|---|
| 用 `EventSource` 做流式 | 它只支持 GET。用 `fetch` + `ReadableStream` 手解 SSE（`docs/02` §1） |
| 流完再 INSERT 整条消息 | 先 INSERT 空壳再每 200ms 增量 UPDATE（`docs/03` §5），否则崩溃全丢 |
| 手拼 `~/.config/xxx` | 用 `app.getPath('userData')`，三平台自动适配 |
| 让 renderer 直接 fetch API | 主进程发；renderer 侧 CSP 为 `connect-src 'none'` |
| 在 renderer 里做上下文 token 估算 | 主进程算好随帧/随 bootstrap 下发 |
| `messages` 做成线性数组 + 覆盖式重生成 | 用 `parent_id` 树 + `active_leaf_id`（`docs/03` §3.2） |
| 引入 antd/MUI 走捷径 | Radix 原语 + 自写样式 |
| 主题色写死 hex | 用 `tokens.css` 的变量 |
| 一次性把 M0~M4 全写了 | 严格按里程碑交付，每个里程碑可运行 |
| 用 xdotool 驱动 Wayland 窗口做 UI 测试 | 合成器不接受合成键事件。用 `--remote-debugging-port` + CDP 的 `Input.dispatchKeyEvent`（见 `scripts/e2e-ui.mjs`） |
| 递归 CTE 里用 `m.parent_id = t.id` 回溯父节点 | 那是向下找子节点，只会返回叶子一条。正确写法是 `m.id = t.parent_id` |
| 渲染层拿缓存的 `session.activeLeafId` 去查线程 | 该值在 `end` 帧到达时会落后一轮，新回答会从界面消失。让主进程按数据库的 `active_leaf_id` 解析 |
| 用 `pkill -f <pattern>`，而 pattern 又出现在同一条命令里 | 会杀掉自己的 shell。把 pattern 写进脚本文件再调用 |
| 把 Shiki 语言静态 import 进主 chunk | 8 种语言就是 1MB+。走 `shiki/langs/*.mjs` 动态 import |
| 在 `pointerup` 里提交 `props.width` | `pointermove` 与 `pointerup` 常在同一任务内，props 还没更新，会把宽度写回起点。用 ref 存最近一次计算值 |
| 用 `aside` 选中"侧栏" | 右栏参数面板也是 `<aside>`。用 `[aria-label="折叠侧栏"]` 这类专属标记定位 |
| 用 `app.getName()` 决定 userData | 打包后它变成 productName，数据目录会换位置。在 ready 之前 `app.setName('my-deepseek-chat')` 固定 |
| 手绘 SVG 或字符当图标 | 用 `Icon.xxx`（Font Awesome）。字符图标随字体回退漂移，自绘描边宽度难统一 |
| 把配置默认值改了就以为老用户生效 | `config.json` 有 `version` 字段，改默认值必须加版本号 + 一次性迁移，否则老配置永远停在旧值 |
| 用 `disabled:opacity-40` 处理彩色按钮 | 白字配 40% 透明度的强调色基本看不见。禁用态应换成中性底色 + 次要文字色 |

## 八、提交与产物

- 提交信息带里程碑前缀：`M0: 接入 better-sqlite3 与首版迁移`
- 一个里程碑内保持原子提交，一次提交只做一件可描述的事
- **不提交**：`dist/`、`out/`、`*.node`、`node_modules/`、任何 `userData` 内容、真实 API Key
- 交付前对照 `docs/05-路线图.md` §6 验收总表逐条打勾

## 九、文档同步规则

设计变更的执行顺序固定为：**改 docs 对应章节 → 改代码 → 再自查文档与代码是否一致**。

当文档与代码冲突时，以文档为准——除非文档本身已先被更新。发现文档有错或过时时，直接修文档并说明原因，不要默默按自己的理解写代码。

## 十、待确认事项

`docs/05-路线图.md` §5 列了 5 个开放问题（"继续生成"、自动标题模型、sqlite 驱动备选路径、JSON 再导入、多窗口）。这些尚未定论，遇到时按该表给出的默认决策推进，并在实现后把结论写回文档。
