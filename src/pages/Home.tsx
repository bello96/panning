import { useState } from "react";
import { getHttpBase } from "../api";

interface HomeProps {
  onEnterRoom: (code: string, name: string) => void;
  urlError: string;
}

export default function Home({ onEnterRoom, urlError }: HomeProps) {
  const [nickname, setNickname] = useState(() => {
    try {
      const raw = sessionStorage.getItem("maze_session");
      if (raw) {
        return (JSON.parse(raw) as { nickname?: string }).nickname || "";
      }
    } catch {
      /* ignore */
    }
    return "";
  });
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tip, setTip] = useState("");

  function clearTip() {
    setTip("");
  }

  async function createRoom() {
    setTip("");
    setError("");
    if (!nickname.trim()) {
      setTip("请输入昵称");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${getHttpBase()}/api/rooms`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error("创建房间失败");
      }
      const data = (await res.json()) as { roomCode: string };
      onEnterRoom(data.roomCode, nickname.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    setTip("");
    setError("");
    if (!nickname.trim()) {
      setTip("请输入昵称");
      return;
    }
    if (!joinCode) {
      setTip("请输入房间号");
      return;
    }
    if (joinCode.length !== 6) {
      setTip("房间号为6位数字");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${getHttpBase()}/api/rooms/${joinCode}`);
      if (!res.ok) {
        throw new Error("房间不存在");
      }
      const info = (await res.json()) as {
        roomCode: string;
        playerCount: number;
        closed: boolean;
      };
      if (info.closed || !info.roomCode) {
        throw new Error("房间不存在或已关闭");
      }
      if (info.playerCount >= 2) {
        throw new Error("房间已满，无法加入");
      }
      onEnterRoom(joinCode, nickname.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#1a1a2e]">
      <div className="bg-[#16213e] rounded-2xl shadow-xl p-8 w-full max-w-md border border-[#4cc9f0]/10">
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="text-4xl">🏆</span>
          <h1 className="text-4xl font-bold text-[#4cc9f0]">迷宫淘金</h1>
        </div>
        <p className="text-gray-400 text-center mb-8">双人在线对战，迷宫寻宝，限时比拼</p>

        {error && (
          <div className="bg-red-900/40 text-red-400 px-4 py-2 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}
        {urlError && !error && (
          <div className="bg-red-900/40 text-red-400 px-4 py-2 rounded-lg mb-4 text-sm">
            {urlError}
          </div>
        )}
        {tip && <div className="text-yellow-400 text-sm mb-4">{tip}</div>}

        <label className="block text-sm font-medium text-gray-300 mb-1">昵称</label>
        <input
          className="w-full px-4 py-3 bg-[#0a0a23] border border-[#4cc9f0]/30 rounded-lg focus:ring-2 focus:ring-[#4cc9f0] focus:border-transparent outline-none transition mb-6 text-white placeholder-gray-500"
          placeholder="输入你的昵称"
          maxLength={12}
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
            clearTip();
          }}
        />

        <button
          className="w-full py-3 px-4 bg-[#4cc9f0] text-[#0a0a23] font-semibold rounded-lg hover:bg-[#4cc9f0]/80 transition mb-6 disabled:opacity-50"
          onClick={createRoom}
          disabled={loading}
        >
          {loading ? "请稍候..." : "创建房间"}
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-[#4cc9f0]/20" />
          <span className="text-sm text-gray-500">或加入房间</span>
          <div className="flex-1 h-px bg-[#4cc9f0]/20" />
        </div>

        <input
          className="w-full px-4 py-3 bg-[#0a0a23] border border-[#4cc9f0]/30 rounded-lg focus:ring-2 focus:ring-[#4cc9f0] focus:border-transparent outline-none transition text-center text-2xl tracking-[0.5em] mb-3 text-white placeholder-gray-500"
          placeholder="房间号"
          maxLength={6}
          value={joinCode}
          onChange={(e) => {
            setJoinCode(e.target.value.replace(/\D/g, ""));
            clearTip();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              joinRoom();
            }
          }}
        />
        <button
          className="w-full py-3 px-4 bg-[#0a0a23] text-[#4cc9f0] font-semibold rounded-lg border-2 border-[#4cc9f0] hover:bg-[#4cc9f0]/10 transition disabled:opacity-50"
          onClick={joinRoom}
          disabled={loading}
        >
          加入房间
        </button>
      </div>
    </div>
  );
}
