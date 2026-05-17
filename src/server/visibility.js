const CONFIG = require("../shared/config.js");
const { angleDiff, dist, lineIntersectsRect } = require("./utils.js");

function visionBlockingRects(game) {
  // Only stone walls block sight. Windows and dropped pallets block bodies, not eyeballs.
  return game.map.walls;
}

function attackBlockingRects(game) {
  const blockers = [...game.map.walls, ...game.map.windows];
  for (const pallet of game.map.pallets) {
    if (!pallet.broken && pallet.state === "dropped") blockers.push(pallet);
  }
  return blockers;
}

function hasLineOfSight(game, ax, ay, bx, by, blockers = visionBlockingRects(game)) {
  return !blockers.some((r) => lineIntersectsRect(ax, ay, bx, by, r));
}

function inCone(viewer, target, length, angle) {
  const d = dist(viewer.x, viewer.y, target.x, target.y);
  if (d > length) return false;
  const toTarget = Math.atan2(target.y - viewer.y, target.x - viewer.x);
  return angleDiff(viewer.angle || 0, toTarget) <= angle / 2;
}

function actorVisibleTo(game, viewer, target) {
  if (!viewer || !target) return false;
  if (viewer.id === target.id) return true;
  if (target.healthState === "dead" || target.healthState === "escaped") return false;

  const v = CONFIG.visibility;
  const close = dist(viewer.x, viewer.y, target.x, target.y) <= v.closeRevealRadius;

  if (viewer.role === "survivor" && target.role === "killer") {
    const cone = inCone(viewer, target, v.survivorConeLength, v.survivorConeAngle);
    return (cone || close) && hasLineOfSight(game, viewer.x, viewer.y, target.x, target.y);
  }

  if (viewer.role === "killer" && target.role === "survivor") {
    const cone = inCone(viewer, target, v.killerConeLength, v.killerConeAngle);
    return (cone || close) && hasLineOfSight(game, viewer.x, viewer.y, target.x, target.y);
  }

  // Survivors can read teammates only when nearby or in sight. Keeps fog meaningful.
  if (viewer.role === "survivor" && target.role === "survivor") {
    const nearby = dist(viewer.x, viewer.y, target.x, target.y) <= 320;
    const cone = inCone(viewer, target, v.survivorConeLength, v.survivorConeAngle);
    return (nearby || cone) && hasLineOfSight(game, viewer.x, viewer.y, target.x, target.y);
  }

  return true;
}

function scratchVisibleToKiller(game, killer, mark) {
  if (!killer || killer.role !== "killer") return false;
  const v = CONFIG.visibility;
  const fakeTarget = { x: mark.x, y: mark.y };
  return dist(killer.x, killer.y, mark.x, mark.y) <= v.scratchMarkRange &&
    inCone(killer, fakeTarget, v.killerConeLength, v.killerConeAngle) &&
    hasLineOfSight(game, killer.x, killer.y, mark.x, mark.y);
}

module.exports = {
  visionBlockingRects,
  attackBlockingRects,
  hasLineOfSight,
  inCone,
  actorVisibleTo,
  scratchVisibleToKiller
};
