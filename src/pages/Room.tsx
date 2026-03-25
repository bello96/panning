import { useState, useEffect } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { getWsBase, getHttpBase } from "../api";
import { hasWall, moveInDirection } from "../utils/maze";
import MazeCanvas from "../components/MazeCanvas";
import PlayerBar from "../components/PlayerBar";
import ChatPanel from "../components/ChatPanel";
import CountdownOverlay from "../components/CountdownOverlay";
import GameResultModal from "../components/GameResultModal";
import Confetti from "../components/Confetti";
import type {
  GamePhase,
  Difficulty,
  Direction,
  PlayerInfo,
  ChatMessage,
  MazeData,
  Position,
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
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [timerMinutes, setTimerMinutes] = useState<3 | 5 | 10 | null>(null);

  /* ── Game state ── */
  const [maze, setMaze] = useState<MazeData | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [gameStartsAt, setGameStartsAt] = useState(0);
  const [winnerId, setWinnerId] = useState<string | null | undefined>(undefined);
  const [winnerName, setWinnerName] = useState("");
  const [gameEndReason, setGameEndReason] = useState<"gold" | "timeout" | "disconnect">("gold");
  const [explored, setExplored] = useState<Record<string, boolean[][]>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  /* ── UI state ── */
  const [showCountdown, setShowCountdown] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [chatFocused, setChatFocused] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

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
          setTimerMinutes(msg.timerMinutes);
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
          if (msg.explored) {
            setExplored(msg.explored);
          }
          setChatMessages(msg.chatHistory);
          break;
        }
        case "playerJoined":
          setPlayers((prev) => [...prev, msg.player]);
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
            setExplored({});
            setShowConfetti(false);
          }
          break;
        case "gameStart": {
          setMaze(msg.maze);
          setGameStartsAt(msg.gameStartsAt);
          const initPositions: Record<string, Position> = {};
          for (const [pid, data] of Object.entries(msg.assignments)) {
            initPositions[pid] = data.position;
          }
          setPositions(initPositions);
          setShowCountdown(true);
          break;
        }
        case "playerMoved":
          setPositions((prev) => ({ ...prev, [msg.playerId]: msg.position }));
          if (msg.explored) {
            setExplored((prev) => ({ ...prev, [msg.playerId]: msg.explored! }));
          }
          break;
        case "gameEnd":
          setWinnerId(msg.winnerId);
          setWinnerName(msg.winnerName);
          setGameEndReason(msg.reason);
          setPhase("ended");
          if (msg.winnerId === myId) {
            setShowConfetti(true);
          }
          break;
        case "difficultyChanged":
          setDifficulty(msg.difficulty);
          break;
        case "timerChanged":
          setTimerMinutes(msg.timerMinutes);
          break;
        case "readyChanged":
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === msg.playerId ? { ...p, ready: msg.ready } : p,
            ),
          );
          break;
        case "chat":
          setChatMessages((prev) => [...prev, msg.message]);
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

  /* ── Effect: Keyboard movement handler ── */
  useEffect(() => {
    if (phase !== "playing" || chatFocused) {
      return;
    }

    let lastMoveTime = 0;
    const MOVE_INTERVAL = 80;

    const handleKeyDown = (e: KeyboardEvent) => {
      const dirMap: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = dirMap[e.key];
      if (!direction || !maze || Date.now() < gameStartsAt) {
        return;
      }
      e.preventDefault();

      const now = Date.now();
      if (now - lastMoveTime < MOVE_INTERVAL) {
        return;
      }
      lastMoveTime = now;

      const myPos = positions[myId];
      if (!myPos) {
        return;
      }
      const cell = maze.cells[myPos.y]?.[myPos.x];
      if (cell === undefined) {
        return;
      }
      if (hasWall(cell, direction)) {
        return;
      }

      // Optimistic update
      const newPos = moveInDirection(myPos, direction);
      setPositions((prev) => ({ ...prev, [myId]: newPos }));
      send({ type: "move", direction });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, chatFocused, gameStartsAt, positions, myId, maze, send]);

  /* ── Effect: Timer countdown ── */
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
  const opponentPosition = opponent ? positions[opponent.id] : null;

  return (
    <div className="h-screen flex flex-col bg-[#1a1a2e] text-white overflow-hidden">
      {/* Top bar */}
      <PlayerBar
        roomCode={roomCode}
        difficulty={difficulty}
        timerMinutes={timerMinutes}
        remainingSeconds={remainingSeconds}
        phase={phase}
        players={players}
        ownerId={ownerId}
        myId={myId}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Game area */}
        <div className="flex-1 flex flex-col p-4 min-w-0">
          {/* Player info cards */}
          <div className="flex gap-4 mb-4">
            {players.map((p) => (
              <div
                key={p.id}
                className={`flex-1 px-4 py-2 rounded-lg ${
                  p.id === myId
                    ? "bg-[#0f3460] border-2 border-[#4cc9f0]"
                    : "bg-[#0f3460] border-2 border-[#f72585]"
                }`}
              >
                <div
                  className={`font-bold ${
                    p.id === myId ? "text-[#4cc9f0]" : "text-[#f72585]"
                  }`}
                >
                  {p.id === myId ? "\u{1F535}" : "\u{1F534}"} {p.name}{" "}
                  {p.id === myId ? "(你)" : ""}
                </div>
                <div className="text-xs text-gray-400">
                  {!p.online
                    ? "离线"
                    : phase === "readying"
                      ? p.ready
                        ? "已准备"
                        : "未准备"
                      : "在线"}
                </div>
              </div>
            ))}
            {players.length < 2 && (
              <div className="flex-1 px-4 py-2 rounded-lg bg-[#0f3460] border-2 border-dashed border-gray-600 flex items-center justify-center text-gray-500">
                等待对手加入...
              </div>
            )}
          </div>

          {/* Maze canvas or waiting message */}
          <div className="flex-1 relative bg-[#0a0a23] rounded-lg overflow-hidden">
            {maze && myPosition ? (
              <MazeCanvas
                maze={maze}
                myPosition={myPosition}
                opponentPosition={opponentPosition ?? null}
                myId={myId}
                opponentId={opponent?.id ?? null}
                difficulty={difficulty}
                explored={difficulty === "hard" ? explored : undefined}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500">
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

          {/* Action buttons */}
          <div className="mt-4 flex gap-4 justify-center items-center flex-wrap">
            {phase === "readying" && isOwner && (
              <>
                {/* Difficulty selector */}
                <select
                  value={difficulty}
                  onChange={(e) =>
                    send({
                      type: "setDifficulty",
                      difficulty: e.target.value as Difficulty,
                    })
                  }
                  className="px-3 py-2 rounded-lg bg-[#16213e] border border-gray-600 text-white"
                >
                  <option value="easy">简单</option>
                  <option value="medium">中等</option>
                  <option value="hard">困难</option>
                </select>

                {/* Timer selector */}
                <select
                  value={timerMinutes ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    send({
                      type: "setTimer",
                      minutes: v ? (Number(v) as 3 | 5 | 10) : null,
                    });
                  }}
                  className="px-3 py-2 rounded-lg bg-[#16213e] border border-gray-600 text-white"
                >
                  <option value="">无限时</option>
                  <option value="3">3 分钟</option>
                  <option value="5">5 分钟</option>
                  <option value="10">10 分钟</option>
                </select>

                {/* Start button */}
                <button
                  onClick={() => send({ type: "startGame" })}
                  disabled={!opponent?.ready}
                  className="px-6 py-2 rounded-lg bg-[#4cc9f0] text-black font-bold hover:bg-[#3ab8df] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  开始游戏
                </button>
              </>
            )}
            {phase === "readying" && !isOwner && (
              <button
                onClick={() => send({ type: "ready" })}
                className={`px-6 py-2 rounded-lg font-bold transition ${
                  players.find((p) => p.id === myId)?.ready
                    ? "bg-green-600 text-white"
                    : "bg-[#4cc9f0] text-black hover:bg-[#3ab8df]"
                }`}
              >
                {players.find((p) => p.id === myId)?.ready
                  ? "已准备 \u2713"
                  : "准备"}
              </button>
            )}
            {phase === "waiting" && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/${roomCode}`,
                  );
                }}
                className="px-6 py-2 rounded-lg bg-[#16213e] border border-[#4cc9f0] text-[#4cc9f0] hover:bg-[#4cc9f0] hover:text-black transition"
              >
                复制邀请链接
              </button>
            )}
            {/* Leave button (always available) */}
            <button
              onClick={() => {
                leave();
                onLeave();
              }}
              className="px-4 py-2 rounded-lg bg-red-900/50 text-red-300 hover:bg-red-800 transition"
            >
              离开房间
            </button>
          </div>
        </div>

        {/* Right: Chat panel */}
        <ChatPanel
          messages={chatMessages}
          onSend={(text) => send({ type: "chat", text })}
          onFocus={() => setChatFocused(true)}
          onBlur={() => setChatFocused(false)}
        />
      </div>

      {/* Game result modal */}
      {phase === "ended" && winnerId !== undefined && (
        <GameResultModal
          winnerId={winnerId}
          winnerName={winnerName}
          myId={myId}
          reason={gameEndReason}
          isOwner={isOwner}
          onPlayAgain={() => send({ type: "playAgain" })}
          onLeave={() => {
            leave();
            onLeave();
          }}
        />
      )}
      <Confetti show={showConfetti} />
    </div>
  );
}
