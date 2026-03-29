import { useState, useEffect, useRef } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { getWsBase, getHttpBase } from "../api";
import { hasWall, shortestPath } from "../utils/maze";
import MazeCanvas, { type PlayerRender } from "../components/MazeCanvas";
import PlayerBar from "../components/PlayerBar";
import CountdownOverlay from "../components/CountdownOverlay";
import GameResultModal from "../components/GameResultModal";
import Confetti from "../components/Confetti";
import { SFX } from "../hooks/useSound";
import type {
  GamePhase,
  Difficulty,
  Direction,
  PlayerInfo,
  MazeData,
  Position,
  S_GameStart,
} from "../types/protocol";

const bullionUrl = new URL("../imgs/bullion.png", import.meta.url).href;

interface RoomProps {
  roomCode: string;
  nickname: string;
  playerId: string;
  initialDifficulty?: Difficulty;
  onLeave: () => void;
}

export default function Room({ roomCode, nickname, playerId, initialDifficulty, onLeave }: RoomProps) {
  /* ── Room state ── */
  const [myId, setMyId] = useState("");
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [phase, setPhase] = useState<GamePhase>("waiting");
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty ?? "medium");

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
  const [readyLoading, setReadyLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [optimalSteps, setOptimalSteps] = useState(0);
  const [showSurrenderConfirm, setShowSurrenderConfirm] = useState(false);

  /* ── WebSocket ── */
  const wsUrl = `${getWsBase()}/api/rooms/${roomCode}/ws`;
  const { connected, send, addListener, leave } = useWebSocket(wsUrl);

  /* ── Effect: Join on connect ── */
  useEffect(() => {
    if (connected) {
      send({ type: "join", playerName: nickname, playerId });
      // 房主创建时把首页选的难度同步给服务端
      if (initialDifficulty) {
        send({ type: "setDifficulty", difficulty: initialDifficulty });
      }
    }
  }, [connected, nickname, playerId, initialDifficulty, send]);

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
            setReadyLoading(false);
            setPlayers((prev) =>
              prev.map((p) => ({ ...p, ready: false })),
            );
          }
          break;
        case "gameStart": {
          setPhase("playing");
          setStepCount(0);
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
          // 本地玩家已乐观更新，只同步对方位置（send 失败时不会乐观更新，所以不会漂移）
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
          // 计算最优步数
          if (mazeRef.current) {
            const m = mazeRef.current;
            const myEntrance = positionsRef.current[myIdRef.current] ?? m.entrances[0];
            const optimal = shortestPath(m, m.entrances[0], m.gold);
            const optimal2 = shortestPath(m, m.entrances[1], m.gold);
            // 取当前玩家入口到金子的最短路径
            const d0 = Math.abs(myEntrance.x - m.entrances[0].x) + Math.abs(myEntrance.y - m.entrances[0].y);
            const d1 = Math.abs(myEntrance.x - m.entrances[1].x) + Math.abs(myEntrance.y - m.entrances[1].y);
            setOptimalSteps(d0 <= d1 ? optimal : optimal2);
          }
          if (msg.winnerId === myId) {
            setShowConfetti(true);
            if (msg.reason === "gold") {
              SFX.gold.play();
            }
            setTimeout(() => SFX.win.play(), 300);
          } else {
            SFX.lose.play();
          }
          break;
        case "difficultyChanged":
          setDifficulty(msg.difficulty);
          break;
        case "readyChanged":
          setReadyLoading(false);
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
  const showCountdownRef = useRef(showCountdown);
  showCountdownRef.current = showCountdown;

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
      if (!direction || !mazeRef.current || showCountdownRef.current) {
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
        SFX.bump.play();
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
      const sent = send({ type: "move", direction });
      if (sent) {
        SFX.move.play();
        setPositions((prev) => ({ ...prev, [myIdRef.current]: newPos }));
        setStepCount((prev) => prev + 1);
      }
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

          {/* Spacer */}
          <div className="flex-1" />

          {/* Playing: elapsed timer + surrender — 靠右 */}
          {phase === "playing" && (
            <>
              <span className="text-sm text-gray-500">
                <span className="text-gray-400">用时:</span>
                <span className="font-mono">{String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}</span>
              </span>
              <span className="text-sm text-gray-500">
                <span className="text-gray-400">步数:</span>
                <span className="font-mono">{stepCount}</span>
              </span>
              <button
                onClick={() => setShowSurrenderConfirm(true)}
                className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 transition"
              >
                投降
              </button>
            </>
          )}

          {/* Readying controls — right side */}
          {phase === "readying" && isOwner && (
            <>
              {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => send({ type: "setDifficulty", difficulty: d })}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    difficulty === d
                      ? "bg-indigo-100 text-indigo-700 border border-indigo-300"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200"
                  }`}
                >
                  {d === "easy" ? "简单" : d === "medium" ? "中等" : "困难"}
                </button>
              ))}
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
              onClick={() => {
                if (readyLoading) {
                  return;
                }
                setReadyLoading(true);
                send({ type: "ready" });
              }}
              disabled={readyLoading}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${
                players.find((p) => p.id === myId)?.ready
                  ? "bg-green-500 text-white hover:bg-green-600"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {readyLoading
                ? "准备中..."
                : players.find((p) => p.id === myId)?.ready
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
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
              {(phase === "waiting" || phase === "readying") && (
                <>
                  <img
                    src={bullionUrl}
                    alt="gold"
                    className="w-24 h-24 mb-4 gold-shimmer"
                  />
                  <span className="text-lg">
                    {phase === "waiting" ? "等待对手加入后开始游戏" : "准备就绪后开始游戏"}
                  </span>
                  <style>{`
                    @keyframes gold-shimmer {
                      0%, 100% { opacity: 1; filter: brightness(1) drop-shadow(0 0 4px transparent); transform: scale(1); }
                      50% { opacity: 0.75; filter: brightness(1.4) drop-shadow(0 0 12px #ffd700); transform: scale(1.08); }
                    }
                    .gold-shimmer { animation: gold-shimmer 1.6s ease-in-out infinite; }
                  `}</style>
                </>
              )}
              {phase !== "waiting" && phase !== "readying" && "加载中..."}
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
          connected={connected}
          gameDuration={gameDuration}
          stepCount={stepCount}
          optimalSteps={optimalSteps}
          onPlayAgain={() => {
            const sent = send({ type: "playAgain" });
            if (!sent) {
              alert("连接已断开，正在重连，请稍后再试");
            }
          }}
          onLeave={handleLeave}
          onClose={() => setShowResult(false)}
        />
      )}
      <Confetti show={showConfetti} />

      {/* 投降确认弹框 */}
      {showSurrenderConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs shadow-xl text-center">
            <div className="text-4xl mb-3">🏳️</div>
            <h3 className="text-lg font-bold text-gray-700 mb-2">确定要投降吗？</h3>
            <p className="text-sm text-gray-400 mb-5">投降后对方将直接获胜</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSurrenderConfirm(false)}
                className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const sent = send({ type: "surrender" });
                  if (sent) {
                    setShowSurrenderConfirm(false);
                  } else {
                    alert("网络连接断开，请刷新页面重试");
                  }
                }}
                className="flex-1 py-2.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition"
              >
                确定投降
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
