# 双人迷宫淘金网页游戏 — 设计文档

## 概述

一个在线双人竞速迷宫游戏。两名玩家通过房间系统匹配，在随机生成的迷宫中竞速寻找金子，先到者获胜。

**部署目标：**
- 前端：Cloudflare Pages → https://panning.dengjiabei.cn
- 后端：Cloudflare Workers
- 代码仓库：https://github.com/bello96/panning

## 技术栈

与参考项目 gomoku 完全一致：

- **前端**：React 18 + TypeScript + Vite + Twind
- **后端**：Cloudflare Workers + Durable Objects + SQLite
- **通信**：WebSocket（原生）
- **渲染**：Canvas 2D
- **部署**：GitHub Actions CI/CD

## 游戏规则

1. 房主创建房间，选择难度和限时设置
2. 对手通过房间码或分享链接加入
3. 系统根据难度生成正方形迷宫，迷宫内随机放置一个金子
4. 迷宫有两个随机入口，双方随机分配到入口处
5. 对手准备后，房主点击开始，倒计时 3→2→1→GO! 后游戏开始
6. 双方用方向键控制移动，实时可见对方位置
7. 先到达金子所在格子的玩家获胜
8. 若设置了限时，超时则判平局

## 难度系统

难度通过迷宫格子大小控制——格子越小，路径越窄，弯道越多，迷宫越复杂。迷宫画布大小固定，难度改变的是格子数量。

| 参数 | 简单 | 中等 | 困难 |
|------|------|------|------|
| 迷宫格数 | ~8×8 | ~15×15 | ~25×25 |
| 路径宽度 | 宽 | 中 | 窄 |
| 弯道密度 | 少 | 适中 | 多 |
| 视野模式 | 全局可见 | 全局可见 | 迷雾探索 |

**迷雾探索（困难模式）：**
- 玩家只能看到角色周围一定范围的区域
- 走过的路径保持可见（已探索区域不会重新变暗）
- 对方位置仍然实时可见（在已探索区域内或在迷雾中显示为模糊标记）

**迷宫生成算法：** 迭代回溯法（Iterative Backtracker，使用显式栈代替递归），保证迷宫连通且有唯一路径结构。使用迭代版本以避免 Cloudflare Workers 调用栈限制。

## 房间状态机

服务端维护四个阶段。倒计时是 `readying → playing` 过渡期间的客户端 UI 效果，不是独立的服务端 phase。

```
waiting → readying → playing → ended
                                 ↓
                             (再来一局)
                                 ↓
                             readying
```

| 阶段 | 触发条件 | 行为 |
|------|---------|------|
| waiting | 房主创建房间 | 显示房间码和分享链接，等待对手加入 |
| readying | 第二人加入 | 房主选择难度和限时；对手点"准备" |
| playing | 房主点"开始游戏" | 服务端生成迷宫，广播 `gameStart`（含迷宫数据），客户端收到后显示倒计时遮罩 3→2→1→GO!，倒计时结束后客户端允许移动操作 |
| ended | 到达金子 / 超时 | 弹窗显示胜负结果。房主端显示"再来一局"按钮，对手端显示"等待房主操作"。房主点击后回到 readying，可重新选择难度 |

**倒计时时序：**
1. 房主点击"开始游戏" → 发送 `startGame`
2. 服务端生成迷宫 → phase 变为 `playing` → 广播 `gameStart`（含迷宫数据 + 游戏开始时间戳，时间戳 = 当前时间 + 4秒）
3. 客户端收到 `gameStart` → 渲染迷宫 + 显示倒计时遮罩 3→2→1→GO!
4. 到达游戏开始时间戳 → 客户端允许发送 `move` 消息
5. 服务端忽略开始时间戳之前收到的 `move` 消息

**倒计时期间断线：** 服务端已进入 playing phase，按正常断线重连处理（30 秒宽限期）。重连后客户端根据 `roomState` 中的开始时间戳判断是否仍在倒计时。

## 页面布局

### 首页 (Home)

- 昵称输入（最长 12 字符）
- 创建房间按钮
- 加入房间（输入 6 位房间码）

### 游戏页面 (Room) — 左右分栏布局

```
┌─ PlayerBar（房间信息 + 倒计时 + 难度标签）──────────────┐
├──────────────────────┬─────────────────────────────────────┤
│                      │                                     │
│  玩家A信息 / 玩家B信息│         💬 聊天面板                │
│                      │    - 实时聊天                       │
│  ┌────────────────┐  │    - 系统消息                       │
│  │                │  │    - 游戏事件                       │
│  │   Canvas 迷宫   │  │                                     │
│  │                │  │                                     │
│  └────────────────┘  │                                     │
│                      │                                     │
│  操作按钮区          │    消息输入框                       │
│  (准备/开始/再来)    │                                     │
└──────────────────────┴─────────────────────────────────────┘
```

- 左栏：弹性伸缩，包含玩家信息 + Canvas 迷宫 + 操作按钮
- 右栏：固定宽度（~288px），聊天面板

## 项目结构

```
panning/
├── src/
│   ├── main.tsx                 # 入口，Twind 初始化
│   ├── App.tsx                  # 路由 + 会话管理
│   ├── api.ts                   # API/WebSocket 基础配置
│   ├── pages/
│   │   ├── Home.tsx             # 创建/加入房间
│   │   └── Room.tsx             # 游戏主页面（状态管理核心）
│   ├── components/
│   │   ├── MazeCanvas.tsx       # Canvas 迷宫渲染 + 迷雾效果
│   │   ├── ChatPanel.tsx        # 聊天面板
│   │   ├── PlayerBar.tsx        # 玩家信息栏
│   │   ├── CountdownOverlay.tsx # 倒计时遮罩 3-2-1-GO
│   │   └── GameResultModal.tsx  # 胜负结果弹窗
│   ├── hooks/
│   │   └── useWebSocket.ts      # WebSocket Hook
│   ├── types/
│   │   └── protocol.ts          # 通信协议类型定义
│   └── utils/
│       └── maze.ts              # 迷宫渲染辅助函数
│
├── worker/
│   ├── src/
│   │   ├── index.ts             # Worker 入口 + HTTP 路由
│   │   ├── room.ts              # MazeRoom Durable Object
│   │   └── maze.ts              # 迷宫生成算法（迭代回溯法）
│   ├── wrangler.toml
│   └── package.json
│
├── .github/workflows/
│   ├── deploy-pages.yml         # 前端部署到 Cloudflare Pages
│   └── deploy-worker.yml        # Worker 部署
│
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## WebSocket 协议

### 客户端 → 服务端

| 类型 | 载荷 | 用途 |
|------|------|------|
| `join` | `{ playerName, playerId? }` | 加入房间（playerId 用于断线重连身份恢复） |
| `ready` | — | 标记准备（非房主） |
| `setDifficulty` | `{ difficulty: 'easy' \| 'medium' \| 'hard' }` | 房主设置难度 |
| `setTimer` | `{ minutes: 3 \| 5 \| 10 \| null }` | 房主设置限时（null=无限时） |
| `startGame` | — | 房主开始游戏 |
| `move` | `{ direction: 'up' \| 'down' \| 'left' \| 'right' }` | 移动 |
| `chat` | `{ text }` | 聊天 |
| `playAgain` | — | 再来一局（仅房主可发送） |
| `leave` | — | 离开房间 |
| `ping` | — | 心跳 |

### 服务端 → 客户端

| 类型 | 载荷 | 用途 |
|------|------|------|
| `roomState` | 见下方 RoomState 定义 | 加入/重连时同步完整状态 |
| `playerJoined` | `{ id, name }` | 对手加入 |
| `playerLeft` | `{ id }` | 对手离开 |
| `phaseChange` | `{ phase }` | 阶段变更 |
| `gameStart` | `{ maze, assignments, gameStartsAt }` | 游戏开始 + 迷宫数据 + 开始时间戳 |
| `playerMoved` | `{ playerId, position }` | 位置更新 |
| `gameEnd` | `{ winnerId, reason }` | 游戏结束（reason: 'gold' / 'timeout' / 'disconnect'） |
| `difficultyChanged` | `{ difficulty }` | 难度变更广播 |
| `timerChanged` | `{ minutes }` | 限时变更广播 |
| `readyChanged` | `{ playerId, ready }` | 准备状态变更 |
| `chat` | `{ playerId, name, text }` | 聊天消息 |
| `roomClosed` | `{ reason }` | 房间关闭（超时/全员离开） |
| `error` | `{ message }` | 错误 |

## 数据结构

### 迷宫数据

```typescript
// 每个格子的墙壁状态（位掩码）
// 1 = 上墙, 2 = 右墙, 4 = 下墙, 8 = 左墙
type Cell = number;

interface MazeData {
  size: number;                    // 格子数（8 / 15 / 25）
  cells: Cell[][];                 // size × size 二维数组
  gold: { x: number; y: number }; // 金子位置
  entrances: [
    { x: number; y: number },     // 入口 1
    { x: number; y: number }      // 入口 2
  ];
}

interface PlayerAssignment {
  [playerId: string]: {
    entrance: number;              // 0 或 1，对应 entrances 索引
    position: { x: number; y: number };
  };
}
```

### RoomState（完整房间状态）

```typescript
interface RoomState {
  roomCode: string;
  phase: 'waiting' | 'readying' | 'playing' | 'ended';
  ownerId: string;
  players: {
    id: string;
    name: string;
    online: boolean;
    ready: boolean;
  }[];
  difficulty: 'easy' | 'medium' | 'hard';
  timerMinutes: 3 | 5 | 10 | null;      // null = 无限时
  // playing / ended 阶段才有以下字段
  maze?: MazeData;
  assignments?: PlayerAssignment;
  gameStartsAt?: number;                // 游戏开始时间戳（ms）
  positions?: { [playerId: string]: { x: number; y: number } };
  winnerId?: string | null;             // ended 阶段，null = 平局
  explored?: { [playerId: string]: boolean[][] }; // 困难模式迷雾探索状态
}
```

## 迷宫生成

- **算法**：迭代回溯法（Iterative Backtracker，显式栈），避免 Workers 调用栈限制
- **执行位置**：服务端（Durable Object 内），防止客户端作弊
- **生成时机**：房主点击"开始游戏"后，服务端立即生成，随 `gameStart` 消息广播
- **入口选择**：从迷宫边缘格子中随机选取两个，确保两个入口之间的欧几里得直线距离 >= 迷宫对角线长度的 40%
- **金子放置**：使用 BFS 计算从两个入口到所有格子的路径长度，选取满足 `|pathA - pathB| / max(pathA, pathB) <= 0.3` 的格子，从中随机选一个。若无满足条件的格子，放宽至 0.5；仍无则取差异最小的格子
- **服务端迷宫文件**：迷宫生成逻辑位于 `worker/src/maze.ts`

## Canvas 渲染

### 迷宫绘制
- 背景色：深色系（#0a0a23）
- 墙壁色：#3a506b，线宽根据难度调整
- 路径色：#111（暗色通道）
- 迷宫自适应容器大小（ResizeObserver）
- 支持高 DPI 屏幕（devicePixelRatio）

### 元素渲染
- **玩家 A**：蓝色圆形（#4cc9f0）+ 字母标记
- **玩家 B**：粉红色圆形（#f72585）+ 字母标记
- **金子**：金色圆形（#ffd700）+ 闪烁动画
- **入口**：墙壁缺口 + 微弱光效标记

### 迷雾效果（困难模式）
- 使用 Canvas 的 `globalCompositeOperation` 实现
- 可见区域：以玩家为中心的圆形区域，半径 3 格（欧几里得距离）
- 已探索区域：保持可见但略微变暗（opacity 0.6）
- 未探索区域：完全遮罩（黑色）
- 迷雾探索状态存储在**服务端**（`explored` 字段），确保断线重连时不丢失探索进度

## 移动与碰撞

### 移动验证
- 客户端按方向键 → 本地校验是否有墙（位掩码判断）→ 合法则立即移动（客户端预测）+ 发送 `move` 消息
- 服务端收到 `move` → 二次校验合法性 → 合法则更新位置并广播 `playerMoved`；非法则发送 `error` + 强制回退位置
- 服务端忽略 `gameStartsAt` 时间戳之前的 `move` 消息

### 移动节流
- 客户端最小移动间隔：80ms（防止消息泛滥）
- 在间隔内的按键排队，间隔到达后发送最近的方向

### 胜负判定
- 服务端在每次合法移动后检查玩家位置是否与金子重合
- 同时到达：按服务端消息处理顺序，先处理的 `move` 先判定（先到先得）
- 超时判定：服务端通过 Durable Object alarm 定时触发

### 键盘与聊天冲突
- 聊天输入框获得焦点时，方向键事件不触发移动
- 按 Enter 聚焦/提交聊天，按 Escape 取消聊天焦点回到游戏

## 断线重连

复用 gomoku 的机制：

- 30 秒宽限期，期间可重连恢复
- 5 秒快速离线（sendBeacon）用于标签页关闭
- `sessionStorage` 保存会话信息
- WebSocket 自动重连：1s → 2s → 4s → 8s → 15s 指数退避
- 心跳：每 25 秒 ping
- 游戏中对方断线超时 → 当前玩家获胜
- 5 分钟无活动 → 房间自动关闭

## 部署架构

### 前端 (Cloudflare Pages)
- 触发：push 到 master 分支（排除 worker/** 文件）
- 构建：`npm run build` → `dist/`
- 域名：panning.dengjiabei.cn

### 后端 (Cloudflare Workers)
- 触发：push 修改 worker/** 文件
- 部署：`wrangler deploy`
- 路由：`panning.dengjiabei.cn/api/*`
- Durable Objects：MazeRoom（SQLite 绑定）

### HTTP API

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/rooms` | 创建房间，返回 roomCode |
| GET | `/api/rooms/:code` | 查询房间信息 |
| POST | `/api/rooms/:code/quickleave` | 快速离线通知 |
| GET | `/api/rooms/:code/ws` | WebSocket 升级 |

## 视觉设计

- **整体风格**：深色系游戏风格
- **配色方案**：深蓝底色（#1a1a2e / #0a0a23），蓝色主题（#4cc9f0）
- **玩家标识**：蓝色 vs 粉红色，对比鲜明
- **金子**：金色（#ffd700）+ 闪烁动画吸引注意力
- **倒计时**：全屏半透明遮罩 + 居中大字数字
- **胜利效果**：彩色纸屑动画（复用 gomoku 的 Confetti 组件）

## 平台支持

- 当前版本：仅 PC 端
- 控制方式：键盘方向键
- 未来可扩展：手机端虚拟方向键
