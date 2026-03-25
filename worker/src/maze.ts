// 迷宫生成模块 — 迭代回溯法（显式栈，适用于 Cloudflare Workers 受限调用栈环境）

// ─── Wall bitmask constants ───────────────────────────────────────────────────
const WALL_TOP = 1;
const WALL_RIGHT = 2;
const WALL_BOTTOM = 4;
const WALL_LEFT = 8;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Position {
  x: number;
  y: number;
}

export interface MazeResult {
  size: number;
  cells: number[][];
  gold: Position;
  entrances: [Position, Position];
}

// ─── Difficulty config ────────────────────────────────────────────────────────
export const DIFFICULTY_CONFIG = {
  easy:   { size: 8 },
  medium: { size: 15 },
  hard:   { size: 25 },
} as const;

// ─── Fisher-Yates shuffle ─────────────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// ─── Get unvisited neighbors ──────────────────────────────────────────────────
function getUnvisitedNeighbors(
  pos: Position,
  size: number,
  visited: boolean[][],
): Position[] {
  const dirs = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];
  const neighbors: Position[] = [];
  for (const { dx, dy } of dirs) {
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (nx >= 0 && nx < size && ny >= 0 && ny < size && !visited[ny][nx]) {
      neighbors.push({ x: nx, y: ny });
    }
  }
  return neighbors;
}

// ─── Remove wall between two adjacent cells ───────────────────────────────────
function removeWall(cells: number[][], a: Position, b: Position): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (dy === -1) {
    // b is above a
    cells[a.y][a.x] &= ~WALL_TOP;
    cells[b.y][b.x] &= ~WALL_BOTTOM;
  } else if (dy === 1) {
    // b is below a
    cells[a.y][a.x] &= ~WALL_BOTTOM;
    cells[b.y][b.x] &= ~WALL_TOP;
  } else if (dx === -1) {
    // b is to the left of a
    cells[a.y][a.x] &= ~WALL_LEFT;
    cells[b.y][b.x] &= ~WALL_RIGHT;
  } else if (dx === 1) {
    // b is to the right of a
    cells[a.y][a.x] &= ~WALL_RIGHT;
    cells[b.y][b.x] &= ~WALL_LEFT;
  }
}

// ─── Place entrances ──────────────────────────────────────────────────────────
function placeEntrances(size: number, cells: number[][]): [Position, Position] {
  // Collect all edge cell positions
  const edges: Position[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (x === 0 || x === size - 1 || y === 0 || y === size - 1) {
        edges.push({ x, y });
      }
    }
  }

  shuffle(edges);

  const diagonal = Math.sqrt(2) * size;
  const minDist = 0.4 * diagonal;

  let entranceA: Position | null = null;
  let entranceB: Position | null = null;

  outer: for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i];
      const b = edges[j];
      const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      if (dist >= minDist) {
        entranceA = a;
        entranceB = b;
        break outer;
      }
    }
  }

  // Fallback: first and last edge cell
  if (entranceA === null || entranceB === null) {
    entranceA = edges[0];
    entranceB = edges[edges.length - 1];
  }

  // Remove outer wall at each entrance
  const openOuterWall = (pos: Position): void => {
    if (pos.y === 0) {
      cells[pos.y][pos.x] &= ~WALL_TOP;
    } else if (pos.y === size - 1) {
      cells[pos.y][pos.x] &= ~WALL_BOTTOM;
    } else if (pos.x === 0) {
      cells[pos.y][pos.x] &= ~WALL_LEFT;
    } else if (pos.x === size - 1) {
      cells[pos.y][pos.x] &= ~WALL_RIGHT;
    }
  };

  openOuterWall(entranceA);
  openOuterWall(entranceB);

  return [entranceA, entranceB];
}

// ─── BFS distance grid ────────────────────────────────────────────────────────
function bfs(cells: number[][], size: number, start: Position): number[][] {
  const dirs = [
    { dx: 0, dy: -1, wall: WALL_TOP },
    { dx: 1,  dy: 0, wall: WALL_RIGHT },
    { dx: 0,  dy: 1, wall: WALL_BOTTOM },
    { dx: -1, dy: 0, wall: WALL_LEFT },
  ];

  // Initialize distance grid with -1 (unvisited)
  const dist: number[][] = Array.from({ length: size }, () =>
    new Array<number>(size).fill(-1),
  );

  dist[start.y][start.x] = 0;
  const queue: Position[] = [start];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    for (const { dx, dy, wall } of dirs) {
      // Only traverse if there is no wall blocking this direction
      if (cells[cur.y][cur.x] & wall) {
        continue;
      }
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size && dist[ny][nx] === -1) {
        dist[ny][nx] = dist[cur.y][cur.x] + 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }

  return dist;
}

// ─── Place gold ───────────────────────────────────────────────────────────────
function placeGold(
  size: number,
  cells: number[][],
  entrances: [Position, Position],
): Position {
  const [a, b] = entrances;
  const distA = bfs(cells, size, a);
  const distB = bfs(cells, size, b);

  const center: Position = {
    x: Math.floor(size / 2),
    y: Math.floor(size / 2),
  };

  // Try progressively relaxed fairness thresholds
  const thresholds = [0.3, 0.5, 1.0];

  for (const threshold of thresholds) {
    const candidates: Position[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dA = distA[y][x];
        const dB = distB[y][x];
        // Skip unreachable cells and entrance cells themselves (distance 0)
        if (dA <= 0 || dB <= 0) {
          continue;
        }
        const maxD = Math.max(dA, dB);
        if (Math.abs(dA - dB) / maxD <= threshold) {
          candidates.push({ x, y });
        }
      }
    }
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  // Absolute fallback: center of maze
  return center;
}

// ─── Main maze generation function ───────────────────────────────────────────
export function generateMaze(size: number): MazeResult {
  // Step 1: Initialize grid — all walls set (bitmask 15 = 0b1111)
  const cells: number[][] = Array.from({ length: size }, () =>
    new Array<number>(size).fill(WALL_TOP | WALL_RIGHT | WALL_BOTTOM | WALL_LEFT),
  );

  // Step 2: Visited grid
  const visited: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );

  // Step 3: Start at a random cell
  const startX = Math.floor(Math.random() * size);
  const startY = Math.floor(Math.random() * size);
  const stack: Position[] = [{ x: startX, y: startY }];
  visited[startY][startX] = true;

  // Step 4: Iterative backtracker
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = getUnvisitedNeighbors(current, size, visited);

    if (neighbors.length > 0) {
      // Pick a random unvisited neighbor
      const next = neighbors[Math.floor(Math.random() * neighbors.length)];
      removeWall(cells, current, next);
      visited[next.y][next.x] = true;
      stack.push(next);
    } else {
      // Dead end — backtrack
      stack.pop();
    }
  }

  // Step 5: Place entrances and gold
  const entrances = placeEntrances(size, cells);
  const gold = placeGold(size, cells, entrances);

  return { size, cells, gold, entrances };
}
