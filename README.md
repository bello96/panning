# 迷宫淘金 Maze Gold Rush

双人在线迷宫淘金网页游戏。两名玩家在随机生成的迷宫中竞速寻找金块，先到者获胜。

**在线体验：** https://panning.dengjiabei.cn

## 游戏玩法

1. 创建房间，分享房间链接给好友
2. 双方进入房间后，房主选择难度，对手点击准备
3. 房主点击开始游戏，倒计时 3-2-1-GO 后开始
4. 使用 **方向键** 控制移动，在迷宫中寻找金块
5. 先到达金块位置的玩家获胜

## 功能特性

- 三档难度（简单 8x8 / 中等 15x15 / 困难 25x25），路径复杂度递增
- Canvas 渲染迷宫，平滑移动动画
- WebSocket 实时对战，双方位置实时同步
- 房间系统：创建、加入、分享链接邀请
- 断线重连（30 秒宽限期）
- 投降 / 再来一局 / 转让房主
- 游戏计时与结果展示

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Vite + Twind |
| 后端 | Cloudflare Workers + Durable Objects |
| 通信 | WebSocket |
| 渲染 | Canvas 2D |
| 部署 | Cloudflare Pages + Workers，GitHub Actions CI/CD |

## 项目结构

```
panning/
├── src/                          # 前端
│   ├── main.tsx                  # 入口
│   ├── App.tsx                   # 路由 + 会话管理
│   ├── api.ts                    # API/WebSocket 基础地址
│   ├── pages/
│   │   ├── Home.tsx              # 首页（创建/加入房间）
│   │   └── Room.tsx              # 游戏页面（核心状态管理）
│   ├── components/
│   │   ├── MazeCanvas.tsx        # Canvas 迷宫渲染
│   │   ├── PlayerBar.tsx         # 顶部信息栏
│   │   ├── CountdownOverlay.tsx  # 倒计时遮罩
│   │   ├── GameResultModal.tsx   # 结果弹窗
│   │   └── Confetti.tsx          # 胜利纸屑动画
│   ├── hooks/
│   │   └── useWebSocket.ts       # WebSocket 连接管理
│   ├── types/
│   │   └── protocol.ts           # 通信协议类型
│   └── utils/
│       └── maze.ts               # 迷宫工具函数
│
├── worker/                        # Cloudflare Worker 后端
│   ├── src/
│   │   ├── index.ts              # Worker 入口 + HTTP 路由
│   │   ├── room.ts               # MazeRoom Durable Object
│   │   └── maze.ts               # 迷宫生成算法（迭代回溯法）
│   ├── wrangler.toml
│   └── package.json
│
├── .github/workflows/             # CI/CD
│   ├── deploy-pages.yml
│   └── deploy-worker.yml
│
└── package.json
```

## 本地开发

```bash
# 安装依赖
npm install
cd worker && npm install && cd ..

# 启动前端（默认 http://localhost:5173）
npm run dev

# 启动后端（需要另开终端）
npm run dev:worker
```

## 部署

推送到 `master` 分支会自动触发 GitHub Actions：

- **前端** → Cloudflare Pages（`deploy-pages.yml`）
- **Worker** → Cloudflare Workers（`deploy-worker.yml`，仅 `worker/**` 变更时触发）

手动部署：

```bash
# 前端
npm run build
npx wrangler pages deploy dist --project-name=panning

# Worker
cd worker && npx wrangler deploy
```

需要在 GitHub 仓库 Settings → Secrets 中配置：

- `CF_API_TOKEN` — Cloudflare API Token
- `CF_ACCOUNT_ID` — Cloudflare Account ID

## 迷宫生成算法

使用**迭代回溯法**（Iterative Backtracker）在服务端生成迷宫，保证：

- 迷宫完全连通，任意两点之间有且仅有一条路径
- 使用显式栈代替递归，适配 Cloudflare Workers 调用栈限制
- 两个入口之间的欧几里得距离 >= 对角线长度的 40%
- 金块放置保证公平性：到两个入口的路径长度差异 <= 30%

## License

MIT
