# CLAUDE.md

供 Claude / 其他 AI 助手在本仓库工作时参考。给新加入此仓库的协作者提供一份"读完就能动手"的导航。

## 项目一句话定位

`panning` 是一个部署在 **Cloudflare Pages + Workers + Durable Objects** 上的双人迷宫寻宝小游戏，前端 React 18 + TypeScript + Vite + Twind，后端 1 个 Worker + 1 类 Durable Object（`MazeRoom`），通过 WebSocket 同步。

域名：`panning.dengjiabei.cn`。Worker 通过 `routes` 绑定到 `panning.dengjiabei.cn/api/*`，前端走 Pages。两者同源，所以浏览器跨域问题极少。

## 目录结构速记

```
src/                  前端
  pages/Room.tsx      双人对战核心，所有协议消息处理在这里
  pages/Home.tsx      首页（创建房间、加入房间、单人入口）
  pages/SinglePlayer.tsx  单人模式（不走 worker）
  hooks/useWebSocket.ts   WS 连接/重连/心跳
  hooks/useSound.ts       Web Audio 程序化音效
  components/MazeCanvas.tsx  Canvas 渲染 + lerp 平滑
  types/protocol.ts        客户端 ↔ 服务端 全部协议类型
  utils/maze.ts            前端迷宫工具（单人生成 + 最短路径）

worker/src/
  index.ts            HTTP 路由 + CORS
  room.ts             MazeRoom Durable Object（房间状态 + 持久化）
  maze.ts             服务端迷宫生成（迭代回溯 + 公平性约束）
```

## 关键架构决策

### Durable Object 必须持久化状态
`MazeRoom` 使用 WebSocket Hibernation API（`ctx.acceptWebSocket`）。这意味着 DO 实例在空闲时会被卸载，下一条消息到来时会被**重新构造**，所有实例字段重置为默认值。因此：

1. **构造函数里必须用 `ctx.blockConcurrencyWhile` 调用 `loadState()` 从 storage 还原状态**
2. **每次状态变更后调用 `persist()` 写回 storage**
3. **`rehydrateWebSockets()` 通过 `ctx.getWebSockets()` 与 attachment 重新对齐 player ↔ ws**

如果忘了持久化任意一项，房间会出现"邀请进不去"、"莫名其妙掉线"、"对方变成新房主"等所有无法解释的诡异行为。

历史 BUG（2026-04-27 修复）：早期版本完全没有持久化任何状态，导致 hibernation 一发生整个房间就废掉。详见 git log。

### `/setup` 要做全量重置
房间号是 6 位随机数字，1/900,000 概率碰撞。同一个 DO 名字（即同一 storage）可能被多次创建。所以 `POST /setup` 必须把所有字段都重置成"全新房间"状态，包括关闭所有现存 WS。

### 协议是 JSON over WebSocket
所有消息类型见 `src/types/protocol.ts`。**前后端协议必须一致**。改协议时同时改两边，并跑 `npx tsc -b`。

### 阶段机：waiting → readying → playing → ended
- `waiting`：仅一个玩家在房间
- `readying`：两个玩家都在，等对手 ready + 房主 startGame
- `playing`：游戏中，4 秒倒计时后才允许 `move`
- `ended`：游戏结束，仅房主能 `playAgain`

`handleSetDifficulty` 允许在 waiting/readying；`handleSetTimer` 同；其他操作严格按阶段判定。

## 常见任务速查

### 加一个新的服务端消息类型
1. 在 `src/types/protocol.ts` 加 `S_Xxx` interface 和 `ServerMessage` union
2. `worker/src/room.ts` 在 broadcast / sendTo 里发送
3. `src/pages/Room.tsx` 的 message switch 里处理

### 加一个新的客户端消息类型
1. 在 `src/types/protocol.ts` 加 `C_Xxx` interface 和 `ClientMessage` union
2. `worker/src/room.ts` `webSocketMessage` 的 switch 里加 case → handleXxx
3. `handleXxx` 里改完状态后**必须调用 `this.persist()`**
4. `src/pages/Room.tsx` 在合适位置 `send({ type: "xxx", ... })`

### 改房间状态字段
1. `worker/src/room.ts` 的 `PersistedState` interface 加字段
2. `loadState()` 里恢复
3. `persist()` 里写入
4. `/setup` 里在 reset 时设回默认值
5. 修改后写一条新的 `STATE_KEY = "room.state.vN+1"` 防止旧 schema 兼容性问题（可选但推荐）

### 添加难度
- 服务端 `worker/src/maze.ts` 加 `DIFFICULTY_CONFIG`
- 客户端 `src/utils/maze.ts` 加 `DIFFICULTY_SIZE` 与 `extraWallRatio`
- `src/types/protocol.ts` 改 `Difficulty` union
- 各处 `(["easy", "medium", "hard"] as Difficulty[]).map` 都要更新
- UI 上 `DIFF_LABELS` 加中文显示

## 开发命令

```bash
npm install                     # 前端依赖
cd worker && npm install        # Worker 依赖
npm run dev                     # 前端 dev server (5173)
npm run dev:worker              # 本地 wrangler dev (8787)
npm run build                   # tsc -b && vite build → dist/
cd worker && npx wrangler deploy --dry-run  # 校验 worker 不实际部署
```

## 类型检查

**完成代码改动后必跑**：

```bash
npx tsc -b                      # 前端
cd worker && npx tsc --noEmit   # 后端
```

构建失败一定要修，不要想着"先 commit 再说"。

## 部署

推 master 自动触发 GitHub Actions：

- 任何非 `worker/**` 改动 → `deploy-pages.yml` → Cloudflare Pages
- `worker/**` 改动 → `deploy-worker.yml` → Cloudflare Workers

手动：`npx wrangler pages deploy dist --project-name=panning` / `cd worker && npx wrangler deploy`

## 已知陷阱

1. **不要在 DO 里把 WebSocket 引用存进 `players` Map**：WebSocket 在 hibernation 时会失效，但 `ctx.getWebSockets()` 是真理之源。需要发消息给某个玩家时，遍历 sockets 用 `getAttachment()` 匹配 playerId。
2. **不要 `await` `storage.put`**：DO 的 output gate 自动保证持久化在响应/广播之前完成。直接 `.catch(err => log)` 就够了。
3. **`storage.setAlarm` 的 next 时间务必 `Math.max(now + 100)`**：传入过去的时间会立刻触发，可能死循环。
4. **CORS 在 Worker 里限制白名单**：`index.ts` 里的 `ALLOWED_ORIGINS`。新增前端域名时要加进去。
5. **`/api/rooms/:code` 路由必须严格匹配 6 位数字**（`\d{6}`）。否则 attacker 可以传任意字符串触发 DO 创建。

## 测试 / 验证 风格

目前**没有自动化测试**。验证主要靠：

1. `npx tsc -b` 双端类型检查
2. `npm run build` + `wrangler deploy --dry-run` 构建验证
3. 浏览器手动开两个窗口互测（一个普通 + 一个无痕，或两个不同浏览器）

如果要新增测试，建议：
- Worker 用 `vitest` + `@cloudflare/vitest-pool-workers`
- 前端组件可以暂时跳过，纯逻辑（如 `utils/maze.ts` 的 `shortestPath`）值得加单测

## 风格约定

- TypeScript 严格模式打开（`strict: true`）
- 所有 `if` 必须带花括号
- Git commit 信息**必须中文**（见 `~/.claude/CLAUDE.md`）
- React 组件用函数式 + hooks
- 不要写多行 docstring；单行注释只在"为什么这样"非显然时才写

## 维护者备忘

- 公网域名 `panning.dengjiabei.cn` 由 `worker/wrangler.toml` 的 `routes` 配置直接绑定
- DO 类名 `MazeRoom` 在 `wrangler.toml` 里通过 `[[migrations]] new_sqlite_classes` 启用 SQLite 后端，已 commit 不能轻易改
- 改 storage schema 时优先改 `STATE_KEY` 版本号；旧 key 留着以便回滚
