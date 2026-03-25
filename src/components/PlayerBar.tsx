import { useState } from "react";
import type { GamePhase, Difficulty, PlayerInfo } from "../types/protocol";

interface PlayerBarProps {
  roomCode: string;
  difficulty: Difficulty;
  timerMinutes: 3 | 5 | 10 | null;
  remainingSeconds: number | null;
  phase: GamePhase;
  players: PlayerInfo[];
  ownerId: string;
  myId: string;
  onLeave: () => void;
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

function difficultyBadgeClass(d: Difficulty): string {
  if (d === "easy") { return "bg-green-100 text-green-700 border border-green-300"; }
  if (d === "medium") { return "bg-amber-100 text-amber-700 border border-amber-300"; }
  return "bg-red-100 text-red-700 border border-red-300";
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
  onLeave,
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
    <div className="bg-white shadow-sm border-b border-gray-100 px-4 py-2 flex items-center justify-between">
      {/* 左侧：房间号 + 分享按钮 + 难度 badge + 倒计时 */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono font-bold text-gray-700">
          房间 <span className="text-indigo-600">{roomCode}</span>
        </span>
        <button
          onClick={handleCopy}
          className={`text-xs px-2 py-1 rounded border transition ${
            copied
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50"
          }`}
        >
          {copied ? "已复制!" : "分享链接"}
        </button>

        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${difficultyBadgeClass(difficulty)}`}>
          {difficultyLabel(difficulty)}
        </span>

        {timerMinutes !== null && (
          <span
            className={`font-mono text-lg font-bold ${
              showTimer && isLowTime ? "text-red-500" : "text-indigo-600"
            }`}
            style={{
              animation: showTimer && isLowTime ? "pulse 0.8s ease-in-out infinite" : "none",
            }}
          >
            {showTimer ? formatTime(remainingSeconds!) : `${timerMinutes}:00`}
          </span>
        )}

        {timerMinutes === null && (
          <span className="text-xs text-gray-400">无时限</span>
        )}
      </div>

      {/* 中间：玩家列表 */}
      <div className="flex items-center gap-4">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5">
            {/* 在线状态小圆点 */}
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                p.online ? "bg-green-500" : "bg-gray-300"
              }`}
            />
            <span
              className={`text-sm font-medium max-w-[80px] truncate ${
                p.id === myId
                  ? "text-indigo-600"
                  : "text-gray-700"
              }`}
            >
              {p.name}
            </span>
            {p.id === ownerId && (
              <span className="text-xs bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded-full font-medium">
                房主
              </span>
            )}
            {phase === "readying" && (
              <span
                className={`text-xs ${p.ready ? "text-green-600" : "text-gray-400"}`}
              >
                {p.ready ? "✓" : "…"}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 右侧：离开按钮 */}
      <div>
        <button
          onClick={onLeave}
          className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition font-medium"
        >
          离开
        </button>
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
