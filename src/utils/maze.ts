import { type Cell, WALL_TOP, WALL_RIGHT, WALL_BOTTOM, WALL_LEFT, type Direction, type Position } from "../types/protocol";

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
