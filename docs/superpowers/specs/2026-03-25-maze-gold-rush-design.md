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

**迷宫生成算法：** 递归回溯法（Recursive Backtracker），保证迷宫连通且有唯一路径结构。

## 房间状态机

```
waiting → readying → countdown → playing → ended
                                              ↓
                                          (再来一局)
                                              ↓
                                          readying
```

| 阶段 | 触发条件 | 行为 |
|------|---------|------|
| waiting | 房主创建房间 | 显示房间码和分享链接，等待对手加入 |
| readying | 第二人加入 | 房主选择难度和限时；对手点"准备" |
| countdown | 房主点"开始游戏" | 全屏半透明遮罩倒计时 3→2→1→GO!，服务端生成迷宫 |
| playing | 倒计时结束 | 方向键移动，Canvas 实时渲染，到达金子触发胜利 |
| ended | 到达金子 / 超时 | 弹窗显示胜负结果，房主可选"再来一局" |

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
│   │   └── room.ts              # MazeRoom Durable Object
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
| `join` | `{ name }` | 加入房间 |
| `ready` | — | 标记准备（非房主） |
| `setDifficulty` | `{ difficulty: 'easy' \| 'medium' \| 'hard' }` | 房主设置难度 |
| `setTimer` | `{ minutes: number \| null }` | 房主设置限时（null=无限时） |
| `startGame` | — | 房主开始游戏 |
| `move` | `{ direction: 'up' \| 'down' \| 'left' \| 'right' }` | 移动 |
| `chat` | `{ text }` | 聊天 |
| `playAgain` | — | 再来一局 |
| `leave` | — | 离开房间 |
| `ping` | — | 心跳 |

### 服务端 → 客户端

| 类型 | 载荷 | 用途 |
|------|------|------|
| `roomState` | 完整房间状态 | 加入时同步 |
| `playerJoined` | `{ id, name }` | 对手加入 |
| `playerLeft` | `{ id }` | 对手离开 |
| `phaseChange` | `{ phase }` | 阶段变更 |
| `countdown` | `{ count: 3\|2\|1\|0 }` | 倒计时 |
| `gameStart` | `{ maze, gold, entrances, assignments }` | 游戏开始 + 迷宫数据 |
| `playerMoved` | `{ playerId, position }` | 位置更新 |
| `gameEnd` | `{ winnerId, reason }` | 游戏结束 |
| `difficultyChanged` | `{ difficulty }` | 难度变更广播 |
| `timerChanged` | `{ minutes }` | 限时变更广播 |
| `readyChanged` | `{ playerId, ready }` | 准备状态变更 |
| `chat` | `{ playerId, name, text }` | 聊天消息 |
| `error` | `{ message }` | 错误 |

## 迷宫数据结构

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

## 迷宫生成

- **算法**：递归回溯法（Recursive Backtracker）
- **执行位置**：服务端（Durable Object 内），防止客户端作弊
- **生成时机**：房主点击"开始游戏"后，倒计时期间生成
- **入口选择**：从迷宫边缘格子中随机选取两个，确保两个入口之间有足够距离（至少迷宫对角线长度的 40%）
- **金子放置**：随机选取迷宫内部格子，确保距离两个入口的路径长度差异不超过 30%（保证公平性）

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
- 可见区域：以玩家为中心的圆形区域（半径 ~3 格）
- 已探索区域：保持可见但略微变暗
- 未探索区域：完全遮罩（黑色）
- 迷雾状态存储在客户端（二维 boolean 数组）

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
