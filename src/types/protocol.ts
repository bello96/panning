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
