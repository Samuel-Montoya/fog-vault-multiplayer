"use strict";

const PERSONALITY_ID = "rift-warden";
const PERSONALITY_LABEL = "Rift Warden";
const PATH_REPLAN_SECONDS = 0.72;
const STUCK_SAMPLE_SECONDS = 0.42;
const STUCK_REPATH_DISTANCE = 5.5;
const STUCK_CLEAR_SECONDS = 1.55;
const PATHFIND_LOOP_LIMIT = 2600;
const RIFT_PROGRESS_EPSILON = 0.001;
const DEFAULT_RIFT_KICK_DISTANCE = 84;
const CHECK_DWELL_SECONDS = 0.65;
const RECENT_CHECK_MEMORY = 3;

const VOID_HUNT_RADIUS = 980;
const VOID_CLOSE_SENSE_RADIUS = 360;
const VOID_TARGET_MEMORY_SECONDS = 2.35;
const VOID_HUNT_SWITCH_LOCK_SECONDS = 4.25;
const VOID_CHASE_TARGET_REPATH_DISTANCE = 96;
const VOID_LAST_KNOWN_REACHED_DISTANCE = 62;
const VOID_HOOK_DISTANCE = 128;
const VOID_ATTACK_QUICK_RANGE = 86;
const VOID_ATTACK_LUNGE_RANGE = 122;
const VOID_ATTACK_CLEAR_EXTRA = 18;
const VOID_LUNGE_START_EXTRA = 56;
const VOID_LUNGE_COMMIT_SECONDS = 0.72;
const VOID_LUNGE_POINT_BLANK_MULT = 0.82;
const VOID_LUNGE_BRAKE_RANGE_MULT = 1.08;
const VOID_EXIT_PATROL_REPATH_SECONDS = 0.65;
const VOID_OBSTACLE_ACTION_DISTANCE = 86;
const VOID_OBSTACLE_SEEK_DISTANCE = 230;
const VOID_OBSTACLE_PATH_WIDTH = 118;
const VOID_CHASE_REPATH_SECONDS = 0.46;
const VOID_HOOK_COMMIT_SECONDS = 3.1;
const VOID_POST_OBSTACLE_SECONDS = 2.35;
const VOID_OBSTACLE_REUSE_COOLDOWN_SECONDS = 6.25;
const VOID_OBSTACLE_ACTION_BUFFER = 70;
const VOID_OBSTACLE_ACTION_LOCK_SECONDS = 0.45;
const VOID_OBSTACLE_COMMIT_SECONDS = 2.15;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b, c, d) {
  if (typeof a === "object" && typeof b === "object") {
    return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
  }
  return Math.hypot((a || 0) - (c || 0), (b || 0) - (d || 0));
}

function helperDist(helpers, ax, ay, bx, by) {
  return typeof helpers?.dist === "function" ? helpers.dist(ax, ay, bx, by) : distance(ax, ay, bx, by);
}

const MOVE_INTENT_LOCK_SECONDS = 0.72;
const MOVE_INTENT_REACHED_DISTANCE = 30;

function stableMoveTarget(actor, tx, ty, brain) {
  if (!brain || !Number.isFinite(tx) || !Number.isFinite(ty)) return { x: tx, y: ty };

  const now = Number(brain.aiNow || 0);
  const dx = tx - actor.x;
  const dy = ty - actor.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const old = brain.moveIntent;

  if (old && now <= (old.until || 0)) {
    const oldDistance = distance(actor.x, actor.y, old.x, old.y);
    if (oldDistance > MOVE_INTENT_REACHED_DISTANCE) {
      const dot = nx * (old.nx || 0) + ny * (old.ny || 0);
      const targetShift = distance(tx, ty, old.x, old.y);
      const notActuallyStuck = (brain.stuckFor || 0) < STUCK_CLEAR_SECONDS;

      // This is the anti-ping-pong governor. New target choices are allowed, but not
      // if they instantly reverse the actor or shuffle between near-identical points.
      // That exact twitch was the "back/forth forever" bug wearing a tiny hat.
      const tinyCorrection = targetShift < 112 && dot > -0.45;
      const hardReverse = targetShift < 170 && dot < -0.35 && oldDistance > MOVE_INTENT_REACHED_DISTANCE * 1.35;
      if ((tinyCorrection || hardReverse) && notActuallyStuck) {
        return { x: old.x, y: old.y };
      }
    }
  }

  brain.moveIntent = {
    x: tx,
    y: ty,
    nx,
    ny,
    until: now + MOVE_INTENT_LOCK_SECONDS
  };
  return { x: tx, y: ty };
}

function setMoveToward(actor, tx, ty, sprint = true) {
  const brain = actor.bot?.voidRiftAi || null;
  const stable = stableMoveTarget(actor, tx, ty, brain);
  tx = stable.x;
  ty = stable.y;
  const dx = tx - actor.x;
  const dy = ty - actor.y;
  const d = Math.hypot(dx, dy);
  actor.input.left = false;
  actor.input.right = false;
  actor.input.up = false;
  actor.input.down = false;
  actor.input.sprint = !!sprint;
  actor.input.angle = Math.atan2(dy, dx);
  if (d <= 4) return false;

  const deadZone = Math.max(8, Math.min(18, d * 0.12));
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  // Let the path target control movement. The one-axis governor made the bot
  // commit to the wrong axis, overshoot the waypoint, then reverse forever.
  // A proud little treadmill of failure.
  if (absX > deadZone) {
    actor.input.left = dx < 0;
    actor.input.right = dx > 0;
  }
  if (absY > deadZone) {
    actor.input.up = dy < 0;
    actor.input.down = dy > 0;
  }
  return !!(actor.input.left || actor.input.right || actor.input.up || actor.input.down);
}

function stopAndFace(actor, target) {
  const brain = actor.bot?.voidRiftAi || null;
  if (brain) brain.moveIntent = null;
  actor.input.left = false;
  actor.input.right = false;
  actor.input.up = false;
  actor.input.down = false;
  actor.input.sprint = false;
  actor.input.repair = false;
  if (target) actor.input.angle = Math.atan2(target.y - actor.y, target.x - actor.x);
}

function ensureVoidBrain(actor) {
  actor.bot = actor.bot || {};
  actor.bot.voidRiftAi = actor.bot.voidRiftAi || {
    personalityId: PERSONALITY_ID,
    personalityLabel: PERSONALITY_LABEL,
    task: null,
    path: [],
    pathTargetKey: null,
    repathIn: 0,
    stuckFor: 0,
    stuckSampleIn: 0,
    stuckX: actor.x,
    stuckY: actor.y,
    nextStep: null,
    recentChecks: [],
    holdingKick: false,
    huntTargetId: null,
    lastKnownRunner: null,
    attackCommitUntil: 0,
    lungeCommitTargetId: null,
    lungeCommitUntil: 0,
    hookCommitTargetId: null,
    hookCommitUntil: 0,
    obstacleCommit: null,
    recentObstacle: null,
    escapeSteer: null
  };

  actor.bot.personalityId = PERSONALITY_ID;
  actor.bot.personality = PERSONALITY_ID;
  actor.bot.personalityLabel = PERSONALITY_LABEL;
  actor.bot.voidRiftAi.personalityId = PERSONALITY_ID;
  actor.bot.voidRiftAi.personalityLabel = PERSONALITY_LABEL;
  return actor.bot.voidRiftAi;
}

function actorCanStandAt(game, actor, x, y, helpers) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < 0 || y < 0 || x > game.map.width || y > game.map.height) return false;
  if (typeof helpers?.canActorStandAt === "function") {
    return !!helpers.canActorStandAt(game, actor, x, y);
  }
  return true;
}

function lineClear(game, actor, x, y, helpers) {
  if (typeof helpers?.segmentClear === "function" && !helpers.segmentClear(game, actor.x, actor.y, x, y)) return false;
  return actorCanStandAt(game, actor, x, y, helpers);
}

function tileAt(game, x, y) {
  const tile = game.map.tile || 32;
  return {
    x: clamp(Math.floor(x / tile), 0, game.map.cols - 1),
    y: clamp(Math.floor(y / tile), 0, game.map.rows - 1)
  };
}

function tileCenter(game, tx, ty) {
  const tile = game.map.tile || 32;
  return { x: tx * tile + tile / 2, y: ty * tile + tile / 2 };
}

function tileKey(tx, ty) {
  return `${tx},${ty}`;
}

function tileCenterInsideRect(game, tx, ty, rect, pad = 0) {
  if (!rect) return false;
  const c = tileCenter(game, tx, ty);
  return c.x >= rect.x - pad
    && c.x <= rect.x + rect.w + pad
    && c.y >= rect.y - pad
    && c.y <= rect.y + rect.h + pad;
}

function isKnownHardBlockedTile(game, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= game.map.cols || ty >= game.map.rows) return true;

  const row = Array.isArray(game.map.rawRows) ? game.map.rawRows[ty] : null;
  const ch = typeof row === "string" ? row[tx] : null;
  if (ch === "X" || ch === "+") return true;

  for (const win of game.map.windows || []) {
    if (tileCenterInsideRect(game, tx, ty, win, 2)) return true;
  }

  for (const pallet of game.map.pallets || []) {
    if (pallet.broken || pallet.state !== "dropped") continue;
    if ((Number.isFinite(pallet.tileX) && pallet.tileX === tx && pallet.tileY === ty) || tileCenterInsideRect(game, tx, ty, pallet, 2)) return true;
  }

  return false;
}

function isTileBlocked(game, actor, tx, ty, helpers) {
  if (tx < 0 || ty < 0 || tx >= game.map.cols || ty >= game.map.rows) return true;

  if (Array.isArray(game.map.rawRows) && isKnownHardBlockedTile(game, tx, ty)) return true;

  // Plan with the actual body again. The package/grid pass made mathematically clean
  // paths that still scraped The Void into corners. A path that the body cannot fit is
  // not a path, it is a wish with coordinates.
  const c = tileCenter(game, tx, ty);
  return !actorCanStandAt(game, actor, c.x, c.y, helpers);
}

function findNearestStandableTile(game, actor, targetX, targetY, helpers) {
  const target = tileAt(game, targetX, targetY);
  if (!isTileBlocked(game, actor, target.x, target.y, helpers)) return target;

  const maxRadius = 8;
  let best = null;
  let bestD = Infinity;
  for (let r = 1; r <= maxRadius; r++) {
    for (let y = target.y - r; y <= target.y + r; y++) {
      for (let x = target.x - r; x <= target.x + r; x++) {
        if (x < 0 || y < 0 || x >= game.map.cols || y >= game.map.rows) continue;
        if (Math.abs(x - target.x) !== r && Math.abs(y - target.y) !== r) continue;
        if (isTileBlocked(game, actor, x, y, helpers)) continue;
        const c = tileCenter(game, x, y);
        const d = distance(c.x, c.y, targetX, targetY);
        if (d < bestD) {
          best = { x, y };
          bestD = d;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function buildPath(game, actor, targetX, targetY, helpers) {
  const start = tileAt(game, actor.x, actor.y);
  const goal = findNearestStandableTile(game, actor, targetX, targetY, helpers);
  if (!goal) return [];
  const startKey = tileKey(start.x, start.y);
  const goalKey = tileKey(goal.x, goal.y);
  if (startKey === goalKey) return [{ x: targetX, y: targetY }];

  const open = [{ x: start.x, y: start.y, g: 0, f: 0 }];
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const closed = new Set();

  const heuristic = (x, y) => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };

  let loops = 0;
  while (open.length && loops++ < PATHFIND_LOOP_LIMIT) {
    let bestIndex = 0;
    let bestF = open[0].f;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < bestF) {
        bestIndex = i;
        bestF = open[i].f;
      }
    }

    const current = open.splice(bestIndex, 1)[0];
    const currentKey = tileKey(current.x, current.y);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    if (currentKey === goalKey) {
      const path = [];
      let k = currentKey;
      while (k) {
        const [x, y] = k.split(",").map(Number);
        path.push(tileCenter(game, x, y));
        k = cameFrom.get(k);
      }
      path.reverse();
      const last = path[path.length - 1];
      if (last && distance(last.x, last.y, targetX, targetY) > (game.map.tile || 32) * 0.25 && actorCanStandAt(game, actor, targetX, targetY, helpers)) {
        path.push({ x: targetX, y: targetY });
      }
      return path;
    }

    const neighbors = [
      { x: current.x + 1, y: current.y, diagonal: false },
      { x: current.x - 1, y: current.y, diagonal: false },
      { x: current.x, y: current.y + 1, diagonal: false },
      { x: current.x, y: current.y - 1, diagonal: false },
      { x: current.x + 1, y: current.y + 1, diagonal: true },
      { x: current.x - 1, y: current.y + 1, diagonal: true },
      { x: current.x + 1, y: current.y - 1, diagonal: true },
      { x: current.x - 1, y: current.y - 1, diagonal: true }
    ];

    for (const n of neighbors) {
      if (isTileBlocked(game, actor, n.x, n.y, helpers)) continue;
      if (n.diagonal && (isTileBlocked(game, actor, current.x, n.y, helpers) || isTileBlocked(game, actor, n.x, current.y, helpers))) continue;
      const nk = tileKey(n.x, n.y);
      if (closed.has(nk)) continue;
      const stepCost = n.diagonal ? Math.SQRT2 : 1;
      const tentative = (gScore.get(currentKey) ?? Infinity) + stepCost;
      if (tentative >= (gScore.get(nk) ?? Infinity)) continue;
      cameFrom.set(nk, currentKey);
      gScore.set(nk, tentative);
      open.push({ x: n.x, y: n.y, g: tentative, f: tentative + heuristic(n.x, n.y) });
    }
  }

  return [];
}

function clearPath(brain) {
  brain.path = [];
  brain.pathTargetKey = null;
  brain.pathGoalX = null;
  brain.pathGoalY = null;
  brain.repathIn = 0;
  brain.moveIntent = null;
  brain.moveAxis = null;
  brain.moveAxisUntil = 0;
}

function fallbackMoveToward(game, actor, target, helpers, options = {}) {
  const brain = ensureVoidBrain(actor);
  const tile = game.map.tile || 32;
  const now = options.now ?? (game.time || 0);
  const baseAngle = Math.atan2(target.y - actor.y, target.x - actor.x);
  const probeDistance = Math.max(tile * 1.05, 42);

  if (!brain.escapeSteer || now > (brain.escapeSteer.until || 0)) {
    brain.escapeSteer = {
      until: now + 0.95,
      side: Math.random() < 0.5 ? -1 : 1
    };
  }

  const side = brain.escapeSteer.side || 1;
  const angles = [
    0,
    side * Math.PI / 5,
    -side * Math.PI / 5,
    side * Math.PI / 2,
    -side * Math.PI / 2,
    Math.PI
  ];

  let best = null;
  let bestScore = Infinity;
  for (const offset of angles) {
    const angle = baseAngle + offset;
    const px = actor.x + Math.cos(angle) * probeDistance;
    const py = actor.y + Math.sin(angle) * probeDistance;
    if (!actorCanStandAt(game, actor, px, py, helpers)) continue;
    const clearBonus = lineClear(game, actor, px, py, helpers) ? -70 : 0;
    const score = helperDist(helpers, px, py, target.x, target.y) + Math.abs(offset) * 42 + clearBonus;
    if (score < bestScore) {
      best = { x: px, y: py };
      bestScore = score;
    }
  }

  const moveTarget = best || target;
  setMoveToward(actor, moveTarget.x, moveTarget.y, !!options.sprint);
}

function followPath(game, actor, target, helpers, options = {}) {
  const brain = ensureVoidBrain(actor);
  brain.aiNow = game.time || 0;
  const stopDistance = Math.max(8, options.stopDistance || 18);
  const targetKeyValue = options.pathTargetKey || `${Math.round(target.x)},${Math.round(target.y)}:${Math.round(stopDistance)}`;
  const repathTargetMoveDistance = Number(options.repathTargetMoveDistance || 0);
  const targetMovedTooFar = repathTargetMoveDistance > 0
    && Number.isFinite(brain.pathGoalX)
    && Number.isFinite(brain.pathGoalY)
    && helperDist(helpers, target.x, target.y, brain.pathGoalX, brain.pathGoalY) >= repathTargetMoveDistance;
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);

  if (d <= stopDistance && lineClear(game, actor, target.x, target.y, helpers)) {
    stopAndFace(actor, target);
    return true;
  }

  brain.stuckSampleIn = (brain.stuckSampleIn || 0) - (options.dt || 0);
  if (brain.stuckSampleIn <= 0) {
    const moved = helperDist(helpers, actor.x, actor.y, brain.stuckX ?? actor.x, brain.stuckY ?? actor.y);
    const hadMove = actor.input.up || actor.input.down || actor.input.left || actor.input.right;
    brain.stuckFor = hadMove && moved < STUCK_REPATH_DISTANCE
      ? (brain.stuckFor || 0) + STUCK_SAMPLE_SECONDS
      : Math.max(0, (brain.stuckFor || 0) - STUCK_SAMPLE_SECONDS * 0.75);
    brain.stuckX = actor.x;
    brain.stuckY = actor.y;
    brain.stuckSampleIn = STUCK_SAMPLE_SECONDS;
  }

  brain.repathIn = (brain.repathIn || 0) - (options.dt || 0);
  const mustRepath = !brain.path?.length
    || brain.pathTargetKey !== targetKeyValue
    || brain.repathIn <= 0
    || targetMovedTooFar
    || (brain.stuckFor || 0) >= STUCK_CLEAR_SECONDS;

  if (mustRepath) {
    brain.path = buildPath(game, actor, target.x, target.y, helpers);
    brain.pathTargetKey = targetKeyValue;
    brain.pathGoalX = target.x;
    brain.pathGoalY = target.y;
    brain.repathIn = Number(options.repathSeconds || PATH_REPLAN_SECONDS) + Math.random() * 0.18;
    if ((brain.stuckFor || 0) >= STUCK_SAMPLE_SECONDS && (brain.stuckFor || 0) < STUCK_CLEAR_SECONDS) {
      brain.stuckFor = Math.max(0, (brain.stuckFor || 0) - STUCK_SAMPLE_SECONDS);
    }
  }

  if (!brain.path?.length) {
    fallbackMoveToward(game, actor, target, helpers, { ...options, now: game.time || 0 });
    return false;
  }

  while (brain.path.length > 1 && helperDist(helpers, actor.x, actor.y, brain.path[0].x, brain.path[0].y) < (game.map.tile || 32) * 0.42) {
    brain.path.shift();
  }

  const allowWaypointSkip = (brain.stuckFor || 0) <= 0.01;
  while (allowWaypointSkip && brain.path.length > 2) {
    const skip = brain.path[2];
    const skipDistance = helperDist(helpers, actor.x, actor.y, skip.x, skip.y);
    if (skipDistance > (game.map.tile || 32) * 2.2 || !lineClear(game, actor, skip.x, skip.y, helpers)) break;
    brain.path.shift();
  }

  const next = brain.path[0];
  setMoveToward(actor, next.x, next.y, !!options.sprint);

  if ((brain.stuckFor || 0) >= STUCK_CLEAR_SECONDS) {
    clearPath(brain);
    brain.stuckFor = STUCK_SAMPLE_SECONDS;
    fallbackMoveToward(game, actor, target, helpers, { ...options, now: game.time || 0 });
    return false;
  }

  return false;
}

function unfinishedRifts(game) {
  return (game?.map?.generators || []).filter((rift) => rift && !rift.done);
}

function riftProgress(rift) {
  return clamp(Number(rift?.progress || 0), 0, 1);
}

function getRiftById(game, id) {
  return (game?.map?.generators || []).find((rift) => rift?.id === id) || null;
}

function isKickableRift(rift) {
  return !!rift && !rift.done && !rift.kickLocked && riftProgress(rift) > RIFT_PROGRESS_EPSILON;
}

function chooseBestKickableRift(game, actor, helpers) {
  let best = null;
  let bestScore = -Infinity;

  for (const rift of unfinishedRifts(game)) {
    if (!isKickableRift(rift)) continue;
    const d = helperDist(helpers, actor.x, actor.y, rift.x, rift.y);
    const progress = riftProgress(rift);
    const score = progress * 2400
      + (progress >= 0.75 ? 700 : 0)
      + (progress >= 0.5 ? 260 : 0)
      + (rift.dotDepositing ? 420 : 0)
      - d * 0.34;
    if (score > bestScore) {
      best = rift;
      bestScore = score;
    }
  }

  return best;
}

function chooseCheckRift(game, actor, helpers, brain) {
  const rifts = unfinishedRifts(game);
  if (!rifts.length) return null;

  let best = null;
  let bestScore = -Infinity;
  const recent = new Set(brain.recentChecks || []);

  for (const rift of rifts) {
    const d = helperDist(helpers, actor.x, actor.y, rift.x, rift.y);
    const progress = riftProgress(rift);
    const recentPenalty = recent.has(rift.id) && rifts.length > recent.size ? 850 : 0;
    const lockedPenalty = rift.kickLocked ? 120 : 0;
    const score = progress * 1000 - d * 0.28 - recentPenalty - lockedPenalty;
    if (score > bestScore) {
      best = rift;
      bestScore = score;
    }
  }

  return best;
}

function predictNextRift(game, actor, helpers, currentId) {
  let best = null;
  let bestScore = -Infinity;
  const from = getRiftById(game, currentId) || actor;

  for (const rift of unfinishedRifts(game)) {
    if (rift.id === currentId || !isKickableRift(rift)) continue;
    const d = distance(from.x, from.y, rift.x, rift.y);
    const progress = riftProgress(rift);
    const score = progress * 1700 + (rift.dotDepositing ? 300 : 0) - d * 0.3;
    if (score > bestScore) {
      best = rift;
      bestScore = score;
    }
  }

  return best;
}

function makeTask(kind, rift, game, actor, helpers) {
  const next = predictNextRift(game, actor, helpers, rift?.id || null);
  return {
    kind,
    id: rift?.id || null,
    x: rift?.x || 0,
    y: rift?.y || 0,
    committedAt: game.time || 0,
    dwellUntil: kind === "check" ? (game.time || 0) + CHECK_DWELL_SECONDS : 0,
    nextKind: next ? "kick" : null,
    nextId: next?.id || null
  };
}

function setTask(game, actor, helpers, kind, rift) {
  const brain = ensureVoidBrain(actor);
  const old = brain.task;
  const same = old && old.kind === kind && old.id === (rift?.id || null);
  if (same) return old;
  brain.task = makeTask(kind, rift, game, actor, helpers);
  clearPath(brain);
  return brain.task;
}

function clearTask(actor) {
  const brain = ensureVoidBrain(actor);
  brain.task = null;
  brain.nextStep = null;
  brain.holdingKick = false;
  clearPath(brain);
}

function clearObjectiveTaskOnly(actor) {
  const brain = ensureVoidBrain(actor);
  brain.task = null;
  brain.holdingKick = false;
}

function resolveTaskTarget(game, task) {
  if (!task) return null;
  return getRiftById(game, task.id);
}

function taskStillValid(game, task) {
  if (!task) return false;
  const rift = resolveTaskTarget(game, task);
  if (!rift || rift.done) return false;
  if (task.kind === "kick") return isKickableRift(rift);
  if (task.kind === "check") return true;
  return false;
}

function rememberCheckedRift(brain, riftId) {
  if (!riftId) return;
  brain.recentChecks = (brain.recentChecks || []).filter((id) => id !== riftId);
  brain.recentChecks.unshift(riftId);
  brain.recentChecks = brain.recentChecks.slice(0, RECENT_CHECK_MEMORY);
}

function isBusy(actor) {
  return !!(actor.vault || actor.breakTarget || actor.attackState || actor.actionLock > 0 || actor.hookActionTargetId);
}

function kickRift(game, actor, rift, helpers, dt) {
  const brain = ensureVoidBrain(actor);
  const kickDistance = Number(helpers?.riftKickDistance || DEFAULT_RIFT_KICK_DISTANCE);
  const d = helperDist(helpers, actor.x, actor.y, rift.x, rift.y);
  brain.nextStep = { kind: "kick-until-locked", targetId: rift.id, nextId: brain.task?.nextId || null };

  if (d <= kickDistance && lineClear(game, actor, rift.x, rift.y, helpers)) {
    stopAndFace(actor, rift);
    actor.input.repair = true;
    brain.holdingKick = true;
    brain.stuckFor = 0;
    return;
  }

  actor.input.repair = false;
  brain.holdingKick = false;
  if (tryUseKillerObstacle(game, actor, rift, helpers, dt)) return;
  followPath(game, actor, rift, helpers, {
    sprint: true,
    stopDistance: Math.max(18, kickDistance * 0.68),
    dt
  });
}

function checkRift(game, actor, rift, helpers, dt) {
  const brain = ensureVoidBrain(actor);
  const checkDistance = Number(helpers?.riftKickDistance || DEFAULT_RIFT_KICK_DISTANCE) * 0.78;
  brain.nextStep = { kind: "check-rift", targetId: rift.id };
  brain.holdingKick = false;
  actor.input.repair = false;

  if (isKickableRift(rift)) {
    setTask(game, actor, helpers, "kick", rift);
    return;
  }

  if (tryUseKillerObstacle(game, actor, rift, helpers, dt)) return;

  const reached = followPath(game, actor, rift, helpers, {
    sprint: true,
    stopDistance: Math.max(18, checkDistance),
    dt
  });

  if (reached && (game.time || 0) >= (brain.task?.dwellUntil || 0)) {
    rememberCheckedRift(brain, rift.id);
    clearTask(actor);
  }
}


function centerOf(rect) {
  return {
    x: (rect?.x || 0) + (rect?.w || 0) / 2,
    y: (rect?.y || 0) + (rect?.h || 0) / 2
  };
}

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.0001) return distance(px, py, ax, ay);
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1);
  return distance(px, py, ax + vx * t, ay + vy * t);
}

function freezeActorInput(actor, target = null) {
  actor.input.left = false;
  actor.input.right = false;
  actor.input.up = false;
  actor.input.down = false;
  actor.input.sprint = false;
  if (target) actor.input.angle = Math.atan2(target.y - actor.y, target.x - actor.x);
}

function holdRepair(actor, target = null) {
  freezeActorInput(actor, target);
  actor.input.repair = true;
  actor.input.action = false;
  actor.input.attack = false;
  actor.input.attackHeld = false;
  actor.input.attackReleased = false;
}

function getActorById(game, id) {
  return id ? game?.actors?.get?.(id) || null : null;
}

function livingSurvivors(game) {
  return [...(game?.actors?.values?.() || [])].filter((p) => p?.role === "survivor" && !p.dead && !p.escaped && !p.hooked);
}

function activeSurvivors(game) {
  return livingSurvivors(game).filter((p) => !p.downed && p.health > 0);
}

function livingRunners(game) {
  return activeSurvivors(game);
}

function downedSurvivors(game) {
  return livingSurvivors(game).filter((p) => p.downed && p.health <= 0);
}

function isFacingPoint(actor, x, y, minDot = 0.36) {
  const ax = Math.cos(actor?.angle || 0);
  const ay = Math.sin(actor?.angle || 0);
  const dx = x - actor.x;
  const dy = y - actor.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return true;
  return (ax * (dx / len) + ay * (dy / len)) >= minDot;
}

function canSenseRunner(game, killer, runner, helpers) {
  if (!runner || runner.dead || runner.escaped || runner.hooked) return false;
  const d = helperDist(helpers, killer.x, killer.y, runner.x, runner.y);
  const los = typeof helpers?.segmentClear === "function" ? helpers.segmentClear(game, killer.x, killer.y, runner.x, runner.y) : true;

  // Objective knowledge is global. Runner knowledge is not.
  // The Void can notice very close runners, runners in its forward cone, or noisy objective actions.
  if (d <= VOID_CLOSE_SENSE_RADIUS * 0.62) return true;
  if (los && d <= VOID_CLOSE_SENSE_RADIUS && isFacingPoint(killer, runner.x, runner.y, 0.12)) return true;
  if (los && d <= VOID_HUNT_RADIUS && isFacingPoint(killer, runner.x, runner.y, 0.42)) return true;
  if ((runner.chaseHold || 0) > 0 && d <= VOID_HUNT_RADIUS * 0.85) return true;
  if (runner.dotDepositing && d <= VOID_HUNT_RADIUS * 0.72) return true;
  return false;
}

function chooseDownedTarget(game, killer, helpers) {
  let best = null;
  let bestScore = -Infinity;
  for (const runner of downedSurvivors(game)) {
    const d = helperDist(helpers, killer.x, killer.y, runner.x, runner.y);
    const score = 2200 - d + (runner.hookCount || 0) * 260;
    if (score > bestScore) {
      best = runner;
      bestScore = score;
    }
  }
  return best;
}

function rememberHuntTarget(game, brain, runner) {
  const now = game.time || 0;
  brain.huntTargetId = runner.id;
  brain.huntLockUntil = now + VOID_HUNT_SWITCH_LOCK_SECONDS;
  brain.lastKnownRunner = { id: runner.id, x: runner.x, y: runner.y, until: now + VOID_TARGET_MEMORY_SECONDS };
}

function keepRememberedHuntTarget(brain, runner) {
  if (!runner) return;
  brain.huntTargetId = runner.id;
}

function chooseHuntTarget(game, killer, helpers, brain) {
  let best = null;
  let bestScore = -Infinity;
  const current = getActorById(game, brain.huntTargetId);
  const now = game.time || 0;

  const currentValid = current
    && current.role === "survivor"
    && !current.dead
    && !current.escaped
    && !current.hooked
    && !current.downed
    && current.health > 0;
  const currentRemembered = currentValid
    && brain.lastKnownRunner
    && brain.lastKnownRunner.id === current.id
    && now <= (brain.lastKnownRunner.until || 0);
  const currentSensed = currentValid && canSenseRunner(game, killer, current, helpers);

  // Do not switch hunt targets every tick. That was the Void's "hunt mode"
  // treadmill: target A wins by 2 points, then target B, then A, then everyone
  // watches the killer vibrate like a broken appliance.
  if (currentValid && currentSensed && now <= Number(brain.huntLockUntil || 0)) {
    rememberHuntTarget(game, brain, current);
    return current;
  }

  if (currentValid && currentRemembered && now <= Number(brain.huntLockUntil || 0)) {
    keepRememberedHuntTarget(brain, current);
    return current;
  }

  let currentScore = -Infinity;
  for (const runner of activeSurvivors(game)) {
    const d = helperDist(helpers, killer.x, killer.y, runner.x, runner.y);
    const sensed = canSenseRunner(game, killer, runner, helpers);
    const remembered = current?.id === runner.id && brain.lastKnownRunner && now <= (brain.lastKnownRunner.until || 0);
    if (!sensed && !remembered) continue;
    const los = typeof helpers?.segmentClear === "function" ? helpers.segmentClear(game, killer.x, killer.y, runner.x, runner.y) : true;
    const score = 1600
      - d * 0.82
      + (runner.injured ? 420 : 0)
      + ((runner.dots || 0) * 18)
      + (runner.dotDepositing ? 620 : 0)
      + ((runner.chaseHold || 0) > 0 ? 260 : 0)
      + (los ? 180 : 0)
      + (current?.id === runner.id ? 520 : 0);
    if (current?.id === runner.id) currentScore = score;
    if (score > bestScore) {
      best = runner;
      bestScore = score;
    }
  }

  if (currentValid && (currentSensed || currentRemembered) && currentScore > -Infinity && best && best.id !== current.id) {
    const switchMargin = now <= Number(brain.huntLockUntil || 0) ? 9999 : 360;
    if (bestScore < currentScore + switchMargin) best = current;
  }

  if (best) {
    if (canSenseRunner(game, killer, best, helpers)) rememberHuntTarget(game, brain, best);
    else keepRememberedHuntTarget(brain, best);
  }
  return best;
}

function attackLineClear(game, killer, target, helpers) {
  if (typeof helpers?.attackSegmentClear === "function") return helpers.attackSegmentClear(game, killer.x, killer.y, target.x, target.y);
  if (typeof helpers?.segmentClear === "function") return helpers.segmentClear(game, killer.x, killer.y, target.x, target.y);
  return true;
}

function faceTarget(actor, target) {
  actor.input.angle = Math.atan2(target.y - actor.y, target.x - actor.x);
}

function clearAttackInputs(killer) {
  killer.input.attack = false;
  killer.input.attackHeld = false;
  killer.input.attackReleased = false;
}

function triggerQuickAttack(killer, target) {
  stopAndFace(killer, target);
  faceTarget(killer, target);
  killer.input.attack = true;
  killer.input.attackReleased = true;
  killer.input.attackHeld = false;
}

function holdLungeCharge(killer, target, shouldMove) {
  faceTarget(killer, target);
  if (shouldMove) setMoveToward(killer, target.x, target.y, true);
  else stopAndFace(killer, target);
  killer.input.attackHeld = true;
  killer.input.attack = false;
  killer.input.attackReleased = false;
}

function tryVoidAttack(game, killer, target, helpers, dt = 0) {
  if (!target || target.downed || target.dead || target.escaped || target.hooked) return false;
  const brain = ensureVoidBrain(killer);

  if (killer.attackState === "quick" || killer.attackState === "lunge") return true;
  if (killer.recovery > 0 || killer.attackCooldown > 0 || killer.actionLock > 0 || killer.vault || killer.breakTarget || killer.hookActionTargetId || (killer.voidStun || 0) > 0) return false;

  // After any attack, the engine requires one clean frame with M1 not held before the
  // next charge. If the bot immediately holds again, it can get trapped in a fake
  // "charging" intention that never becomes a real swing. Very glamorous failure mode.
  if (killer.attackNeedsRelease) {
    clearAttackInputs(killer);
    return false;
  }

  const now = game.time || 0;
  const d = helperDist(helpers, killer.x, killer.y, target.x, target.y);
  const quickRange = Number(helpers?.quickAttackRange || VOID_ATTACK_QUICK_RANGE);
  const lungeRange = Number(helpers?.lungeAttackRange || VOID_ATTACK_LUNGE_RANGE);
  const startRange = lungeRange + VOID_ATTACK_CLEAR_EXTRA + VOID_LUNGE_START_EXTRA;
  const pointBlankRange = Math.max(42, quickRange * VOID_LUNGE_POINT_BLANK_MULT);
  const brakeRange = Math.max(pointBlankRange + 18, lungeRange * VOID_LUNGE_BRAKE_RANGE_MULT);
  const clear = attackLineClear(game, killer, target, helpers);
  const committed = brain.lungeCommitTargetId === target.id && now <= (brain.lungeCommitUntil || 0);

  // If The Void is already close enough to touch the runner, charging a lunge is how it
  // strolls through them before active frames start. At point-blank range, quick attack is
  // the best attack. The bot still charges for real lunges, it just stops suiciding into
  // the lunge dead-zone.
  if (d <= pointBlankRange && clear) {
    triggerQuickAttack(killer, target);
    brain.lungeCommitTargetId = null;
    brain.lungeCommitUntil = 0;
    return true;
  }

  if (killer.attackState === "charging") {
    const shouldMove = d > brakeRange;
    holdLungeCharge(killer, target, shouldMove);
    brain.lungeCommitTargetId = target.id;
    brain.lungeCommitUntil = Math.max(brain.lungeCommitUntil || 0, now + VOID_LUNGE_COMMIT_SECONDS);
    return true;
  }

  if (!committed && d > startRange) return false;
  if (!committed && !clear) return false;

  const shouldMove = d > brakeRange;
  holdLungeCharge(killer, target, shouldMove);
  brain.lungeCommitTargetId = target.id;
  brain.lungeCommitUntil = Math.max(brain.lungeCommitUntil || 0, now + VOID_LUNGE_COMMIT_SECONDS);
  return true;
}

function obstacleBetweenKillerAndTarget(game, killer, target, object) {
  if (!object) return false;
  const c = centerOf(object);
  const total = helperDist(null, killer.x, killer.y, target.x, target.y);
  const through = distance(killer.x, killer.y, c.x, c.y) + distance(c.x, c.y, target.x, target.y);
  const corridor = distancePointToSegment(c.x, c.y, killer.x, killer.y, target.x, target.y);
  return through <= total + (game.map?.tile || 32) * 2.5 || corridor <= VOID_OBSTACLE_PATH_WIDTH;
}

function targetOppositeSideOfObject(actor, object, target) {
  if (!object || !target) return false;
  const c = centerOf(object);
  if (object.orientation === "horizontal") {
    return (actor.y < c.y && target.y > c.y) || (actor.y > c.y && target.y < c.y);
  }
  return (actor.x < c.x && target.x > c.x) || (actor.x > c.x && target.x < c.x);
}

function obstacleScore(game, killer, target, object, type, helpers) {
  const c = centerOf(object);
  const d = helperDist(helpers, killer.x, killer.y, c.x, c.y);
  if (d > VOID_OBSTACLE_SEEK_DISTANCE) return -Infinity;
  const lineBlocked = typeof helpers?.segmentClear === "function" ? !helpers.segmentClear(game, killer.x, killer.y, target.x, target.y) : false;
  const between = obstacleBetweenKillerAndTarget(game, killer, target, object);
  const opposite = targetOppositeSideOfObject(killer, object, target);
  const stuckBonus = (ensureVoidBrain(killer).stuckFor || 0) >= STUCK_SAMPLE_SECONDS ? 520 : 0;
  if (!between && !opposite && !lineBlocked && !stuckBonus) return -Infinity;
  return 1200
    + (lineBlocked ? 360 : 0)
    + (between ? 280 : 0)
    + (opposite ? 220 : 0)
    + stuckBonus
    + (type === "pallet" ? 80 : 0)
    - d * 2.2;
}

function choosePostObstaclePoint(game, killer, object, target, helpers) {
  const tile = game.map?.tile || 32;
  const c = centerOf(object);
  let vx = (target?.x ?? killer.x) - c.x;
  let vy = (target?.y ?? killer.y) - c.y;
  let len = Math.hypot(vx, vy);
  if (len < 1) {
    vx = killer.x - c.x;
    vy = killer.y - c.y;
    len = Math.hypot(vx, vy) || 1;
  }
  vx /= len;
  vy /= len;

  const distances = [tile * 3.5, tile * 5.0, tile * 6.6, tile * 2.4];
  const sides = [0, tile * 1.35, -tile * 1.35, tile * 2.5, -tile * 2.5];
  let best = null;
  let bestScore = Infinity;
  for (const forward of distances) {
    for (const side of sides) {
      const px = clamp(c.x + vx * forward + -vy * side, 44, game.map.width - 44);
      const py = clamp(c.y + vy * forward + vx * side, 44, game.map.height - 44);
      if (!actorCanStandAt(game, killer, px, py, helpers)) continue;
      const targetScore = target ? distance(px, py, target.x, target.y) : 0;
      const objectClear = distance(px, py, c.x, c.y);
      const score = targetScore - objectClear * 0.28 + Math.abs(side) * 0.14;
      if (score < bestScore) {
        best = { x: px, y: py };
        bestScore = score;
      }
    }
  }
  return best || { x: clamp(killer.x + vx * tile * 4, 44, game.map.width - 44), y: clamp(killer.y + vy * tile * 4, 44, game.map.height - 44) };
}

function obstacleActionLocked(game, killer, type, object) {
  if (!object) return true;
  const now = game.time || 0;

  for (const other of game.actors?.values?.() || []) {
    if (!other || other === killer) continue;
    if (other.vault?.objectId === object.id && other.vault?.vaultType === (type === "pallet" ? "pallet" : "window")) return true;
    if (type === "pallet" && other.breakTarget === object.id) return true;
  }

  if (type === "window") {
    if (killer.bot?.lastVaultWindowId === object.id && now < Number(killer.bot?.lastVaultWindowUntil || 0)) return true;
  }

  if (type === "pallet") {
    if (!object || object.broken || object.state !== "dropped") return true;
  }

  return false;
}

function obstacleApproachPoint(game, killer, object, helpers, target = null) {
  if (!object) return null;
  const c = centerOf(object);
  const tile = game.map?.tile || 32;
  const gap = Math.max(40, tile * 0.92);
  const raw = object.orientation === "horizontal"
    ? [
        { x: c.x, y: c.y - gap },
        { x: c.x, y: c.y + gap },
        { x: c.x - gap, y: c.y - gap },
        { x: c.x + gap, y: c.y - gap },
        { x: c.x - gap, y: c.y + gap },
        { x: c.x + gap, y: c.y + gap }
      ]
    : [
        { x: c.x - gap, y: c.y },
        { x: c.x + gap, y: c.y },
        { x: c.x - gap, y: c.y - gap },
        { x: c.x - gap, y: c.y + gap },
        { x: c.x + gap, y: c.y - gap },
        { x: c.x + gap, y: c.y + gap }
      ];

  let best = null;
  let bestScore = Infinity;
  for (const point of raw) {
    const px = clamp(point.x, 44, game.map.width - 44);
    const py = clamp(point.y, 44, game.map.height - 44);
    if (!actorCanStandAt(game, killer, px, py, helpers)) continue;
    const route = buildPath(game, killer, px, py, helpers);
    if (!route && distance(killer.x, killer.y, px, py) > gap * 1.3) continue;
    const targetScore = target ? distance(px, py, target.x, target.y) : 0;
    const score = (route?.length || 0) * 46 + distance(killer.x, killer.y, px, py) * 0.45 + targetScore * 0.22;
    if (score < bestScore) {
      bestScore = score;
      best = { x: px, y: py };
    }
  }
  return best;
}

function recentlyUsedObstacle(brain, type, id, now) {
  const recent = brain.recentObstacle;
  if (!recent || !id) return false;
  return recent.type === type && recent.id === id && now <= (recent.until || 0);
}

function rememberObstacleUse(brain, type, id, now) {
  if (!id) return;
  brain.recentObstacle = {
    type,
    id,
    until: now + VOID_OBSTACLE_REUSE_COOLDOWN_SECONDS
  };
}

function obstacleStillValid(game, commit) {
  if (!commit) return false;
  const collection = commit.type === "window" ? game.map?.windows : game.map?.pallets;
  const object = (collection || []).find((o) => o?.id === commit.id) || null;
  if (!object) return null;
  if (commit.type === "pallet" && (object.broken || object.state !== "dropped")) return null;
  return object;
}

function chooseKillerObstacle(game, killer, target, helpers) {
  let best = null;
  let bestScore = -Infinity;
  const brain = ensureVoidBrain(killer);
  const now = game.time || 0;

  for (const win of game.map?.windows || []) {
    if (!win || recentlyUsedObstacle(brain, "window", win.id, now) || obstacleActionLocked(game, killer, "window", win)) continue;
    const score = obstacleScore(game, killer, target, win, "window", helpers);
    if (score > bestScore) {
      best = { type: "window", object: win, score };
      bestScore = score;
    }
  }

  for (const pallet of game.map?.pallets || []) {
    if (!pallet || pallet.broken || pallet.state !== "dropped" || recentlyUsedObstacle(brain, "pallet", pallet.id, now) || obstacleActionLocked(game, killer, "pallet", pallet)) continue;
    const score = obstacleScore(game, killer, target, pallet, "pallet", helpers);
    if (score > bestScore) {
      best = { type: "pallet", object: pallet, score };
      bestScore = score;
    }
  }

  return bestScore > -Infinity ? best : null;
}

function tryUseKillerObstacle(game, killer, target, helpers, dt = 0) {
  const brain = ensureVoidBrain(killer);
  const now = game.time || 0;
  const interactDistance = Number(helpers?.interactDistance || VOID_OBSTACLE_ACTION_DISTANCE);

  if (!target || killer.vault || killer.breakTarget || killer.actionLock > 0 || killer.attackState || killer.hookActionTargetId) return false;

  if (brain.obstacleCommit?.postUntil && now <= brain.obstacleCommit.postUntil) {
    const post = brain.obstacleCommit.postTarget;
    if (post && Number.isFinite(post.x) && Number.isFinite(post.y)) {
      killer.input.action = false;
      killer.input.attack = false;
      killer.input.attackHeld = false;
      killer.input.attackReleased = false;
      setMoveToward(killer, post.x, post.y, true);
      return true;
    }
    return false;
  }

  let choice = null;
  const committedObject = obstacleStillValid(game, brain.obstacleCommit);
  if (committedObject && now <= (brain.obstacleCommit.until || 0)
    && !recentlyUsedObstacle(brain, brain.obstacleCommit.type, brain.obstacleCommit.id, now)
    && !obstacleActionLocked(game, killer, brain.obstacleCommit.type, committedObject)) {
    choice = { type: brain.obstacleCommit.type, object: committedObject };
  }

  if (!choice) {
    choice = chooseKillerObstacle(game, killer, target, helpers);
    if (choice) {
      brain.obstacleCommit = {
        type: choice.type,
        id: choice.object.id || null,
        until: now + VOID_OBSTACLE_COMMIT_SECONDS,
        postUntil: 0
      };
      clearPath(brain);
    }
  }

  if (!choice?.object) return false;

  const c = centerOf(choice.object);
  const d = helperDist(helpers, killer.x, killer.y, c.x, c.y);
  brain.nextStep = { kind: choice.type === "window" ? "vault-window" : "break-pallet", targetId: choice.object.id || null };

  if (obstacleActionLocked(game, killer, choice.type, choice.object)) {
    rememberObstacleUse(brain, choice.type, choice.object.id, now);
    brain.obstacleCommit = null;
    return false;
  }

  if (d <= interactDistance * 0.94) {
    freezeActorInput(killer, c);
    killer.input.action = true;
    killer.input.sprint = false;
    killer.input.attackHeld = false;
    killer.input.attackReleased = false;
    killer.input.attack = false;
    brain.obstacleCommit = {
      type: choice.type,
      id: choice.object.id || null,
      until: now + VOID_OBSTACLE_ACTION_LOCK_SECONDS,
      postUntil: now + 0.35,
      postTarget: choosePostObstaclePoint(game, killer, choice.object, target, helpers)
    };
    brain.stuckFor = 0;
    clearPath(brain);
    return true;
  }

  killer.input.action = false;
  killer.input.attackHeld = false;
  killer.input.attackReleased = false;
  killer.input.attack = false;

  if (d <= interactDistance + VOID_OBSTACLE_ACTION_BUFFER) {
    setMoveToward(killer, c.x, c.y, true);
    return true;
  }

  const approach = obstacleApproachPoint(game, killer, choice.object, helpers, target);
  const pathTarget = approach || c;
  followPath(game, killer, pathTarget, helpers, {
    sprint: true,
    stopDistance: Math.max(14, interactDistance * 0.38),
    dt
  });
  return true;
}

function hookDownedRunner(game, killer, target, helpers, dt) {
  const brain = ensureVoidBrain(killer);
  brain.holdingKick = false;
  brain.nextStep = { kind: "hook-or-execute-downed-runner", targetId: target.id };
  const now = game.time || 0;
  const d = helperDist(helpers, killer.x, killer.y, target.x, target.y);
  const hookDistance = Number(helpers?.hookInteractDistance || VOID_HOOK_DISTANCE);
  const clear = typeof helpers?.segmentClear !== "function" || helpers.segmentClear(game, killer.x, killer.y, target.x, target.y);

  if (brain.hookCommitTargetId === target.id && now <= (brain.hookCommitUntil || 0) && d <= hookDistance + 28 && clear) {
    holdRepair(killer, target);
    brain.stuckFor = 0;
    return true;
  }

  if (d <= hookDistance && clear) {
    brain.hookCommitTargetId = target.id;
    brain.hookCommitUntil = now + VOID_HOOK_COMMIT_SECONDS;
    holdRepair(killer, target);
    brain.stuckFor = 0;
    return true;
  }

  killer.input.repair = false;
  if (tryUseKillerObstacle(game, killer, target, helpers, dt)) return true;
  followPath(game, killer, target, helpers, {
    sprint: true,
    stopDistance: Math.max(20, hookDistance * 0.62),
    dt
  });
  return true;
}

function continueHookCommit(game, killer, helpers) {
  const brain = ensureVoidBrain(killer);
  const target = getActorById(game, killer.hookActionTargetId || brain.hookCommitTargetId);
  if (!target || target.dead || target.escaped || target.hooked || !target.downed || target.health > 0) {
    brain.hookCommitTargetId = null;
    brain.hookCommitUntil = 0;
    return false;
  }
  const hookDistance = Number(helpers?.hookInteractDistance || VOID_HOOK_DISTANCE);
  const d = helperDist(helpers, killer.x, killer.y, target.x, target.y);
  const clear = typeof helpers?.segmentClear !== "function" || helpers.segmentClear(game, killer.x, killer.y, target.x, target.y);
  if (d > hookDistance + 34 || !clear) return false;
  brain.hookCommitTargetId = target.id;
  brain.hookCommitUntil = Math.max(brain.hookCommitUntil || 0, (game.time || 0) + 0.35);
  holdRepair(killer, target);
  return true;
}

function clearHuntMemory(actor) {
  const brain = ensureVoidBrain(actor);
  brain.huntTargetId = null;
  brain.lastKnownRunner = null;
  brain.huntLockUntil = 0;
  brain.lungeCommitTargetId = null;
  brain.lungeCommitUntil = 0;
  brain.obstacleCommit = null;
  brain.nextStep = null;
  clearPath(brain);
}

function chaseLastKnownRunner(game, killer, target, helpers, dt) {
  const brain = ensureVoidBrain(killer);
  const now = game.time || 0;
  const last = brain.lastKnownRunner && brain.lastKnownRunner.id === target.id ? brain.lastKnownRunner : null;

  if (!last || now > Number(last.until || 0)) {
    clearHuntMemory(killer);
    return false;
  }

  const reachedLastKnown = helperDist(helpers, killer.x, killer.y, last.x, last.y) <= VOID_LAST_KNOWN_REACHED_DISTANCE;
  if (reachedLastKnown) {
    clearHuntMemory(killer);
    return false;
  }

  brain.holdingKick = false;
  brain.huntTargetId = target.id;
  brain.nextStep = { kind: "hunt-last-known", targetId: target.id };
  killer.input.action = false;
  killer.input.repair = false;
  clearAttackInputs(killer);

  const oldReplan = brain.repathIn;
  brain.repathIn = Math.min(oldReplan || 0, VOID_CHASE_REPATH_SECONDS);
  followPath(game, killer, { x: last.x, y: last.y }, helpers, {
    sprint: true,
    stopDistance: VOID_LAST_KNOWN_REACHED_DISTANCE,
    pathTargetKey: `lastKnown:${target.id}:${Math.round(last.x / 32)},${Math.round(last.y / 32)}`,
    repathTargetMoveDistance: VOID_CHASE_TARGET_REPATH_DISTANCE,
    repathSeconds: VOID_CHASE_REPATH_SECONDS,
    dt
  });
  return true;
}

function chaseRunner(game, killer, target, helpers, dt) {
  const brain = ensureVoidBrain(killer);
  const sensed = canSenseRunner(game, killer, target, helpers);

  if (!sensed) {
    return chaseLastKnownRunner(game, killer, target, helpers, dt);
  }

  rememberHuntTarget(game, brain, target);
  brain.holdingKick = false;
  brain.nextStep = { kind: "hunt-runner", targetId: target.id };

  if (tryVoidAttack(game, killer, target, helpers, dt)) return true;

  if (tryUseKillerObstacle(game, killer, target, helpers, dt)) return true;

  const oldReplan = brain.repathIn;
  brain.repathIn = Math.min(oldReplan || 0, VOID_CHASE_REPATH_SECONDS);
  followPath(game, killer, target, helpers, {
    sprint: true,
    stopDistance: Math.max(18, Number(helpers?.quickAttackRange || VOID_ATTACK_QUICK_RANGE) * 0.48),
    pathTargetKey: `chase:${target.id}`,
    repathTargetMoveDistance: VOID_CHASE_TARGET_REPATH_DISTANCE,
    repathSeconds: VOID_CHASE_REPATH_SECONDS,
    dt
  });
  return true;
}

function runVoidHuntAi(game, actor, helpers = {}, dt = 0) {
  const brain = ensureVoidBrain(actor);
  brain.aiNow = game.time || 0;
  if (actor.dead || actor.escaped || (actor.voidStun || 0) > 0) return false;

  if (actor.hookActionTargetId || brain.hookCommitTargetId) {
    if (continueHookCommit(game, actor, helpers)) return true;
  }

  if (actor.vault || actor.breakTarget || actor.actionLock > 0) {
    freezeActorInput(actor, null);
    actor.input.attackHeld = false;
    actor.input.attackReleased = false;
    actor.input.attack = false;
    actor.input.repair = false;
    return true;
  }

  const downed = chooseDownedTarget(game, actor, helpers);
  if (downed) {
    clearObjectiveTaskOnly(actor);
    return hookDownedRunner(game, actor, downed, helpers, dt);
  }

  const target = chooseHuntTarget(game, actor, helpers, brain);
  if (target) {
    clearObjectiveTaskOnly(actor);
    return chaseRunner(game, actor, target, helpers, dt);
  }

  if (brain.huntTargetId && (!brain.lastKnownRunner || (game.time || 0) > brain.lastKnownRunner.until)) {
    brain.huntTargetId = null;
    brain.lastKnownRunner = null;
  }
  return false;
}

function chooseExitPatrolGate(game, killer, helpers) {
  const gates = (game?.map?.gates || []).filter((gate) => gate && gate.open);
  if (!gates.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const gate of gates) {
    const d = helperDist(helpers, killer.x, killer.y, gate.x, gate.y);
    let runnerNear = 0;
    let escapePressure = 0;
    for (const runner of livingRunners(game)) {
      const rd = distance(runner.x, runner.y, gate.x, gate.y);
      if (rd < 520) runnerNear += 1 - rd / 520;
      if (runner.escapeGateId === gate.id) escapePressure += 2 + Math.max(0, Number(runner.escapeProgress || 0)) * 3;
    }
    const score = 1200 + runnerNear * 520 + escapePressure * 420 - d * 0.72;
    if (score > bestScore) {
      best = gate;
      bestScore = score;
    }
  }
  return best;
}

function patrolExitGates(game, actor, helpers, dt) {
  const brain = ensureVoidBrain(actor);
  const gate = chooseExitPatrolGate(game, actor, helpers);
  if (!gate) {
    stopAndFace(actor, null);
    return true;
  }
  brain.task = { kind: "exitPatrol", id: gate.id, x: gate.x, y: gate.y };
  brain.nextStep = { kind: "patrol-open-exit", targetId: gate.id };
  brain.repathIn = Math.min(brain.repathIn || 0, VOID_EXIT_PATROL_REPATH_SECONDS);
  followPath(game, actor, gate, helpers, {
    sprint: true,
    stopDistance: Math.max(24, DEFAULT_RIFT_KICK_DISTANCE * 0.7),
    dt
  });
  actor.input.action = false;
  actor.input.repair = false;
  actor.input.attack = false;
  actor.input.attackHeld = false;
  actor.input.attackReleased = false;
  if (!(actor.input.up || actor.input.down || actor.input.left || actor.input.right)) {
    setMoveToward(actor, gate.x, gate.y, true);
  }
  return true;
}

function runVoidRiftAi(game, actor, helpers = {}, dt = 0) {
  const brain = ensureVoidBrain(actor);
  brain.aiNow = game.time || 0;
  brain.holdingKick = false;
  actor.input.repair = false;

  if (actor.dead || actor.escaped) {
    clearTask(actor);
    stopAndFace(actor, null);
    return;
  }

  if (runVoidHuntAi(game, actor, helpers, dt)) return;

  if (game.escapeOpen) {
    clearTask(actor);
    patrolExitGates(game, actor, helpers, dt);
    return;
  }

  if (!unfinishedRifts(game).length) {
    clearTask(actor);
    stopAndFace(actor, null);
    return;
  }

  if (isBusy(actor)) {
    stopAndFace(actor, null);
    return;
  }

  if (!taskStillValid(game, brain.task)) {
    clearTask(actor);
  }

  if (!brain.task) {
    const kickable = chooseBestKickableRift(game, actor, helpers);
    if (kickable) setTask(game, actor, helpers, "kick", kickable);
    else {
      const check = chooseCheckRift(game, actor, helpers, brain);
      if (check) setTask(game, actor, helpers, "check", check);
    }
  }

  const task = brain.task;
  const rift = resolveTaskTarget(game, task);
  if (!task || !rift) {
    stopAndFace(actor, null);
    return;
  }

  if (task.kind === "kick") {
    kickRift(game, actor, rift, helpers, dt);
    return;
  }

  if (task.kind === "check") {
    checkRift(game, actor, rift, helpers, dt);
    return;
  }

  clearTask(actor);
  stopAndFace(actor, null);
}

module.exports = {
  runVoidRiftAi,
  ensureVoidBrain
};
