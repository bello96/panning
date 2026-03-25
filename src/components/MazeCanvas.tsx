import { useRef, useEffect, useState } from "react";
import { type MazeData, type Position, type Difficulty, WALL_TOP, WALL_RIGHT, WALL_BOTTOM, WALL_LEFT } from "../types/protocol";
import { getVisibleCells } from "../utils/maze";

interface MazeCanvasProps {
  maze: MazeData;
  myPosition: Position;
  opponentPosition: Position | null;
  myId: string;
  opponentId: string | null;
  difficulty: Difficulty;
  explored?: Record<string, boolean[][]>;
}

export default function MazeCanvas({
  maze,
  myPosition,
  opponentPosition,
  myId,
  opponentId: _opponentId,
  difficulty,
  explored,
}: MazeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState(400);
  const animRef = useRef<number>(0);

  // ResizeObserver — keep canvas square and fill container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize(Math.min(width, height));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Animation + rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    ctx.scale(dpr, dpr);

    const cellSize = canvasSize / maze.size;

    function drawPlayer(pos: Position, color: string, label: string) {
      const px = pos.x * cellSize + cellSize / 2;
      const py = pos.y * cellSize + cellSize / 2;
      const r = cellSize * 0.35;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${cellSize * 0.35}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px, py);
    }

    const render = (time: number) => {
      const animationTime = time / 1000;

      // 1. Clear canvas
      ctx.fillStyle = "#0a0a23";
      ctx.fillRect(0, 0, canvasSize, canvasSize);

      // 2. Draw path cells
      ctx.fillStyle = "#111";
      for (let y = 0; y < maze.size; y++) {
        for (let x = 0; x < maze.size; x++) {
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }

      // 3. Draw walls
      ctx.strokeStyle = "#3a506b";
      ctx.lineWidth =
        difficulty === "easy" ? 3 : difficulty === "medium" ? 2 : 1.5;

      for (let y = 0; y < maze.size; y++) {
        for (let x = 0; x < maze.size; x++) {
          const cell = maze.cells[y][x];
          const cx = x * cellSize;
          const cy = y * cellSize;

          ctx.beginPath();
          if (cell & WALL_TOP) {
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + cellSize, cy);
          }
          if (cell & WALL_RIGHT) {
            ctx.moveTo(cx + cellSize, cy);
            ctx.lineTo(cx + cellSize, cy + cellSize);
          }
          if (cell & WALL_BOTTOM) {
            ctx.moveTo(cx, cy + cellSize);
            ctx.lineTo(cx + cellSize, cy + cellSize);
          }
          if (cell & WALL_LEFT) {
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx, cy + cellSize);
          }
          ctx.stroke();
        }
      }

      // 4. Draw entrance markers
      ctx.fillStyle = "rgba(76, 201, 240, 0.15)";
      for (const entrance of maze.entrances) {
        ctx.fillRect(
          entrance.x * cellSize,
          entrance.y * cellSize,
          cellSize,
          cellSize
        );
      }

      // 5. Draw gold — pulsing golden circle
      const goldX = maze.gold.x * cellSize + cellSize / 2;
      const goldY = maze.gold.y * cellSize + cellSize / 2;
      const pulse = 0.8 + 0.2 * Math.sin(animationTime * 3);
      const goldRadius = cellSize * 0.3 * pulse;

      ctx.shadowColor = "#ffd700";
      ctx.shadowBlur = cellSize * 0.4;
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.arc(goldX, goldY, goldRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // 6. Draw players
      drawPlayer(myPosition, "#4cc9f0", "A");
      if (opponentPosition) {
        drawPlayer(opponentPosition, "#f72585", "B");
      }

      // 7. Draw fog overlay (hard mode only)
      if (difficulty === "hard" && explored) {
        ctx.save();

        // Semi-transparent black over entire canvas
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
        ctx.fillRect(0, 0, canvasSize, canvasSize);

        // Cut out explored/visible areas
        ctx.globalCompositeOperation = "destination-out";

        const myExplored = explored[myId];
        if (myExplored) {
          for (let y = 0; y < maze.size; y++) {
            for (let x = 0; x < maze.size; x++) {
              if (myExplored[y]?.[x]) {
                // Previously explored: partially visible
                ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
                ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
              }
            }
          }
        }

        // Current visible area: fully clear
        const visible = getVisibleCells(
          myPosition.x,
          myPosition.y,
          maze.size,
          3
        );
        ctx.fillStyle = "rgba(0, 0, 0, 1.0)";
        for (const key of visible) {
          const [vx, vy] = key.split(",").map(Number);
          ctx.fillRect(vx * cellSize, vy * cellSize, cellSize, cellSize);
        }

        ctx.restore();
      }

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [canvasSize, maze, myPosition, opponentPosition, difficulty, explored, myId]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center">
      <canvas
        ref={canvasRef}
        style={{ width: canvasSize, height: canvasSize }}
        className="rounded-lg"
      />
    </div>
  );
}
