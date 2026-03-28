import { useState } from "react";
import type { GamePhase, PlayerInfo } from "../types/protocol";

interface PlayerBarProps {
  roomCode: string;
  phase: GamePhase;
  players: PlayerInfo[];
  ownerId: string;
  myId: string;
  onLeave: () => void;
  onTransferOwner?: () => void;
}

export default function PlayerBar({
  roomCode,
  phase,
  players,
  ownerId,
  myId,
  onLeave,
  onTransferOwner,
}: PlayerBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const shareLink = `${window.location.origin}/${roomCode}`;
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-white shadow-sm border-b border-gray-100 px-4 py-2 flex items-center">
      {/* 左侧：房间号 + 分享（1份宽度） */}
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <span className="text-sm font-mono font-bold text-gray-700">
          房间 <span className="text-indigo-600">{roomCode}</span>
        </span>
        {players.length < 2 && (
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
        )}
      </div>

      {/* 中间：玩家列表（2份宽度） */}
      <div className="flex-[2] flex items-center justify-center gap-4 min-w-0">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                p.online ? "bg-green-500" : "bg-gray-300"
              }`}
            />
            <span
              className={`text-sm font-medium max-w-[80px] truncate ${
                p.id === myId ? "text-indigo-600" : "text-gray-700"
              }`}
            >
              {p.name}
            </span>
            {p.id === ownerId && (
              <span className="text-xs bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded-full font-medium">
                房主
              </span>
            )}
            {phase === "readying" && p.id !== ownerId && (
              <span
                className={`text-xs ${p.ready ? "text-green-600" : "text-gray-400"}`}
              >
                {p.ready ? "\u2713" : "\u2026"}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 右侧：转让房主 + 离开按钮（1份宽度） */}
      <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
        {myId === ownerId && players.length === 2 && phase !== "playing" && onTransferOwner && (
          <button
            onClick={onTransferOwner}
            className="text-sm px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition font-medium"
          >
            转让房主
          </button>
        )}
        <button
          onClick={onLeave}
          className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition font-medium"
        >
          离开
        </button>
      </div>
    </div>
  );
}
