# 双人迷宫淘金游戏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an online two-player maze gold rush game where players race through a randomly generated maze to find gold first.

**Architecture:** Cloudflare Workers + Durable Objects backend handles room management, maze generation, and game state. React + Canvas 2D frontend renders the maze and handles real-time player movement via WebSocket. Architecture mirrors the gomoku reference project at `D:\code\demo\gomoku`.

**Tech Stack:** React 18, TypeScript, Vite, Twind, Cloudflare Workers, Durable Objects, WebSocket, Canvas 2D

**Spec:** `docs/superpowers/specs/2026-03-25-maze-gold-rush-design.md`

**Reference project:** `D:\code\demo\gomoku` — follow its patterns for project structure, WebSocket hook, room flow, CI/CD, and deployment config.

**Protocol deviations from spec:** This plan extends the spec's protocol with practical fields needed for implementation:
- `S_RoomState` adds `yourId` (client needs its own ID) and `chatHistory` (reconnect needs chat history)
- `S_PlayerJoined` uses `{ player: PlayerInfo }` instead of flat `{ id, name }` (carries online/ready state)
- `S_PhaseChange` adds `ownerId` (client needs to know who controls the room)
- `S_GameEnd` adds `winnerName` (display convenience, empty string on draw)
- `S_Chat` uses `{ message: ChatMessage }` for richer message data
- `S_PlayerMoved.explored` is a single `boolean[][]` (incremental update for the moved player only)

---

## File Map

### Frontend (`src/`)

| File | Responsibility |
|------|---------------|
| `src/main.tsx` | Entry point, Twind setup with dark game theme |
| `src/App.tsx` | URL routing, session management (sessionStorage) |
| `src/api.ts` | API base URL + WS base URL helpers |
| `src/pages/Home.tsx` | Create/join room UI |
| `src/pages/Room.tsx` | Game page — state management core, WebSocket message handling |
| `src/components/MazeCanvas.tsx` | Canvas maze rendering, player/gold drawing, fog of war |
| `src/components/PlayerBar.tsx` | Room info bar + player status |
| `src/components/ChatPanel.tsx` | Real-time chat panel |
| `src/components/CountdownOverlay.tsx` | 3-2-1-GO countdown overlay |
| `src/components/GameResultModal.tsx` | Win/lose/draw result modal |
| `src/components/Confetti.tsx` | Victory confetti animation |
| `src/hooks/useWebSocket.ts` | WebSocket connection + heartbeat + reconnect |
| `src/types/protocol.ts` | Client/server message type definitions |
| `src/utils/maze.ts` | Client-side maze helpers (wall checking, fog calculation) |

### Backend (`worker/`)

| File | Responsibility |
|------|---------------|
| `worker/src/index.ts` | Worker entry, HTTP routing, WebSocket upgrade |
| `worker/src/room.ts` | MazeRoom Durable Object — room lifecycle, game logic, move validation |
| `worker/src/maze.ts` | Maze generation (iterative backtracker), entrance placement, gold placement |

### Config & CI

| File | Responsibility |
|------|---------------|
| `package.json` | Frontend deps & scripts |
| `index.html` | HTML entry |
| `vite.config.ts` | Vite config |
| `tsconfig.json` | TS project references |
| `tsconfig.app.json` | App TS config |
| `tsconfig.node.json` | Node TS config |
| `.env.development` | Dev API base URL |
| `worker/package.json` | Worker deps |
| `worker/wrangler.toml` | Worker + Durable Object config |
| `worker/tsconfig.json` | Worker TS config |
| `.github/workflows/deploy-pages.yml` | Frontend deploy to CF Pages |
| `.github/workflows/deploy-worker.yml` | Worker deploy |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `.env.development`
- Create: `worker/package.json`, `worker/wrangler.toml`, `worker/tsconfig.json`

**Reference:** Copy patterns from `D:\code\demo\gomoku` — same deps, same structure, rename project-specific values.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "maze-gold-rush",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:worker": "cd worker && npx wrangler dev",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@twind/core": "^1.1.3",
    "@twind/preset-autoprefix": "^1.0.7",
    "@twind/preset-tailwind": "^1.1.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.6.3",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />
    <title>迷宫淘金</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 4: Create TypeScript configs**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `.env.development`**

```
VITE_API_BASE=https://panning.dengjiabei.cn
```

- [ ] **Step 6: Create `worker/package.json`**

```json
{
  "name": "panning-worker",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241205.0",
    "typescript": "^5.6.3",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 7: Create `worker/wrangler.toml`**

```toml
name = "panning-worker"
main = "src/index.ts"
compatibility_date = "2024-12-05"
workers_dev = true

routes = [
  { pattern = "panning.dengjiabei.cn/api/*", zone_name = "dengjiabei.cn" }
]

[durable_objects]
bindings = [
  { name = "MAZE_ROOM", class_name = "MazeRoom" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["MazeRoom"]
```

- [ ] **Step 8: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Install dependencies**

```bash
cd D:/code/demo/panning && npm install
cd D:/code/demo/panning/worker && npm install
```

- [ ] **Step 10: Verify build**

```bash
cd D:/code/demo/panning && mkdir -p src && echo 'console.log("hello")' > src/main.tsx
npx tsc -b --noEmit 2>&1 || true
```

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: 项目脚手架初始化"
```

---

## Task 2: Protocol Types

**Files:**
- Create: `src/types/protocol.ts`

**Reference:** Adapt from `D:\code\demo\gomoku\src\types\protocol.ts` — replace gomoku-specific types (board, pieces, scores) with maze-specific types (maze, positions, explored).

- [ ] **Step 1: Create `src/types/protocol.ts`**

Define all types from the spec: `GamePhase`, `PlayerInfo`, `ChatMessage`, `MazeData`, `PlayerAssignment`, `Position`, all `S_*` server messages, all `C_*` client messages, and the union types `ServerMessage` / `ClientMessage`.

Key differences from gomoku:
- `S_RoomState` includes: `maze?`, `assignments?`, `gameStartsAt?`, `positions?`, `winnerId?`, `explored?`, `difficulty`, `timerMinutes`
- `S_GameStart` includes: `maze` (MazeData), `assignments` (PlayerAssignment), `gameStartsAt` (number)
- `S_PlayerMoved` includes: `playerId`, `position`, `explored?` (updated fog data for hard mode)
- `C_Move` instead of `C_PlacePiece`: `{ direction: 'up' | 'down' | 'left' | 'right' }`
- `C_SetDifficulty`: `{ difficulty: 'easy' | 'medium' | 'hard' }`
- Remove: `C_PlacePiece`, `C_Surrender`, `C_TransferOwner`, `S_PiecePlaced`

```typescript
/* === 基础类型 === */
export type GamePhase = "waiting" | "readying" | "playing" | "ended";
export type Difficulty = "easy" | "medium" | "hard";
export type Direction = "up" | "down" | "left" | "right";

export interface Position { x: number; y: number }

export interface PlayerInfo {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
}

export interface ChatMessage {
  id: string;
  kind: "chat" | "system";
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

// 位掩码: 1=上墙, 2=右墙, 4=下墙, 8=左墙
export type Cell = number;
export const WALL_TOP = 1;
export const WALL_RIGHT = 2;
export const WALL_BOTTOM = 4;
export const WALL_LEFT = 8;

export interface MazeData {
  size: number;
  cells: Cell[][];
  gold: Position;
  entrances: [Position, Position];
}

export interface PlayerAssignment {
  [playerId: string]: {
    entrance: number;
    position: Position;
  };
}

/* === 服务端 → 客户端 === */
export interface S_RoomState {
  type: "roomState";
  yourId: string;
  roomCode: string;
  phase: GamePhase;
  ownerId: string;
  players: PlayerInfo[];
  difficulty: Difficulty;
  timerMinutes: 3 | 5 | 10 | null;
  maze?: MazeData;
  assignments?: PlayerAssignment;
  gameStartsAt?: number;
  positions?: Record<string, Position>;
  winnerId?: string | null;
  explored?: Record<string, boolean[][]>;
  chatHistory: ChatMessage[];
}

export interface S_PlayerJoined { type: "playerJoined"; player: PlayerInfo }
export interface S_PlayerLeft { type: "playerLeft"; playerId: string }
export interface S_PhaseChange { type: "phaseChange"; phase: GamePhase; ownerId: string }
export interface S_GameStart {
  type: "gameStart";
  maze: MazeData;
  assignments: PlayerAssignment;
  gameStartsAt: number;
}
export interface S_PlayerMoved {
  type: "playerMoved";
  playerId: string;
  position: Position;
  explored?: boolean[][];
}
export interface S_GameEnd {
  type: "gameEnd";
  winnerId: string | null;
  winnerName: string;
  reason: "gold" | "timeout" | "disconnect";
}
export interface S_DifficultyChanged { type: "difficultyChanged"; difficulty: Difficulty }
export interface S_TimerChanged { type: "timerChanged"; timerMinutes: 3 | 5 | 10 | null }
export interface S_ReadyChanged { type: "readyChanged"; playerId: string; ready: boolean }
export interface S_Chat { type: "chat"; message: ChatMessage }
export interface S_RoomClosed { type: "roomClosed"; reason: string }
export interface S_Error { type: "error"; message: string }

export type ServerMessage =
  | S_RoomState | S_PlayerJoined | S_PlayerLeft | S_PhaseChange
  | S_GameStart | S_PlayerMoved | S_GameEnd
  | S_DifficultyChanged | S_TimerChanged | S_ReadyChanged
  | S_Chat | S_RoomClosed | S_Error;

/* === 客户端 → 服务端 === */
export interface C_Join { type: "join"; playerName: string; playerId?: string }
export interface C_Ready { type: "ready" }
export interface C_SetDifficulty { type: "setDifficulty"; difficulty: Difficulty }
export interface C_SetTimer { type: "setTimer"; minutes: 3 | 5 | 10 | null }
export interface C_StartGame { type: "startGame" }
export interface C_Move { type: "move"; direction: Direction }
export interface C_Chat { type: "chat"; text: string }
export interface C_PlayAgain { type: "playAgain" }
export interface C_Leave { type: "leave" }
export interface C_Ping { type: "ping" }

export type ClientMessage =
  | C_Join | C_Ready | C_SetDifficulty | C_SetTimer
  | C_StartGame | C_Move | C_Chat | C_PlayAgain
  | C_Leave | C_Ping;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd D:/code/demo/panning && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/types/protocol.ts && git commit -m "feat: 定义 WebSocket 通信协议类型"
```

---

## Task 3: Maze Generation Algorithm

**Files:**
- Create: `worker/src/maze.ts`

This is pure algorithmic logic — the most testable part of the project.

- [ ] **Step 1: Implement `generateMaze(size: number)`**

Iterative backtracker algorithm using an explicit stack:

1. Initialize `size × size` grid with all walls (each cell = `1|2|4|8 = 15`)
2. Start at random cell, push to stack, mark visited
3. While stack not empty:
   - Look at top cell's unvisited neighbors
   - If neighbors exist: pick random one, remove wall between them, push new cell, mark visited
   - Else: pop stack
4. Return `Cell[][]`

Wall removal: when connecting cell (x,y) to neighbor (nx,ny):
- Going up (ny = y-1): remove BOTTOM from (x,y-1), remove TOP from (x,y)
  Wait, let me think about coordinates. If y goes from top to bottom:
  - up: ny = y-1 → remove WALL_TOP from (x,y), remove WALL_BOTTOM from (nx,ny)
  - down: ny = y+1 → remove WALL_BOTTOM from (x,y), remove WALL_TOP from (nx,ny)
  - left: nx = x-1 → remove WALL_LEFT from (x,y), remove WALL_RIGHT from (nx,ny)
  - right: nx = x+1 → remove WALL_RIGHT from (x,y), remove WALL_LEFT from (nx,ny)

```typescript
const WALL_TOP = 1, WALL_RIGHT = 2, WALL_BOTTOM = 4, WALL_LEFT = 8;

interface Position { x: number; y: number }
interface MazeResult {
  size: number;
  cells: number[][];
  gold: Position;
  entrances: [Position, Position];
}

export function generateMaze(size: number): MazeResult {
  const cells = Array.from({ length: size }, () =>
    new Array(size).fill(WALL_TOP | WALL_RIGHT | WALL_BOTTOM | WALL_LEFT)
  );

  // Iterative backtracker
  const visited = Array.from({ length: size }, () => new Array(size).fill(false));
  const stack: Position[] = [];
  const start = { x: Math.floor(Math.random() * size), y: Math.floor(Math.random() * size) };
  visited[start.y][start.x] = true;
  stack.push(start);

  while (stack.length > 0) {
    const current = stack[stack.length - 1]!;
    const neighbors = getUnvisitedNeighbors(current, size, visited);
    if (neighbors.length > 0) {
      const next = neighbors[Math.floor(Math.random() * neighbors.length)]!;
      removeWall(cells, current, next);
      visited[next.y][next.x] = true;
      stack.push(next);
    } else {
      stack.pop();
    }
  }

  const entrances = placeEntrances(size, cells);
  const gold = placeGold(size, cells, entrances);

  return { size, cells, gold, entrances };
}
```

- [ ] **Step 2: Implement helper functions**

`getUnvisitedNeighbors`, `removeWall`, `placeEntrances` (with 40% diagonal distance constraint), `placeGold` (with BFS fairness check), and `bfs` utility.

```typescript
function getUnvisitedNeighbors(pos: Position, size: number, visited: boolean[][]): Position[] {
  const dirs = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
  return dirs
    .map(d => ({ x: pos.x + d.x, y: pos.y + d.y }))
    .filter(p => p.x >= 0 && p.x < size && p.y >= 0 && p.y < size && !visited[p.y][p.x]);
}

function removeWall(cells: number[][], a: Position, b: Position): void {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dy === -1) { cells[a.y][a.x] &= ~WALL_TOP; cells[b.y][b.x] &= ~WALL_BOTTOM; }
  if (dy === 1)  { cells[a.y][a.x] &= ~WALL_BOTTOM; cells[b.y][b.x] &= ~WALL_TOP; }
  if (dx === -1) { cells[a.y][a.x] &= ~WALL_LEFT; cells[b.y][b.x] &= ~WALL_RIGHT; }
  if (dx === 1)  { cells[a.y][a.x] &= ~WALL_RIGHT; cells[b.y][b.x] &= ~WALL_LEFT; }
}

function placeEntrances(size: number, cells: number[][]): [Position, Position] {
  // 1. Collect all edge cells (x=0 or x=size-1 or y=0 or y=size-1)
  const edges: Position[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x === 0 || x === size - 1 || y === 0 || y === size - 1) edges.push({ x, y });
    }
  }
  // 2. Shuffle edges, pick first pair where Euclidean distance >= 0.4 * diagonal
  const diagonal = Math.sqrt(2) * size;
  const minDist = diagonal * 0.4;
  shuffle(edges);
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const dx = edges[i].x - edges[j].x, dy = edges[i].y - edges[j].y;
      if (Math.sqrt(dx * dx + dy * dy) >= minDist) {
        // 3. Remove outer wall at each entrance
        // e.g. if entrance at y=0, remove WALL_TOP; if x=size-1, remove WALL_RIGHT
        removeOuterWall(cells, edges[i], size);
        removeOuterWall(cells, edges[j], size);
        return [edges[i], edges[j]];
      }
    }
  }
  // Fallback: first and last edge
  removeOuterWall(cells, edges[0], size);
  removeOuterWall(cells, edges[edges.length - 1], size);
  return [edges[0], edges[edges.length - 1]];
}

function removeOuterWall(cells: number[][], pos: Position, size: number): void {
  if (pos.y === 0) cells[pos.y][pos.x] &= ~WALL_TOP;
  if (pos.y === size - 1) cells[pos.y][pos.x] &= ~WALL_BOTTOM;
  if (pos.x === 0) cells[pos.y][pos.x] &= ~WALL_LEFT;
  if (pos.x === size - 1) cells[pos.y][pos.x] &= ~WALL_RIGHT;
}

function bfs(cells: number[][], size: number, start: Position): number[][] {
  const dist = Array.from({ length: size }, () => new Array(size).fill(-1));
  const queue: Position[] = [start];
  dist[start.y][start.x] = 0;
  const dirs = [
    { dx: 0, dy: -1, wall: WALL_TOP },
    { dx: 1, dy: 0, wall: WALL_RIGHT },
    { dx: 0, dy: 1, wall: WALL_BOTTOM },
    { dx: -1, dy: 0, wall: WALL_LEFT },
  ];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of dirs) {
      if (cells[cur.y][cur.x] & d.wall) continue; // wall blocks
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      if (dist[ny][nx] !== -1) continue;
      dist[ny][nx] = dist[cur.y][cur.x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

function placeGold(size: number, cells: number[][], entrances: [Position, Position]): Position {
  const distA = bfs(cells, size, entrances[0]);
  const distB = bfs(cells, size, entrances[1]);
  // Collect candidates at each threshold
  for (const threshold of [0.3, 0.5, 1.0]) {
    const candidates: Position[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dA = distA[y][x], dB = distB[y][x];
        if (dA <= 0 || dB <= 0) continue; // skip unreachable and entrances
        const diff = Math.abs(dA - dB) / Math.max(dA, dB);
        if (diff <= threshold) candidates.push({ x, y });
      }
    }
    if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
  }
  // Absolute fallback: center
  return { x: Math.floor(size / 2), y: Math.floor(size / 2) };
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
```

- [ ] **Step 3: Export `DIFFICULTY_CONFIG`**

```typescript
export const DIFFICULTY_CONFIG = {
  easy:   { size: 8 },
  medium: { size: 15 },
  hard:   { size: 25 },
} as const;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd D:/code/demo/panning/worker && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd D:/code/demo/panning && git add worker/src/maze.ts && git commit -m "feat: 迷宫生成算法（迭代回溯法）"
```

---

## Task 4: Worker Entry + HTTP Routes

**Files:**
- Create: `worker/src/index.ts`

**Reference:** Adapt from `D:\code\demo\gomoku\worker\src\index.ts` — same CORS, same routing pattern, rename binding from `GOMOKU_ROOM` to `MAZE_ROOM`.

- [ ] **Step 1: Create stub `worker/src/room.ts`**

Create this first so `index.ts` can import from it:

- [ ] **Step 2: Create `worker/src/index.ts`**

Implement:
- CORS headers helper
- `POST /api/rooms` → create room (generate 6-digit code, get Durable Object stub)
- `GET /api/rooms/:code` → query room info
- `POST /api/rooms/:code/quickleave` → quick leave (sendBeacon)
- `GET /api/rooms/:code/ws` → WebSocket upgrade
- Export `MazeRoom` class from `./room`

Same pattern as gomoku's `worker/src/index.ts`.

Minimal Durable Object stub for `room.ts`:

```typescript
export class MazeRoom {
  private state: DurableObjectState;
  private env: unknown;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response("not implemented", { status: 501 });
  }
}
```

- [ ] **Step 3: Verify worker compiles**

```bash
cd D:/code/demo/panning/worker && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd D:/code/demo/panning && git add worker/src/ && git commit -m "feat: Worker 入口和 HTTP 路由"
```

---

## Task 5: MazeRoom Durable Object

**Files:**
- Modify: `worker/src/room.ts` (replace stub with full implementation)

**Reference:** Adapt from `D:\code\demo\gomoku\worker\src\room.ts` (~1100 lines). Same patterns for: WebSocket handling, player management, broadcast, grace period disconnect, alarm scheduling.

Replace gomoku-specific logic with maze logic:
- `handleStartGame` → generate maze, compute `gameStartsAt`, broadcast `gameStart`
- `handleMove` → validate move against walls, update position, check gold, broadcast `playerMoved`
- `handleSetDifficulty` → validate and broadcast
- Remove: `handlePlacePiece`, `handleSurrender`, `handleTransferOwner`, scoring logic

- [ ] **Step 1: Implement player/room management**

Port from gomoku `room.ts`:
- `webSocketMessage` / `webSocketClose` / `webSocketError` handlers
- `handleJoin` — player registration, session restore, send `roomState`
- `handleReady` — toggle ready state
- `handleLeave` — grace period disconnect
- `handleChat` — broadcast chat
- `handlePing` — pong/noop
- `broadcast` / `broadcastExcept` / `sendTo` helpers
- `scheduleAlarm` / `alarm` — inactivity timeout, game timer, grace period

Key state fields:
```typescript
private roomCode = "";
private phase: GamePhase = "waiting";
private ownerId = "";
private players: Map<string, PlayerData> = new Map();
private difficulty: Difficulty = "easy";
private timerMinutes: 3 | 5 | 10 | null = null;
private maze: MazeResult | null = null;
private positions: Map<string, Position> = new Map();
private gameStartsAt = 0;
private winnerId: string | null = null;
private explored: Map<string, boolean[][]> = new Map();
private chatHistory: ChatMessage[] = [];
```

- [ ] **Step 2: Implement game-specific handlers**

- `handleSetDifficulty(ws, { difficulty })` — only owner, only in readying phase
- `handleSetTimer(ws, { minutes })` — only owner, validate `[3,5,10,null]`
- `handleStartGame(ws)` — only owner, check opponent ready, call `generateMaze(DIFFICULTY_CONFIG[difficulty].size)`, set `gameStartsAt = Date.now() + 4000`, assign players to entrances randomly, init explored grids for hard mode, broadcast `gameStart`, schedule timer alarm
- `handleMove(ws, { direction })` — validate: phase is playing, `Date.now() >= gameStartsAt`, player exists, wall check with bitmask. Update position. If hard mode: update explored grid using same logic as client's `getVisibleCells(pos, 3)` — iterate cells within Euclidean radius 3 of new position, set `explored[playerId][y][x] = true`. Check if new position equals gold → `handleGameEnd('gold')`. Broadcast `playerMoved` with `explored` (the moved player's full `boolean[][]`) only in hard mode.
- `handlePlayAgain(ws)` — only owner, only in ended phase → reset to readying, clear maze/positions/explored, broadcast `phaseChange`

- [ ] **Step 3: Implement `buildRoomState()` helper**

Returns `S_RoomState` object with all current state for a given player.

- [ ] **Step 4: Implement alarm handler**

- Grace period expired → remove player, if in playing phase → opponent wins
- Game timer expired → `handleGameEnd('timeout')`
- Inactivity timeout (5 min) → close room, broadcast `roomClosed`

- [ ] **Step 5: Verify worker compiles**

```bash
cd D:/code/demo/panning/worker && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd D:/code/demo/panning && git add worker/src/room.ts && git commit -m "feat: MazeRoom Durable Object 完整实现"
```

---

## Task 6: Frontend Infrastructure

**Files:**
- Create: `src/main.tsx`, `src/api.ts`, `src/hooks/useWebSocket.ts`

- [ ] **Step 1: Create `src/api.ts`**

Identical to gomoku's `src/api.ts`:
```typescript
const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;
export function getHttpBase(): string { return API_BASE || window.location.origin; }
export function getWsBase(): string { return getHttpBase().replace(/^http/, "ws"); }
```

- [ ] **Step 2: Create `src/hooks/useWebSocket.ts`**

Copy from `D:\code\demo\gomoku\src\hooks\useWebSocket.ts` verbatim — same hook, same heartbeat (25s), same reconnect delays (1→2→4→8→15s). Only the type imports change to point to our `protocol.ts`.

- [ ] **Step 3: Create `src/main.tsx`**

Adapt from gomoku's `src/main.tsx` — change Twind theme to dark game colors:

```typescript
import { install } from "@twind/core";
import presetAutoprefix from "@twind/preset-autoprefix";
import presetTailwind from "@twind/preset-tailwind";
import { createRoot } from "react-dom/client";
import App from "./App";

install({
  presets: [presetAutoprefix(), presetTailwind()],
  theme: {
    extend: {
      colors: {
        "game-bg": "#1a1a2e",
        "game-dark": "#0a0a23",
        "game-panel": "#16213e",
        "player-a": "#4cc9f0",
        "player-b": "#f72585",
        gold: "#ffd700",
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 4: Verify build**

```bash
cd D:/code/demo/panning && npx tsc -b --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/api.ts src/hooks/ && git commit -m "feat: 前端基础设施（API、WebSocket Hook、入口）"
```

---

## Task 7: App Shell + Routing

**Files:**
- Create: `src/App.tsx`

**Reference:** Adapt from `D:\code\demo\gomoku\src\App.tsx` — same URL-based routing, same session management, rename `gomoku_session` → `maze_session`.

- [ ] **Step 1: Create `src/App.tsx`**

Same structure as gomoku:
- `loadSession` / `saveSession` / `clearSession` from sessionStorage
- URL match `/:roomCode` (6-digit)
- Pending join dialog (enter nickname to join via shared link)
- Route to `<Home>` or `<Room>` based on state

Key changes from gomoku:
- Session key: `maze_session`
- Title/text: "迷宫淘金" instead of "五子棋"
- Styling: dark theme colors (`bg-game-bg`, `text-white`)

- [ ] **Step 2: Create stub pages**

`src/pages/Home.tsx`:
```typescript
export default function Home({ onEnterRoom, urlError }: { onEnterRoom: (code: string, name: string) => void; urlError: string }) {
  return <div>Home placeholder</div>;
}
```

`src/pages/Room.tsx`:
```typescript
export default function Room({ roomCode, nickname, playerId, onLeave }: { roomCode: string; nickname: string; playerId: string; onLeave: () => void }) {
  return <div>Room placeholder</div>;
}
```

- [ ] **Step 3: Verify dev server starts**

```bash
cd D:/code/demo/panning && npm run dev
```

Open `http://localhost:5173` — should show "Home placeholder".

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/pages/ && git commit -m "feat: App 路由和会话管理"
```

---

## Task 8: Home Page

**Files:**
- Modify: `src/pages/Home.tsx`

**Reference:** Adapt from `D:\code\demo\gomoku\src\pages\Home.tsx` — same create/join flow, dark theme styling.

- [ ] **Step 1: Implement Home page**

- Nickname input (max 12 chars)
- "创建房间" button → `POST /api/rooms` → get roomCode → `onEnterRoom(code, nickname)`
- "加入房间" section → 6-digit room code input → validate room exists → `onEnterRoom(code, nickname)`
- Error handling: room not found, room full, network error
- Dark theme: `bg-game-bg`, `text-white`, accent `bg-player-a`

- [ ] **Step 2: Verify in browser**

```bash
cd D:/code/demo/panning && npm run dev
```

Open `http://localhost:5173` — should show create/join room UI.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Home.tsx && git commit -m "feat: 首页（创建/加入房间）"
```

---

## Task 9: Maze Canvas Renderer

**Files:**
- Create: `src/components/MazeCanvas.tsx`, `src/utils/maze.ts`

This is the core rendering component — most complex frontend piece.

- [ ] **Step 1: Create `src/utils/maze.ts`**

Client-side maze utilities:

```typescript
import { Cell, WALL_TOP, WALL_RIGHT, WALL_BOTTOM, WALL_LEFT, Direction } from "../types/protocol";

/** Check if movement in direction is blocked by a wall */
export function hasWall(cell: Cell, direction: Direction): boolean {
  switch (direction) {
    case "up": return (cell & WALL_TOP) !== 0;
    case "right": return (cell & WALL_RIGHT) !== 0;
    case "down": return (cell & WALL_BOTTOM) !== 0;
    case "left": return (cell & WALL_LEFT) !== 0;
  }
}

/** Calculate fog visibility: cells within Euclidean distance `radius` from position */
export function getVisibleCells(
  px: number, py: number, size: number, radius: number
): Set<string> {
  const visible = new Set<string>();
  const r2 = radius * radius;
  for (let y = Math.max(0, py - radius); y <= Math.min(size - 1, py + radius); y++) {
    for (let x = Math.max(0, px - radius); x <= Math.min(size - 1, px + radius); x++) {
      if ((x - px) ** 2 + (y - py) ** 2 <= r2) {
        visible.add(`${x},${y}`);
      }
    }
  }
  return visible;
}

/** Compute new position after moving in a direction (no wall check) */
export function moveInDirection(pos: Position, direction: Direction): Position {
  switch (direction) {
    case "up": return { x: pos.x, y: pos.y - 1 };
    case "down": return { x: pos.x, y: pos.y + 1 };
    case "left": return { x: pos.x - 1, y: pos.y };
    case "right": return { x: pos.x + 1, y: pos.y };
  }
}
```

- [ ] **Step 2: Create `src/components/MazeCanvas.tsx`**

Props:
```typescript
interface MazeCanvasProps {
  maze: MazeData;
  myPosition: Position;
  opponentPosition: Position | null;
  myId: string;
  difficulty: Difficulty;
  explored?: boolean[][];  // hard mode fog state
}
```

Implementation:
- `useRef<HTMLCanvasElement>` + `useEffect` for rendering
- `ResizeObserver` for responsive sizing
- `devicePixelRatio` for HiDPI
- Drawing layers:
  1. Background (`#0a0a23`)
  2. Paths (`#111` fill for each cell)
  3. Walls (`#3a506b` lines, width varies by difficulty)
  4. Entrance markers (wall gaps with glow)
  5. Gold (`#ffd700` circle with pulsing animation via `requestAnimationFrame`)
  6. Players (colored circles with letter labels)
  7. Fog overlay (hard mode only — use `globalCompositeOperation`)

For fog:
- Draw full maze first
- Draw black overlay over entire canvas
- Use `destination-out` composite to punch holes for:
  - Currently visible area (full opacity)
  - Previously explored cells (0.6 opacity)

- [ ] **Step 3: Implement gold pulsing animation**

`requestAnimationFrame` loop that oscillates gold circle radius/opacity. Clean up on unmount.

- [ ] **Step 4: Verify rendering with mock data**

Temporarily render `<MazeCanvas>` with hardcoded maze data in Room.tsx to visually verify.

- [ ] **Step 5: Commit**

```bash
git add src/components/MazeCanvas.tsx src/utils/maze.ts && git commit -m "feat: Canvas 迷宫渲染器（含迷雾效果）"
```

---

## Task 10: UI Components

**Files:**
- Create: `src/components/PlayerBar.tsx`
- Create: `src/components/ChatPanel.tsx`
- Create: `src/components/CountdownOverlay.tsx`
- Create: `src/components/GameResultModal.tsx`
- Create: `src/components/Confetti.tsx`

**Reference:** Adapt from gomoku's equivalent components, adjust for maze game context.

- [ ] **Step 1: Create `PlayerBar.tsx`**

Top bar showing: room code, difficulty badge, timer countdown, share button (in waiting phase).

Props: `roomCode`, `difficulty`, `timerMinutes`, `remainingSeconds`, `phase`, `players`, `ownerId`

- [ ] **Step 2: Create `ChatPanel.tsx`**

Copy pattern from gomoku's `ChatPanel.tsx`. Fixed-width right panel:
- Message list (auto-scroll to bottom)
- Input field at bottom
- System messages in italics
- Player messages with color-coded names

Important: `onFocus`/`onBlur` callbacks to parent so Room.tsx knows when chat is focused (to disable arrow key movement).

- [ ] **Step 3: Create `CountdownOverlay.tsx`**

Full-screen semi-transparent overlay with large centered numbers.

Props: `gameStartsAt: number`

- Uses `requestAnimationFrame` or `setInterval(1000)` to count down
- Shows: 3 → 2 → 1 → GO! → auto-dismiss
- Large text with animation (scale/fade)
- Disappears when `Date.now() >= gameStartsAt`

- [ ] **Step 4: Create `GameResultModal.tsx`**

Center modal showing result.

Props: `winnerId`, `winnerName`, `myId`, `reason`, `isOwner`, `onPlayAgain`, `onLeave`

- "你赢了!" / "你输了!" / "平局!"
- Show reason (found gold / timeout / opponent disconnected)
- Owner sees "再来一局" button, opponent sees "等待房主操作"
- "离开房间" button for both

- [ ] **Step 5: Create `Confetti.tsx`**

Copy from gomoku's `src/components/Confetti.tsx` — canvas-based confetti particle animation, 80 particles, triggered on victory.

- [ ] **Step 6: Commit**

```bash
git add src/components/ && git commit -m "feat: UI 组件（PlayerBar、ChatPanel、倒计时、结果弹窗、纸屑）"
```

---

## Task 11: Room Page (Game Core)

**Files:**
- Modify: `src/pages/Room.tsx`

**Reference:** Adapt from `D:\code\demo\gomoku\src\pages\Room.tsx` (~538 lines). This is the state management core.

- [ ] **Step 1: Set up state and WebSocket connection**

```typescript
// Core state
const [myId, setMyId] = useState("");
const [players, setPlayers] = useState<PlayerInfo[]>([]);
const [ownerId, setOwnerId] = useState("");
const [phase, setPhase] = useState<GamePhase>("waiting");
const [difficulty, setDifficulty] = useState<Difficulty>("easy");
const [timerMinutes, setTimerMinutes] = useState<3 | 5 | 10 | null>(null);

// Game state
const [maze, setMaze] = useState<MazeData | null>(null);
const [positions, setPositions] = useState<Record<string, Position>>({});
const [gameStartsAt, setGameStartsAt] = useState(0);
const [winnerId, setWinnerId] = useState<string | null | undefined>(undefined);
const [winnerName, setWinnerName] = useState("");
const [gameEndReason, setGameEndReason] = useState<string>("");
const [explored, setExplored] = useState<Record<string, boolean[][]>>({});
const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

// UI state
const [showCountdown, setShowCountdown] = useState(false);
const [showConfetti, setShowConfetti] = useState(false);
const [chatFocused, setChatFocused] = useState(false);
const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

// WebSocket
const wsUrl = `${getWsBase()}/api/rooms/${roomCode}/ws`;
const { connected, send, addListener, leave } = useWebSocket(wsUrl);
```

- [ ] **Step 2: Implement WebSocket message handler**

```typescript
useEffect(() => {
  return addListener((msg) => {
    switch (msg.type) {
      case "roomState": // Set all state from server
      case "playerJoined": // Add player
      case "playerLeft": // Remove player
      case "phaseChange": // Update phase
      case "gameStart": // Set maze, assignments, show countdown
      case "playerMoved": // Update position, update explored
      case "gameEnd": // Set winner, show result
      case "difficultyChanged": // Update difficulty
      case "timerChanged": // Update timer
      case "readyChanged": // Update player ready
      case "chat": // Append chat message
      case "roomClosed": // Navigate away
      case "error": // Show error toast
    }
  });
}, [addListener]);
```

- [ ] **Step 3: Implement keyboard movement handler**

```typescript
useEffect(() => {
  if (phase !== "playing" || chatFocused) return;

  let lastMoveTime = 0;
  const MOVE_INTERVAL = 80; // ms throttle

  const handleKeyDown = (e: KeyboardEvent) => {
    const dirMap: Record<string, Direction> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right"
    };
    const direction = dirMap[e.key];
    if (!direction || Date.now() < gameStartsAt) return;
    e.preventDefault();

    const now = Date.now();
    if (now - lastMoveTime < MOVE_INTERVAL) return;
    lastMoveTime = now;

    // Client-side wall check
    const myPos = positions[myId];
    if (!myPos || !maze) return;
    const cell = maze.cells[myPos.y][myPos.x];
    if (hasWall(cell, direction)) return;

    // Optimistic update
    const newPos = moveInDirection(myPos, direction);
    setPositions(prev => ({ ...prev, [myId]: newPos }));

    // Send to server
    send({ type: "move", direction });
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [phase, chatFocused, gameStartsAt, positions, myId, maze, send]);
```

- [ ] **Step 4: Implement timer countdown**

```typescript
useEffect(() => {
  if (phase !== "playing" || !timerMinutes || !gameStartsAt) {
    setRemainingSeconds(null);
    return;
  }
  const endTime = gameStartsAt + timerMinutes * 60 * 1000;
  const interval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    setRemainingSeconds(remaining);
  }, 1000);
  return () => clearInterval(interval);
}, [phase, timerMinutes, gameStartsAt]);
```

- [ ] **Step 5: Implement join on mount**

```typescript
useEffect(() => {
  if (connected) {
    send({ type: "join", playerName: nickname, playerId });
  }
}, [connected]);
```

- [ ] **Step 6: Implement `sendBeacon` on unload**

```typescript
useEffect(() => {
  const handleBeforeUnload = () => {
    navigator.sendBeacon(`${getHttpBase()}/api/rooms/${roomCode}/quickleave`,
      JSON.stringify({ playerId }));
  };
  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => window.removeEventListener("beforeunload", handleBeforeUnload);
}, [roomCode, playerId]);
```

- [ ] **Step 7: Compose the render layout**

```tsx
return (
  <div className="h-screen flex flex-col bg-game-bg text-white">
    <PlayerBar ... />
    <div className="flex-1 flex overflow-hidden">
      {/* Left: game area */}
      <div className="flex-1 flex flex-col p-4">
        {/* Player info cards */}
        <div className="flex gap-4 mb-4">...</div>

        {/* Maze canvas */}
        <div className="flex-1 relative">
          {maze && <MazeCanvas ... />}
          {showCountdown && <CountdownOverlay gameStartsAt={gameStartsAt} onDone={() => setShowCountdown(false)} />}
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex gap-4 justify-center">
          {/* Difficulty selector (readying, owner) */}
          {/* Timer selector (readying, owner) */}
          {/* Ready button (readying, non-owner) */}
          {/* Start button (readying, owner) */}
        </div>
      </div>

      {/* Right: chat */}
      <ChatPanel messages={chatMessages} onSend={text => send({ type: "chat", text })}
        onFocus={() => setChatFocused(true)} onBlur={() => setChatFocused(false)} />
    </div>

    {/* Result modal */}
    {phase === "ended" && <GameResultModal ... />}
    {showConfetti && <Confetti />}
  </div>
);
```

- [ ] **Step 8: Verify full flow in browser**

Start dev server + worker, create room, join from another tab, play through a game.

```bash
# Terminal 1
cd D:/code/demo/panning && npm run dev
# Terminal 2
cd D:/code/demo/panning && npm run dev:worker
```

- [ ] **Step 9: Commit**

```bash
git add src/pages/Room.tsx && git commit -m "feat: Room 页面（游戏核心状态管理）"
```

---

## Task 12: CI/CD Workflows

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Create: `.github/workflows/deploy-worker.yml`

- [ ] **Step 1: Create `.github/workflows/deploy-pages.yml`**

Copy from gomoku, change `--project-name=gomoku` → `--project-name=panning`:

```yaml
name: Deploy Frontend to Cloudflare Pages

on:
  push:
    branches: [master]
    paths-ignore:
      - "worker/**"

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - name: Deploy to Cloudflare Pages
        run: npx wrangler pages deploy dist --project-name=panning
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
```

- [ ] **Step 2: Create `.github/workflows/deploy-worker.yml`**

Copy from gomoku:

```yaml
name: Deploy Worker to Cloudflare

on:
  push:
    branches: [master]
    paths:
      - "worker/**"

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: cd worker && npm ci
      - name: Deploy Worker
        run: cd worker && npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.superpowers/
.env.local
```

- [ ] **Step 4: Commit**

```bash
git add .github/ .gitignore && git commit -m "feat: CI/CD 部署流水线"
```

---

## Task 13: Final Integration + Deploy

**Files:** All files from previous tasks

- [ ] **Step 1: Full build verification**

```bash
cd D:/code/demo/panning && npm run build
```

Fix any TypeScript or build errors.

- [ ] **Step 2: Local end-to-end test**

Run both dev servers, test full game flow:
1. Open tab 1 → create room → get room code
2. Open tab 2 → join with room code
3. Set difficulty + timer
4. Ready → Start → Countdown → Move → Find gold → Win
5. Test chat
6. Test "再来一局"
7. Test disconnect/reconnect

- [ ] **Step 3: Push to GitHub**

```bash
git remote add origin https://github.com/bello96/panning.git
git push -u origin master
```

- [ ] **Step 4: Verify CI/CD deployments**

Check GitHub Actions → both workflows should trigger and succeed.

- [ ] **Step 5: Verify production**

Open https://panning.dengjiabei.cn — full game should work.

- [ ] **Step 6: Final commit (if any fixes)**

```bash
git add -A && git commit -m "fix: 部署修复" && git push
```
