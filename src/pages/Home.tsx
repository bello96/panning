import { useState } from "react";
import { getHttpBase } from "../api";
import type { Difficulty } from "../types/protocol";

type GameMode = "single" | "multi";

interface HomeProps {
  onEnterRoom: (code: string, name: string) => void;
  onSinglePlayer: (nickname: string, difficulty: Difficulty) => void;
  onCreateMultiplayer: (nickname: string, difficulty: Difficulty) => void;
  urlError: string;
  createLoading: boolean;
}

export default function Home({ onEnterRoom, onSinglePlayer, onCreateMultiplayer, urlError, createLoading }: HomeProps) {
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
  const [mode, setMode] = useState<GameMode>("single");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tip, setTip] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false);

  function clearTip() {
    setTip("");
  }

  function checkNickname(): boolean {
    setTip("");
    setError("");
    if (!nickname.trim()) {
      setTip("请输入昵称");
      return false;
    }
    return true;
  }

  function handleStart() {
    setTip("");
    setError("");
    if (mode === "single") {
      onSinglePlayer("", difficulty);
    } else {
      if (!checkNickname()) {
        return;
      }
      onCreateMultiplayer(nickname.trim(), difficulty);
    }
  }

  async function joinRoom() {
    if (!checkNickname()) {
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

  const isLoading = loading || createLoading;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#eff2ff]">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="text-4xl">🧭</span>
          <h1 className="text-4xl font-bold text-indigo-600">迷径寻宝</h1>
        </div>
        <p className="text-gray-500 text-center mb-6">迷宫探索，寻找宝藏</p>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm border border-red-200">
            {error}
          </div>
        )}
        {urlError && !error && (
          <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm border border-red-200">
            {urlError}
          </div>
        )}
        {tip && <div className="text-amber-600 text-sm mb-4">{tip}</div>}

        {/* 模式选择 */}
        <label className="block text-sm font-medium text-gray-700 mb-1">模式</label>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setMode("single"); setShowJoinInput(false); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition ${
              mode === "single"
                ? "bg-indigo-100 text-indigo-700 border border-indigo-300"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200"
            }`}
          >
            🧭 单人探索
          </button>
          <button
            onClick={() => setMode("multi")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition ${
              mode === "multi"
                ? "bg-pink-100 text-pink-700 border border-pink-300"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200"
            }`}
          >
            ⚔️ 双人在线
          </button>
        </div>

        {/* 难度选择 */}
        <label className="block text-sm font-medium text-gray-700 mb-1">难度</label>
        <div className="flex gap-2 mb-8">
          {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                difficulty === d
                  ? "bg-indigo-100 text-indigo-700 border border-indigo-300"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200"
              }`}
            >
              {d === "easy" ? "简单" : d === "medium" ? "中等" : "困难"}
            </button>
          ))}
        </div>

        {/* 昵称 — 仅双人模式显示 */}
        {mode === "multi" && (
          <>
            <label className="block text-sm font-medium text-gray-700 mb-1">昵称</label>
            <input
              className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none transition mb-8 text-gray-800 placeholder-gray-400"
              placeholder="输入你的昵称"
              maxLength={12}
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                clearTip();
              }}
            />
          </>
        )}

        {/* 单人：开始探索 */}
        {mode === "single" && (
          <button
            className="w-full py-3 px-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition"
            onClick={handleStart}
          >
            开始探索
          </button>
        )}

        {/* 双人：默认视图 — 创建房间 + 加入房间 */}
        {mode === "multi" && !showJoinInput && (
          <>
            <button
              className="w-full py-3 px-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition mb-3 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleStart}
              disabled={isLoading}
            >
              {createLoading ? "创建中..." : "创建房间"}
            </button>
            <button
              className="w-full py-3 px-4 bg-white text-indigo-600 font-semibold rounded-lg border-2 border-indigo-600 hover:bg-indigo-50 transition"
              onClick={() => setShowJoinInput(true)}
            >
              加入房间
            </button>
          </>
        )}

        {/* 双人：加入房间视图 — 房间号输入 + 加入按钮 + 返回 */}
        {mode === "multi" && showJoinInput && (
          <>
            <input
              className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none transition text-center text-2xl tracking-[0.5em] mb-3 text-gray-800 placeholder-gray-400"
              placeholder="输入6位房间号"
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
              autoFocus
            />
            <button
              className="w-full py-3 px-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition mb-3 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={joinRoom}
              disabled={isLoading}
            >
              {loading ? "加入中..." : "加入房间"}
            </button>
            <button
              className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition"
              onClick={() => { setShowJoinInput(false); setJoinCode(""); }}
            >
              返回
            </button>
          </>
        )}
      </div>
    </div>
  );
}
