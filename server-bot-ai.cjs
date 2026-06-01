"use strict";

const { buildPathWithPathfinding } = require("./server-pathing.cjs");

const voidAi = require("./server-void-ai.cjs");

const PERSONALITY_ID = "orb-runner";
const PERSONALITY_LABEL = "Orb Runner";
const PATH_REPLAN_SECONDS = 0.38;
const STUCK_SAMPLE_SECONDS = 0.42;
const STUCK_REPATH_DISTANCE = 5.5;
const STUCK_CLEAR_SECONDS = 1.25;
const STUCK_ESCAPE_SECONDS = 0.9;
const WAYPOINT_REACHED_DISTANCE = 24;
const PATHFIND_LOOP_LIMIT = 2600;
const DEPOSIT_AFTER_ORBS = 6;
const NEAR_RIFT_DEPOSIT_MULT = 2.15;
const ORB_CANDIDATE_LIMIT = 18;

const RUNNER_THREAT_RADIUS = 660;
const RUNNER_DANGER_RADIUS = 340;
const RUNNER_SAFE_DISTANCE = 780;
const RUNNER_FLEE_LOCK_SECONDS = 2.45;
const RUNNER_FLEE_REPLAN_SECONDS = 1.25;
const RUNNER_INTERACT_DISTANCE = 74;
const RUNNER_PALLET_DROP_KILLER_RADIUS = 138;
const RUNNER_PALLET_DROP_PANIC_RADIUS = 230;
const RUNNER_SAFE_OBJECT_RADIUS = 760;
const RUNNER_SAFE_SAMPLE_RINGS = [220, 340, 470, 610];
const RUNNER_SAFE_SAMPLE_STEPS = 20;
const RUNNER_HOOK_RESCUE_DISTANCE = 108;
const RUNNER_HOOK_TARGET_RADIUS = 1180;
const RUNNER_HOOK_KILLER_CAMP_DISTANCE = 315;
const RUNNER_UNHOOK_COMMIT_SECONDS = 3.2;
const RUNNER_HEAL_DISTANCE = 82;
const RUNNER_HEAL_TARGET_RADIUS = 860;
const RUNNER_HEAL_KILLER_UNSAFE_DISTANCE = 430;
const RUNNER_HEAL_COMMIT_SECONDS = 4.8;
const RUNNER_HEALER_NEAR_DISTANCE = 150;
const RUNNER_POST_INTERACT_SECONDS = 1.65;
const RUNNER_INTERACT_REUSE_COOLDOWN_SECONDS = 3.2;

function isFinitePoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

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

function setMoveToward(actor, tx, ty, sprint = true) {
  const dx = tx - actor.x;
  const dy = ty - actor.y;
  actor.input.left = dx < -8;
  actor.input.right = dx > 8;
  actor.input.up = dy < -8;
  actor.input.down = dy > 8;
  actor.input.sprint = !!sprint;
  actor.input.angle = Math.atan2(dy, dx);
}

function stopAndFace(actor, target) {
  actor.input.left = false;
  actor.input.right = false;
  actor.input.up = false;
  actor.input.down = false;
  actor.input.sprint = false;
  if (target) actor.input.angle = Math.atan2(target.y - actor.y, target.x - actor.x);
}

function ensureBotBrain(actor) {
  actor.bot = actor.bot || {};
  actor.bot.simpleAi = actor.bot.simpleAi || {
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
    recentInteract: null
  };

  actor.bot.personalityId = PERSONALITY_ID;
  actor.bot.personality = PERSONALITY_ID;
  actor.bot.personalityLabel = PERSONALITY_LABEL;
  return actor.bot.simpleAi;
}

function assignRunnerBotPersonalities(game) {
  if (!game?.actors) return;
  for (const actor of game.actors.values()) {
    if (!actor?.isBot || actor.role !== "survivor") continue;
    const brain = ensureBotBrain(actor);
    brain.personalityId = PERSONALITY_ID;
    brain.personalityLabel = PERSONALITY_LABEL;
    actor.bot.personalityId = PERSONALITY_ID;
    actor.bot.personality = PERSONALITY_ID;
    actor.bot.personalityLabel = PERSONALITY_LABEL;
  }
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

function findNearestStandableTile(game, actor, targetX, targetY, helpers) {
  const target = tileAt(game, targetX, targetY);
  const center = tileCenter(game, target.x, target.y);
  if (actorCanStandAt(game, actor, center.x, center.y, helpers)) return target;

  const maxRadius = 7;
  let best = null;
  let bestD = Infinity;
  for (let r = 1; r <= maxRadius; r++) {
    for (let y = target.y - r; y <= target.y + r; y++) {
      for (let x = target.x - r; x <= target.x + r; x++) {
        if (x < 0 || y < 0 || x >= game.map.cols || y >= game.map.rows) continue;
        if (Math.abs(x - target.x) !== r && Math.abs(y - target.y) !== r) continue;
        const c = tileCenter(game, x, y);
        if (!actorCanStandAt(game, actor, c.x, c.y, helpers)) continue;
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

function isTileBlocked(game, actor, tx, ty, helpers) {
  if (tx < 0 || ty < 0 || tx >= game.map.cols || ty >= game.map.rows) return true;
  const c = tileCenter(game, tx, ty);
  return !actorCanStandAt(game, actor, c.x, c.y, helpers);
}

function buildPath(game, actor, targetX, targetY, helpers) {
  const packagePath = buildPathWithPathfinding(game, actor, targetX, targetY, helpers, {
    isTileBlocked,
    actorCanStandAt,
    tileAt,
    tileCenter,
    findNearestStandableTile,
    distance
  });
  if (packagePath.length) return packagePath;

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
  brain.repathIn = 0;
}

function fallbackMoveToward(game, actor, target, helpers, options = {}) {
  const brain = ensureBotBrain(actor);
  const tile = game.map?.tile || 32;
  const now = options.now ?? 0;
  const baseAngle = Math.atan2(target.y - actor.y, target.x - actor.x);
  const probeDistance = Math.max(tile * 0.95, 38);

  if (!brain.escapeSteer || now > (brain.escapeSteer.until || 0)) {
    brain.escapeSteer = {
      until: now + STUCK_ESCAPE_SECONDS,
      side: Math.random() < 0.5 ? -1 : 1
    };
  }

  const side = brain.escapeSteer.side || 1;
  const angles = [
    0,
    side * Math.PI / 4,
    -side * Math.PI / 4,
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
    const direct = helperDist(helpers, px, py, target.x, target.y);
    const clearBonus = lineClear(game, actor, px, py, helpers) ? -80 : 0;
    const score = direct + Math.abs(offset) * 38 + clearBonus;
    if (score < bestScore) {
      best = { x: px, y: py };
      bestScore = score;
    }
  }

  const moveTarget = best || target;
  setMoveToward(actor, moveTarget.x, moveTarget.y, !!options.sprint);
}

function followPath(game, actor, target, helpers, options = {}) {
  const brain = ensureBotBrain(actor);
  const stopDistance = Math.max(8, options.stopDistance || 18);
  const targetKeyValue = `${Math.round(target.x)},${Math.round(target.y)}:${Math.round(stopDistance)}`;
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
    || (brain.stuckFor || 0) >= STUCK_SAMPLE_SECONDS;

  if (mustRepath) {
    brain.path = buildPath(game, actor, target.x, target.y, helpers);
    brain.pathTargetKey = targetKeyValue;
    brain.repathIn = PATH_REPLAN_SECONDS + Math.random() * 0.18;
    if ((brain.stuckFor || 0) >= STUCK_SAMPLE_SECONDS) brain.stuckFor = Math.max(0, (brain.stuckFor || 0) - STUCK_SAMPLE_SECONDS);
  }

  if (!brain.path?.length) {
    // No path does not mean no movement. It usually means the current target sits near
    // awkward collision, so first try the local interactable that is probably blocking us.
    if (tryUseNearbyTraversalObject(game, actor, target, helpers, { ...options, force: true })) return false;
    fallbackMoveToward(game, actor, target, helpers, { ...options, now: game.time || 0 });
    return false;
  }

  const waypointReach = Math.max(WAYPOINT_REACHED_DISTANCE, (game.map.tile || 32) * ((brain.stuckFor || 0) > 0 ? 0.82 : 0.58));
  while (brain.path.length > 1 && helperDist(helpers, actor.x, actor.y, brain.path[0].x, brain.path[0].y) < waypointReach) {
    brain.path.shift();
  }

  const allowWaypointSkip = (brain.stuckFor || 0) <= 0.01;
  while (allowWaypointSkip && brain.path.length > 2) {
    const skip = brain.path[2];
    const skipDistance = helperDist(helpers, actor.x, actor.y, skip.x, skip.y);
    if (skipDistance > (game.map.tile || 32) * 2.4 || !lineClear(game, actor, skip.x, skip.y, helpers)) break;
    brain.path.shift();
  }

  const next = brain.path[0];
  if ((brain.stuckFor || 0) >= STUCK_SAMPLE_SECONDS && tryUseNearbyTraversalObject(game, actor, target, helpers, { ...options, force: true })) {
    return false;
  }
  setMoveToward(actor, next.x, next.y, !!options.sprint);

  if ((brain.stuckFor || 0) >= STUCK_CLEAR_SECONDS) {
    clearPath(brain);
    brain.stuckFor = STUCK_SAMPLE_SECONDS;
    if (tryUseNearbyTraversalObject(game, actor, target, helpers, { ...options, force: true })) return false;
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

function getOrbById(game, id) {
  return (game?.collectibleDots || []).find((dot) => dot?.id === id) || null;
}

function chooseBestRift(game, actor, helpers, fromPoint = actor) {
  const carried = Math.max(0, Math.floor(actor?.dots || 0));
  const dotsPerRift = Math.max(1, Number(helpers?.dotsPerRift || 30));
  let best = null;
  let bestScore = -Infinity;

  for (const rift of unfinishedRifts(game)) {
    const d = distance(fromPoint.x, fromPoint.y, rift.x, rift.y);
    const progress = riftProgress(rift);
    const canFinish = progress + carried / dotsPerRift >= 1;
    const activeDepositBonus = rift.dotDepositing ? 140 : 0;
    const score = progress * 1800 + (canFinish ? 420 : 0) + activeDepositBonus - d * 0.42;
    if (score > bestScore) {
      best = rift;
      bestScore = score;
    }
  }

  return best;
}

function chooseNearbyRift(game, actor, helpers) {
  const depositDistance = Number(helpers?.dotDepositDistance || 96);
  const nearbyDistance = depositDistance * NEAR_RIFT_DEPOSIT_MULT;
  let best = null;
  let bestScore = -Infinity;
  for (const rift of unfinishedRifts(game)) {
    const d = helperDist(helpers, actor.x, actor.y, rift.x, rift.y);
    if (d > nearbyDistance) continue;
    const score = riftProgress(rift) * 1200 - d;
    if (score > bestScore) {
      best = rift;
      bestScore = score;
    }
  }
  return best;
}

function chooseOrb(game, actor, helpers) {
  const dots = (game?.collectibleDots || []).filter(Boolean);
  if (!dots.length) return null;

  const shortlist = dots
    .map((dot) => ({ dot, d: helperDist(helpers, actor.x, actor.y, dot.x, dot.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.min(ORB_CANDIDATE_LIMIT, dots.length));

  let best = null;
  let bestScore = Infinity;
  for (const item of shortlist) {
    const nextRift = chooseBestRift(game, actor, helpers, item.dot);
    const riftDistance = nextRift ? distance(item.dot.x, item.dot.y, nextRift.x, nextRift.y) : 0;
    const progressPull = nextRift ? riftProgress(nextRift) * 260 : 0;
    const score = item.d + riftDistance * 0.22 - progressPull;
    if (score < bestScore) {
      best = item.dot;
      bestScore = score;
    }
  }
  return best;
}

function makeTask(kind, target, game, actor, helpers) {
  const now = game.time || 0;
  const task = {
    kind,
    id: target?.id || null,
    x: target?.x || 0,
    y: target?.y || 0,
    committedAt: now,
    nextKind: null,
    nextId: null
  };

  if (kind === "orb") {
    const nextRift = chooseBestRift(game, actor, helpers, target);
    task.nextKind = nextRift ? "deposit" : null;
    task.nextId = nextRift?.id || null;
  } else if (kind === "deposit") {
    const nextOrb = chooseOrb(game, actor, helpers);
    task.nextKind = nextOrb ? "orb" : null;
    task.nextId = nextOrb?.id || null;
  }

  return task;
}

function setTask(game, actor, helpers, kind, target) {
  const brain = ensureBotBrain(actor);
  const old = brain.task;
  const same = old && old.kind === kind && old.id === (target?.id || null);
  if (same) return old;
  brain.task = makeTask(kind, target, game, actor, helpers);
  clearPath(brain);
  return brain.task;
}

function clearTask(actor) {
  const brain = ensureBotBrain(actor);
  brain.task = null;
  brain.nextStep = null;
  clearPath(brain);
}

function resolveTaskTarget(game, task) {
  if (!task) return null;
  if (task.kind === "orb") return getOrbById(game, task.id);
  if (task.kind === "deposit") return getRiftById(game, task.id);
  return null;
}

function taskStillValid(game, actor, task, helpers) {
  if (!task) return false;
  const target = resolveTaskTarget(game, task);
  if (!target) return false;
  if (task.kind === "orb") {
    if ((actor.dots || 0) >= Number(helpers?.survivorDotMax || 30)) return false;
    return (game.collectibleDots || []).some((dot) => dot.id === target.id);
  }
  if (task.kind === "deposit") {
    return (actor.dots || 0) > 0 && !target.done;
  }
  return false;
}

function shouldDepositNow(game, actor, helpers) {
  const carried = Math.max(0, Math.floor(actor.dots || 0));
  if (carried <= 0) return false;
  if (carried >= Number(helpers?.survivorDotMax || 30)) return true;
  if (carried >= DEPOSIT_AFTER_ORBS) return true;
  if (!(game.collectibleDots || []).length) return true;
  return !!chooseNearbyRift(game, actor, helpers);
}

function depositAtRift(game, actor, rift, helpers, dt) {
  const depositDistance = Number(helpers?.dotDepositDistance || 96);
  const d = helperDist(helpers, actor.x, actor.y, rift.x, rift.y);
  actor.bot.simpleAi.nextStep = { kind: "deposit-until-empty", targetId: rift.id };

  if (d <= depositDistance && lineClear(game, actor, rift.x, rift.y, helpers)) {
    stopAndFace(actor, rift);
    actor.bot.simpleAi.stuckFor = 0;
    return;
  }

  followPath(game, actor, rift, helpers, {
    sprint: true,
    stopDistance: Math.max(18, depositDistance * 0.62),
    dt
  });
}

function collectOrb(game, actor, orb, helpers, dt) {
  const pickupRadius = Number(helpers?.survivorPickupRadius || 48);
  actor.bot.simpleAi.nextStep = { kind: "collect-then-deposit", targetId: orb.id };
  followPath(game, actor, orb, helpers, {
    sprint: true,
    stopDistance: Math.max(12, pickupRadius * 0.35),
    dt
  });
}


function centerOf(rect) {
  return {
    x: (rect?.x || 0) + (rect?.w || 0) / 2,
    y: (rect?.y || 0) + (rect?.h || 0) / 2
  };
}

function pointRectDistance(px, py, rect) {
  if (!rect) return Infinity;
  const closestX = clamp(px, rect.x, rect.x + rect.w);
  const closestY = clamp(py, rect.y, rect.y + rect.h);
  return distance(px, py, closestX, closestY);
}

function getLivingKiller(game) {
  if (!game?.actors) return null;
  return [...game.actors.values()].find((p) => p?.role === "killer" && !p.dead && !p.escaped) || null;
}

function actorMoveVector(actor) {
  const dx = (actor?.input?.right ? 1 : 0) - (actor?.input?.left ? 1 : 0);
  const dy = (actor?.input?.down ? 1 : 0) - (actor?.input?.up ? 1 : 0);
  const len = Math.hypot(dx, dy);
  return len > 0.001 ? { x: dx / len, y: dy / len } : { x: Math.cos(actor?.angle || 0), y: Math.sin(actor?.angle || 0) };
}

function isFacingPoint(actor, x, y, minDot = 0.48) {
  const ax = Math.cos(actor?.angle || 0);
  const ay = Math.sin(actor?.angle || 0);
  const dx = x - actor.x;
  const dy = y - actor.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return true;
  return (ax * (dx / len) + ay * (dy / len)) >= minDot;
}

function killerIsActivelyTargetingRunner(game, killer, actor, d, los) {
  const voidBrain = killer?.bot?.voidRiftAi;
  const now = game?.time || 0;
  if (voidBrain?.huntTargetId === actor.id) return true;
  if (voidBrain?.lastKnownRunner?.id === actor.id && now <= (voidBrain.lastKnownRunner.until || 0)) return true;
  if ((killer.attackState === "charging" || killer.attackState === "lunge" || killer.input?.attackHeld) && los && d <= RUNNER_THREAT_RADIUS && isFacingPoint(killer, actor.x, actor.y, 0.36)) return true;
  if ((actor.chaseHold || 0) > 0 || (actor.killerVisibleHold || 0) > 0) return true;

  const mv = actorMoveVector(killer);
  const toRunnerX = actor.x - killer.x;
  const toRunnerY = actor.y - killer.y;
  const len = Math.hypot(toRunnerX, toRunnerY) || 1;
  const movingToward = (mv.x * (toRunnerX / len) + mv.y * (toRunnerY / len)) > 0.56;
  if (los && d <= RUNNER_THREAT_RADIUS && movingToward && isFacingPoint(killer, actor.x, actor.y, 0.22)) return true;
  return false;
}

function survivorThreatInfo(game, actor, helpers) {
  const killer = getLivingKiller(game);
  if (!killer) return null;
  const d = helperDist(helpers, actor.x, actor.y, killer.x, killer.y);
  const los = typeof helpers?.segmentClear === "function" ? helpers.segmentClear(game, actor.x, actor.y, killer.x, killer.y) : true;

  // The terror radius only wakes them up; actual fleeing requires killer intent.
  // This prevents the old "hover at the radius edge" bug.
  const activelyTargeted = killerIsActivelyTargetingRunner(game, killer, actor, d, los);
  const immediateDanger = los && d <= RUNNER_DANGER_RADIUS * 0.72;
  const threatened = activelyTargeted || immediateDanger;
  const panic = immediateDanger || (activelyTargeted && d <= RUNNER_DANGER_RADIUS);
  return { killer, distance: d, los, chase: activelyTargeted, threatened, panic };
}

function ensureSurvivalBrain(actor) {
  const brain = ensureBotBrain(actor);
  brain.survivalTask = brain.survivalTask || null;
  brain.threatUntil = brain.threatUntil || 0;
  brain.safeAfter = brain.safeAfter || 0;
  brain.unhookTask = brain.unhookTask || null;
  brain.healTask = brain.healTask || null;
  return brain;
}

function sameTargetTask(task, kind, id) {
  return !!task && task.kind === kind && task.id === (id || null);
}

function recentlyUsedSurvivalObject(actor, kind, id, now) {
  const recent = ensureSurvivalBrain(actor).recentInteract;
  if (!recent || !id) return false;
  if (recent.id !== id) return false;
  if (recent.kind !== kind && !(recent.kind === "palletDrop" && kind === "palletVault")) return false;
  return now <= (recent.until || 0);
}

function rememberSurvivalInteract(actor, kind, id, now) {
  if (!id) return;
  const brain = ensureSurvivalBrain(actor);
  brain.recentInteract = {
    kind,
    id,
    until: now + RUNNER_INTERACT_REUSE_COOLDOWN_SECONDS
  };
}

function tryUseNearbyTraversalObject(game, actor, target, helpers, options = {}) {
  if (!game?.map || !target || actor.vault || actor.actionLock > 0) return false;
  const brain = ensureSurvivalBrain(actor);
  const now = game.time || 0;
  const interactDistance = RUNNER_INTERACT_DISTANCE + (options.force ? 26 : 8);

  if (now <= (brain.traversalPostUntil || 0)) return false;

  let best = null;
  let bestScore = Infinity;
  const blockedToTarget = typeof helpers?.segmentClear === "function"
    ? !helpers.segmentClear(game, actor.x, actor.y, target.x, target.y)
    : false;

  const consider = (object, kind) => {
    if (!object?.id || recentlyUsedSurvivalObject(actor, kind, object.id, now)) return;
    const c = centerOf(object);
    const d = helperDist(helpers, actor.x, actor.y, c.x, c.y);
    if (d > interactDistance) return;
    const targetRectD = pointRectDistance(target.x, target.y, object);
    const lineToObjectClear = typeof helpers?.segmentClear !== "function" || helpers.segmentClear(game, actor.x, actor.y, c.x, c.y);
    if (!lineToObjectClear && !options.force) return;
    const score = d + targetRectD * 0.12 + (blockedToTarget ? -180 : 60);
    if (score < bestScore) {
      best = { object, kind, center: c };
      bestScore = score;
    }
  };

  for (const win of game.map.windows || []) consider(win, "windowVault");
  for (const pallet of game.map.pallets || []) {
    if (!pallet || pallet.broken || pallet.state !== "dropped") continue;
    consider(pallet, "palletVault");
  }

  if (!best) return false;

  stopAndFace(actor, best.center);
  actor.input.action = true;
  actor.input.sprint = false;
  rememberSurvivalInteract(actor, best.kind, best.object.id, now);
  brain.traversalPostUntil = now + RUNNER_POST_INTERACT_SECONDS;
  brain.stuckFor = 0;
  clearPath(brain);
  return true;
}

function postInteractSafePoint(game, actor, killer, task, helpers) {
  if (Number.isFinite(task?.exitX) && Number.isFinite(task?.exitY)) {
    return { x: task.exitX, y: task.exitY };
  }
  const point = chooseRawSafePoint(game, actor, killer, helpers);
  task.exitX = point.x;
  task.exitY = point.y;
  return point;
}

function setSurvivalTask(game, actor, kind, target, extra = {}) {
  const brain = ensureSurvivalBrain(actor);
  const id = target?.id || null;
  if (sameTargetTask(brain.survivalTask, kind, id)) return brain.survivalTask;
  brain.survivalTask = {
    kind,
    id,
    x: target?.x || 0,
    y: target?.y || 0,
    committedAt: game.time || 0,
    lockUntil: (game.time || 0) + RUNNER_FLEE_REPLAN_SECONDS,
    ...extra
  };
  clearPath(brain);
  return brain.survivalTask;
}

function clearSurvivalTask(actor) {
  const brain = ensureSurvivalBrain(actor);
  brain.survivalTask = null;
  clearPath(brain);
}

function clearUnhookTask(actor) {
  const brain = ensureSurvivalBrain(actor);
  brain.unhookTask = null;
  clearPath(brain);
}

function clearHealTask(actor) {
  const brain = ensureSurvivalBrain(actor);
  brain.healTask = null;
  clearPath(brain);
}

function isRunnerWounded(actor) {
  return !!(
    actor
    && actor.role === "survivor"
    && !actor.dead
    && !actor.escaped
    && !actor.hooked
    && ((actor.downed && actor.health <= 0) || (actor.health === 1 && actor.injured))
  );
}

function isSafeForHeal(game, actor, helpers, target = actor) {
  const killer = getLivingKiller(game);
  if (!killer) return true;
  const actorThreat = survivorThreatInfo(game, actor, helpers);
  if (actorThreat?.panic || actorThreat?.chase) return false;
  const actorD = helperDist(helpers, actor.x, actor.y, killer.x, killer.y);
  const targetD = helperDist(helpers, target.x, target.y, killer.x, killer.y);
  const unsafeDistance = Number(helpers?.healKillerUnsafeDistance || RUNNER_HEAL_KILLER_UNSAFE_DISTANCE);
  return actorD >= unsafeDistance && targetD >= unsafeDistance;
}

function chooseHealTarget(game, actor, helpers) {
  if (!isSafeForHeal(game, actor, helpers)) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const target of game?.actors?.values?.() || []) {
    if (!target || target.id === actor.id || !isRunnerWounded(target)) continue;
    if (!isSafeForHeal(game, actor, helpers, target)) continue;
    const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
    if (d > RUNNER_HEAL_TARGET_RADIUS) continue;
    const progressBonus = (target.healProgress || 0) * 1100;
    const downedBonus = target.downed ? 520 : 0;
    const injuredBonus = target.injured ? 180 : 0;
    const score = 1500 + progressBonus + downedBonus + injuredBonus - d * 0.72;
    if (score > bestScore) {
      best = target;
      bestScore = score;
    }
  }
  return best;
}

function nearbyHealerForMe(game, actor, helpers) {
  if (!isRunnerWounded(actor) || actor.downed || !isSafeForHeal(game, actor, helpers)) return null;
  for (const other of game?.actors?.values?.() || []) {
    if (!other || other.id === actor.id || other.role !== "survivor" || other.dead || other.escaped || other.hooked || other.downed) continue;
    if (!isSafeForHeal(game, other, helpers, actor)) continue;
    const d = helperDist(helpers, actor.x, actor.y, other.x, other.y);
    if (d <= RUNNER_HEALER_NEAR_DISTANCE && (typeof helpers?.segmentClear !== "function" || helpers.segmentClear(game, actor.x, actor.y, other.x, other.y))) {
      return other;
    }
  }
  return null;
}

function runSurvivorWaitForHeal(game, actor, helpers) {
  const healer = nearbyHealerForMe(game, actor, helpers);
  if (!healer) return false;
  actor.bot.simpleAi.nextStep = { kind: "receive-heal", targetId: healer.id };
  stopAndFace(actor, healer);
  actor.input.action = false;
  actor.input.repair = false;
  actor.input.sprint = false;
  clearPath(ensureBotBrain(actor));
  return true;
}

function runSurvivorHeal(game, actor, helpers, dt) {
  const brain = ensureSurvivalBrain(actor);
  const now = game.time || 0;
  if (actor.downed || actor.hooked || !isSafeForHeal(game, actor, helpers)) {
    clearHealTask(actor);
    return false;
  }

  let target = brain.healTask?.id ? [...(game?.actors?.values?.() || [])].find((p) => p?.id === brain.healTask.id) : null;
  if (!target || !isRunnerWounded(target) || !isSafeForHeal(game, actor, helpers, target) || now > (brain.healTask?.commitUntil || 0)) {
    target = chooseHealTarget(game, actor, helpers);
    if (target) {
      brain.healTask = { id: target.id, x: target.x, y: target.y, commitUntil: now + RUNNER_HEAL_COMMIT_SECONDS };
      clearPath(brain);
    } else {
      clearHealTask(actor);
      return false;
    }
  }

  const healDistance = Number(helpers?.healDistance || RUNNER_HEAL_DISTANCE);
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
  actor.bot.simpleAi.nextStep = { kind: "heal-teammate", targetId: target.id };

  if (d <= healDistance && lineClear(game, actor, target.x, target.y, helpers)) {
    stopAndFace(actor, target);
    actor.input.action = false;
    actor.input.repair = false;
    actor.input.sprint = false;
    brain.healTask.commitUntil = Math.max(brain.healTask.commitUntil || 0, now + 0.55);
    brain.stuckFor = 0;
    return true;
  }

  followPath(game, actor, target, helpers, {
    sprint: true,
    stopDistance: Math.max(22, healDistance * 0.65),
    dt
  });
  actor.input.action = false;
  actor.input.repair = false;
  return true;
}

function chooseHookedRescueTarget(game, actor, helpers) {
  const killer = getLivingKiller(game);
  let best = null;
  let bestScore = -Infinity;
  const rescueDistance = Number(helpers?.hookRescueDistance || RUNNER_HOOK_RESCUE_DISTANCE);

  for (const target of game?.actors?.values?.() || []) {
    if (!target || target.id === actor.id || target.role !== "survivor" || !target.hooked || target.dead || target.escaped) continue;
    const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
    if (d > RUNNER_HOOK_TARGET_RADIUS) continue;

    const killerD = killer ? helperDist(helpers, killer.x, killer.y, target.x, target.y) : Infinity;
    const killerActorD = killer ? helperDist(helpers, killer.x, killer.y, actor.x, actor.y) : Infinity;
    const killerCamping = killerD < RUNNER_HOOK_KILLER_CAMP_DISTANCE && killerD < killerActorD + 140;
    const alreadyRescuing = d <= rescueDistance + 24 && (target.unhookProgress || 0) > 0;
    const threat = survivorThreatInfo(game, actor, helpers);
    if (threat?.threatened && !alreadyRescuing) continue;
    if (killerCamping && !alreadyRescuing) continue;

    const progressBonus = (target.unhookProgress || 0) * 900;
    const urgency = (target.hookCount || 0) * 240;
    const score = 1800 + urgency + progressBonus - d * 0.82 - (killerCamping ? 600 : 0);
    if (score > bestScore) {
      best = target;
      bestScore = score;
    }
  }
  return best;
}

function runSurvivorUnhook(game, actor, helpers, dt) {
  const brain = ensureSurvivalBrain(actor);
  const now = game.time || 0;
  let target = brain.unhookTask?.id ? [...(game?.actors?.values?.() || [])].find((p) => p?.id === brain.unhookTask.id) : null;

  if (!target || !target.hooked || target.dead || target.escaped || now > (brain.unhookTask?.commitUntil || 0)) {
    target = chooseHookedRescueTarget(game, actor, helpers);
    if (target) {
      brain.unhookTask = { id: target.id, x: target.x, y: target.y, commitUntil: now + RUNNER_UNHOOK_COMMIT_SECONDS };
      clearPath(brain);
    } else {
      clearUnhookTask(actor);
      return false;
    }
  }

  const threat = survivorThreatInfo(game, actor, helpers);
  const rescueDistance = Number(helpers?.hookRescueDistance || RUNNER_HOOK_RESCUE_DISTANCE);
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
  if (threat?.panic && d > rescueDistance + 14) {
    clearUnhookTask(actor);
    return false;
  }

  actor.bot.simpleAi.nextStep = { kind: "unhook-teammate", targetId: target.id };

  if (d <= rescueDistance && lineClear(game, actor, target.x, target.y, helpers)) {
    stopAndFace(actor, target);
    actor.input.action = false;
    actor.input.repair = false;
    actor.input.sprint = false;
    brain.unhookTask.commitUntil = Math.max(brain.unhookTask.commitUntil || 0, now + 0.45);
    return true;
  }

  followPath(game, actor, target, helpers, {
    sprint: true,
    stopDistance: Math.max(22, rescueDistance * 0.62),
    dt
  });
  actor.input.action = false;
  actor.input.repair = false;
  return true;
}

function objectById(list, id) {
  return (list || []).find((item) => item?.id === id) || null;
}

function resolveSafeObject(game, task) {
  if (!task) return null;
  if (task.kind === "windowVault") return objectById(game.map?.windows, task.id);
  if (task.kind === "palletDrop" || task.kind === "palletVault") return objectById(game.map?.pallets, task.id);
  return null;
}

function edgePenalty(game, x, y) {
  const tile = game.map?.tile || 32;
  const edge = Math.min(x, y, game.map.width - x, game.map.height - y);
  const corner = ((x < tile * 3 || x > game.map.width - tile * 3) && (y < tile * 3 || y > game.map.height - tile * 3));
  return (edge < tile * 1.5 ? 950 : edge < tile * 3 ? 360 : 0) + (corner ? 720 : 0);
}

function safePointScore(game, actor, killer, point, helpers) {
  const fromKiller = helperDist(helpers, killer.x, killer.y, point.x, point.y);
  const fromActor = helperDist(helpers, actor.x, actor.y, point.x, point.y);
  const actorFromKiller = Math.max(1, helperDist(helpers, killer.x, killer.y, actor.x, actor.y));
  const awayX = (actor.x - killer.x) / actorFromKiller;
  const awayY = (actor.y - killer.y) / actorFromKiller;
  const moveLen = Math.max(1, fromActor);
  const moveAway = ((point.x - actor.x) / moveLen) * awayX + ((point.y - actor.y) / moveLen) * awayY;
  const losBlocked = typeof helpers?.segmentClear === "function" ? !helpers.segmentClear(game, killer.x, killer.y, point.x, point.y) : false;
  return fromKiller * 2.35 + moveAway * 360 + (losBlocked ? 520 : 0) - fromActor * 0.42 - edgePenalty(game, point.x, point.y);
}

function oppositeSidePoint(game, actor, object, killer, actorSize = 32) {
  const c = centerOf(object);
  const tile = game.map?.tile || 32;
  const offset = tile * 1.25 + actorSize;
  if (object.orientation === "horizontal") {
    const actorNorth = actor.y < c.y;
    const killerNorth = killer.y < c.y;
    const side = actorNorth === killerNorth ? (actorNorth ? 1 : -1) : (actorNorth ? -1 : 1);
    return { x: clamp(actor.x, object.x + actorSize, object.x + object.w - actorSize), y: c.y + side * offset };
  }
  const actorWest = actor.x < c.x;
  const killerWest = killer.x < c.x;
  const side = actorWest === killerWest ? (actorWest ? 1 : -1) : (actorWest ? -1 : 1);
  return { x: c.x + side * offset, y: clamp(actor.y, object.y + actorSize, object.y + object.h - actorSize) };
}

function killerBehindRunner(actor, killer, objectCenter) {
  const runnerToObjectX = objectCenter.x - actor.x;
  const runnerToObjectY = objectCenter.y - actor.y;
  const killerToRunnerX = actor.x - killer.x;
  const killerToRunnerY = actor.y - killer.y;
  const a = Math.hypot(runnerToObjectX, runnerToObjectY);
  const b = Math.hypot(killerToRunnerX, killerToRunnerY);
  if (a < 1 || b < 1) return false;
  return ((runnerToObjectX / a) * (killerToRunnerX / b) + (runnerToObjectY / a) * (killerToRunnerY / b)) > 0.22;
}

function chooseImmediatePalletDrop(game, actor, killer, helpers) {
  let best = null;
  let bestScore = -Infinity;
  for (const pallet of game.map?.pallets || []) {
    if (!pallet || pallet.broken || pallet.state !== "upright") continue;
    const c = centerOf(pallet);
    const runnerD = helperDist(helpers, actor.x, actor.y, c.x, c.y);
    if (runnerD > RUNNER_INTERACT_DISTANCE + 22) continue;
    const killerRectD = pointRectDistance(killer.x, killer.y, pallet);
    const killerD = helperDist(helpers, actor.x, actor.y, killer.x, killer.y);
    const behind = killerBehindRunner(actor, killer, c);
    const shouldDrop = killerRectD <= RUNNER_PALLET_DROP_KILLER_RADIUS || (behind && killerD <= RUNNER_PALLET_DROP_PANIC_RADIUS);
    if (!shouldDrop) continue;
    const score = (RUNNER_PALLET_DROP_KILLER_RADIUS - killerRectD) * 4 + (behind ? 240 : 0) - runnerD;
    if (score > bestScore) {
      best = pallet;
      bestScore = score;
    }
  }
  return best;
}

function chooseSafeObject(game, actor, killer, helpers) {
  let best = null;
  let bestScore = -Infinity;
  const actorSize = 32;
  const now = game.time || 0;

  for (const win of game.map?.windows || []) {
    if (recentlyUsedSurvivalObject(actor, "windowVault", win?.id, now)) continue;
    const c = centerOf(win);
    const approachD = helperDist(helpers, actor.x, actor.y, c.x, c.y);
    if (approachD > RUNNER_SAFE_OBJECT_RADIUS) continue;
    const exit = oppositeSidePoint(game, actor, win, killer, actorSize);
    if (!actorCanStandAt(game, actor, exit.x, exit.y, helpers)) continue;
    const score = safePointScore(game, actor, killer, exit, helpers) + 420 - approachD * 0.36;
    if (score > bestScore) {
      best = { kind: "windowVault", object: win, point: c, exit, score };
      bestScore = score;
    }
  }

  for (const pallet of game.map?.pallets || []) {
    if (!pallet || pallet.broken) continue;
    if (recentlyUsedSurvivalObject(actor, pallet.state === "upright" ? "palletDrop" : "palletVault", pallet.id, now)) continue;
    const c = centerOf(pallet);
    const approachD = helperDist(helpers, actor.x, actor.y, c.x, c.y);
    if (approachD > RUNNER_SAFE_OBJECT_RADIUS) continue;

    if (pallet.state === "upright") {
      const killerRectD = pointRectDistance(killer.x, killer.y, pallet);
      const behind = killerBehindRunner(actor, killer, c);
      const score = safePointScore(game, actor, killer, c, helpers)
        + 520
        + (behind ? 280 : 0)
        + (killerRectD < RUNNER_PALLET_DROP_PANIC_RADIUS ? 220 : 0)
        - approachD * 0.28;
      if (score > bestScore) {
        best = { kind: "palletDrop", object: pallet, point: c, exit: c, score };
        bestScore = score;
      }
    } else if (pallet.state === "dropped") {
      const exit = oppositeSidePoint(game, actor, pallet, killer, actorSize);
      if (!actorCanStandAt(game, actor, exit.x, exit.y, helpers)) continue;
      const score = safePointScore(game, actor, killer, exit, helpers) + 260 - approachD * 0.32;
      if (score > bestScore) {
        best = { kind: "palletVault", object: pallet, point: c, exit, score };
        bestScore = score;
      }
    }
  }

  return best;
}

function chooseRawSafePoint(game, actor, killer, helpers) {
  let best = null;
  let bestScore = -Infinity;
  const baseAngle = Math.atan2(actor.y - killer.y, actor.x - killer.x);
  for (const radius of RUNNER_SAFE_SAMPLE_RINGS) {
    for (let i = 0; i < RUNNER_SAFE_SAMPLE_STEPS; i++) {
      const spread = (i / RUNNER_SAFE_SAMPLE_STEPS) * Math.PI * 2;
      const angle = baseAngle + spread;
      const point = {
        x: clamp(actor.x + Math.cos(angle) * radius, 44, game.map.width - 44),
        y: clamp(actor.y + Math.sin(angle) * radius, 44, game.map.height - 44)
      };
      if (!actorCanStandAt(game, actor, point.x, point.y, helpers)) continue;
      const score = safePointScore(game, actor, killer, point, helpers);
      if (score > bestScore) {
        best = point;
        bestScore = score;
      }
    }
  }
  return best || {
    x: clamp(actor.x + Math.cos(baseAngle) * 360, 44, game.map.width - 44),
    y: clamp(actor.y + Math.sin(baseAngle) * 360, 44, game.map.height - 44)
  };
}

function chooseSurvivalTask(game, actor, threat, helpers) {
  const { killer } = threat;
  const immediatePallet = chooseImmediatePalletDrop(game, actor, killer, helpers);
  if (immediatePallet) {
    const c = centerOf(immediatePallet);
    return { kind: "palletDrop", target: { ...c, id: immediatePallet.id }, object: immediatePallet };
  }

  const safeObject = chooseSafeObject(game, actor, killer, helpers);
  if (safeObject) {
    return {
      kind: safeObject.kind,
      target: { ...safeObject.point, id: safeObject.object.id },
      object: safeObject.object,
      exit: safeObject.exit
    };
  }

  const point = chooseRawSafePoint(game, actor, killer, helpers);
  return { kind: "safePoint", target: { ...point, id: null }, object: null };
}

function runSurvivorSurvival(game, actor, helpers, dt) {
  const brain = ensureSurvivalBrain(actor);
  const threat = survivorThreatInfo(game, actor, helpers);
  const now = game.time || 0;

  if (!threat?.threatened && now > (brain.threatUntil || 0) && (!brain.survivalTask || !threat?.killer || threat.distance >= RUNNER_SAFE_DISTANCE)) {
    if (brain.survivalTask) clearSurvivalTask(actor);
    return false;
  }

  if (threat?.threatened) {
    brain.threatUntil = Math.max(brain.threatUntil || 0, now + RUNNER_FLEE_LOCK_SECONDS);
    if (threat.panic || threat.distance <= RUNNER_THREAT_RADIUS) clearTask(actor);
  }

  if (!threat?.killer) return false;

  const stillUnsafe = threat.distance < RUNNER_SAFE_DISTANCE || now < (brain.threatUntil || 0);
  if (!stillUnsafe) {
    clearSurvivalTask(actor);
    brain.threatUntil = 0;
    return false;
  }

  const currentObject = resolveSafeObject(game, brain.survivalTask);
  const taskUnlocked = now >= (brain.survivalTask?.lockUntil || 0);
  const taskBadObject = (brain.survivalTask?.kind !== "safePoint" && !currentObject)
    || (brain.survivalTask?.kind === "palletDrop" && currentObject?.state !== "upright")
    || (brain.survivalTask?.kind === "palletVault" && currentObject?.state !== "dropped")
    || (brain.survivalTask?.kind === "windowVault" && !currentObject);
  const currentInvalid = !brain.survivalTask || (taskUnlocked && taskBadObject);

  if (currentInvalid) {
    const choice = chooseSurvivalTask(game, actor, threat, helpers);
    const extra = choice.exit ? { exitX: choice.exit.x, exitY: choice.exit.y } : {};
    setSurvivalTask(game, actor, choice.kind, choice.target, extra);
  }

  const task = brain.survivalTask;
  if (!task) return false;

  const target = { x: task.x, y: task.y, id: task.id };
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
  const isInteractTask = task.kind === "windowVault" || task.kind === "palletDrop" || task.kind === "palletVault";

  if (isInteractTask && now <= (task.afterInteractUntil || 0)) {
    const postPoint = postInteractSafePoint(game, actor, threat.killer, task, helpers);
    actor.input.action = false;
    followPath(game, actor, postPoint, helpers, {
      sprint: true,
      stopDistance: 42,
      dt
    });
    return true;
  }

  if (isInteractTask && d <= RUNNER_INTERACT_DISTANCE + 8) {
    stopAndFace(actor, threat.killer);
    actor.input.action = true;
    actor.input.sprint = false;
    const postPoint = postInteractSafePoint(game, actor, threat.killer, task, helpers);
    task.exitX = postPoint.x;
    task.exitY = postPoint.y;
    task.afterInteractUntil = Math.max(task.afterInteractUntil || 0, now + RUNNER_POST_INTERACT_SECONDS);
    task.lockUntil = Math.max(task.lockUntil || 0, now + RUNNER_POST_INTERACT_SECONDS);
    rememberSurvivalInteract(actor, task.kind, task.id, now);
    clearPath(brain);
    return true;
  }

  followPath(game, actor, target, helpers, {
    sprint: true,
    stopDistance: isInteractTask ? RUNNER_INTERACT_DISTANCE * 0.62 : 38,
    dt
  });
  actor.input.action = false;
  return true;
}

function runSurvivorOrbRunner(game, actor, helpers, dt) {
  const brain = ensureBotBrain(actor);
  const carried = Math.max(0, Math.floor(actor.dots || 0));

  if (game.escapeOpen || !unfinishedRifts(game).length) {
    clearTask(actor);
    stopAndFace(actor, null);
    return;
  }

  const nearbyDeposit = carried > 0 ? chooseNearbyRift(game, actor, helpers) : null;
  if (nearbyDeposit) {
    const task = setTask(game, actor, helpers, "deposit", nearbyDeposit);
    task.reason = "near-rift";
    depositAtRift(game, actor, nearbyDeposit, helpers, dt);
    return;
  }

  if (!taskStillValid(game, actor, brain.task, helpers)) {
    clearTask(actor);
  }

  if (!brain.task) {
    if (shouldDepositNow(game, actor, helpers)) {
      const rift = chooseBestRift(game, actor, helpers);
      if (rift) setTask(game, actor, helpers, "deposit", rift);
    } else {
      const orb = chooseOrb(game, actor, helpers);
      if (orb) setTask(game, actor, helpers, "orb", orb);
      else if (carried > 0) {
        const rift = chooseBestRift(game, actor, helpers);
        if (rift) setTask(game, actor, helpers, "deposit", rift);
      }
    }
  }

  const task = brain.task;
  const target = resolveTaskTarget(game, task);
  if (!task || !target) {
    stopAndFace(actor, null);
    return;
  }

  if (task.kind === "deposit") {
    depositAtRift(game, actor, target, helpers, dt);
    return;
  }

  if (task.kind === "orb") {
    collectOrb(game, actor, target, helpers, dt);
  }
}

function updateBotInputs(game, dt, helpers = {}) {
  if (!game?.actors) return;

  for (const actor of game.actors.values()) {
    if (!actor?.isBot) continue;
    ensureBotBrain(actor);

    if (typeof helpers.resetInput === "function") helpers.resetInput(actor.input);
    actor.bot.actionCooldown = Math.max(0, (actor.bot.actionCooldown || 0) - dt);

    if (actor.dead || actor.escaped || actor.hooked || actor.downed) {
      clearTask(actor);
      clearSurvivalTask(actor);
      clearUnhookTask(actor);
      clearHealTask(actor);
      continue;
    }

    if (actor.role === "killer") {
      voidAi.runVoidRiftAi(game, actor, helpers, dt);
      continue;
    }

    if (actor.role !== "survivor") {
      stopAndFace(actor, null);
      continue;
    }

    if (runSurvivorSurvival(game, actor, helpers, dt)) continue;
    if (runSurvivorUnhook(game, actor, helpers, dt)) continue;
    if (runSurvivorWaitForHeal(game, actor, helpers)) continue;
    if (runSurvivorHeal(game, actor, helpers, dt)) continue;

    runSurvivorOrbRunner(game, actor, helpers, dt);
  }
}

module.exports = {
  assignRunnerBotPersonalities,
  updateBotInputs
};
