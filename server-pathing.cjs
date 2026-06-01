"use strict";

let PF = null;
try {
  // Optional dependency. package.json includes it, but the AI falls back to the
  // local A* if npm install has not been run yet.
  PF = require("pathfinding");
} catch (_) {
  PF = null;
}

function isUsablePath(path) {
  return Array.isArray(path) && path.length > 0;
}

function buildPathWithPathfinding(game, actor, targetX, targetY, helpers, adapter = {}) {
  if (!PF || !game?.map || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return [];

  const cols = Math.max(1, Number(game.map.cols || 0));
  const rows = Math.max(1, Number(game.map.rows || 0));
  if (!cols || !rows) return [];

  const tileAt = adapter.tileAt;
  const tileCenter = adapter.tileCenter;
  const isTileBlocked = adapter.isTileBlocked;
  const findNearestStandableTile = adapter.findNearestStandableTile;
  const actorCanStandAt = adapter.actorCanStandAt;
  const distance = adapter.distance || ((ax, ay, bx, by) => Math.hypot(ax - bx, ay - by));

  if (typeof tileAt !== "function" || typeof tileCenter !== "function" || typeof isTileBlocked !== "function") return [];

  const start = tileAt(game, actor.x, actor.y);
  const goal = typeof findNearestStandableTile === "function"
    ? findNearestStandableTile(game, actor, targetX, targetY, helpers)
    : tileAt(game, targetX, targetY);

  if (!goal) return [];
  if (start.x === goal.x && start.y === goal.y) return [{ x: targetX, y: targetY }];

  const matrix = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      row.push(isTileBlocked(game, actor, x, y, helpers) ? 1 : 0);
    }
    matrix.push(row);
  }

  // Actors can be squeezed slightly off-center by collision. Never mark their
  // current tile as unwalkable or the finder may refuse to start.
  if (matrix[start.y]) matrix[start.y][start.x] = 0;
  if (matrix[goal.y]) matrix[goal.y][goal.x] = 0;

  const grid = new PF.Grid(matrix);
  const finder = new PF.AStarFinder({
    allowDiagonal: true,
    dontCrossCorners: true,
    heuristic: PF.Heuristic.octile
  });

  const raw = finder.findPath(start.x, start.y, goal.x, goal.y, grid);
  if (!isUsablePath(raw)) return [];

  let smoothed = raw;
  if (PF.Util?.compressPath) smoothed = PF.Util.compressPath(raw);

  const result = smoothed.map(([x, y]) => tileCenter(game, x, y));
  const last = result[result.length - 1];
  if (
    last
    && distance(last.x, last.y, targetX, targetY) > (game.map.tile || 32) * 0.25
    && (typeof actorCanStandAt !== "function" || actorCanStandAt(game, actor, targetX, targetY, helpers))
  ) {
    result.push({ x: targetX, y: targetY });
  }
  return result;
}

module.exports = {
  buildPathWithPathfinding,
  hasPathfindingPackage: () => !!PF
};
