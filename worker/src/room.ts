import { DurableObject } from "cloudflare:workers";
import { generateMaze, DIFFICULTY_CONFIG, type MazeResult } from "./maze";

/* ── 类型定义 ── */

interface ChatMessage {
  id: string;
  kind: "chat" | "system";
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

interface PlayerEntry {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
  graceTimeout?: number;
}

interface WsAttachment {
  playerId: string | null;
  playerName: string | null;
}

type GamePhase = "waiting" | "readying" | "playing" | "ended";
type Difficulty = "easy" | "medium" | "hard";
type TimerMinutes = 3 | 5 | 10 | null;

/* ── Persistable state ── */
interface PersistedState {
  roomCode: string;
  phase: GamePhase;
  ownerId: string;
  difficulty: Difficulty;
  timerMinutes: TimerMinutes;
  maze: MazeResult | null;
  positions: Record<string, { x: number; y: number }>;
  gameStartsAt: number;
  winnerId: string | null;
  explored: Record<string, boolean[][]>;
  chatHistory: ChatMessage[];
  closed: boolean;
  lastActivityAt: number;
  assignments: Record<string, number>;
  players: PlayerEntry[];
}

const STATE_KEY = "room.state.v1";

/* ── 墙壁常量 (与 maze.ts 一致) ── */
const WALL_TOP = 1;
const WALL_RIGHT = 2;
const WALL_BOTTOM = 4;
const WALL_LEFT = 8;

/* ── 其他常量 ── */
const MAX_PLAYERS = 2;
const GRACE_PERIOD = 30_000;
const QUICK_GRACE = 5_000;
const INACTIVITY_TIMEOUT = 30 * 60_000; // 30 分钟无活动才关闭，给玩家断线重连留充足空间
const MAX_CHAT = 200;
const COUNTDOWN_MS = 4000;
const EXPLORE_RADIUS = 3;

/* ── 工具函数 ── */
function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface Env {
  MAZE_ROOM: DurableObjectNamespace;
}

/* ── MazeRoom Durable Object ── */
export class MazeRoom extends DurableObject<Env> {
  /* ── 状态字段（在 loadState 中从 storage 重新填充）── */
  private roomCode = "";
  private phase: GamePhase = "waiting";
  private ownerId = "";
  private difficulty: Difficulty = "medium";
  private timerMinutes: TimerMinutes = null;
  private maze: MazeResult | null = null;
  private positions: Map<string, { x: number; y: number }> = new Map();
  private gameStartsAt = 0;
  private winnerId: string | null = null;
  private explored: Map<string, boolean[][]> = new Map();
  private chatHistory: ChatMessage[] = [];
  private closed = false;
  private lastActivityAt = 0;

  // 玩家入口分配: playerId -> entrance index (0 | 1)
  private assignments: Map<string, number> = new Map();

  // 玩家跟踪
  private players: Map<string, PlayerEntry> = new Map();

  // 标识 storage 是否已加载完成
  private loaded = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 在 DO 启动时从 storage 加载所有状态。blockConcurrencyWhile 保证在加载完成前
    // 任何 fetch / webSocketMessage / alarm 都会被阻塞等待，避免读到空状态。
    ctx.blockConcurrencyWhile(async () => {
      await this.loadState();
      this.rehydrateWebSockets();
      this.loaded = true;
    });
    // 配置心跳的 auto-response：客户端发 ping，runtime 直接回 pong，无需唤醒 DO。
    // 这能让 DO 在双方仅 ping 心跳时持续 hibernate，省下读 storage 的延迟与计费。
    try {
      ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair(
          JSON.stringify({ type: "ping" }),
          JSON.stringify({ type: "pong" }),
        ),
      );
    } catch {
      // 老版本 workerd 不支持 setWebSocketAutoResponse 时静默兜底
    }
  }

  /* ── 持久化 ── */

  private async loadState(): Promise<void> {
    const stored = await this.ctx.storage.get<PersistedState>(STATE_KEY);
    if (!stored) {
      return;
    }
    this.roomCode = stored.roomCode;
    this.phase = stored.phase;
    this.ownerId = stored.ownerId;
    this.difficulty = stored.difficulty;
    this.timerMinutes = stored.timerMinutes;
    this.maze = stored.maze;
    this.positions = new Map(Object.entries(stored.positions));
    this.gameStartsAt = stored.gameStartsAt;
    this.winnerId = stored.winnerId;
    this.explored = new Map(Object.entries(stored.explored));
    this.chatHistory = stored.chatHistory;
    this.closed = stored.closed;
    this.lastActivityAt = stored.lastActivityAt;
    this.assignments = new Map(
      Object.entries(stored.assignments).map(([k, v]) => [k, Number(v)]),
    );
    // 加载时把所有玩家先标记为离线，rehydrateWebSockets 再根据真实 WS 修正
    this.players = new Map(
      stored.players.map((p) => [p.id, { ...p, online: false }]),
    );
  }

  private rehydrateWebSockets(): void {
    // hibernation 唤醒时 WebSocket 还在 ctx.getWebSockets() 中。
    // 通过 attachment 把 WS 与玩家身份重新对齐，并把这些玩家标记为在线。
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const att = this.getAttachment(ws);
      if (!att?.playerId) {
        continue;
      }
      const player = this.players.get(att.playerId);
      if (player) {
        player.online = true;
        player.graceTimeout = undefined;
      }
    }
  }

  private persist(): void {
    // Cloudflare DO 的 output gate 会保证所有 put 在响应/广播之前完成持久化，
    // 因此可以 fire-and-forget；只需要 catch 一下避免 unhandled rejection。
    const state: PersistedState = {
      roomCode: this.roomCode,
      phase: this.phase,
      ownerId: this.ownerId,
      difficulty: this.difficulty,
      timerMinutes: this.timerMinutes,
      maze: this.maze,
      positions: Object.fromEntries(this.positions),
      gameStartsAt: this.gameStartsAt,
      winnerId: this.winnerId,
      explored: Object.fromEntries(this.explored),
      chatHistory: this.chatHistory,
      closed: this.closed,
      lastActivityAt: this.lastActivityAt,
      assignments: Object.fromEntries(this.assignments),
      players: Array.from(this.players.values()),
    };
    this.ctx.storage.put(STATE_KEY, state).catch((err) => {
      console.error("MazeRoom persist failed:", err);
    });
  }

  /* ── HTTP 入口 ── */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /setup — 初始化房间（全量重置，避免房间号碰撞时复用旧状态）
    if (url.pathname === "/setup" && request.method === "POST") {
      const { roomCode } = (await request.json()) as { roomCode: string };
      // 关闭并清理所有现存连接（理论上 /setup 只在新建时被调用，但要兼容碰撞）
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, "Room reset");
        } catch {
          /* ignore */
        }
      }
      this.roomCode = roomCode;
      this.phase = "waiting";
      this.ownerId = "";
      this.difficulty = "medium";
      this.timerMinutes = null;
      this.maze = null;
      this.positions.clear();
      this.gameStartsAt = 0;
      this.winnerId = null;
      this.explored.clear();
      this.chatHistory = [];
      this.assignments.clear();
      this.players.clear();
      this.closed = false;
      this.lastActivityAt = Date.now();
      this.persist();
      return new Response("ok");
    }

    // GET /info — 房间信息（用于加入前验证）
    if (url.pathname === "/info") {
      // 房间未通过 /setup 初始化 → 视为不存在
      if (!this.roomCode) {
        return Response.json({ error: "room not found" }, { status: 404 });
      }
      const ownerEntry = this.players.get(this.ownerId);
      return Response.json({
        roomCode: this.roomCode,
        playerCount: this.players.size,
        closed: this.closed,
        ownerName: ownerEntry?.name || null,
      });
    }

    // POST /quickleave — sendBeacon 快速离开
    if (url.pathname === "/quickleave" && request.method === "POST") {
      const { playerId } = (await request.json()) as { playerId: string };
      this.startGracePeriod(playerId, QUICK_GRACE);
      return new Response("ok");
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      // 房间不存在 / 未初始化 → 拒绝升级
      if (!this.roomCode || this.closed) {
        return new Response("room not found", { status: 404 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        playerId: null,
        playerName: null,
      } as WsAttachment);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  /* ── WebSocket 生命周期 ── */
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") {
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    this.lastActivityAt = Date.now();

    switch (msg.type as string) {
      case "join":
        this.handleJoin(ws, msg);
        break;
      case "ready":
        this.handleReady(ws);
        break;
      case "setDifficulty":
        this.handleSetDifficulty(ws, msg);
        break;
      case "setTimer":
        this.handleSetTimer(ws, msg);
        break;
      case "startGame":
        this.handleStartGame(ws);
        break;
      case "move":
        this.handleMove(ws, msg);
        break;
      case "chat":
        this.handleChat(ws, msg);
        break;
      case "playAgain":
        this.handlePlayAgain(ws);
        break;
      case "surrender":
        this.handleSurrender(ws);
        break;
      case "transferOwner":
        this.handleTransferOwner(ws);
        break;
      case "leave":
        this.handleLeave(ws);
        break;
      case "ping":
        this.handlePing(ws);
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = this.getAttachment(ws);
    if (att?.playerId) {
      this.handleDisconnect(att.playerId);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /* ── 消息处理器 ── */

  private handleJoin(
    ws: WebSocket,
    msg: Record<string, unknown>,
  ): void {
    if (this.closed) {
      this.sendTo(ws, { type: "roomClosed", reason: "房间已关闭" });
      ws.close(1000, "Room closed");
      return;
    }

    const playerName = (msg.playerName as string) || "匿名";
    const requestedId = msg.playerId as string | undefined;

    // 断线重连
    if (requestedId && this.players.has(requestedId)) {
      const existing = this.players.get(requestedId)!;

      // 清除 grace timeout
      existing.graceTimeout = undefined;
      existing.online = true;
      existing.name = playerName;

      this.setAttachment(ws, { playerId: requestedId, playerName });

      // 发送完整房间状态给重连玩家
      this.sendTo(ws, this.buildRoomState(requestedId));

      // 广播给其他人
      this.broadcastExcept(ws, {
        type: "playerJoined",
        player: {
          id: requestedId,
          name: playerName,
          online: true,
          ready: existing.ready,
        },
      });

      this.persist();
      this.scheduleNextAlarm();
      return;
    }

    // 新玩家加入，检查房间是否已满
    if (this.players.size >= MAX_PLAYERS) {
      this.sendTo(ws, { type: "error", message: "房间已满" });
      ws.close(1000, "Room full");
      return;
    }

    const playerId = requestedId || generateId();

    // 创建玩家条目
    const entry: PlayerEntry = {
      id: playerId,
      name: playerName,
      online: true,
      ready: false,
    };
    this.players.set(playerId, entry);

    this.setAttachment(ws, { playerId, playerName });

    // 第一个玩家成为房主
    if (!this.ownerId) {
      this.ownerId = playerId;
    }

    // 广播新玩家加入给其他人
    this.broadcastExcept(ws, {
      type: "playerJoined",
      player: {
        id: playerId,
        name: playerName,
        online: true,
        ready: false,
      },
    });

    // 第二个玩家触发 readying 阶段
    if (this.players.size === 2 && this.phase === "waiting") {
      this.phase = "readying";
      this.broadcast({
        type: "phaseChange",
        phase: "readying",
        ownerId: this.ownerId,
      });
    }

    // 发送完整房间状态给新加入的玩家
    this.sendTo(ws, this.buildRoomState(playerId));

    this.persist();
    this.scheduleNextAlarm();
  }

  private handleReady(ws: WebSocket): void {
    if (this.phase !== "readying") {
      return;
    }

    const att = this.getAttachment(ws);
    if (!att?.playerId) {
      return;
    }

    // 房主不需要准备
    if (att.playerId === this.ownerId) {
      return;
    }

    const player = this.players.get(att.playerId);
    if (!player) {
      return;
    }

    player.ready = !player.ready;

    this.broadcast({
      type: "readyChanged",
      playerId: att.playerId,
      ready: player.ready,
    });

    this.persist();
  }

  private handleSetDifficulty(
    ws: WebSocket,
    msg: Record<string, unknown>,
  ): void {
    if (this.phase !== "waiting" && this.phase !== "readying") {
      return;
    }

    const att = this.getAttachment(ws);
    if (!att?.playerId || att.playerId !== this.ownerId) {
      return;
    }

    const diff = msg.difficulty as string;
    if (diff !== "easy" && diff !== "medium" && diff !== "hard") {
      return;
    }

    if (this.difficulty === diff) {
      return;
    }
    this.difficulty = diff;

    this.broadcast({
      type: "difficultyChanged",
      difficulty: this.difficulty,
    });

    this.persist();
  }

  private handleSetTimer(
    ws: WebSocket,
    msg: Record<string, unknown>,
  ): void {
    if (this.phase !== "waiting" && this.phase !== "readying") {
      return;
    }

    const att = this.getAttachment(ws);
    if (!att?.playerId || att.playerId !== this.ownerId) {
      return;
    }

    const minutes = msg.minutes as number | null;
    if (minutes !== null && minutes !== 3 && minutes !== 5 && minutes !== 10) {
      return;
    }

    this.timerMinutes = minutes as TimerMinutes;

    this.broadcast({
      type: "timerChanged",
      timerMinutes: this.timerMinutes,
    });

    this.persist();
  }

  private handleStartGame(ws: WebSocket): void {
    if (this.phase !== "readying") {
      return;
    }

    const att = this.getAttachment(ws);
    if (!att?.playerId || att.playerId !== this.ownerId) {
      return;
    }

    // 检查对手是否存在且已准备
    const players = Array.from(this.players.values());
    const opponent = players.find((p) => p.id !== this.ownerId);
    if (!opponent || !opponent.ready) {
      this.sendTo(ws, {
        type: "error",
        message: "对手未准备",
      });
      return;
    }

    // 生成迷宫
    const size = DIFFICULTY_CONFIG[this.difficulty].size;
    this.maze = generateMaze(size);

    // 倒计时
    this.gameStartsAt = Date.now() + COUNTDOWN_MS;

    // 随机分配玩家到入口
    const playerIds = Array.from(this.players.keys());
    // Fisher-Yates shuffle
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = playerIds[i]!;
      playerIds[i] = playerIds[j]!;
      playerIds[j] = tmp;
    }

    this.assignments.clear();
    this.positions.clear();
    this.explored.clear();

    // 分配入口 0 和 1
    const [pidA, pidB] = playerIds;
    this.assignments.set(pidA!, 0);
    this.assignments.set(pidB!, 1);

    // 设置初始位置
    this.positions.set(pidA!, {
      x: this.maze.entrances[0].x,
      y: this.maze.entrances[0].y,
    });
    this.positions.set(pidB!, {
      x: this.maze.entrances[1].x,
      y: this.maze.entrances[1].y,
    });

    // hard 模式：初始化探索网格
    if (this.difficulty === "hard") {
      for (const pid of playerIds) {
        const grid: boolean[][] = Array.from({ length: size }, () =>
          new Array<boolean>(size).fill(false),
        );
        const pos = this.positions.get(pid!)!;
        this.markExplored(grid, pos.x, pos.y, size);
        this.explored.set(pid!, grid);
      }
    }

    // 变更阶段
    this.phase = "playing";
    this.winnerId = null;

    // 广播游戏开始
    this.broadcast({
      type: "gameStart",
      maze: this.maze,
      assignments: Object.fromEntries(this.assignments),
      gameStartsAt: this.gameStartsAt,
      positions: Object.fromEntries(this.positions),
      difficulty: this.difficulty,
      timerMinutes: this.timerMinutes,
      explored:
        this.difficulty === "hard"
          ? Object.fromEntries(this.explored)
          : undefined,
    });

    // 系统消息
    const sysMsg = this.addSystemMessage(
      `游戏开始！难度：${this.difficulty}，迷宫大小：${size}x${size}`,
    );
    this.broadcast({ type: "chat", message: sysMsg });

    // 定时器 alarm
    if (this.timerMinutes !== null) {
      this.ctx.storage.setAlarm(
        this.gameStartsAt + this.timerMinutes * 60_000,
      );
    } else {
      // 仅调度不活跃检查
      this.scheduleNextAlarm();
    }

    this.persist();
  }

  private handleMove(
    ws: WebSocket,
    msg: Record<string, unknown>,
  ): void {
    if (this.phase !== "playing") {
      return;
    }

    // 检查倒计时是否结束
    if (Date.now() < this.gameStartsAt) {
      this.sendTo(ws, {
        type: "error",
        message: "游戏尚未开始",
      });
      return;
    }

    const att = this.getAttachment(ws);
    if (!att?.playerId) {
      return;
    }

    const playerId = att.playerId;
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    const direction = msg.direction as string;
    if (!direction) {
      return;
    }

    const currentPos = this.positions.get(playerId);
    if (!currentPos) {
      return;
    }

    if (!this.maze) {
      return;
    }

    const size = this.maze.size;

    // 方向 -> 墙壁常量映射
    let wallBit: number;
    let dx = 0;
    let dy = 0;

    switch (direction) {
      case "up":
        wallBit = WALL_TOP;
        dy = -1;
        break;
      case "down":
        wallBit = WALL_BOTTOM;
        dy = 1;
        break;
      case "left":
        wallBit = WALL_LEFT;
        dx = -1;
        break;
      case "right":
        wallBit = WALL_RIGHT;
        dx = 1;
        break;
      default:
        this.sendTo(ws, {
          type: "error",
          message: "无效方向",
        });
        return;
    }

    // 检查墙壁是否阻挡
    const cell = this.maze.cells[currentPos.y]![currentPos.x]!;
    if (cell & wallBit) {
      this.sendTo(ws, {
        type: "error",
        message: "墙壁阻挡",
      });
      return;
    }

    // 计算新位置
    const newX = currentPos.x + dx;
    const newY = currentPos.y + dy;

    // 边界验证 — 静默忽略
    if (newX < 0 || newX >= size || newY < 0 || newY >= size) {
      return;
    }

    // 更新位置
    const newPos = { x: newX, y: newY };
    this.positions.set(playerId, newPos);

    // hard 模式：更新探索网格
    let exploredGrid: boolean[][] | undefined;
    if (this.difficulty === "hard") {
      const grid = this.explored.get(playerId);
      if (grid) {
        this.markExplored(grid, newX, newY, size);
        exploredGrid = grid;
      }
    }

    // 检查是否到达金币位置
    if (newX === this.maze.gold.x && newY === this.maze.gold.y) {
      // 先广播移动
      this.broadcast({
        type: "playerMoved",
        playerId,
        position: newPos,
        explored:
          this.difficulty === "hard" && exploredGrid
            ? exploredGrid
            : undefined,
      });
      // 然后结束游戏
      this.handleGameEnd("gold", playerId);
      return;
    }

    // 广播移动
    this.broadcast({
      type: "playerMoved",
      playerId,
      position: newPos,
      explored:
        this.difficulty === "hard" && exploredGrid
          ? exploredGrid
          : undefined,
    });

    this.persist();
  }

  private handleGameEnd(
    reason: string,
    winnerId?: string,
  ): void {
    if (this.phase !== "playing" && this.phase !== "ended") {
      return;
    }

    this.phase = "ended";
    this.winnerId = winnerId || null;

    const winnerName = winnerId
      ? this.players.get(winnerId)?.name || ""
      : "";

    this.broadcast({
      type: "gameEnd",
      winnerId: this.winnerId,
      winnerName,
      reason,
    });

    // 系统消息
    let sysText: string;
    switch (reason) {
      case "gold":
        sysText = `${winnerName} 找到了宝藏，获胜！`;
        break;
      case "timeout":
        sysText = "时间到！平局结束。";
        break;
      case "disconnect":
        sysText = `对方断线，${winnerName} 获胜！`;
        break;
      case "surrender":
        sysText = `对方投降，${winnerName} 获胜！`;
        break;
      default:
        sysText = "游戏结束。";
        break;
    }

    const sysMsg = this.addSystemMessage(sysText);
    this.broadcast({ type: "chat", message: sysMsg });

    // 清除游戏定时器
    this.ctx.storage.deleteAlarm();
    this.scheduleNextAlarm();

    this.persist();
  }

  private handleChat(
    ws: WebSocket,
    msg: Record<string, unknown>,
  ): void {
    const att = this.getAttachment(ws);
    if (!att?.playerId) {
      return;
    }

    const text = msg.text as string;
    if (!text || typeof text !== "string" || text.length > 500) {
      return;
    }

    const player = this.players.get(att.playerId);
    if (!player) {
      return;
    }

    const chatMsg: ChatMessage = {
      id: generateId(),
      kind: "chat",
      playerId: att.playerId,
      playerName: player.name,
      text: text.trim(),
      timestamp: Date.now(),
    };

    this.chatHistory.push(chatMsg);
    if (this.chatHistory.length > MAX_CHAT) {
      this.chatHistory = this.chatHistory.slice(-MAX_CHAT);
    }

    this.broadcast({ type: "chat", message: chatMsg });

    this.persist();
  }

  private handleSurrender(ws: WebSocket): void {
    if (this.phase !== "playing") {
      return;
    }
    const att = this.getAttachment(ws);
    if (!att?.playerId) {
      return;
    }
    // 投降者输，对手赢
    const opponentId = Array.from(this.players.keys()).find((id) => id !== att.playerId);
    this.handleGameEnd("surrender", opponentId);
  }

  private handleTransferOwner(ws: WebSocket): void {
    const att = this.getAttachment(ws);
    if (!att?.playerId || att.playerId !== this.ownerId) {
      return;
    }
    if (this.phase === "playing") {
      return;
    }
    if (this.players.size < 2) {
      return;
    }

    // 找到对手
    const opponentId = Array.from(this.players.keys()).find((id) => id !== this.ownerId);
    if (!opponentId) {
      return;
    }

    this.ownerId = opponentId;

    // 重置准备状态
    for (const player of this.players.values()) {
      player.ready = false;
    }

    // 回到 readying
    this.phase = "readying";
    this.maze = null;
    this.positions.clear();
    this.explored.clear();
    this.assignments.clear();
    this.winnerId = null;
    this.gameStartsAt = 0;

    this.broadcast({
      type: "phaseChange",
      phase: "readying",
      ownerId: this.ownerId,
    });

    const newOwner = this.players.get(this.ownerId);
    const sysMsg = this.addSystemMessage(`${newOwner?.name ?? "对方"} 成为了新房主`);
    this.broadcast({ type: "chat", message: sysMsg });

    this.persist();
  }

  private handlePlayAgain(ws: WebSocket): void {
    const att = this.getAttachment(ws);
    if (!att?.playerId) {
      return;
    }

    if (att.playerId !== this.ownerId) {
      return;
    }

    if (this.phase !== "ended") {
      return;
    }

    // 重置游戏状态
    this.phase = "readying";
    this.maze = null;
    this.positions.clear();
    this.explored.clear();
    this.assignments.clear();
    this.winnerId = null;
    this.gameStartsAt = 0;

    // 重置所有玩家的准备状态
    for (const player of this.players.values()) {
      player.ready = false;
    }

    this.broadcast({
      type: "phaseChange",
      phase: "readying",
      ownerId: this.ownerId,
    });

    const sysMsg = this.addSystemMessage("房主发起了新一局");
    this.broadcast({ type: "chat", message: sysMsg });

    this.persist();
  }

  private handleLeave(ws: WebSocket): void {
    const att = this.getAttachment(ws);
    if (!att?.playerId) {
      return;
    }

    // 主动离开 → 立即移除玩家，不走 grace period
    const player = this.players.get(att.playerId);
    if (player) {
      player.graceTimeout = undefined;
    }

    this.handlePlayerRemoved(att.playerId);

    try {
      ws.close(1000, "Left");
    } catch {
      /* ignore */
    }

    // 所有人都走了 → 广播房间关闭
    if (this.players.size === 0) {
      this.broadcast({ type: "roomClosed", reason: "所有玩家已离开" });
    }
  }

  private handlePing(_ws: WebSocket): void {
    // no-op — 心跳只用于保活底层 WebSocket 连接，不需要应答
  }

  /* ── 断线处理 ── */

  private handleDisconnect(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    player.online = false;

    this.startGracePeriod(playerId, GRACE_PERIOD);

    // 通知对方该玩家离线了（更新 online 状态）
    this.broadcast({
      type: "readyChanged",
      playerId,
      ready: player.ready,
    });
  }

  private startGracePeriod(playerId: string, duration: number): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    player.online = false;
    player.graceTimeout = Date.now() + duration;

    this.persist();
    this.scheduleNextAlarm();
  }

  private handlePlayerRemoved(playerId: string): void {
    const wasOwner = playerId === this.ownerId;
    this.players.delete(playerId);
    this.positions.delete(playerId);
    this.explored.delete(playerId);
    this.assignments.delete(playerId);

    this.broadcast({
      type: "playerLeft",
      playerId,
    });

    // 如果没有玩家了，关闭房间
    if (this.players.size === 0) {
      this.closed = true;
      this.persist();
      return;
    }

    // 如果房主离开了，转移房主
    if (wasOwner) {
      const remaining = Array.from(this.players.values());
      if (remaining.length > 0) {
        this.ownerId = remaining[0]!.id;
      }
    }

    // 游戏中有人离开 → 对手获胜（gameEnd 也带上新的 ownerId 通知）
    if (this.phase === "playing") {
      const remaining = Array.from(this.players.values());
      if (remaining.length > 0) {
        // 先广播 ownerId 变更，确保结果弹窗里"再来一局"按钮归到新房主
        if (wasOwner) {
          this.broadcast({
            type: "phaseChange",
            phase: "playing",
            ownerId: this.ownerId,
          });
        }
        this.handleGameEnd("disconnect", remaining[0]!.id);
      }
      this.persist();
      return;
    }

    // readying / ended 阶段人不够了 → 回到 waiting，并把所有人的 ready 重置
    if (this.players.size < 2 && this.phase !== "waiting") {
      this.phase = "waiting";
      for (const p of this.players.values()) {
        p.ready = false;
      }
      this.broadcast({
        type: "phaseChange",
        phase: "waiting",
        ownerId: this.ownerId,
      });
    } else if (wasOwner) {
      // 仍有 2 人但房主走了 → 通知房主切换（理论上不会发生，因为 size < 2 总会触发上面分支）
      this.broadcast({
        type: "phaseChange",
        phase: this.phase,
        ownerId: this.ownerId,
      });
    }

    this.persist();
  }

  /* ── 定时器 ── */

  private scheduleNextAlarm(): void {
    const now = Date.now();
    let next = now + INACTIVITY_TIMEOUT;

    // 断线清理
    for (const player of this.players.values()) {
      if (player.graceTimeout) {
        next = Math.min(next, player.graceTimeout);
      }
    }

    // 游戏倒计时
    if (this.phase === "playing" && this.timerMinutes && this.gameStartsAt) {
      const gameEnd = this.gameStartsAt + this.timerMinutes * 60_000;
      next = Math.min(next, gameEnd);
    }

    // 不活跃超时
    next = Math.min(next, this.lastActivityAt + INACTIVITY_TIMEOUT);

    // 至少 100ms 后
    next = Math.max(next, now + 100);

    this.ctx.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    if (this.closed) {
      return;
    }

    const now = Date.now();

    // 检查 grace period 过期（先收集再处理，避免遍历中删除）
    const toRemove: string[] = [];
    for (const [id, player] of this.players) {
      if (player.graceTimeout && now >= player.graceTimeout) {
        player.graceTimeout = undefined;
        if (!player.online) {
          toRemove.push(id);
        }
      }
    }
    for (const id of toRemove) {
      this.handlePlayerRemoved(id);
    }

    // 检查游戏定时器过期
    if (this.phase === "playing" && this.timerMinutes && this.gameStartsAt) {
      const endTime = this.gameStartsAt + this.timerMinutes * 60_000;
      if (now >= endTime) {
        this.handleGameEnd("timeout");
        return;
      }
    }

    // 不活跃超时（30 分钟）：仅在没有任何活跃 WS 时才关闭
    if (
      now - this.lastActivityAt >= INACTIVITY_TIMEOUT &&
      this.ctx.getWebSockets().length === 0
    ) {
      this.closed = true;
      this.persist();
      return;
    }

    // 如果还有活跃内容，继续调度
    if (
      !this.closed &&
      (this.hasGracePending() ||
        this.ctx.getWebSockets().length > 0 ||
        this.phase === "playing")
    ) {
      this.scheduleNextAlarm();
    }

    this.persist();
  }

  /* ── 广播工具 ── */

  private broadcast(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  private broadcastExcept(excludeWs: WebSocket, data: unknown): void {
    const msg = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== excludeWs) {
        try {
          ws.send(msg);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private sendTo(ws: WebSocket, data: unknown): void {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  /* ── 状态构建工具 ── */

  private buildRoomState(forPlayerId: string): Record<string, unknown> {
    return {
      type: "roomState",
      yourId: forPlayerId,
      roomCode: this.roomCode,
      phase: this.phase,
      ownerId: this.ownerId,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        online: p.online,
        ready: p.ready,
      })),
      difficulty: this.difficulty,
      timerMinutes: this.timerMinutes,
      maze: this.maze,
      assignments:
        this.assignments.size > 0
          ? Object.fromEntries(this.assignments)
          : undefined,
      gameStartsAt: this.gameStartsAt || undefined,
      positions:
        this.positions.size > 0
          ? Object.fromEntries(this.positions)
          : undefined,
      winnerId: this.phase === "ended" ? this.winnerId : undefined,
      explored:
        this.difficulty === "hard" && this.explored.size > 0
          ? Object.fromEntries(this.explored)
          : undefined,
      chatHistory: this.chatHistory,
    };
  }

  /* ── WebSocket Attachment 工具 ── */

  private getAttachment(ws: WebSocket): WsAttachment | null {
    try {
      return ws.deserializeAttachment() as WsAttachment | null;
    } catch {
      return null;
    }
  }

  private setAttachment(ws: WebSocket, att: WsAttachment): void {
    ws.serializeAttachment(att);
  }

  /* ── 探索网格工具 (hard 模式) ── */

  private markExplored(
    grid: boolean[][],
    cx: number,
    cy: number,
    size: number,
  ): void {
    const r = EXPLORE_RADIUS;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (
          nx >= 0 &&
          nx < size &&
          ny >= 0 &&
          ny < size &&
          dx * dx + dy * dy <= r2
        ) {
          grid[ny]![nx] = true;
        }
      }
    }
  }

  /* ── 其他工具 ── */

  private addSystemMessage(text: string): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      kind: "system",
      playerId: "",
      playerName: "",
      text,
      timestamp: Date.now(),
    };
    this.chatHistory.push(msg);
    if (this.chatHistory.length > MAX_CHAT) {
      this.chatHistory = this.chatHistory.slice(-MAX_CHAT);
    }
    return msg;
  }

  private hasGracePending(): boolean {
    for (const player of this.players.values()) {
      if (player.graceTimeout) {
        return true;
      }
    }
    return false;
  }
}
