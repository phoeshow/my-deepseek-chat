# my-deepseek-chat

本地运行的 DeepSeek 桌面聊天助手。Electron + React + TypeScript，数据全部留在本机。

> 当前状态：**v1.0 已交付**（M0–M4 完成，Linux 产物实测可用），**v1.1 增量进行中**（跨会话搜索 / 消息版本切换 / 用量仪表盘 / 会话归档已交付）。

## 文档

从 [docs/README.md](./docs/README.md) 开始，那里有阅读顺序与完整决策记录。

> 用 AI agent 参与开发时，先看 [AGENTS.md](./AGENTS.md)：硬性约束、反模式清单、里程碑纪律都写在那里。

| 文档 | 内容 |
|---|---|
| [docs/01-产品需求](./docs/01-产品需求.md) | 功能清单、优先级、验收标准、边界情况 |
| [docs/02-系统架构](./docs/02-系统架构.md) | 进程模型、IPC 契约、流式协议、错误模型、安全 |
| [docs/03-数据模型](./docs/03-数据模型.md) | SQLite schema、树形会话、写入策略、导出格式 |
| [docs/04-视觉规范](./docs/04-视觉规范.md) | 布局栅格、设计令牌、组件状态、动效、键位 |
| [docs/05-路线图](./docs/05-路线图.md) | M0–M4 里程碑、v1.1 backlog、风险、验收总表 |

## 核心设计取向

- **本地优先**：除 DeepSeek API 外无任何网络出口，无账号、无遥测
- **Key 不出主进程**：渲染层永远拿不到明文 Key
- **中断不丢数据**：流式期间每 200ms 落库，最坏丢 200ms 输出
- **协议不写死**：模型名与能力运行时 `GET /models` 拉取，本地缓存兜底
- **树形会话**：v1 只露主线，为将来的消息编辑与版本切换留零迁移路径

## 构建产物

```bash
pnpm dist        # 产出 release/ 下的 AppImage 与 tar.gz
```

| 产物 | 适用 | 运行方式 |
|---|---|---|
| `release/my-deepseek-chat-1.0.0.tar.gz`（132MB） | 任意发行版，**无系统依赖** | `tar -xzf ... && ./my-deepseek-chat-1.0.0/my-deepseek-chat` |
| `release/DeepSeek Chat-1.0.0.AppImage`（139MB） | 任意发行版，需 FUSE2 | `chmod +x` 后运行；Arch 需先 `sudo pacman -S fuse2`，或加 `--appimage-extract-and-run` |

两者共用同一份 `~/.config/my-deepseek-chat`：开发态攒的对话与 API Key 会直接带过去。

## 开发

```bash
pnpm install          # 首次安装（electron 二进制缺失时见 AGENTS.md §6）
pnpm dev              # 开发模式（HMR）
pnpm typecheck        # 类型检查
pnpm test:migrations  # 迁移测试（20 项）
pnpm smoke            # 主进程冒烟（88 项）
pnpm e2e:ui           # UI 端到端（85 项，CDP 驱动真实键盘事件）
pnpm clean            # 清空 tmp/ 与 release/（--tmp-only / --release-only 可分开清）
```

工作区约定：一次性脚本与截图放 `./tmp/`（已 gitignore，不会被提交，也不随系统重启丢失）；可复用的验证脚本放 `./scripts/` 并入库。

包管理器约定 **pnpm**；改原生依赖后需跑 `electron-rebuild`（见 AGENTS.md §6）。

## 后续

v1.1 backlog 见 [docs/05-路线图](./docs/05-路线图.md) §3：搜索 / 版本切换 / 用量 / 会话归档 / 编辑消息分叉已交付；下一步是系统提示词预设库与多 provider 选择器。
