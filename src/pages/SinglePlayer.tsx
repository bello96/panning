import { useState, useEffect, useRef, useCallback } from "react";
import { hasWall, shortestPath } from "../utils/maze";
import { generateMaze } from "../utils/maze";
import MazeCanvas, { type PlayerRender } from "../components/MazeCanvas";
import { SFX } from "../hooks/useSound";
import type { Difficulty, Direction, MazeData, Position } from "../types/protocol";

interface SinglePlayerProps {
  difficulty: Difficulty;
  onLeave: () => void;
}

const DIFF_LABELS: Record<Difficulty, string> = { easy: "简单", medium: "中等", hard: "困难" };

export default function SinglePlayer({ difficulty: initDifficulty, onLeave }: SinglePlayerProps) {
  const [currentDifficulty, setCurrentDifficulty] = useState<Difficulty>(initDifficulty);
  const [maze, setMaze] = useState<MazeData>(() => generateMaze(initDifficulty, true));
  const [position, setPosition] = useState<Position>(() => maze.entrances[0]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [gameStartsAt, setGameStartsAt] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);
  const [finalTime, setFinalTime] = useState(0);
  const [showResult, setShowResult] = useState(false);
  // 通关后待选难度（未点开始前可切换）
  const [nextDifficulty, setNextDifficulty] = useState<Difficulty>(initDifficulty);

  const positionRef = useRef(position);
  positionRef.current = position;
  const mazeRef = useRef(maze);
  mazeRef.current = maze;
  const gameStartsAtRef = useRef(gameStartsAt);
  gameStartsAtRef.current = gameStartsAt;
  const finishedRef = useRef(finished);
  finishedRef.current = finished;

  const startNewGame = useCallback((diff: Difficulty) => {
    const newMaze = generateMaze(diff, true);
    setCurrentDifficulty(diff);
    setMaze(newMaze);
    setPosition(newMaze.entrances[0]);
    setElapsedSeconds(0);
    setStepCount(0);
    setGameStartsAt(Date.now());
    setFinished(false);
    setFinalTime(0);
    setShowResult(false);
    setNextDifficulty(diff);
  }, []);

  /* ── 键盘移动 ── */
  useEffect(() => {
    let lastMoveTime = 0;
    const MOVE_INTERVAL = 100;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (finishedRef.current) {
        return;
      }
      const dirMap: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = dirMap[e.key];
      if (!direction) {
        return;
      }
      e.preventDefault();

      const now = Date.now();
      if (now - lastMoveTime < MOVE_INTERVAL) {
        return;
      }
      lastMoveTime = now;

      const myPos = positionRef.current;
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

      SFX.move.play();
      const newPos = { x: nx, y: ny };
      setPosition(newPos);
      setStepCount((prev) => prev + 1);

      // 检查是否找到金子
      if (nx === m.gold.x && ny === m.gold.y) {
        SFX.gold.play();
        setTimeout(() => SFX.win.play(), 300);
        setFinished(true);
        setFinalTime(Math.floor((Date.now() - gameStartsAtRef.current) / 1000));
        setShowResult(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /* ── 计时器 ── */
  useEffect(() => {
    if (finished) {
      return;
    }
    const interval = setInterval(() => {
      const now = Date.now();
      if (now >= gameStartsAt) {
        setElapsedSeconds(Math.floor((now - gameStartsAt) / 1000));
      }
    }, 500);
    return () => clearInterval(interval);
  }, [gameStartsAt, finished]);

  const playerRenders: PlayerRender[] = [
    {
      id: "me",
      position,
      color: "#6366f1",
      label: "我",
    },
  ];

  return (
    <div className="h-screen flex flex-col bg-[#eff2ff] overflow-hidden">
      {/* Top bar */}
      <div className="bg-white shadow-sm border-b border-gray-100 px-4 py-2 flex items-center">
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-gray-700">
            🧭 单人探索
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-600 font-medium">
            {DIFF_LABELS[currentDifficulty]}
          </span>
        </div>
        <div className="flex-1" />
        <button
          onClick={onLeave}
          className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition font-medium"
        >
          返回首页
        </button>
      </div>

      <div className="flex-1 flex flex-col p-4 overflow-hidden">
        {/* 信息栏 */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white shadow-sm text-sm border border-indigo-400">
            <span className="font-bold text-indigo-600">探索者</span>
          </div>

          <div className="flex-1" />

          {/* 游戏中：显示用时和步数 */}
          {!finished && (
            <>
              <span className="text-sm text-gray-500">
                <span className="text-gray-400">用时:</span>
                <span className="font-mono">
                  {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}
                </span>
              </span>
              <span className="text-sm text-gray-500">
                <span className="text-gray-400">步数:</span>
                <span className="font-mono">{stepCount}</span>
              </span>
            </>
          )}

          {/* 通关后：显示难度选择和开始按钮 */}
          {finished && (
            <>
              {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setNextDifficulty(d)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    nextDifficulty === d
                      ? "bg-indigo-100 text-indigo-700 border border-indigo-300"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200"
                  }`}
                >
                  {DIFF_LABELS[d]}
                </button>
              ))}
              <button
                onClick={() => startNewGame(nextDifficulty)}
                className="px-4 py-1 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition"
              >
                开始
              </button>
            </>
          )}
        </div>

        {/* 迷宫 */}
        <div className="flex-1 relative bg-white rounded-lg shadow-sm overflow-hidden p-2">
          <MazeCanvas
            maze={maze}
            players={playerRenders}
            difficulty={currentDifficulty}
          />
        </div>
      </div>

      {/* 结算弹框 */}
      {showResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-xs shadow-xl text-center">
            <div className="text-5xl mb-3">🎉</div>
            <div className="text-3xl font-black text-green-500 mb-2">恭喜通关!</div>
            <div className="text-gray-500 mb-1">难度：{DIFF_LABELS[currentDifficulty]}</div>
            <div className="text-gray-400 text-sm mb-1">
              用时 {String(Math.floor(finalTime / 60)).padStart(2, "0")}:{String(finalTime % 60).padStart(2, "0")}
            </div>
            <div className="text-gray-400 text-sm mb-5">
              步数 {stepCount}
              {(() => {
                const optimal = shortestPath(maze, maze.entrances[0], maze.gold);
                if (optimal > 0) {
                  return (
                    <span style={{ color: stepCount <= optimal ? "#10b981" : "#f59e0b", marginLeft: "8px" }}>
                      (最优 {optimal} 步{stepCount <= optimal ? " 🎯" : ""})
                    </span>
                  );
                }
                return null;
              })()}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowResult(false)}
                className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition"
              >
                再来一局
              </button>
              <button
                onClick={onLeave}
                className="w-full py-2.5 rounded-lg bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
