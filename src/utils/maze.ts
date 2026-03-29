import { type Cell, type MazeData, type Difficulty, WALL_TOP, WALL_RIGHT, WALL_BOTTOM, WALL_LEFT, type Direction, type Position } from "../types/protocol";

/** Check if movement in direction is blocked by a wall */
export function hasWall(cell: Cell, direction: Direction): boolean {
  switch (direction) {
    case "up": return (cell & WALL_TOP) !== 0;
    case "right": return (cell & WALL_RIGHT) !== 0;
    case "down": return (cell & WALL_BOTTOM) !== 0;
    case "left": return (cell & WALL_LEFT) !== 0;
  }
}

/** Compute new position after moving in a direction (no wall check) */
export function moveInDirection(pos: Position, direction: Direction): Position {
  switch (direction) {
    case "up": return { x: pos.x, y: pos.y - 1 };
    case "down": return { x: pos.x, y: pos.y + 1 };
    case "left": return { x: pos.x - 1, y: pos.y };
    case "right": return { x: pos.x + 1, y: pos.y };
  }
}

const DIFFICULTY_SIZE: Record<Difficulty, number> = { easy: 8, medium: 12, hard: 18 };

/** 递归回溯法生成迷宫 */
export function generateMaze(difficulty: Difficulty, singlePlayer = false): MazeData {
  const size = DIFFICULTY_SIZE[difficulty];
  // 初始化所有墙壁
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => WALL_TOP | WALL_RIGHT | WALL_BOTTOM | WALL_LEFT),
  );

  const visited: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false) as boolean[],
  );

  const dirs: { dx: number; dy: number; wall: number; opposite: number }[] = [
    { dx: 0, dy: -1, wall: WALL_TOP, opposite: WALL_BOTTOM },
    { dx: 1, dy: 0, wall: WALL_RIGHT, opposite: WALL_LEFT },
    { dx: 0, dy: 1, wall: WALL_BOTTOM, opposite: WALL_TOP },
    { dx: -1, dy: 0, wall: WALL_LEFT, opposite: WALL_RIGHT },
  ];

  // 使用栈代替递归避免栈溢出
  const stack: Position[] = [{ x: 0, y: 0 }];
  visited[0][0] = true;

  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const neighbors = dirs
      .map((d) => ({ nx: cur.x + d.dx, ny: cur.y + d.dy, ...d }))
      .filter((n) => n.nx >= 0 && n.nx < size && n.ny >= 0 && n.ny < size && !visited[n.ny][n.nx]);

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const chosen = neighbors[Math.floor(Math.random() * neighbors.length)];
    cells[cur.y][cur.x] &= ~chosen.wall;
    cells[chosen.ny][chosen.nx] &= ~chosen.opposite;
    visited[chosen.ny][chosen.nx] = true;
    stack.push({ x: chosen.nx, y: chosen.ny });
  }

  const entrance: Position = { x: 0, y: 0 };
  cells[0][0] &= ~WALL_TOP;

  if (singlePlayer) {
    // 单人模式：只有一个入口，金子放在离入口最远处
    let bestPos: Position = { x: size - 1, y: size - 1 };
    let bestDist = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dist = Math.abs(x - entrance.x) + Math.abs(y - entrance.y);
        if (dist > bestDist) {
          bestDist = dist;
          bestPos = { x, y };
        }
      }
    }
    return {
      size,
      cells,
      gold: bestPos,
      entrances: [entrance, entrance],
    };
  }

  // 双人模式：两个入口
  const entrance2: Position = { x: size - 1, y: size - 1 };
  cells[size - 1][size - 1] &= ~WALL_BOTTOM;

  let bestPos: Position = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  let bestDist = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d1 = Math.abs(x - entrance.x) + Math.abs(y - entrance.y);
      const d2 = Math.abs(x - entrance2.x) + Math.abs(y - entrance2.y);
      const minDist = Math.min(d1, d2);
      if (minDist > bestDist) {
        bestDist = minDist;
        bestPos = { x, y };
      }
    }
  }

  return {
    size,
    cells,
    gold: bestPos,
    entrances: [entrance, entrance2],
  };
}

/** BFS 计算从 start 到 end 的最短路径步数，返回 -1 表示不可达 */
export function shortestPath(maze: MazeData, start: Position, end: Position): number {
  const { size, cells } = maze;
  const visited: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false) as boolean[]);
  const queue: { x: number; y: number; steps: number }[] = [{ ...start, steps: 0 }];
  visited[start.y][start.x] = true;

  const moves: { dir: Direction; dx: number; dy: number }[] = [
    { dir: "up", dx: 0, dy: -1 },
    { dir: "down", dx: 0, dy: 1 },
    { dir: "left", dx: -1, dy: 0 },
    { dir: "right", dx: 1, dy: 0 },
  ];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.x === end.x && cur.y === end.y) {
      return cur.steps;
    }
    const cell = cells[cur.y][cur.x];
    for (const m of moves) {
      if (hasWall(cell, m.dir)) {
        continue;
      }
      const nx = cur.x + m.dx;
      const ny = cur.y + m.dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size || visited[ny][nx]) {
        continue;
      }
      visited[ny][nx] = true;
      queue.push({ x: nx, y: ny, steps: cur.steps + 1 });
    }
  }
  return -1;
}

/** Calculate fog visibility: cells within Euclidean distance radius from position */
export function getVisibleCells(
  px: number, py: number, size: number, radius: number
): Set<string> {
  const visible = new Set<string>();
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(py - radius)); y <= Math.min(size - 1, Math.ceil(py + radius)); y++) {
    for (let x = Math.max(0, Math.floor(px - radius)); x <= Math.min(size - 1, Math.ceil(px + radius)); x++) {
      if ((x - px) ** 2 + (y - py) ** 2 <= r2) {
        visible.add(`${x},${y}`);
      }
    }
  }
  return visible;
}
