import { useRef, useEffect, useState } from "react";
import { type MazeData, type Position, type Difficulty, WALL_TOP, WALL_RIGHT, WALL_BOTTOM, WALL_LEFT } from "../types/protocol";

export interface PlayerRender {
  id: string;
  position: Position;
  color: string;
  label: string; // 用户名首字符
}

interface MazeCanvasProps {
  maze: MazeData;
  players: PlayerRender[];
  difficulty: Difficulty;
}

const LERP_MS = 120;

interface LerpState {
  fromX: number; fromY: number;
  toX: number; toY: number;
  start: number;
}

function lerpPos(s: LerpState, now: number) {
  if (s.start === 0) {
    return { x: s.toX, y: s.toY };
  }
  const t = Math.min((now - s.start) / LERP_MS, 1);
  const e = 1 - (1 - t) * (1 - t);
  return {
    x: s.fromX + (s.toX - s.fromX) * e,
    y: s.fromY + (s.toY - s.fromY) * e,
  };
}

export default function MazeCanvas({
  maze,
  players: playerRenders,
  difficulty,
}: MazeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState(400);
  const animRef = useRef<number>(0);

  // Load gold image
  const goldImgRef = useRef<HTMLImageElement | null>(null);
  if (!goldImgRef.current) {
    const img = new Image();
    img.src = new URL("../imgs/bullion.png", import.meta.url).href;
    goldImgRef.current = img;
  }

  // Per-player lerp states
  const lerpsRef = useRef<Map<string, LerpState>>(new Map());
  const prevPositions = useRef<Map<string, Position>>(new Map());

  // Update lerps when player positions change
  for (const pr of playerRenders) {
    const prev = prevPositions.current.get(pr.id);
    if (!prev || prev.x !== pr.position.x || prev.y !== pr.position.y) {
      const now = performance.now();
      const existing = lerpsRef.current.get(pr.id);
      if (existing) {
        const cur = lerpPos(existing, now);
        lerpsRef.current.set(pr.id, {
          fromX: cur.x, fromY: cur.y,
          toX: pr.position.x, toY: pr.position.y,
          start: now,
        });
      } else {
        lerpsRef.current.set(pr.id, {
          fromX: pr.position.x, fromY: pr.position.y,
          toX: pr.position.x, toY: pr.position.y,
          start: 0,
        });
      }
      prevPositions.current.set(pr.id, pr.position);
    }
  }

  // Refs for render loop
  const mazeRef = useRef(maze); mazeRef.current = maze;
  const diffRef = useRef(difficulty); diffRef.current = difficulty;
  const playersRef = useRef(playerRenders); playersRef.current = playerRenders;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) { return; }
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize(Math.min(width, height));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) { return; }
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    ctx.scale(dpr, dpr);

    function drawPlayer(x: number, y: number, color: string, label: string) {
      const cs = canvasSize / mazeRef.current.size;
      const px = x * cs + cs / 2;
      const py = y * cs + cs / 2;
      const r = cs * 0.35;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${cs * 0.4}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px, py);
    }

    const render = (time: number) => {
      const m = mazeRef.current;
      const diff = diffRef.current;

      const prs = playersRef.current;
      const cs = canvasSize / m.size;

      // 1. Background
      ctx.fillStyle = "#f0f2f8";
      ctx.fillRect(0, 0, canvasSize, canvasSize);

      // 2. Path cells
      ctx.fillStyle = "#ffffff";
      for (let y = 0; y < m.size; y++) {
        for (let x = 0; x < m.size; x++) {
          ctx.fillRect(x * cs, y * cs, cs, cs);
        }
      }

      // 3. Walls — 每面墙只画一次，避免重叠导致粗细不一
      ctx.strokeStyle = "#8b95a8";
      ctx.lineWidth = diff === "easy" ? 3 : diff === "medium" ? 2 : 1.5;
      ctx.beginPath();
      for (let y = 0; y < m.size; y++) {
        for (let x = 0; x < m.size; x++) {
          const cell = m.cells[y][x];
          const cx = x * cs, cy = y * cs;
          // 每个格子只画 TOP 和 LEFT，避免与相邻格子重复
          if (cell & WALL_TOP) { ctx.moveTo(cx, cy); ctx.lineTo(cx + cs, cy); }
          if (cell & WALL_LEFT) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + cs); }
          // 最后一列补 RIGHT
          if (x === m.size - 1 && (cell & WALL_RIGHT)) { ctx.moveTo(cx + cs, cy); ctx.lineTo(cx + cs, cy + cs); }
          // 最后一行补 BOTTOM
          if (y === m.size - 1 && (cell & WALL_BOTTOM)) { ctx.moveTo(cx, cy + cs); ctx.lineTo(cx + cs, cy + cs); }
        }
      }
      ctx.stroke();

      // 3.5 Outer border — thick wall around maze, with entrance gaps
      const borderW = diff === "easy" ? 5 : diff === "medium" ? 4 : 3;
      ctx.strokeStyle = "#4b5563";
      ctx.lineWidth = borderW;
      const totalSize = m.size * cs;
      const [ent0, ent1] = m.entrances;

      // Helper: draw border edge, skipping entrance cell
      function drawBorderEdge(
        x1: number, y1: number, x2: number, y2: number,
        isHorizontal: boolean, entrances: Position[],
      ) {
        // Collect entrance gaps on this edge
        const gaps: { start: number; end: number }[] = [];
        for (const ent of entrances) {
          if (isHorizontal && ((y1 === 0 && ent.y === 0) || (y1 === totalSize && ent.y === m.size - 1))) {
            gaps.push({ start: ent.x * cs, end: (ent.x + 1) * cs });
          }
          if (!isHorizontal && ((x1 === 0 && ent.x === 0) || (x1 === totalSize && ent.x === m.size - 1))) {
            gaps.push({ start: ent.y * cs, end: (ent.y + 1) * cs });
          }
        }

        if (gaps.length === 0) {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          return;
        }

        // Sort gaps and draw segments between them
        gaps.sort((a, b) => a.start - b.start);
        const coord = isHorizontal ? y1 : x1;
        let pos = isHorizontal ? x1 : y1;
        const end = isHorizontal ? x2 : y2;

        for (const gap of gaps) {
          if (pos < gap.start) {
            ctx.beginPath();
            if (isHorizontal) { ctx.moveTo(pos, coord); ctx.lineTo(gap.start, coord); }
            else { ctx.moveTo(coord, pos); ctx.lineTo(coord, gap.start); }
            ctx.stroke();
          }
          pos = gap.end;
        }
        if (pos < end) {
          ctx.beginPath();
          if (isHorizontal) { ctx.moveTo(pos, coord); ctx.lineTo(end, coord); }
          else { ctx.moveTo(coord, pos); ctx.lineTo(coord, end); }
          ctx.stroke();
        }
      }

      const ents = [ent0, ent1];
      drawBorderEdge(0, 0, totalSize, 0, true, ents);           // top
      drawBorderEdge(0, totalSize, totalSize, totalSize, true, ents); // bottom
      drawBorderEdge(0, 0, 0, totalSize, false, ents);           // left
      drawBorderEdge(totalSize, 0, totalSize, totalSize, false, ents); // right

      // 4. Entrance markers
      ctx.fillStyle = "rgba(99, 102, 241, 0.15)";
      for (const e of m.entrances) {
        ctx.fillRect(e.x * cs, e.y * cs, cs, cs);
      }

      // 5. Gold — bullion image with pulse
      const goldImg = goldImgRef.current;
      const pulse = 0.85 + 0.15 * Math.sin(time / 1000 * 3);
      const goldSize = cs * 0.8 * pulse;
      const gx = m.gold.x * cs + (cs - goldSize) / 2;
      const gy = m.gold.y * cs + (cs - goldSize) / 2;
      if (goldImg && goldImg.complete && goldImg.naturalWidth > 0) {
        ctx.drawImage(goldImg, gx, gy, goldSize, goldSize);
      } else {
        // Fallback circle if image not loaded
        ctx.fillStyle = "#ffd700";
        ctx.beginPath();
        ctx.arc(m.gold.x * cs + cs / 2, m.gold.y * cs + cs / 2, cs * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 6. Players — smooth lerp, consistent colors for both sides
      const now = performance.now();
      for (const pr of prs) {
        const ls = lerpsRef.current.get(pr.id);
        if (ls) {
          const p = lerpPos(ls, now);
          drawPlayer(p.x, p.y, pr.color, pr.label);
        } else {
          drawPlayer(pr.position.x, pr.position.y, pr.color, pr.label);
        }
      }



      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [canvasSize]);

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
