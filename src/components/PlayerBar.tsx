import { useState } from "react";
import type { GamePhase, Difficulty } from "../types/protocol";

interface PlayerBarProps {
  roomCode: string;
  difficulty: Difficulty;
  timerMinutes: 3 | 5 | 10 | null;
  remainingSeconds: number | null;
  phase: GamePhase;
  players: { id: string; name: string; online: boolean; ready: boolean }[];
  ownerId: string;
  myId: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function difficultyLabel(d: Difficulty): string {
  if (d === "easy") { return "简单"; }
  if (d === "medium") { return "中等"; }
  return "困难";
}

function difficultyColor(d: Difficulty): string {
  if (d === "easy") { return "#4ade80"; }
  if (d === "medium") { return "#fbbf24"; }
  return "#f87171";
}

export default function PlayerBar({
  roomCode,
  difficulty,
  timerMinutes,
  remainingSeconds,
  phase,
  players,
  ownerId,
  myId,
}: PlayerBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const shareLink = `${window.location.origin}/${roomCode}`;
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isLowTime = remainingSeconds !== null && remainingSeconds < 30;
  const showTimer = phase === "playing" && remainingSeconds !== null;

  return (
    <div
      style={{ backgroundColor: "#1a1a2e", borderBottom: "1px solid #16213e" }}
      className="flex items-center justify-between px-4 py-2 text-white"
    >
      {/* 左侧：房间码 + 复制按钮 */}
      <div className="flex items-center gap-2">
        <span style={{ color: "#4cc9f0" }} className="text-sm font-mono font-bold">
          {roomCode}
        </span>
        <button
          onClick={handleCopy}
          style={{
            backgroundColor: copied ? "#4cc9f0" : "#16213e",
            color: copied ? "#1a1a2e" : "#4cc9f0",
            border: "1px solid #4cc9f0",
            borderRadius: "4px",
            padding: "2px 8px",
            fontSize: "12px",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          {copied ? "已复制!" : "复制链接"}
        </button>
      </div>

      {/* 中间：难度徽章 + 计时器 */}
      <div className="flex items-center gap-3">
        <span
          style={{
            backgroundColor: difficultyColor(difficulty) + "22",
            color: difficultyColor(difficulty),
            border: `1px solid ${difficultyColor(difficulty)}`,
            borderRadius: "12px",
            padding: "2px 10px",
            fontSize: "13px",
            fontWeight: "bold",
          }}
        >
          {difficultyLabel(difficulty)}
        </span>

        {timerMinutes !== null && (
          <span
            style={{
              color: showTimer && isLowTime ? "#f72585" : "#ffd700",
              fontFamily: "monospace",
              fontSize: "20px",
              fontWeight: "bold",
              animation: showTimer && isLowTime ? "pulse 0.8s ease-in-out infinite" : "none",
            }}
          >
            {showTimer
              ? formatTime(remainingSeconds!)
              : `${timerMinutes}:00`}
          </span>
        )}

        {timerMinutes === null && (
          <span style={{ color: "#888", fontSize: "13px" }}>无时限</span>
        )}
      </div>

      {/* 右侧：玩家连线状态 */}
      <div className="flex items-center gap-2">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-1" title={p.name}>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: p.online ? "#4ade80" : "#6b7280",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: "13px",
                color: p.id === myId ? "#4cc9f0" : p.id === ownerId ? "#ffd700" : "#d1d5db",
                fontWeight: p.id === myId || p.id === ownerId ? "bold" : "normal",
                maxWidth: "80px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
              {p.id === ownerId && " 👑"}
            </span>
            {phase === "readying" && (
              <span
                style={{
                  fontSize: "11px",
                  color: p.ready ? "#4ade80" : "#9ca3af",
                }}
              >
                {p.ready ? "✓" : "…"}
              </span>
            )}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
