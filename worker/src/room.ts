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

interface PlayerInfo {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
}

interface PlayerEntry {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
  ws: WebSocket | null;
  graceTimeout?: number;
}

interface WsAttachment {
  playerId: string | null;
  playerName: string | null;
}

type GamePhase = "waiting" | "readying" | "playing" | "ended";
type Difficulty = "easy" | "medium" | "hard";
type TimerMinutes = 3 | 5 | 10 | null;

/* ── 墙壁常量 (与 maze.ts 一致) ── */
const WALL_TOP = 1;
const WALL_RIGHT = 2;
const WALL_BOTTOM = 4;
const WALL_LEFT = 8;

/* ── 其他常量 ── */
const MAX_PLAYERS = 2;
const GRACE_PERIOD = 30_000;
const QUICK_GRACE = 5_000;
const INACTIVITY_TIMEOUT = 5 * 60_000;
const MAX_CHAT = 200;
const COUNTDOWN_MS = 4000;
const EXPLORE_RADIUS = 3;

/* ── 工具函数 ── */
function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ── MazeRoom Durable Object ── */
export class MazeRoom extends DurableObject {
  /* ── 状态字段 ── */
  private roomCode = "";
  private phase: GamePhase = "waiting";
  private ownerId = "";
  private difficulty: Difficulty = "easy";
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

  /* ── HTTP 入口 ── */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /setup — 初始化房间
    if (url.pathname === "/setup" && request.method === "POST") {
      const { roomCode } = (await request.json()) as { roomCode: string };
      this.roomCode = roomCode;
      this.lastActivityAt = Date.now();
      return new Response("ok");
    }

    // GET /info — 房间信息（用于加入前验证）
    if (url.pathname === "/info") {
      const ownerEntry = Array.from(this.players.values()).find(
        (p) => p.id === this.ownerId,
      );
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
      existing.ws = ws;
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
      ws,
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
  }

  private handleSetDifficulty(
    ws: WebSocket,
    msg: Record<string, unknown>,
  ): void {
    if (this.phase !== "readying") {
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

    this.difficulty = diff;

    this.broadcast({
      type: "difficultyChanged",
      difficulty: this.difficulty,
    });
  }

  private handleSetTimer(
    ws: WebSocket,
    msg: Record<string, unknown>,
  ): void {
    if (this.phase !== "readying") {
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
    const ownerPlayer = this.players.get(this.ownerId);
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

    // 边界验证
    if (newX < 0 || newX >= size || newY < 0 || newY >= size) {
      this.sendTo(ws, {
        type: "error",
        message: "超出边界",
      });
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
      default:
        sysText = "游戏结束。";
        break;
    }

    const sysMsg = this.addSystemMessage(sysText);
    this.broadcast({ type: "chat", message: sysMsg });

    // 清除游戏定时器
    this.ctx.storage.deleteAlarm();
    this.scheduleNextAlarm();
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
  }

  private handleLeave(ws: WebSocket): void {
    const att = this.getAttachment(ws);
    if (!att?.playerId) {
      return;
    }

    const player = this.players.get(att.playerId);
    if (player) {
      player.online = false;
      player.ws = null;
    }

    this.startGracePeriod(att.playerId, GRACE_PERIOD);

    try {
      ws.close(1000, "Left");
    } catch {
      /* ignore */
    }
  }

  private handlePing(_ws: WebSocket): void {
    // no-op — 连接保活由 WebSocket 层处理
  }

  /* ── 断线处理 ── */

  private handleDisconnect(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      player.online = false;
      player.ws = null;
    }

    this.startGracePeriod(playerId, GRACE_PERIOD);

    // 广播下线
    this.broadcast({
      type: "playerOffline",
      playerId,
    });
  }

  private startGracePeriod(playerId: string, duration: number): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    player.online = false;
    player.graceTimeout = Date.now() + duration;

    this.scheduleNextAlarm();
  }

  private handlePlayerRemoved(playerId: string): void {
    const removedPlayer = this.players.get(playerId);
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
      return;
    }

    // 如果房主离开了，转移房主
    if (playerId === this.ownerId) {
      const remaining = Array.from(this.players.values());
      if (remaining.length > 0) {
        this.ownerId = remaining[0]!.id;
      }
    }

    // 游戏中有人离开 → 对手获胜
    if (this.phase === "playing") {
      const remaining = Array.from(this.players.values());
      if (remaining.length > 0) {
        this.handleGameEnd("disconnect", remaining[0]!.id);
      }
      return;
    }

    // readying 阶段人不够了 → 回到 waiting
    if (this.players.size < 2 && this.phase !== "waiting") {
      this.phase = "waiting";
      this.broadcast({
        type: "phaseChange",
        phase: "waiting",
        ownerId: this.ownerId,
      });
    }
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

    // 检查 grace period 过期
    for (const [id, player] of this.players) {
      if (player.graceTimeout && now >= player.graceTimeout) {
        player.graceTimeout = undefined;
        // 确认玩家确实仍然离线
        if (!player.online) {
          this.handlePlayerRemoved(id);
        }
      }
    }

    // 检查游戏定时器过期
    if (this.phase === "playing" && this.timerMinutes && this.gameStartsAt) {
      const endTime = this.gameStartsAt + this.timerMinutes * 60_000;
      if (now >= endTime) {
        this.handleGameEnd("timeout");
        return;
      }
    }

    // 不活跃超时（5 分钟）
    if (now - this.lastActivityAt >= INACTIVITY_TIMEOUT) {
      this.closed = true;
      this.broadcast({
        type: "roomClosed",
        reason: "长时间无操作，房间已关闭",
      });
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

  private buildAssignments(): Record<string, number> | undefined {
    if (this.assignments.size === 0) {
      return undefined;
    }
    return Object.fromEntries(this.assignments);
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
