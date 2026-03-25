import { useState, useEffect, useRef } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { getWsBase, getHttpBase } from "../api";
import { hasWall } from "../utils/maze";
import MazeCanvas, { type PlayerRender } from "../components/MazeCanvas";
import PlayerBar from "../components/PlayerBar";
import CountdownOverlay from "../components/CountdownOverlay";
import GameResultModal from "../components/GameResultModal";
import Confetti from "../components/Confetti";
import type {
  GamePhase,
  Difficulty,
  Direction,
  PlayerInfo,
  MazeData,
  Position,
  S_GameStart,
} from "../types/protocol";

interface RoomProps {
  roomCode: string;
  nickname: string;
  playerId: string;
  onLeave: () => void;
}

export default function Room({ roomCode, nickname, playerId, onLeave }: RoomProps) {
  /* ── Room state ── */
  const [myId, setMyId] = useState("");
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [phase, setPhase] = useState<GamePhase>("waiting");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

  /* ── Game state ── */
  const [maze, setMaze] = useState<MazeData | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [gameStartsAt, setGameStartsAt] = useState(0);
  const [winnerId, setWinnerId] = useState<string | null | undefined>(undefined);
  const [winnerName, setWinnerName] = useState("");
  const [gameEndReason, setGameEndReason] = useState<"gold" | "timeout" | "disconnect" | "surrender">("gold");
  const [gameDuration, setGameDuration] = useState(0); // 用时（秒）

  /* ── UI state ── */
  const [showCountdown, setShowCountdown] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  /* ── WebSocket ── */
  const wsUrl = `${getWsBase()}/api/rooms/${roomCode}/ws`;
  const { connected, send, addListener, leave } = useWebSocket(wsUrl);

  /* ── Effect: Join on connect ── */
  useEffect(() => {
    if (connected) {
      send({ type: "join", playerName: nickname, playerId });
    }
  }, [connected, nickname, playerId, send]);

  /* ── Effect: WebSocket message handler ── */
  useEffect(() => {
    return addListener((msg) => {
      switch (msg.type) {
        case "roomState": {
          setMyId(msg.yourId);
          setPlayers(msg.players);
          setOwnerId(msg.ownerId);
          setPhase(msg.phase);
          setDifficulty(msg.difficulty);
          if (msg.maze) {
            setMaze(msg.maze);
          }
          if (msg.gameStartsAt) {
            setGameStartsAt(msg.gameStartsAt);
            if (Date.now() < msg.gameStartsAt) {
              setShowCountdown(true);
            }
          }
          if (msg.positions) {
            setPositions(msg.positions);
          }
          if (msg.winnerId !== undefined) {
            setWinnerId(msg.winnerId);
          }
          break;
        }
        case "playerJoined":
          setPlayers((prev) => {
            if (prev.some((p) => p.id === msg.player.id)) {
              return prev.map((p) => p.id === msg.player.id ? msg.player : p);
            }
            return [...prev, msg.player];
          });
          break;
        case "playerLeft":
          setPlayers((prev) => prev.filter((p) => p.id !== msg.playerId));
          break;
        case "phaseChange":
          setPhase(msg.phase);
          setOwnerId(msg.ownerId);
          if (msg.phase === "readying") {
            setMaze(null);
            setPositions({});
            setGameStartsAt(0);
            setWinnerId(undefined);
            setWinnerName("");
            setShowConfetti(false);
            setShowResult(false);
            setPlayers((prev) =>
              prev.map((p) => ({ ...p, ready: false })),
            );
          }
          break;
        case "gameStart": {
          setPhase("playing");
          setMaze(msg.maze);
          setGameStartsAt(msg.gameStartsAt);
          const gameStartMsg = msg as S_GameStart & { positions?: Record<string, Position> };
          if (gameStartMsg.positions) {
            setPositions(gameStartMsg.positions);
          } else {
            const initPositions: Record<string, Position> = {};
            for (const [pid, val] of Object.entries(msg.assignments)) {
              const idx = typeof val === "number" ? val : (val as { entrance: number }).entrance ?? 0;
              initPositions[pid] = msg.maze.entrances[idx] ?? { x: 0, y: 0 };
            }
            setPositions(initPositions);
          }
          setShowCountdown(true);
          break;
        }
        case "playerMoved":
          // 本地玩家已经乐观更新了，只同步对方的位置
          if (msg.playerId !== playerId) {
            setPositions((prev) => ({ ...prev, [msg.playerId]: msg.position }));
          }
          break;
        case "gameEnd":
          setWinnerId(msg.winnerId);
          setWinnerName(msg.winnerName);
          setGameEndReason(msg.reason);
          setPhase("ended");
          setShowResult(true);
          // 用 ref 读取最新的 gameStartsAt，避免闭包陈旧值
          if (gameStartsAtRef.current) {
            setGameDuration(Math.floor((Date.now() - gameStartsAtRef.current) / 1000));
          }
          if (msg.winnerId === myId) {
            setShowConfetti(true);
          }
          break;
        case "difficultyChanged":
          setDifficulty(msg.difficulty);
          break;
        case "readyChanged":
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === msg.playerId ? { ...p, ready: msg.ready } : p,
            ),
          );
          break;
        case "roomClosed":
          leave();
          onLeave();
          break;
        case "error":
          console.error("Server error:", msg.message);
          break;
      }
    });
  }, [addListener, myId, leave, onLeave]);

  /* ── Refs for keyboard handler ── */
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const mazeRef = useRef(maze);
  mazeRef.current = maze;
  const gameStartsAtRef = useRef(gameStartsAt);
  gameStartsAtRef.current = gameStartsAt;
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  /* ── Effect: Keyboard movement handler (cell-to-cell) ── */
  useEffect(() => {
    if (phase !== "playing") {
      return;
    }

    let lastMoveTime = 0;
    const MOVE_INTERVAL = 100;

    const handleKeyDown = (e: KeyboardEvent) => {
      const dirMap: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = dirMap[e.key];
      if (!direction || !mazeRef.current || Date.now() < gameStartsAtRef.current) {
        return;
      }
      e.preventDefault();

      const now = Date.now();
      if (now - lastMoveTime < MOVE_INTERVAL) {
        return;
      }
      lastMoveTime = now;

      const myPos = positionsRef.current[myIdRef.current];
      if (!myPos) {
        return;
      }
      const m = mazeRef.current;
      const cell = m.cells[myPos.y]?.[myPos.x];
      if (cell === undefined) {
        return;
      }
      if (hasWall(cell, direction)) {
        return;
      }

      let nx = myPos.x, ny = myPos.y;
      if (direction === "up") { ny -= 1; }
      if (direction === "down") { ny += 1; }
      if (direction === "left") { nx -= 1; }
      if (direction === "right") { nx += 1; }
      if (nx < 0 || nx >= m.size || ny < 0 || ny >= m.size) {
        return;
      }

      const newPos = { x: nx, y: ny };
      setPositions((prev) => ({ ...prev, [myIdRef.current]: newPos }));
      send({ type: "move", direction });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, send]);

  /* ── Effect: Elapsed timer ── */
  useEffect(() => {
    if (phase !== "playing" || !gameStartsAt) {
      return;
    }
    const interval = setInterval(() => {
      const now = Date.now();
      if (now >= gameStartsAt) {
        setElapsedSeconds(Math.floor((now - gameStartsAt) / 1000));
      }
    }, 500);
    return () => clearInterval(interval);
  }, [phase, gameStartsAt]);

  /* ── Effect: sendBeacon on unload ── */
  useEffect(() => {
    const handleBeforeUnload = () => {
      navigator.sendBeacon(
        `${getHttpBase()}/api/rooms/${roomCode}/quickleave`,
        JSON.stringify({ playerId }),
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [roomCode, playerId]);

  /* ── Derived values ── */
  const isOwner = myId === ownerId;
  const opponent = players.find((p) => p.id !== myId);
  const myPosition = positions[myId];

  // 按玩家列表顺序分配固定颜色，双方看到的颜色一致
  const PLAYER_COLORS = ["#6366f1", "#ec4899"];
  const mazePlayerRenders: PlayerRender[] = players
    .map((p, i) => ({
      id: p.id,
      position: positions[p.id] ?? { x: 0, y: 0 },
      color: PLAYER_COLORS[i] ?? PLAYER_COLORS[0],
      label: p.name.charAt(0),
    }))
    .filter((p) => positions[p.id] !== undefined);

  const handleLeave = () => {
    leave();
    onLeave();
  };

  return (
    <div className="h-screen flex flex-col bg-[#eff2ff] overflow-hidden">
      {/* Top bar */}
      <PlayerBar
        roomCode={roomCode}
        phase={phase}
        players={players}
        ownerId={ownerId}
        myId={myId}
        onLeave={handleLeave}
        onTransferOwner={() => send({ type: "transferOwner" })}
      />

      <div className="flex-1 flex flex-col p-4 overflow-hidden">
        {/* Player cards + controls in one row */}
        <div className="flex items-center gap-3 mb-3">
          {/* Player tags — color by list order (same as maze) */}
          {players.map((p, i) => {
            const borderCls = i === 0 ? "border border-indigo-400" : "border border-pink-400";
            const textCls = i === 0 ? "text-indigo-600" : "text-pink-500";
            return (
            <div
              key={p.id}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white shadow-sm text-sm ${borderCls}`}
            >
              <span className={`font-bold ${textCls}`}>
                {p.name}
              </span>
              <span className="text-xs text-gray-400">
                {p.id === myId ? "(你)" : ""}
                {!p.online
                  ? " 离线"
                  : phase === "readying"
                    ? p.id === ownerId
                      ? ""
                      : p.ready ? " 已准备" : " 未准备"
                    : ""}
              </span>
            </div>
            );
          })}
          {players.length < 2 && (
            <div className="flex items-center px-3 py-1.5 rounded-lg bg-white shadow-sm border border-dashed border-gray-300 text-sm text-gray-400">
              等待对手...
            </div>
          )}

          {/* Playing: elapsed timer + surrender */}
          {phase === "playing" && (
            <>
              <span className="text-sm font-mono text-gray-500 ml-2">
                {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}
              </span>
              <button
                onClick={() => {
                  if (window.confirm("确定投降吗？")) {
                    send({ type: "surrender" });
                  }
                }}
                className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 transition"
              >
                投降
              </button>
            </>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Readying controls — right side */}
          {phase === "readying" && isOwner && (
            <>
              <select
                value={difficulty}
                onChange={(e) =>
                  send({
                    type: "setDifficulty",
                    difficulty: e.target.value as Difficulty,
                  })
                }
                className="px-2 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-700 text-sm focus:ring-2 focus:ring-indigo-400 outline-none"
              >
                <option value="easy">简单</option>
                <option value="medium">中等</option>
                <option value="hard">困难</option>
              </select>
              <button
                onClick={() => send({ type: "startGame" })}
                disabled={!opponent?.ready}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                开始游戏
              </button>
            </>
          )}
          {phase === "readying" && !isOwner && (
            <button
              onClick={() => send({ type: "ready" })}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition ${
                players.find((p) => p.id === myId)?.ready
                  ? "bg-green-500 text-white hover:bg-green-600"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {players.find((p) => p.id === myId)?.ready
                ? "已准备 \u2713"
                : "准备"}
            </button>
          )}
        </div>

        {/* Maze canvas or waiting message */}
        <div className="flex-1 relative bg-white rounded-lg shadow-sm overflow-hidden p-2">
          {maze && myPosition ? (
            <MazeCanvas
              maze={maze}
              players={mazePlayerRenders}
              difficulty={difficulty}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              {phase === "waiting"
                ? "等待对手加入后开始游戏"
                : phase === "readying"
                  ? "准备就绪后开始游戏"
                  : "加载中..."}
            </div>
          )}
          {showCountdown && (
            <CountdownOverlay
              gameStartsAt={gameStartsAt}
              onDone={() => setShowCountdown(false)}
            />
          )}
        </div>
      </div>

      {/* Game result modal */}
      {showResult && phase === "ended" && winnerId !== undefined && (
        <GameResultModal
          winnerId={winnerId}
          winnerName={winnerName}
          myId={myId}
          reason={gameEndReason}
          isOwner={isOwner}
          gameDuration={gameDuration}
          onPlayAgain={() => send({ type: "playAgain" })}
          onLeave={handleLeave}
          onClose={() => setShowResult(false)}
        />
      )}
      <Confetti show={showConfetti} />
    </div>
  );
}
