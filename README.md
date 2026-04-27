# 迷径寻宝 Maze Gold Rush

双人在线 + 单人探索的迷宫寻宝网页游戏。在随机生成的迷宫里寻找宝藏，先到者获胜。

**在线体验：** https://panning.dengjiabei.cn

## 游戏玩法

### 单人探索
1. 选择难度（简单 / 中等 / 困难），点击"开始探索"
2. 用 **方向键** 移动，找到金块即通关
3. 通关后展示用时、步数与最优步数

### 双人在线
1. 输入昵称 → 点击"创建房间"，把房间链接（或 6 位房号）发给好友
2. 好友点击邀请链接 → 输入昵称加入
3. 房主选择难度 → 对手点"准备" → 房主点"开始游戏"
4. 倒计时 3-2-1-GO 后开始竞速，先到达金块的玩家获胜

## 功能特性

- 单人模式 + 双人在线两种玩法
- 三档难度（简单 8x8 / 中等 12-15x15 / 困难 18-25x25）；困难模式带迷雾视野
- Canvas 渲染迷宫，平滑移动动画 + 程序化合成音效
- WebSocket 实时对战，双方位置实时同步
- 房间系统：6 位数字房号 + 链接邀请 + 房主转让
- **持久化的服务端状态**：Worker 重启 / Durable Object hibernation 都不丢房间
- 断线重连（30 秒宽限期）、心跳保活
- 投降 / 再来一局 / 平局检测
- 游戏结束展示：用时、步数、最优步数对比

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Vite + Twind |
| 后端 | Cloudflare Workers + Durable Objects（SQLite-backed） |
| 通信 | WebSocket（Hibernation API） |
| 渲染 | Canvas 2D + Web Audio API（程序化合成） |
| 部署 | Cloudflare Pages + Workers，GitHub Actions CI/CD |

## 项目结构

```
panning/
├── src/                          # 前端
│   ├── main.tsx                  # 入口
│   ├── App.tsx                   # 路由 + 会话管理 + 邀请链接处理
│   ├── api.ts                    # API/WebSocket 基础地址
│   ├── pages/
│   │   ├── Home.tsx              # 首页（创建/加入房间 + 单人入口）
│   │   ├── Room.tsx              # 双人对战页面
│   │   └── SinglePlayer.tsx      # 单人探索页面
│   ├── components/
│   │   ├── MazeCanvas.tsx        # Canvas 迷宫渲染（带 lerp 平滑）
│   │   ├── PlayerBar.tsx         # 顶部信息栏（房号/分享/转让）
│   │   ├── CountdownOverlay.tsx  # 倒计时遮罩
│   │   ├── GameResultModal.tsx   # 结果弹窗
│   │   ├── Confetti.tsx          # 胜利纸屑动画
│   │   └── ChatPanel.tsx         # 聊天面板
│   ├── hooks/
│   │   ├── useWebSocket.ts       # WebSocket 连接 + 重连 + 心跳
│   │   └── useSound.ts           # Web Audio API 程序化合成音效
│   ├── types/
│   │   └── protocol.ts           # 通信协议类型
│   └── utils/
│       └── maze.ts               # 客户端迷宫工具（单人模式生成 + 最短路径）
│
├── worker/                        # Cloudflare Worker 后端
│   ├── src/
│   │   ├── index.ts              # Worker 入口 + HTTP 路由 + CORS
│   │   ├── room.ts               # MazeRoom Durable Object（持久化全状态）
│   │   └── maze.ts               # 服务端迷宫生成（迭代回溯 + 公平性约束）
│   ├── wrangler.toml
│   └── package.json
│
├── .github/workflows/             # CI/CD
│   ├── deploy-pages.yml           # 推送 master → 部署前端
│   └── deploy-worker.yml          # worker/** 变更 → 部署 Worker
│
└── package.json
```

## 通信协议

WebSocket 上的 JSON 消息（详见 `src/types/protocol.ts`）：

**Client → Server**: `join` / `ready` / `setDifficulty` / `setTimer` / `startGame` / `move` / `chat` / `playAgain` / `surrender` / `transferOwner` / `leave` / `ping`

**Server → Client**: `roomState` / `playerJoined` / `playerLeft` / `phaseChange` / `gameStart` / `playerMoved` / `gameEnd` / `difficultyChanged` / `timerChanged` / `readyChanged` / `chat` / `roomClosed` / `error`

## 房间生命周期

```
waiting (等对手)  →  readying (准备阶段)  →  playing (游戏中)  →  ended (已结束)
                          ↑                                           ↓
                          └────── playAgain ──────────────────────────┘
```

- `waiting`：仅一个玩家在房间
- `readying`：两个玩家都在，等对手准备 + 房主开始
- `playing`：游戏进行中，4 秒倒计时后可移动
- `ended`：游戏结束，房主可"再来一局"

## 服务端状态持久化（重要）

**MazeRoom Durable Object 把所有房间状态（roomCode、玩家列表、阶段、迷宫数据、聊天记录、定时器等）持久化到 `ctx.storage`**：

- 构造函数里 `blockConcurrencyWhile` 加载状态
- 每次状态变更后调用 `persist()` 写入 storage
- WebSocket Hibernation 唤醒后通过 `ctx.getWebSockets()` + attachment 重新建立 player ↔ ws 映射

如果不持久化，DO hibernation / Worker 重新部署 / 实例驱逐都会让房间状态全丢失，表现为：
- 邀请链接 GET `/api/rooms/:code` 返回空 roomCode → 前端报"房间不存在"
- 玩家 WebSocket 还活着但服务端忘了他是谁 → 操作全静默失败 → 像断线

## 本地开发

```bash
# 安装依赖
npm install
cd worker && npm install && cd ..

# 启动前端（默认 http://localhost:5173）
npm run dev

# 启动后端 Worker（另开一个终端，需要 wrangler 登录）
npm run dev:worker
```

### 环境变量

`.env.development` / `.env.production` 控制前端调用的 API 基址：

```
VITE_API_BASE=https://panning.dengjiabei.cn
```

不设置时（或 .env.local 留空）会使用 `window.location.origin` 走 Vite 代理（见 `vite.config.ts`）。
本地连接本地 Worker 时，可以在 `.env.local` 中改写：

```
VITE_API_BASE=http://localhost:8787
```

## 部署

推送到 `master` 分支会自动触发 GitHub Actions：

- **前端** → Cloudflare Pages（`deploy-pages.yml`）
- **Worker** → Cloudflare Workers（`deploy-worker.yml`，仅 `worker/**` 变更时触发）

手动部署：

```bash
# Worker（后端）
npm run deploy:worker      # 或 pnpm deploy:worker / yarn deploy:worker

# 前端 Pages
npm run deploy:pages       # 或 pnpm deploy:pages / yarn deploy:pages

# 一次部前后端
npm run deploy:all         # 或 pnpm deploy:all / yarn deploy:all
```

> 注意：聚合脚本叫 `deploy:all` 而不是 `deploy`，因为 `pnpm deploy` 是 pnpm 的保留命令（workspace 部署）会被劫持。

底层依赖根目录的 `wrangler` devDependency；如果是首次拉仓库别忘了 `npm install` / `pnpm install`。

需要在 GitHub 仓库 Settings → Secrets 中配置：

- `CF_API_TOKEN` — Cloudflare API Token
- `CF_ACCOUNT_ID` — Cloudflare Account ID

## 迷宫生成算法

服务端使用**迭代回溯法**（Iterative Backtracker）生成迷宫，保证：

- 迷宫完全连通，任意两点之间至少有一条路径
- 使用显式栈代替递归，适配 Cloudflare Workers 受限调用栈
- 两个入口之间的欧几里得距离 >= 对角线长度的 40%
- 金块放置保证公平性：到两个入口的路径长度差异 <= 30%（首选阈值）

单人模式由前端 `src/utils/maze.ts` 生成，会在生成树之上额外打通 8%–12% 的内部墙壁制造岔路与环路。

## 故障排查

| 现象 | 可能原因 / 检查 |
|------|----------------|
| 邀请链接进不去房间，提示"房间不存在" | 服务端 DO 状态丢失。已通过持久化修复，确认部署的是最新 worker 代码 |
| 双方一会儿就掉线、操作无效 | 同上，DO 状态丢失导致服务端忘了玩家身份 |
| 本地开发 wrangler 报错 | 检查 `wrangler login`、`wrangler.toml` 中的 `compatibility_date` 与 `new_sqlite_classes` 迁移 |
| WebSocket 连不上 | 检查 `getWsBase()` 返回的 URL 协议（`ws://` / `wss://`），CORS 头是否被 Cloudflare 路由命中 |

## License

MIT
