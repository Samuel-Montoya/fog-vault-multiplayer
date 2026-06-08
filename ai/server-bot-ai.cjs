"use strict";

const voidAi = require("./server-void-ai.cjs");

// Survivor AI deliberately went back to boring, cheap, readable priorities.
// Fancy route theory made the server sweat and the bots forget how doors work.

const PERSONALITY_ID = "basic-runner";
const PERSONALITY_LABEL = "Basic Runner";

const THINK_PATH_REPLAN_SECONDS = 0.55;
const CHASE_PATH_REPLAN_SECONDS = 0.28;
const STUCK_SAMPLE_SECONDS = 0.65;
const STUCK_DISTANCE_EPSILON = 5.5;
const WAYPOINT_REACHED_DISTANCE = 26;
const FINAL_TARGET_REACHED_DISTANCE = 34;
const PATH_NODE_LIMIT = 1400;
const PATH_CACHE_LIMIT = 320;

const DEPOSIT_AFTER_ORBS = 5;
const RESCUE_SCAN_DISTANCE = 2400;
const HEAL_SCAN_DISTANCE = 900;
const OBJECTIVE_SCAN_LIMIT = 12;
const SAFETY_SCAN_LIMIT = 10;
const SAFETY_ACTION_BUFFER = 88;
const SAFETY_POST_ACTION_SECONDS = 1.35;

const KILLER_THREAT_RADIUS = 690;
const KILLER_CHASE_RADIUS = 430;
const KILLER_PANIC_RADIUS = 285;
const KILLER_CAMP_HOOK_RADIUS = 290;
const KILLER_CAMP_SOFT_RADIUS = 390;
const SPEED_BURST_PANIC_RADIUS = 360;

const POST_INTERACT_SECONDS = 1.15;
const TASK_COMMIT_SECONDS = 1.0;
const RESCUE_COMMIT_SECONDS = 3.8;
const HEAL_COMMIT_SECONDS = 3.0;
const ESCAPE_COMMIT_SECONDS = 2.2;
const CHASE_COMMIT_SECONDS = 1.15;
const RECEIVE_HEAL_LOCK_SECONDS = 1.25;
const FLEE_HYSTERESIS_SECONDS = 0.95;

const RUNNER_SPEED_BURST_ID = "speedBurst";

const BOT_ABILITY_ATTEMPT_SECONDS = 0.24;
const BOT_ABILITY_SUCCESS_SECONDS = 0.42;
const DART_BOX_SCAN_DISTANCE = 1900;
const DART_BOX_LOW_AMMO_RATIO = 0.34;
const COLLECTION_BOLT_MIN_CLUSTER = 2;
const COLLECTION_BOLT_SCAN_LIMIT = 18;
const HEALING_DART_SCAN_DISTANCE = 760;
const TEAM_DASH_SCAN_DISTANCE = 760;
const SMOKE_DART_DANGER_DISTANCE = 560;
const VOID_SWIRL_TRIGGER_DISTANCE = 430;

const MOVE_INTENT_LOCK_SECONDS = 0.42;
const MOVE_INTENT_REACHED_DISTANCE = 24;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(ax, ay, bx, by) {
  if (typeof ax === "object" && typeof ay === "object") {
    return Math.hypot((ax.x || 0) - (ay.x || 0), (ax.y || 0) - (ay.y || 0));
  }
  return Math.hypot((ax || 0) - (bx || 0), (ay || 0) - (by || 0));
}

function helperDist(helpers, ax, ay, bx, by) {
  return typeof helpers?.dist === "function" ? helpers.dist(ax, ay, bx, by) : dist(ax, ay, bx, by);
}

function now(game) {
  return Number(game?.time || 0);
}

function centerOf(rect) {
  if (!rect) return { x: 0, y: 0 };
  return {
    x: Number(rect.x || 0) + Number(rect.w || 0) / 2,
    y: Number(rect.y || 0) + Number(rect.h || 0) / 2
  };
}

function isActiveSurvivor(actor) {
  return !!(actor && actor.role === "survivor" && !actor.dead && !actor.escaped && !actor.hooked && !actor.downed);
}

function isWoundedSurvivor(actor) {
  return !!(actor && actor.role === "survivor" && !actor.dead && !actor.escaped && !actor.hooked && (actor.downed || actor.injured || actor.health === 1));
}

function carriedOrbs(actor) {
  return Math.max(0, Math.floor(Number(actor?.dots || 0)));
}

function getActorById(game, id) {
  if (!id || !game?.actors) return null;
  return game.actors.get?.(id) || null;
}

function ensureBotBrain(actor) {
  actor.bot = actor.bot || {};
  const brain = actor.bot.simpleAi || (actor.bot.simpleAi = {});
  brain.path = Array.isArray(brain.path) ? brain.path : [];
  brain.task = brain.task || null;
  brain.unhookTask = brain.unhookTask || null;
  brain.healTask = brain.healTask || null;
  brain.escapeTask = brain.escapeTask || null;
  brain.survivalTask = brain.survivalTask || null;
  brain.dartBoxTask = brain.dartBoxTask || null;
  brain.nextStep = brain.nextStep || null;
  brain.nextAbilityAt = Number(brain.nextAbilityAt || 0);
  brain.repathAt = Number(brain.repathAt || 0);
  brain.stuckFor = Number(brain.stuckFor || 0);
  brain.lastX = Number.isFinite(brain.lastX) ? brain.lastX : actor.x;
  brain.lastY = Number.isFinite(brain.lastY) ? brain.lastY : actor.y;
  return brain;
}

function clearPath(brain) {
  brain.path = [];
  brain.pathKey = null;
  brain.nextStep = null;
  brain.repathAt = 0;
  brain.moveIntent = null;
  brain.moveAxis = null;
  brain.moveAxisUntil = 0;
}

function clearTasks(brain) {
  brain.task = null;
  brain.unhookTask = null;
  brain.healTask = null;
  brain.escapeTask = null;
  brain.survivalTask = null;
  brain.dartBoxTask = null;
  brain.afterInteractTarget = null;
  brain.afterInteractUntil = 0;
  clearPath(brain);
}

function setTask(brain, slot, kind, target, game, extra = {}) {
  const id = target?.id || null;
  const old = brain[slot];
  if (old && old.kind === kind && old.id === id && (old.lockUntil || 0) > now(game)) {
    return old;
  }
  brain[slot] = {
    kind,
    id,
    x: Number(target?.x || 0),
    y: Number(target?.y || 0),
    lockUntil: now(game) + (extra.lockSeconds || TASK_COMMIT_SECONDS),
    reason: extra.reason || kind
  };
  clearPath(brain);
  return brain[slot];
}

function clearNonSlotTasks(brain, keep) {
  if (keep !== "task") brain.task = null;
  if (keep !== "unhookTask") brain.unhookTask = null;
  if (keep !== "healTask") brain.healTask = null;
  if (keep !== "escapeTask") brain.escapeTask = null;
  if (keep !== "survivalTask") brain.survivalTask = null;
  if (keep !== "dartBoxTask") brain.dartBoxTask = null;
}

function clearZeroOrbDepositState(actor, brain) {
  if (carriedOrbs(actor) > 0) return false;
  let cleared = false;

  if (brain?.task?.kind === "deposit") {
    brain.task = null;
    clearPath(brain);
    cleared = true;
  }

  if (brain?.nextStep?.kind === "hold-deposit" || brain?.nextStep?.kind === "deposit") {
    brain.nextStep = null;
    cleared = true;
  }

  if (actor) {
    if (actor.dotDepositTargetId || actor.dotDepositProgress || actor.dotDepositChain) cleared = true;
    actor.dotDepositTargetId = null;
    actor.dotDepositProgress = 0;
    actor.dotDepositChain = 0;
  }

  return cleared;
}

function resetActorInput(actor, helpers) {
  if (!actor.input) actor.input = {};
  const angle = Number.isFinite(actor.input.angle) ? actor.input.angle : Number(actor.angle || 0);
  if (typeof helpers?.resetInput === "function") helpers.resetInput(actor.input);
  else {
    actor.input.up = actor.input.down = actor.input.left = actor.input.right = false;
    actor.input.sprint = false;
    actor.input.action = false;
    actor.input.repair = false;
    actor.input.attack = false;
    actor.input.attackHeld = false;
    actor.input.attackReleased = false;
    actor.input.actionDir = null;
  }
  actor.input.angle = angle;
}

function stopAndFace(actor, target) {
  if (!actor?.input) return;
  const brain = actor?.bot?.simpleAi || null;
  if (brain) {
    brain.moveIntent = null;
    brain.moveAxis = null;
    brain.moveAxisUntil = 0;
  }
  actor.input.up = actor.input.down = actor.input.left = actor.input.right = false;
  actor.input.sprint = false;
  actor.input.action = false;
  actor.input.repair = false;
  if (target) actor.input.angle = Math.atan2((target.y || 0) - actor.y, (target.x || 0) - actor.x);
}

function stableMoveTarget(actor, target) {
  const brain = actor?.bot?.simpleAi || null;
  if (!brain || !target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return target;

  const t = Number(brain.aiNow || 0);
  const dx = target.x - actor.x;
  const dy = target.y - actor.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const old = brain.moveIntent;

  if (old && t <= (old.until || 0)) {
    const oldDistance = helperDist(null, actor.x, actor.y, old.x, old.y);
    if (oldDistance > MOVE_INTENT_REACHED_DISTANCE) {
      const dot = nx * (old.nx || 0) + ny * (old.ny || 0);
      const targetShift = helperDist(null, target.x, target.y, old.x, old.y);
      const notStuck = (brain.stuckFor || 0) < STUCK_SAMPLE_SECONDS;
      // Only keep the previous micro-target when the new one is basically the
      // same direction. Keeping it during a real reversal is what caused
      // heal/flee and objective/flee ping-pong. Humanity invented hysteresis,
      // the bots can have a teaspoon of it.
      if (notStuck && targetShift < 76 && dot > -0.45) {
        return { x: old.x, y: old.y };
      }
    }
  }

  brain.moveIntent = {
    x: target.x,
    y: target.y,
    nx,
    ny,
    until: t + MOVE_INTENT_LOCK_SECONDS
  };
  return target;
}

function setMoveToward(actor, target, sprint = true) {
  if (!actor?.input || !target) return false;
  const brain = actor?.bot?.simpleAi || null;
  const stable = stableMoveTarget(actor, target);
  const dx = (stable.x || 0) - actor.x;
  const dy = (stable.y || 0) - actor.y;
  const d = Math.hypot(dx, dy);
  actor.input.up = actor.input.down = actor.input.left = actor.input.right = false;
  actor.input.sprint = !!sprint;
  actor.input.action = false;
  actor.input.repair = false;
  if (d <= 4) return false;

  const deadZone = Math.max(8, Math.min(18, d * 0.12));
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  // Use the path target directly. The previous one-axis governor removed diagonal
  // zig-zag, then introduced worse left/right ping-pong at waypoints. Naturally.
  // Diagonal input is fine as long as the target itself is stable.
  if (absX > deadZone) {
    actor.input.left = dx < 0;
    actor.input.right = dx > 0;
  }
  if (absY > deadZone) {
    actor.input.up = dy < 0;
    actor.input.down = dy > 0;
  }

  actor.input.angle = Math.atan2(dy, dx);
  return !!(actor.input.up || actor.input.down || actor.input.left || actor.input.right);
}

function actorCanStandAt(game, actor, x, y, helpers) {
  if (!game?.map || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const pad = 36;
  if (x < pad || y < pad || x > game.map.width - pad || y > game.map.height - pad) return false;
  if (typeof helpers?.canActorStandAt === "function") return !!helpers.canActorStandAt(game, actor, x, y);
  return true;
}

function segmentClear(game, ax, ay, bx, by, helpers) {
  if (typeof helpers?.segmentClear === "function") return !!helpers.segmentClear(game, ax, ay, bx, by);
  return true;
}

function riftsComplete(game) {
  const gens = game?.map?.generators || [];
  if (!gens.length) return false;
  const required = Number(game?.requiredGenerators ?? game?.map?.requiredGenerators ?? gens.length);
  return gens.filter((g) => g.done).length >= required;
}

function tileAt(game, x, y) {
  const tile = Number(game?.map?.tile || 72);
  return {
    x: clamp(Math.floor(Number(x || 0) / tile), 0, (game?.map?.cols || 1) - 1),
    y: clamp(Math.floor(Number(y || 0) / tile), 0, (game?.map?.rows || 1) - 1)
  };
}

function tileCenter(game, tx, ty) {
  const tile = Number(game?.map?.tile || 72);
  return { x: tx * tile + tile / 2, y: ty * tile + tile / 2 };
}

function cellKey(tx, ty) {
  return `${tx},${ty}`;
}

function getRunnerGrid(game, actor, helpers) {
  const map = game?.map;
  if (!map) return null;
  const key = `${map.name || "map"}:${map.cols}x${map.rows}:${game.pathCacheEpoch || 0}:${riftsComplete(game) ? 1 : 0}`;
  if (game.__basicRunnerGrid?.key === key) return game.__basicRunnerGrid;

  const passable = Array.from({ length: map.rows }, () => Array(map.cols).fill(false));
  for (let ty = 0; ty < map.rows; ty++) {
    for (let tx = 0; tx < map.cols; tx++) {
      const ch = map.rawRows?.[ty]?.[tx] || "X";
      if (ch === "X" || ch === "+") continue;
      const p = tileCenter(game, tx, ty);
      passable[ty][tx] = actorCanStandAt(game, actor, p.x, p.y, helpers);
    }
  }

  game.__basicRunnerGrid = { key, cols: map.cols, rows: map.rows, tile: map.tile, passable };
  return game.__basicRunnerGrid;
}

function isPassable(grid, tx, ty) {
  return !!(grid && tx >= 0 && ty >= 0 && tx < grid.cols && ty < grid.rows && grid.passable[ty]?.[tx]);
}

function nearestPassableTile(game, actor, helpers, x, y, maxRadius = 4) {
  const grid = getRunnerGrid(game, actor, helpers);
  if (!grid) return null;
  const base = tileAt(game, x, y);
  if (isPassable(grid, base.x, base.y)) return base;
  let best = null;
  let bestScore = Infinity;
  for (let r = 1; r <= maxRadius; r++) {
    for (let ty = base.y - r; ty <= base.y + r; ty++) {
      for (let tx = base.x - r; tx <= base.x + r; tx++) {
        if (Math.abs(tx - base.x) !== r && Math.abs(ty - base.y) !== r) continue;
        if (!isPassable(grid, tx, ty)) continue;
        const p = tileCenter(game, tx, ty);
        const score = helperDist(helpers, x, y, p.x, p.y);
        if (score < bestScore) {
          bestScore = score;
          best = { x: tx, y: ty };
        }
      }
    }
    if (best) return best;
  }
  return best;
}

function getPathCache(game) {
  game.__basicRunnerPathCache = game.__basicRunnerPathCache || new Map();
  return game.__basicRunnerPathCache;
}

function cachedPathKey(game, start, goal) {
  return `${game.__basicRunnerGrid?.key || "grid"}|${start.x},${start.y}>${goal.x},${goal.y}`;
}

function findPathTiles(game, actor, helpers, targetX, targetY, options = {}) {
  const grid = getRunnerGrid(game, actor, helpers);
  if (!grid) return null;
  const start = nearestPassableTile(game, actor, helpers, actor.x, actor.y, 3);
  const goal = nearestPassableTile(game, actor, helpers, targetX, targetY, options.goalRadius || 4);
  if (!start || !goal) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const cache = getPathCache(game);
  const key = cachedPathKey(game, start, goal);
  if (cache.has(key)) {
    const cached = cache.get(key);
    cache.delete(key);
    cache.set(key, cached);
    return cached ? cached.map((p) => ({ ...p })) : null;
  }

  const open = [{ x: start.x, y: start.y, g: 0, f: 0, parent: null }];
  const best = new Map([[cellKey(start.x, start.y), open[0]]]);
  const closed = new Set();
  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, -1, Math.SQRT2]
  ];
  let nodes = 0;
  let found = null;

  while (open.length && nodes++ < (options.nodeLimit || PATH_NODE_LIMIT)) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIndex].f) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = cellKey(current.x, current.y);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    if (current.x === goal.x && current.y === goal.y) {
      found = current;
      break;
    }

    for (const [dx, dy, stepCost] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isPassable(grid, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isPassable(grid, current.x + dx, current.y) || !isPassable(grid, current.x, current.y + dy))) continue;
      const nk = cellKey(nx, ny);
      if (closed.has(nk)) continue;
      const g = current.g + stepCost;
      const hx = Math.abs(goal.x - nx);
      const hy = Math.abs(goal.y - ny);
      const h = (hx + hy) + (Math.SQRT2 - 2) * Math.min(hx, hy);
      const existing = best.get(nk);
      if (existing && existing.g <= g) continue;
      const node = { x: nx, y: ny, g, f: g + h * 1.08, parent: current };
      best.set(nk, node);
      open.push(node);
    }
  }

  let result = null;
  if (found) {
    result = [];
    let node = found;
    while (node && !(node.x === start.x && node.y === start.y)) {
      result.push({ x: node.x, y: node.y });
      node = node.parent;
    }
    result.reverse();
  }

  cache.set(key, result ? result.map((p) => ({ ...p })) : null);
  while (cache.size > PATH_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return result;
}

function buildWorldPath(game, actor, helpers, target, options = {}) {
  if (!target) return null;
  const tilePath = findPathTiles(game, actor, helpers, target.x, target.y, options);
  if (!tilePath) return null;
  const world = tilePath.map((t) => tileCenter(game, t.x, t.y));
  if (actorCanStandAt(game, actor, target.x, target.y, helpers)) {
    const last = world[world.length - 1];
    if (!last || helperDist(helpers, last.x, last.y, target.x, target.y) > 18) world.push({ x: target.x, y: target.y });
  }
  return world;
}

function updateStuckState(game, actor, brain, dt, hadMoveInput = false) {
  const moved = helperDist(null, actor.x, actor.y, brain.lastX, brain.lastY);
  if (hadMoveInput && moved < STUCK_DISTANCE_EPSILON) brain.stuckFor = (brain.stuckFor || 0) + dt;
  else brain.stuckFor = 0;
  brain.lastX = actor.x;
  brain.lastY = actor.y;
  if (brain.stuckFor >= STUCK_SAMPLE_SECONDS) {
    clearPath(brain);
    brain.stuckFor = 0;
    return true;
  }
  return false;
}

function followPath(game, actor, helpers, target, options = {}) {
  const brain = ensureBotBrain(actor);
  const t = now(game);
  const stopDistance = Number(options.stopDistance || FINAL_TARGET_REACHED_DISTANCE);
  const targetKey = `${options.key || "target"}:${Math.round(target.x)},${Math.round(target.y)}`;

  if (helperDist(helpers, actor.x, actor.y, target.x, target.y) <= stopDistance) {
    stopAndFace(actor, target);
    brain.nextStep = { kind: options.kind || "arrived", targetId: options.targetId || null };
    return true;
  }

  if (brain.pathKey !== targetKey || !brain.path?.length || t >= (brain.repathAt || 0)) {
    const path = buildWorldPath(game, actor, helpers, target, options);
    if (!path) {
      clearPath(brain);
      brain.nextStep = { kind: "no-path", targetId: options.targetId || null };
      return false;
    }
    brain.path = path;
    brain.pathKey = targetKey;
    brain.repathAt = t + (options.repathSeconds || THINK_PATH_REPLAN_SECONDS);
  }

  while (brain.path.length > 1 && helperDist(helpers, actor.x, actor.y, brain.path[0].x, brain.path[0].y) <= WAYPOINT_REACHED_DISTANCE) {
    brain.path.shift();
  }

  const next = brain.path[0] || target;
  const moving = setMoveToward(actor, next, !!options.sprint);
  brain.nextStep = { kind: options.kind || "path", targetId: options.targetId || null };
  if (!moving) return false;
  return true;
}

function holdOrCreepToInteraction(game, actor, helpers, target, interactDistance, holdKind, closeKind, targetId, options = {}) {
  if (!target) return false;
  const brain = ensureBotBrain(actor);
  const holdBuffer = Number(options.holdBuffer ?? 6);
  const creepBuffer = Number(options.creepBuffer ?? 72);
  const requireLos = options.requireLos !== false;
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
  const hasLine = !requireLos || segmentClear(game, actor.x, actor.y, target.x, target.y, helpers);

  if (hasLine && d <= Math.max(16, interactDistance - holdBuffer)) {
    stopAndFace(actor, target);
    brain.nextStep = { kind: holdKind, targetId: targetId || target.id || null };
    return true;
  }

  // This is the important bit: pathing often brings a bot to a valid approach
  // point around a Rift/hook/heal target, but the server interaction still checks
  // distance to the actual center. If we stop at the approach point, the bot just
  // stares at the objective like it is waiting for a notarized invitation.
  if (hasLine && d <= interactDistance + creepBuffer) {
    setMoveToward(actor, target, true);
    brain.nextStep = { kind: closeKind, targetId: targetId || target.id || null };
    return true;
  }

  return false;
}

function directFlee(actor, killer) {
  const dx = actor.x - killer.x;
  const dy = actor.y - killer.y;
  const len = Math.hypot(dx, dy) || 1;
  const target = { x: actor.x + (dx / len) * 260, y: actor.y + (dy / len) * 260 };
  setMoveToward(actor, target, true);
}

function nearestKiller(game, actor) {
  let best = null;
  let bestD = Infinity;
  for (const other of game?.actors?.values?.() || []) {
    if (!other || other.role !== "killer" || other.dead || other.escaped) continue;
    const d = dist(actor.x, actor.y, other.x, other.y);
    if (d < bestD) {
      best = other;
      bestD = d;
    }
  }
  return best ? { killer: best, distance: bestD } : { killer: null, distance: Infinity };
}

function threatInfo(game, actor, helpers, brain = null) {
  const info = nearestKiller(game, actor);
  const killer = info.killer;
  const d = info.distance;
  const los = killer ? segmentClear(game, actor.x, actor.y, killer.x, killer.y, helpers) : false;
  const chaseSignal = (actor.chaseHold || 0) > 0 || (actor.killerVisibleHold || 0) > 0;
  const t = now(game);

  // This is intentionally strict. A stale chaseHold from the engine should not
  // make a bot abandon healing/depositing from the other side of the map.
  const hardDanger = !!killer && (
    d <= KILLER_PANIC_RADIUS + 45
    || (los && d <= KILLER_CHASE_RADIUS)
    || (chaseSignal && d <= KILLER_CHASE_RADIUS + 80)
  );

  if (brain) {
    if (hardDanger) brain.fleeUntil = t + FLEE_HYSTERESIS_SECONDS;
    else if (!killer || d > KILLER_THREAT_RADIUS + 120) brain.fleeUntil = 0;
  }

  const hysteresisDanger = !!killer
    && !!brain
    && t <= Number(brain.fleeUntil || 0)
    && d <= KILLER_THREAT_RADIUS + 80;

  return {
    killer,
    distance: d,
    los,
    chaseSignal,
    hardDanger,
    threatened: !!killer && (d <= KILLER_THREAT_RADIUS || (los && d <= KILLER_THREAT_RADIUS + 120)),
    danger: hardDanger || hysteresisDanger,
    panic: !!killer && d <= KILLER_PANIC_RADIUS
  };
}

function tryUseSpeedBurst(game, actor, helpers, threat) {
  if (!threat?.killer || typeof helpers?.applySurvivorAbility !== "function") return false;
  if ((actor.speedBurst || 0) > 0) return false;
  if (threat.distance > SPEED_BURST_PANIC_RADIUS && !(actor.chaseHold > 0 && threat.distance < KILLER_CHASE_RADIUS)) return false;
  const result = helpers.applySurvivorAbility(game, actor, RUNNER_SPEED_BURST_ID);
  return !!result?.ok;
}

function normalizeRunnerClassKey(actor) {
  const raw = String(actor?.runnerClass || "orbCollector").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (raw === "chase") return "escapist";
  return raw || "orbcollector";
}

function qAbilityForClass(actor) {
  const classKey = normalizeRunnerClassKey(actor);
  if (classKey === "orbcollector") return "doubleOrb";
  if (classKey === "nebulizer") return "voidSwirl";
  if (classKey === "escapist") return "swiftVault";
  return "";
}

function shootAbilityForClass(actor) {
  const classKey = normalizeRunnerClassKey(actor);
  if (classKey === "orbcollector") return "collectionBolt";
  if (classKey === "healer") return "healingDart";
  if (classKey === "escapist") return "dashDart";
  if (classKey === "nebulizer") return "smokeDart";
  return "";
}

function survivorAbilityDef(game, actor, helpers, abilityId) {
  if (!abilityId || typeof helpers?.getSurvivorAbilityDef !== "function") return null;
  return helpers.getSurvivorAbilityDef(abilityId, actor, game) || null;
}

function survivorAbilityReady(game, actor, helpers, abilityId, options = {}) {
  const ability = survivorAbilityDef(game, actor, helpers, abilityId);
  if (!ability || ability.locked) return null;
  if (actor.dead || actor.escaped || actor.hooked || actor.downed || actor.vault || actor.actionLock > 0) return null;
  const cooldown = Math.max(0, Number(actor.survivorAbilityCooldowns?.[ability.id] || 0));
  if (cooldown > 0) return null;
  const cost = Math.max(0, Number(ability.cost || 0));
  if (!options.ignoreCost && carriedOrbs(actor) < cost) return null;
  return ability;
}

function runnerDartMaxAmmo(actor, helpers) {
  const helperValue = typeof helpers?.runnerDartMaxAmmo === "function" ? Number(helpers.runnerDartMaxAmmo(actor)) : 0;
  const actorValue = Number(actor?.runnerDartMaxAmmo || 0);
  return Math.max(1, Math.floor(helperValue || actorValue || (normalizeRunnerClassKey(actor) === "orbcollector" ? 5 : 3)));
}

function runnerDartAmmo(actor, helpers) {
  const max = runnerDartMaxAmmo(actor, helpers);
  const raw = Number(actor?.runnerDartAmmo);
  return clamp(Number.isFinite(raw) ? Math.floor(raw) : max, 0, max);
}

function shootAbilityReady(game, actor, helpers, abilityId = shootAbilityForClass(actor)) {
  const ability = survivorAbilityReady(game, actor, helpers, abilityId, { ignoreCost: true });
  if (!ability || !ability.projectileKind) return null;
  if (runnerDartAmmo(actor, helpers) <= 0) return null;
  if (Math.max(0, Number(actor.runnerDartFireLockout || 0)) > 0) return null;
  return ability;
}

function abilityAttemptReady(game, actor) {
  const brain = ensureBotBrain(actor);
  return now(game) >= Number(brain.nextAbilityAt || 0);
}

function markAbilityAttempt(game, actor, seconds = BOT_ABILITY_ATTEMPT_SECONDS, detail = null) {
  const brain = ensureBotBrain(actor);
  brain.nextAbilityAt = now(game) + seconds;
  if (detail) brain.lastAbilityUse = { ...detail, at: now(game) };
}

function fireBotShootAbility(game, actor, helpers, abilityId, target, reason = "bot-shot") {
  if (!target || typeof helpers?.fireRunnerShootAbility !== "function") return false;
  if (!abilityAttemptReady(game, actor)) return false;
  const ability = shootAbilityReady(game, actor, helpers, abilityId);
  if (!ability) return false;
  const range = Math.max(80, Number(ability.range || 620));
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
  if (d > range + Math.max(48, Number(ability.radius || 80))) return false;
  const result = helpers.fireRunnerShootAbility(game, actor, {
    id: ability.id,
    targetX: target.x,
    targetY: target.y,
    angle: Math.atan2((target.y || 0) - actor.y, (target.x || 0) - actor.x)
  });
  markAbilityAttempt(game, actor, result?.ok ? BOT_ABILITY_SUCCESS_SECONDS : BOT_ABILITY_ATTEMPT_SECONDS, {
    id: ability.id,
    reason,
    targetId: target.id || null
  });
  if (result?.ok) {
    const brain = ensureBotBrain(actor);
    brain.nextStep = { kind: `fire-${ability.id}`, targetId: target.id || null };
    return true;
  }
  return false;
}

function useBotQAbility(game, actor, helpers, abilityId, reason = "bot-q") {
  if (typeof helpers?.applySurvivorAbility !== "function") return false;
  if (!abilityAttemptReady(game, actor)) return false;
  const ability = survivorAbilityReady(game, actor, helpers, abilityId);
  if (!ability || ability.projectileKind) return false;
  const result = helpers.applySurvivorAbility(game, actor, ability.id);
  markAbilityAttempt(game, actor, result?.ok ? BOT_ABILITY_SUCCESS_SECONDS : BOT_ABILITY_ATTEMPT_SECONDS, {
    id: ability.id,
    reason,
    targetId: null
  });
  if (result?.ok) {
    const brain = ensureBotBrain(actor);
    brain.nextStep = { kind: `use-${ability.id}`, targetId: null };
    return true;
  }
  return false;
}

function countOrbsNear(game, helpers, x, y, radius) {
  let count = 0;
  for (const dot of game?.collectibleDots || []) {
    if (!dot) continue;
    if (helperDist(helpers, x, y, dot.x, dot.y) <= radius && segmentClear(game, x, y, dot.x, dot.y, helpers)) count++;
  }
  return count;
}

function chooseCollectionBoltTarget(game, actor, helpers, ability, threat = null) {
  if (!ability || carriedOrbs(actor) >= Number(helpers?.survivorDotMax || 30)) return null;
  const radius = Math.max(48, Number(ability.radius || 96));
  const range = Math.max(120, Number(ability.range || 620));
  const dots = (game?.collectibleDots || [])
    .filter((dot) => dot && Number.isFinite(dot.x) && Number.isFinite(dot.y))
    .map((dot) => ({ dot, d: helperDist(helpers, actor.x, actor.y, dot.x, dot.y) }))
    .filter((item) => item.d <= range + radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, COLLECTION_BOLT_SCAN_LIMIT);
  let best = null;
  let bestScore = -Infinity;
  for (const item of dots) {
    const dot = item.dot;
    const clear = segmentClear(game, actor.x, actor.y, dot.x, dot.y, helpers);
    const cluster = countOrbsNear(game, helpers, dot.x, dot.y, radius);
    if (cluster <= 0) continue;
    const danger = killerDangerPenalty(game, dot.x, dot.y, helpers, threat);
    const beamBonus = Number(ability.effect?.beamCollectRadius || ability.beamCollectRadius || 0) > 0 ? Math.min(2, cluster) * 80 : 0;
    const score = cluster * 560 + beamBonus - item.d * 0.85 - danger * 0.36 + (clear ? 220 : -260);
    if (score > bestScore) {
      bestScore = score;
      best = { x: dot.x, y: dot.y, id: dot.id, cluster, score, clear };
    }
  }
  if (!best || best.cluster < COLLECTION_BOLT_MIN_CLUSTER) return null;
  return best;
}

function teammateThreat(game, teammate, helpers) {
  const killer = [...(game?.actors?.values?.() || [])].find((actor) => actor?.role === "killer" && !actor.dead && !actor.escaped);
  if (!killer) return { killer: null, distance: Infinity, los: false, danger: false };
  const d = helperDist(helpers, teammate.x, teammate.y, killer.x, killer.y);
  const los = segmentClear(game, teammate.x, teammate.y, killer.x, killer.y, helpers);
  return { killer, distance: d, los, danger: d <= KILLER_CHASE_RADIUS || (los && d <= KILLER_THREAT_RADIUS) };
}

function chooseHealingDartTarget(game, actor, helpers, ability, threat = null) {
  if (!ability) return null;
  const range = Math.min(Math.max(HEALING_DART_SCAN_DISTANCE, Number(ability.range || 620)), Number(ability.range || 620) + Number(ability.radius || 60));
  const canUnhook = !!ability.effect?.canUnhook;
  const canPickupDowned = !!ability.effect?.canPickupDowned;
  let best = null;
  let bestScore = -Infinity;
  for (const target of game?.actors?.values?.() || []) {
    if (!target || target.id === actor.id || target.role !== "survivor" || target.dead || target.escaped) continue;
    const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
    if (d > range) continue;
    if (!segmentClear(game, actor.x, actor.y, target.x, target.y, helpers)) continue;
    let score = -Infinity;
    if (target.hooked) {
      if (!canUnhook || target.healingDartUnhook) continue;
      score = 4200 - d + Math.max(0, 1 - Number(target.unhookProgress || 0)) * 450;
    } else if (target.downed) {
      if (!canPickupDowned || target.healingDartHeal) continue;
      score = 3600 - d + Math.min(600, Number(target.hookProgress || 0) * 900);
    } else if (target.injured || target.health === 1) {
      if (target.healingDartHeal) continue;
      const manualHelp = (target.healProgress || 0) > 0 || (target.activeHealers || []).length > 0;
      score = 1600 - d - (manualHelp ? 320 : 0);
    }
    if (!Number.isFinite(score)) continue;
    const tThreat = teammateThreat(game, target, helpers);
    if (tThreat.danger) score += target.hooked || target.downed ? 260 : -180;
    if (threat?.hardDanger) score -= 250;
    if (score > bestScore) {
      bestScore = score;
      best = { x: target.x, y: target.y, id: target.id, score };
    }
  }
  return best;
}

function chooseDashDartTarget(game, actor, helpers, ability, threat = null) {
  if (!ability) return null;
  const range = Math.max(120, Number(ability.range || 640));
  const radius = Math.max(70, Number(ability.radius || 108));
  if (threat?.killer && (threat.hardDanger || threat.distance <= KILLER_CHASE_RADIUS + 70) && (actor.dashBoost || 0) <= 0) {
    const dx = actor.x - threat.killer.x;
    const dy = actor.y - threat.killer.y;
    const len = Math.hypot(dx, dy) || 1;
    const target = {
      id: actor.id,
      x: clamp(actor.x + (dx / len) * Math.min(radius * 0.78, 96), 44, game.map.width - 44),
      y: clamp(actor.y + (dy / len) * Math.min(radius * 0.78, 96), 44, game.map.height - 44),
      self: true
    };
    if (segmentClear(game, actor.x, actor.y, target.x, target.y, helpers)) return target;
  }

  let best = null;
  let bestScore = -Infinity;
  for (const target of game?.actors?.values?.() || []) {
    if (!target || target.id === actor.id || !isActiveSurvivor(target)) continue;
    if ((target.dashBoost || 0) > 0) continue;
    const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
    if (d > Math.min(range + radius, TEAM_DASH_SCAN_DISTANCE)) continue;
    if (!segmentClear(game, actor.x, actor.y, target.x, target.y, helpers)) continue;
    const tThreat = teammateThreat(game, target, helpers);
    const carried = carriedOrbs(target);
    const score = (tThreat.danger ? 2500 : 0) + carried * 28 - d + (target.chase ? 420 : 0);
    if (score > bestScore && score > 520) {
      bestScore = score;
      best = { x: target.x, y: target.y, id: target.id };
    }
  }
  return best;
}

function chooseSmokeDartTarget(game, actor, helpers, ability, threat = null) {
  if (!ability || !threat?.killer) return null;
  if (!threat.hardDanger && !(threat.los && threat.distance <= SMOKE_DART_DANGER_DISTANCE)) return null;
  const dx = actor.x - threat.killer.x;
  const dy = actor.y - threat.killer.y;
  const len = Math.hypot(dx, dy) || 1;
  const forward = Math.min(Math.max(70, Number(ability.radius || 130) * 0.68), 145);
  const candidates = [
    { x: actor.x + (dx / len) * forward, y: actor.y + (dy / len) * forward, id: "smoke-ahead" },
    { x: actor.x + (dx / len) * (forward * 0.45), y: actor.y + (dy / len) * (forward * 0.45), id: "smoke-self" },
    { x: (actor.x + threat.killer.x) * 0.5, y: (actor.y + threat.killer.y) * 0.5, id: "smoke-line" }
  ];
  for (const p of candidates) {
    const target = { ...p, x: clamp(p.x, 44, game.map.width - 44), y: clamp(p.y, 44, game.map.height - 44) };
    if (helperDist(helpers, actor.x, actor.y, target.x, target.y) <= Number(ability.range || 620) && segmentClear(game, actor.x, actor.y, target.x, target.y, helpers)) return target;
  }
  return null;
}

function tryUseSupportBolts(game, actor, helpers, threat = null) {
  const abilityId = shootAbilityForClass(actor);
  const ability = shootAbilityReady(game, actor, helpers, abilityId);
  if (!ability) return false;
  if (ability.id === "healingDart") {
    const target = chooseHealingDartTarget(game, actor, helpers, ability, threat);
    return target ? fireBotShootAbility(game, actor, helpers, ability.id, target, "healing dart support") : false;
  }
  if (ability.id === "dashDart") {
    const target = chooseDashDartTarget(game, actor, helpers, ability, threat);
    return target ? fireBotShootAbility(game, actor, helpers, ability.id, target, target.self ? "self dash" : "team dash") : false;
  }
  return false;
}

function tryUseChaseAbilities(game, actor, helpers, threat = null) {
  const qId = qAbilityForClass(actor);
  if (qId === "voidSwirl" && threat?.killer && threat.distance <= VOID_SWIRL_TRIGGER_DISTANCE && (actor.voidSwirlSlow || 0) <= 0) {
    const alreadyCovered = (game.voidSwirls || []).some((swirl) => swirl?.ownerId === actor.id && helperDist(helpers, actor.x, actor.y, swirl.x, swirl.y) < Math.max(72, Number(swirl.radius || 0) * 1.2));
    if (!alreadyCovered && useBotQAbility(game, actor, helpers, "voidSwirl", "killer behind")) return true;
  }
  if (qId === "swiftVault" && threat?.killer && (threat.hardDanger || threat.distance <= KILLER_CHASE_RADIUS + 30) && (actor.swiftVaultReady || 0) <= 0) {
    if (useBotQAbility(game, actor, helpers, "swiftVault", "chase vault prep")) return true;
  }

  const abilityId = shootAbilityForClass(actor);
  const ability = shootAbilityReady(game, actor, helpers, abilityId);
  if (!ability) return false;
  if (ability.id === "dashDart") {
    const target = chooseDashDartTarget(game, actor, helpers, ability, threat);
    return target ? fireBotShootAbility(game, actor, helpers, ability.id, target, target.self ? "self dash" : "team dash") : false;
  }
  if (ability.id === "smokeDart") {
    const target = chooseSmokeDartTarget(game, actor, helpers, ability, threat);
    return target ? fireBotShootAbility(game, actor, helpers, ability.id, target, "smoke break line") : false;
  }
  return false;
}

function tryUseObjectiveAbilities(game, actor, helpers, threat = null) {
  const qId = qAbilityForClass(actor);
  const shootId = shootAbilityForClass(actor);
  const shootAbility = shootAbilityReady(game, actor, helpers, shootId);

  if (qId === "doubleOrb" && (actor.doubleOrb || 0) <= 0 && carriedOrbs(actor) >= 10 && carriedOrbs(actor) <= Number(helpers?.survivorDotMax || 30) - 5) {
    const clusterTarget = shootAbility?.id === "collectionBolt" ? chooseCollectionBoltTarget(game, actor, helpers, shootAbility, threat) : null;
    const nearbyOrbs = clusterTarget?.cluster || countOrbsNear(game, helpers, actor.x, actor.y, 260);
    if (nearbyOrbs >= 4 && useBotQAbility(game, actor, helpers, "doubleOrb", "orb cluster")) return true;
  }

  if (shootAbility?.id === "collectionBolt") {
    const target = chooseCollectionBoltTarget(game, actor, helpers, shootAbility, threat);
    if (target && fireBotShootAbility(game, actor, helpers, shootAbility.id, target, "collection bolt cluster")) return true;
  }

  return false;
}

function shouldSeekDartBox(game, actor, helpers, force = false) {
  if (!game?.dartBoxes?.length) return false;
  const shootId = shootAbilityForClass(actor);
  if (!survivorAbilityDef(game, actor, helpers, shootId)) return false;
  const ammo = runnerDartAmmo(actor, helpers);
  const maxAmmo = runnerDartMaxAmmo(actor, helpers);
  if (force) return ammo <= 0;
  return ammo <= 0 || (ammo / maxAmmo <= DART_BOX_LOW_AMMO_RATIO && !actor.dotDepositTargetId && !actor.healingTargetId && !actor.unhookTargetId);
}

function chooseDartBox(game, actor, helpers, threat = null) {
  if (!game?.dartBoxes?.length) return null;
  const shortlist = (game.dartBoxes || [])
    .filter((box) => box && (!box.type || box.type === "dart"))
    .map((box) => ({ box, d: helperDist(helpers, actor.x, actor.y, box.x, box.y) }))
    .filter((item) => item.d <= DART_BOX_SCAN_DISTANCE)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);
  let best = null;
  let bestScore = Infinity;
  for (const item of shortlist) {
    const approach = approachPointForTarget(game, actor, helpers, item.box, Number(helpers?.dartBoxInteractRadius || 74) * 0.72, { nodeLimit: 700 });
    if (!approach) continue;
    const claimed = botTaskClaimCount(game, actor, "dartBoxTask", "dartBox", item.box.id);
    const danger = killerDangerPenalty(game, item.box.x, item.box.y, helpers, threat);
    const score = item.d + approach.path.length * 34 + claimed * 520 + danger * 0.72;
    if (score < bestScore) {
      bestScore = score;
      best = { box: item.box, approach };
    }
  }
  return best;
}

function runDartBox(game, actor, helpers, dt, threat = null, options = {}) {
  if (!shouldSeekDartBox(game, actor, helpers, !!options.force)) return false;
  const brain = ensureBotBrain(actor);
  const lockedBox = brain.dartBoxTask?.id ? (game.dartBoxes || []).find((box) => box.id === brain.dartBoxTask.id) : null;
  let choice = null;
  if (lockedBox && (brain.dartBoxTask.lockUntil || 0) > now(game)) {
    const approach = approachPointForTarget(game, actor, helpers, lockedBox, Number(helpers?.dartBoxInteractRadius || 74) * 0.72, { nodeLimit: 700 });
    if (approach) choice = { box: lockedBox, approach };
  }
  if (!choice) choice = chooseDartBox(game, actor, helpers, threat);
  if (!choice) return false;

  clearNonSlotTasks(brain, "dartBoxTask");
  setTask(brain, "dartBoxTask", "dartBox", choice.box, game, { lockSeconds: TASK_COMMIT_SECONDS + 0.6, reason: "refill darts" });
  const interactDistance = Number(helpers?.dartBoxInteractRadius || 74);
  if (holdOrCreepToInteraction(game, actor, helpers, choice.box, interactDistance, "hold-dart-box", "close-dart-box", choice.box.id, { holdBuffer: -2, creepBuffer: 78 })) {
    return true;
  }
  return followPath(game, actor, helpers, choice.approach, {
    key: `dartbox:${choice.box.id}`,
    kind: "dart-box",
    targetId: choice.box.id,
    sprint: true,
    stopDistance: 8,
    repathSeconds: THINK_PATH_REPLAN_SECONDS,
    nodeLimit: 720
  });
}

function interactionObjectLocked(game, actor, item) {
  if (!game?.actors || !item?.object) return false;
  const vaultType = item.type === "palletVault" ? "pallet" : item.type === "window" ? "window" : null;
  if (!vaultType) return false;
  for (const other of game.actors.values()) {
    if (!other || other === actor) continue;
    if (other.vault?.objectId === item.object.id && other.vault?.vaultType === vaultType) return true;
  }
  return false;
}

function interactionObjectUsableForActor(actor, item, game = null) {
  if (!item?.object) return false;
  if (interactionObjectLocked(game, actor, item)) return false;
  if (item.type === "window") return (actor.windowVaultCooldown || 0) <= 0;
  if (item.type === "palletVault") return item.object.state === "dropped" && (actor.palletVaultCooldown || 0) <= 0;
  if (item.type === "palletDrop") return item.object.state === "upright" && !item.object.broken;
  return true;
}

function interactionObjects(game, actor = null) {
  const windows = (game?.map?.windows || []).map((object) => ({ type: "window", object, x: centerOf(object).x, y: centerOf(object).y }));
  const pallets = (game?.map?.pallets || [])
    .filter((object) => object && !object.broken)
    .map((object) => ({ type: object.state === "dropped" ? "palletVault" : "palletDrop", object, x: centerOf(object).x, y: centerOf(object).y }));
  const all = [...windows, ...pallets];
  return actor ? all.filter((item) => interactionObjectUsableForActor(actor, item, game)) : all;
}

function findInteractionObject(game, type, id) {
  if (!type || !id) return null;
  if (type === "window") {
    const object = (game?.map?.windows || []).find((win) => win?.id === id) || null;
    return object ? { type, object, x: centerOf(object).x, y: centerOf(object).y } : null;
  }
  if (type === "palletVault" || type === "palletDrop") {
    const object = (game?.map?.pallets || []).find((pallet) => pallet?.id === id && !pallet.broken) || null;
    if (!object) return null;
    const actualType = object.state === "dropped" ? "palletVault" : "palletDrop";
    return actualType === type ? { type, object, x: centerOf(object).x, y: centerOf(object).y } : null;
  }
  return null;
}

function objectApproachPoints(game, actor, object, helpers, preferredAwayFrom = null) {
  const c = centerOf(object);
  const tile = Number(game?.map?.tile || 72);
  const gap = tile * 0.86;
  const raw = [
    { x: c.x - gap, y: c.y },
    { x: c.x + gap, y: c.y },
    { x: c.x, y: c.y - gap },
    { x: c.x, y: c.y + gap },
    { x: c.x - gap, y: c.y - gap },
    { x: c.x + gap, y: c.y - gap },
    { x: c.x - gap, y: c.y + gap },
    { x: c.x + gap, y: c.y + gap }
  ];
  return raw
    .map((p) => ({ x: clamp(p.x, 44, game.map.width - 44), y: clamp(p.y, 44, game.map.height - 44) }))
    .filter((p) => actorCanStandAt(game, actor, p.x, p.y, helpers))
    .sort((a, b) => {
      const da = helperDist(helpers, actor.x, actor.y, a.x, a.y);
      const db = helperDist(helpers, actor.x, actor.y, b.x, b.y);
      if (!preferredAwayFrom) return da - db;
      const fa = helperDist(helpers, preferredAwayFrom.x, preferredAwayFrom.y, a.x, a.y);
      const fb = helperDist(helpers, preferredAwayFrom.x, preferredAwayFrom.y, b.x, b.y);
      return (db - da) * 0.25 + (fb - fa);
    });
}

function nearestCurrentInteractable(game, actor, helpers) {
  const interactDistance = Number(helpers?.interactDistance || 96);
  let best = null;
  for (const item of interactionObjects(game, actor)) {
    const d = helperDist(helpers, actor.x, actor.y, item.x, item.y);
    // Do not press Space early. The server only accepts the interaction inside
    // INTERACT_DISTANCE, so acting from the outer edge made bots freeze near
    // windows and pallets while accomplishing exactly nothing. Art imitates QA.
    if (d > interactDistance - 4) continue;
    if (!best || d < best.d) best = { ...item, d };
  }
  return best;
}

function chooseSafetyObject(game, actor, helpers, threat) {
  const killer = threat?.killer;
  if (!killer) return null;
  const objects = interactionObjects(game, actor)
    .map((item) => ({ ...item, d: helperDist(helpers, actor.x, actor.y, item.x, item.y) }))
    .filter((item) => item.d <= 1050)
    .sort((a, b) => a.d - b.d)
    .slice(0, SAFETY_SCAN_LIMIT);

  let best = null;
  let bestScore = Infinity;
  for (const item of objects) {
    const approaches = objectApproachPoints(game, actor, item.object, helpers, killer).slice(0, 4);
    for (const approach of approaches) {
      const path = buildWorldPath(game, actor, helpers, approach, { nodeLimit: 650, goalRadius: 3 });
      if (!path) continue;
      const objectDistanceToKiller = helperDist(helpers, killer.x, killer.y, item.x, item.y);
      const approachDistanceToKiller = helperDist(helpers, killer.x, killer.y, approach.x, approach.y);
      const usableBonus = item.type === "window" || item.type === "palletVault" ? -180 : -80;
      const score = path.length * 40 + item.d * 0.45 - approachDistanceToKiller * 0.55 - objectDistanceToKiller * 0.25 + usableBonus;
      if (score < bestScore) {
        bestScore = score;
        best = { ...item, approach, path };
      }
    }
  }
  return best;
}

function chooseFleePoint(game, actor, helpers, threat) {
  const killer = threat?.killer;
  if (!killer) return null;
  const tile = Number(game?.map?.tile || 72);
  const baseAngle = Math.atan2(actor.y - killer.y, actor.x - killer.x);
  const candidates = [];
  const spreads = [0, -0.45, 0.45, -0.9, 0.9, Math.PI, -Math.PI * 0.75, Math.PI * 0.75];
  for (const spread of spreads) {
    const angle = baseAngle + spread;
    for (const radius of [tile * 4.2, tile * 6.2, tile * 8.0]) {
      candidates.push({
        x: clamp(actor.x + Math.cos(angle) * radius, 44, game.map.width - 44),
        y: clamp(actor.y + Math.sin(angle) * radius, 44, game.map.height - 44)
      });
    }
  }

  let best = null;
  let bestScore = -Infinity;
  for (const p of candidates) {
    if (!actorCanStandAt(game, actor, p.x, p.y, helpers)) continue;
    const path = buildWorldPath(game, actor, helpers, p, { nodeLimit: 520, goalRadius: 4 });
    if (!path) continue;
    const far = helperDist(helpers, p.x, p.y, killer.x, killer.y);
    const progress = helperDist(helpers, actor.x, actor.y, killer.x, killer.y);
    const score = far * 1.7 - path.length * 35 + (far > progress ? 260 : -260);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function postObjectTarget(game, actor, object, helpers, killer) {
  const c = centerOf(object);
  const tile = Number(game?.map?.tile || 72);
  const dx = c.x - (killer?.x ?? actor.x);
  const dy = c.y - (killer?.y ?? actor.y);
  const len = Math.hypot(dx, dy) || 1;
  const target = {
    x: clamp(c.x + (dx / len) * tile * 1.8, 44, game.map.width - 44),
    y: clamp(c.y + (dy / len) * tile * 1.8, 44, game.map.height - 44)
  };
  if (actorCanStandAt(game, actor, target.x, target.y, helpers)) return target;
  return chooseFleePoint(game, actor, helpers, { killer }) || target;
}

function runPostInteract(game, actor, helpers, dt) {
  const brain = ensureBotBrain(actor);
  if (!brain.afterInteractTarget || now(game) > (brain.afterInteractUntil || 0)) return false;
  clearNonSlotTasks(brain, null);
  const ok = followPath(game, actor, helpers, brain.afterInteractTarget, {
    key: "post-interact",
    kind: "post-interact",
    sprint: true,
    stopDistance: 38,
    repathSeconds: CHASE_PATH_REPLAN_SECONDS,
    nodeLimit: 500
  });
  if (!ok) setMoveToward(actor, brain.afterInteractTarget, true);
  return true;
}

function shouldUseSafetyNow(item, threat) {
  if (!item) return false;
  if (item.type === "window" || item.type === "palletVault") return true;
  return threat?.distance <= 250 || !!threat?.panic;
}

function tryUseSafetyObject(game, actor, helpers, threat, item) {
  if (!item?.object || !interactionObjectUsableForActor(actor, item, game)) return false;
  if (!shouldUseSafetyNow(item, threat)) return false;

  const brain = ensureBotBrain(actor);
  const interactDistance = Number(helpers?.interactDistance || 96);
  const c = centerOf(item.object);
  const d = helperDist(helpers, actor.x, actor.y, c.x, c.y);

  // Do not require a perfect segment clear here. A window/pallet is itself a
  // collider, so a strict wall segment check can claim the interactable blocks
  // its own interaction. Humanity peaked when it invented doors, then wrote LOS
  // checks that forgot what doors are.
  if (d <= interactDistance - 4) {
    stopAndFace(actor, c);
    actor.input.action = true;
    actor.input.sprint = true;
    brain.survivalTask = {
      kind: item.type,
      id: item.object.id || null,
      x: c.x,
      y: c.y,
      lockUntil: now(game) + CHASE_COMMIT_SECONDS,
      reason: "use safety"
    };
    brain.afterInteractTarget = postObjectTarget(game, actor, item.object, helpers, threat?.killer || null);
    brain.afterInteractUntil = now(game) + SAFETY_POST_ACTION_SECONDS;
    brain.nextStep = { kind: item.type, targetId: item.object.id || null };
    clearPath(brain);
    return true;
  }

  if (d <= interactDistance + SAFETY_ACTION_BUFFER) {
    setMoveToward(actor, c, true);
    actor.input.action = false;
    brain.survivalTask = {
      kind: item.type,
      id: item.object.id || null,
      x: c.x,
      y: c.y,
      lockUntil: now(game) + CHASE_COMMIT_SECONDS,
      reason: "close safety"
    };
    brain.nextStep = { kind: `close-${item.type}`, targetId: item.object.id || null };
    return true;
  }

  return false;
}

function runFlee(game, actor, helpers, dt, threat) {
  const brain = ensureBotBrain(actor);
  clearNonSlotTasks(brain, "survivalTask");
  tryUseSpeedBurst(game, actor, helpers, threat);
  tryUseChaseAbilities(game, actor, helpers, threat);

  const current = nearestCurrentInteractable(game, actor, helpers);
  if (current && tryUseSafetyObject(game, actor, helpers, threat, current)) return true;

  const lockedSafety = brain.survivalTask?.id
    ? findInteractionObject(game, brain.survivalTask.kind, brain.survivalTask.id)
    : null;
  if (lockedSafety && (brain.survivalTask.lockUntil || 0) > now(game) && tryUseSafetyObject(game, actor, helpers, threat, lockedSafety)) return true;

  let target = null;
  const locked = brain.survivalTask && brain.survivalTask.x && (brain.survivalTask.lockUntil || 0) > now(game);
  if (locked) target = { x: brain.survivalTask.x, y: brain.survivalTask.y };

  if (!target) {
    const safety = chooseSafetyObject(game, actor, helpers, threat);
    if (safety) {
      target = safety.approach;
      brain.survivalTask = {
        kind: safety.type,
        id: safety.object.id,
        x: target.x,
        y: target.y,
        lockUntil: now(game) + CHASE_COMMIT_SECONDS,
        reason: "safety object"
      };
      brain.path = safety.path;
      brain.pathKey = `safety:${safety.object.id}:${Math.round(target.x)},${Math.round(target.y)}`;
      brain.repathAt = now(game) + CHASE_PATH_REPLAN_SECONDS;
      if (tryUseSafetyObject(game, actor, helpers, threat, safety)) return true;
    }
  }

  if (!target) {
    target = chooseFleePoint(game, actor, helpers, threat);
    if (target) {
      brain.survivalTask = { kind: "flee", id: null, x: target.x, y: target.y, lockUntil: now(game) + CHASE_COMMIT_SECONDS, reason: "away from void" };
    }
  }

  if (!target) {
    directFlee(actor, threat.killer);
    brain.nextStep = { kind: "direct-flee", targetId: threat.killer?.id || null };
    return true;
  }

  const ok = followPath(game, actor, helpers, target, {
    key: `flee:${Math.round(target.x)},${Math.round(target.y)}`,
    kind: "flee",
    sprint: true,
    stopDistance: 8,
    repathSeconds: CHASE_PATH_REPLAN_SECONDS,
    nodeLimit: 650
  });
  if (!ok) directFlee(actor, threat.killer);
  return true;
}

function approachPointForTarget(game, actor, helpers, target, radius, options = {}) {
  // Keep approach points inside the actual server interaction radius. The old
  // outer ring plus a loose stopDistance left bots close-ish, but not close
  // enough for deposits/unhooks/heals to start. Very brave, very useless.
  const rings = [radius * 0.55, radius * 0.72, radius * 0.9, radius * 1.05].filter((r) => r > 24);
  const steps = 16;
  let best = null;
  let bestScore = Infinity;
  for (const r of rings) {
    for (let i = 0; i < steps; i++) {
      const angle = (Math.PI * 2 * i) / steps;
      const p = {
        x: clamp(target.x + Math.cos(angle) * r, 44, game.map.width - 44),
        y: clamp(target.y + Math.sin(angle) * r, 44, game.map.height - 44)
      };
      if (!actorCanStandAt(game, actor, p.x, p.y, helpers)) continue;
      if (options.requireLos !== false && !segmentClear(game, p.x, p.y, target.x, target.y, helpers)) continue;
      const path = buildWorldPath(game, actor, helpers, p, { nodeLimit: options.nodeLimit || 900, goalRadius: 4 });
      if (!path) continue;
      const d = helperDist(helpers, actor.x, actor.y, p.x, p.y);
      const score = path.length * 40 + d;
      if (score < bestScore) {
        bestScore = score;
        best = { ...p, path };
      }
    }
  }
  return best;
}

function rescueClaimedByOther(game, actor, target) {
  let closestClaimer = null;
  let closestDistance = Infinity;
  for (const other of game?.actors?.values?.() || []) {
    if (!other?.isBot || other.id === actor.id || !isActiveSurvivor(other)) continue;
    const brain = other.bot?.simpleAi;
    if (brain?.unhookTask?.id !== target.id) continue;
    const d = dist(other.x, other.y, target.x, target.y);
    if (d < closestDistance) {
      closestDistance = d;
      closestClaimer = other;
    }
  }
  if (!closestClaimer) return false;
  const myD = dist(actor.x, actor.y, target.x, target.y);
  return closestDistance + 130 < myD && (closestClaimer.bot?.simpleAi?.unhookTask?.lockUntil || 0) > now(game);
}

function chooseHookedTarget(game, actor, helpers, threat) {
  let best = null;
  let bestScore = Infinity;
  const killer = threat?.killer || nearestKiller(game, actor).killer;
  for (const target of game?.actors?.values?.() || []) {
    if (!target || target.id === actor.id || target.role !== "survivor" || !target.hooked || target.dead || target.escaped) continue;
    if (rescueClaimedByOther(game, actor, target)) continue;
    const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
    if (d > RESCUE_SCAN_DISTANCE) continue;
    const killerD = killer ? helperDist(helpers, killer.x, killer.y, target.x, target.y) : Infinity;
    if (!game.escapeOpen && killerD < KILLER_CAMP_HOOK_RADIUS) continue;
    const approach = approachPointForTarget(game, actor, helpers, target, Number(helpers?.hookRescueDistance || 96) * 0.78, { nodeLimit: 800 });
    if (!approach) continue;
    const campPenalty = killerD < KILLER_CAMP_SOFT_RADIUS ? 900 : 0;
    const score = d + approach.path.length * 45 + campPenalty - (game.escapeOpen ? 300 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { target, approach };
    }
  }
  return best;
}

function runUnhook(game, actor, helpers, dt, threat) {
  const brain = ensureBotBrain(actor);
  const lockedTarget = brain.unhookTask?.id ? getActorById(game, brain.unhookTask.id) : null;
  let choice = null;
  if (lockedTarget?.hooked && !lockedTarget.dead && !lockedTarget.escaped && (brain.unhookTask.lockUntil || 0) > now(game)) {
    const approach = approachPointForTarget(game, actor, helpers, lockedTarget, Number(helpers?.hookRescueDistance || 96) * 0.78, { nodeLimit: 800 });
    if (approach) choice = { target: lockedTarget, approach };
  }
  if (!choice) choice = chooseHookedTarget(game, actor, helpers, threat);
  if (!choice) {
    brain.unhookTask = null;
    return false;
  }

  clearNonSlotTasks(brain, "unhookTask");
  setTask(brain, "unhookTask", "unhook", choice.target, game, { lockSeconds: RESCUE_COMMIT_SECONDS, reason: "rescue teammate" });

  const rescueDistance = Number(helpers?.hookRescueDistance || 96);
  if (holdOrCreepToInteraction(game, actor, helpers, choice.target, rescueDistance, "hold-unhook", "close-unhook", choice.target.id, { holdBuffer: 8, creepBuffer: 84 })) {
    return true;
  }

  const ok = followPath(game, actor, helpers, choice.approach, {
    key: `unhook:${choice.target.id}`,
    kind: "unhook",
    targetId: choice.target.id,
    sprint: true,
    stopDistance: 6,
    repathSeconds: THINK_PATH_REPLAN_SECONDS,
    nodeLimit: 850
  });
  return ok;
}

function chooseHealTarget(game, actor, helpers, threat) {
  let best = null;
  let bestScore = Infinity;
  const killer = threat?.killer || nearestKiller(game, actor).killer;
  for (const target of game?.actors?.values?.() || []) {
    if (!target || target.id === actor.id || !isWoundedSurvivor(target)) continue;
    const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
    if (d > HEAL_SCAN_DISTANCE) continue;
    if (killer && helperDist(helpers, killer.x, killer.y, target.x, target.y) < KILLER_CHASE_RADIUS) continue;
    const approach = approachPointForTarget(game, actor, helpers, target, Number(helpers?.healDistance || 82) * 0.78, { nodeLimit: 600 });
    if (!approach) continue;
    const claimed = botTaskClaimCount(game, actor, "healTask", "heal", target.id);
    const claimPenalty = target.downed ? claimed * 120 : claimed * 420;
    const score = d + approach.path.length * 35 + claimPenalty - (target.downed ? 260 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { target, approach };
    }
  }
  return best;
}

function runHeal(game, actor, helpers, dt, threat) {
  const brain = ensureBotBrain(actor);
  if (actor.injured && !actor.downed) return false;
  const lockedTarget = brain.healTask?.id ? getActorById(game, brain.healTask.id) : null;
  let choice = null;
  if (lockedTarget && isWoundedSurvivor(lockedTarget) && (brain.healTask.lockUntil || 0) > now(game)) {
    const approach = approachPointForTarget(game, actor, helpers, lockedTarget, Number(helpers?.healDistance || 82) * 0.78, { nodeLimit: 600 });
    if (approach) choice = { target: lockedTarget, approach };
  }
  if (!choice) choice = chooseHealTarget(game, actor, helpers, threat);
  if (!choice) {
    brain.healTask = null;
    return false;
  }

  clearNonSlotTasks(brain, "healTask");
  setTask(brain, "healTask", "heal", choice.target, game, { lockSeconds: HEAL_COMMIT_SECONDS, reason: "heal teammate" });
  const healDistance = Number(helpers?.healDistance || 82);
  if (holdOrCreepToInteraction(game, actor, helpers, choice.target, healDistance, "hold-heal", "close-heal", choice.target.id, { holdBuffer: 6, creepBuffer: 72 })) {
    return true;
  }
  return followPath(game, actor, helpers, choice.approach, {
    key: `heal:${choice.target.id}`,
    kind: "heal",
    targetId: choice.target.id,
    sprint: true,
    stopDistance: 6,
    repathSeconds: THINK_PATH_REPLAN_SECONDS,
    nodeLimit: 650
  });
}

function chooseGate(game, actor, helpers) {
  let best = null;
  let bestScore = Infinity;
  for (const gate of game?.map?.gates || []) {
    if (!gate?.open) continue;
    const approach = approachPointForTarget(game, actor, helpers, gate, Number(helpers?.interactDistance || 96) * 0.82, { nodeLimit: 850, requireLos: false });
    if (!approach) continue;
    const d = helperDist(helpers, actor.x, actor.y, gate.x, gate.y);
    const score = d + approach.path.length * 35;
    if (score < bestScore) {
      bestScore = score;
      best = { gate, approach };
    }
  }
  return best;
}

function runEscape(game, actor, helpers, dt) {
  if (!game.escapeOpen) return false;
  const brain = ensureBotBrain(actor);
  const lockedGate = brain.escapeTask?.id ? (game.map.gates || []).find((g) => g.id === brain.escapeTask.id) : null;
  let choice = null;
  if (lockedGate?.open && (brain.escapeTask.lockUntil || 0) > now(game)) {
    const approach = approachPointForTarget(game, actor, helpers, lockedGate, Number(helpers?.interactDistance || 96) * 0.82, { nodeLimit: 850, requireLos: false });
    if (approach) choice = { gate: lockedGate, approach };
  }
  if (!choice) choice = chooseGate(game, actor, helpers);
  if (!choice) return false;
  clearNonSlotTasks(brain, "escapeTask");
  setTask(brain, "escapeTask", "escape", choice.gate, game, { lockSeconds: ESCAPE_COMMIT_SECONDS, reason: "gate open" });

  const gateDistance = Number(helpers?.interactDistance || 96) + 16;
  if (holdOrCreepToInteraction(game, actor, helpers, choice.gate, gateDistance, "hold-escape", "close-escape", choice.gate.id, { holdBuffer: 0, creepBuffer: 84, requireLos: false })) {
    return true;
  }

  return followPath(game, actor, helpers, choice.approach, {
    key: `escape:${choice.gate.id}`,
    kind: "escape",
    targetId: choice.gate.id,
    sprint: true,
    stopDistance: 6,
    repathSeconds: THINK_PATH_REPLAN_SECONDS,
    nodeLimit: 850
  });
}

function unfinishedRifts(game) {
  return (game?.map?.generators || []).filter((g) => g && !g.done);
}

function botTaskClaimCount(game, actor, slot, kind, id) {
  if (!id || !game?.actors) return 0;
  let count = 0;
  const t = now(game);
  for (const other of game.actors.values()) {
    if (!other?.isBot || other.id === actor.id || other.role !== "survivor") continue;
    if (other.dead || other.escaped || other.hooked || other.downed) continue;
    const task = other.bot?.simpleAi?.[slot];
    if (task?.kind === kind && task.id === id && (task.lockUntil || 0) > t) count++;
  }
  return count;
}

function killerDangerPenalty(game, x, y, helpers, threat = null) {
  const killer = threat?.killer || null;
  if (!killer || killer.dead || killer.escaped) return 0;
  const d = helperDist(helpers, killer.x, killer.y, x, y);
  if (d > KILLER_THREAT_RADIUS + 220) return 0;
  const los = segmentClear(game, x, y, killer.x, killer.y, helpers);
  const close = Math.max(0, KILLER_THREAT_RADIUS + 220 - d);
  const panic = d <= KILLER_PANIC_RADIUS ? 950 : 0;
  const chase = d <= KILLER_CHASE_RADIUS ? 520 : 0;
  return close * (los ? 1.25 : 0.55) + panic + chase;
}

function nearestUnfinishedRiftDistance(game, helpers, x, y) {
  let best = Infinity;
  for (const rift of unfinishedRifts(game)) {
    const d = helperDist(helpers, x, y, rift.x, rift.y);
    if (d < best) best = d;
  }
  return best;
}

function chooseRift(game, actor, helpers, threat = null) {
  const carried = carriedOrbs(actor);
  let best = null;
  let bestScore = Infinity;
  for (const rift of unfinishedRifts(game)) {
    const approach = approachPointForTarget(game, actor, helpers, rift, Number(helpers?.dotDepositDistance || 96) * 0.76, { nodeLimit: 950 });
    if (!approach) continue;
    const d = helperDist(helpers, actor.x, actor.y, rift.x, rift.y);
    const progress = clamp(Number(rift.progress || 0), 0, 1);
    const claimed = botTaskClaimCount(game, actor, "task", "deposit", rift.id);
    const danger = killerDangerPenalty(game, rift.x, rift.y, helpers, threat);
    const score = d
      + approach.path.length * 36
      + claimed * 180
      + danger * 0.62
      - progress * 520
      - Math.min(carried, 12) * 18;
    if (score < bestScore) {
      bestScore = score;
      best = { rift, approach };
    }
  }
  return best;
}

function chooseOrb(game, actor, helpers, threat = null) {
  const dots = (game?.collectibleDots || []).filter(Boolean);
  if (!dots.length) return null;
  const shortlist = dots
    .filter((dot) => Number.isFinite(dot.x) && Number.isFinite(dot.y))
    .map((dot) => ({ dot, d: helperDist(helpers, actor.x, actor.y, dot.x, dot.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, OBJECTIVE_SCAN_LIMIT);

  let best = null;
  let bestScore = Infinity;
  for (const item of shortlist) {
    const path = buildWorldPath(game, actor, helpers, item.dot, { nodeLimit: 800, goalRadius: 3 });
    if (!path) continue;
    const claimed = botTaskClaimCount(game, actor, "task", "orb", item.dot.id);
    const danger = killerDangerPenalty(game, item.dot.x, item.dot.y, helpers, threat);
    const riftDistance = nearestUnfinishedRiftDistance(game, helpers, item.dot.x, item.dot.y);
    const score = item.d
      + path.length * 34
      + claimed * 420
      + danger * 0.8
      + (Number.isFinite(riftDistance) ? riftDistance * 0.08 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { dot: item.dot, path };
    }
  }
  return best;
}

function nearAnyRift(game, actor, helpers) {
  const distanceLimit = Number(helpers?.dotDepositDistance || 96) * 1.25;
  let best = null;
  let bestD = Infinity;
  for (const rift of unfinishedRifts(game)) {
    const d = helperDist(helpers, actor.x, actor.y, rift.x, rift.y);
    if (d > distanceLimit || d >= bestD) continue;
    if (!segmentClear(game, actor.x, actor.y, rift.x, rift.y, helpers)) continue;
    best = rift;
    bestD = d;
  }
  return best;
}

function shouldDeposit(game, actor, helpers) {
  const carried = carriedOrbs(actor);
  if (carried <= 0) return false;
  if (nearAnyRift(game, actor, helpers)) return true;
  if (carried >= Number(helpers?.survivorDotMax || 30)) return true;
  if (carried >= DEPOSIT_AFTER_ORBS) return true;
  if (!(game.collectibleDots || []).length) return true;
  return false;
}

function runDeposit(game, actor, helpers, dt, threat = null) {
  const brain = ensureBotBrain(actor);
  if (carriedOrbs(actor) <= 0) {
    clearZeroOrbDepositState(actor, brain);
    return false;
  }

  const lockedRift = brain.task?.kind === "deposit" && brain.task.id
    ? (game.map.generators || []).find((g) => g.id === brain.task.id && !g.done)
    : null;
  let choice = null;
  if (lockedRift && (brain.task.lockUntil || 0) > now(game)) {
    const approach = approachPointForTarget(game, actor, helpers, lockedRift, Number(helpers?.dotDepositDistance || 96) * 0.76, { nodeLimit: 950 });
    if (approach) choice = { rift: lockedRift, approach };
  }
  if (!choice) choice = chooseRift(game, actor, helpers, threat);
  if (!choice) return false;
  if (carriedOrbs(actor) <= 0) {
    clearZeroOrbDepositState(actor, brain);
    return false;
  }

  clearNonSlotTasks(brain, "task");
  setTask(brain, "task", "deposit", choice.rift, game, { lockSeconds: TASK_COMMIT_SECONDS, reason: "deposit carried orbs" });
  const depositDistance = Number(helpers?.dotDepositDistance || 96);
  if (holdOrCreepToInteraction(game, actor, helpers, choice.rift, depositDistance, "hold-deposit", "close-deposit", choice.rift.id, { holdBuffer: 6, creepBuffer: 84 })) {
    return true;
  }
  return followPath(game, actor, helpers, choice.approach, {
    key: `deposit:${choice.rift.id}`,
    kind: "deposit",
    targetId: choice.rift.id,
    sprint: true,
    stopDistance: 6,
    repathSeconds: THINK_PATH_REPLAN_SECONDS,
    nodeLimit: 950
  });
}

function runCollectOrb(game, actor, helpers, dt, threat = null) {
  const brain = ensureBotBrain(actor);
  if ((actor.dots || 0) >= Number(helpers?.survivorDotMax || 30)) return false;

  const lockedDot = brain.task?.kind === "orb" && brain.task.id
    ? (game.collectibleDots || []).find((d) => d.id === brain.task.id)
    : null;
  let choice = null;
  if (lockedDot && (brain.task.lockUntil || 0) > now(game)) {
    const path = buildWorldPath(game, actor, helpers, lockedDot, { nodeLimit: 800, goalRadius: 3 });
    if (path) choice = { dot: lockedDot, path };
  }
  if (!choice) choice = chooseOrb(game, actor, helpers, threat);
  if (!choice) return false;

  clearNonSlotTasks(brain, "task");
  setTask(brain, "task", "orb", choice.dot, game, { lockSeconds: TASK_COMMIT_SECONDS, reason: "collect orb" });
  const pickup = Number(helpers?.survivorPickupRadius || 48);
  if (helperDist(helpers, actor.x, actor.y, choice.dot.x, choice.dot.y) <= pickup * 0.8 && segmentClear(game, actor.x, actor.y, choice.dot.x, choice.dot.y, helpers)) {
    setMoveToward(actor, choice.dot, true);
    brain.nextStep = { kind: "collect-close", targetId: choice.dot.id };
    return true;
  }
  brain.path = choice.path;
  brain.pathKey = `orb:${choice.dot.id}`;
  brain.repathAt = Math.max(brain.repathAt || 0, now(game) + THINK_PATH_REPLAN_SECONDS * 0.75);
  return followPath(game, actor, helpers, choice.dot, {
    key: `orb:${choice.dot.id}`,
    kind: "orb",
    targetId: choice.dot.id,
    sprint: true,
    stopDistance: Math.max(18, pickup * 0.45),
    repathSeconds: THINK_PATH_REPLAN_SECONDS,
    nodeLimit: 800
  });
}

function chooseIdlePoint(game, actor, helpers) {
  const tile = Number(game?.map?.tile || 72);
  const angleSeed = ((String(actor.id || "bot").split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) % 360) * Math.PI) / 180;
  for (let i = 0; i < 10; i++) {
    const a = angleSeed + i * 0.72 + now(game) * 0.05;
    const r = tile * (2.5 + (i % 4));
    const p = { x: clamp(actor.x + Math.cos(a) * r, 44, game.map.width - 44), y: clamp(actor.y + Math.sin(a) * r, 44, game.map.height - 44) };
    if (!actorCanStandAt(game, actor, p.x, p.y, helpers)) continue;
    const path = buildWorldPath(game, actor, helpers, p, { nodeLimit: 450, goalRadius: 4 });
    if (path) return p;
  }
  return null;
}

function runIdle(game, actor, helpers, dt) {
  const brain = ensureBotBrain(actor);
  clearNonSlotTasks(brain, "task");
  if (!brain.task || brain.task.kind !== "idle" || (brain.task.lockUntil || 0) <= now(game)) {
    const p = chooseIdlePoint(game, actor, helpers);
    if (!p) {
      stopAndFace(actor, null);
      brain.nextStep = { kind: "idle", targetId: null };
      return true;
    }
    brain.task = { kind: "idle", id: null, x: p.x, y: p.y, lockUntil: now(game) + 2.0, reason: "idle patrol" };
    clearPath(brain);
  }
  return followPath(game, actor, helpers, brain.task, {
    key: `idle:${Math.round(brain.task.x)},${Math.round(brain.task.y)}`,
    kind: "idle",
    sprint: true,
    stopDistance: 36,
    repathSeconds: THINK_PATH_REPLAN_SECONDS,
    nodeLimit: 450
  });
}

function healerCanStillHealMe(game, actor, healer, helpers, threat) {
  if (!actor || !healer || healer.id === actor.id) return false;
  if (actor.dead || actor.escaped || actor.hooked || actor.downed) return false;
  if (!(actor.injured || actor.health === 1)) return false;
  if (threat?.danger) return false;
  if (healer.role !== "survivor" || healer.dead || healer.escaped || healer.hooked || healer.downed) return false;
  if (healer.escapeGateId || healer.escaping || healer.escapeProgress > 0) return false;

  const healDistance = Number(helpers?.healDistance || 82);
  const d = helperDist(helpers, actor.x, actor.y, healer.x, healer.y);
  if (d > healDistance + 70) return false;
  if (!segmentClear(game, actor.x, actor.y, healer.x, healer.y, helpers)) return false;

  const otherBrain = healer.bot?.simpleAi || null;
  const assigned = otherBrain?.healTask?.id === actor.id && (otherBrain.healTask.lockUntil || 0) > now(game);
  const alreadyHealing = healer.healingTargetId === actor.id || (actor.activeHealers || []).includes(healer.id);
  const otherMoving = !!(healer.input?.up || healer.input?.down || healer.input?.left || healer.input?.right || healer.vault);
  const closeStationary = d <= healDistance + 28 && !otherMoving;

  return !!(assigned || alreadyHealing || closeStationary);
}

function healerTryingToHealMe(game, actor, helpers, threat) {
  if (!actor || actor.dead || actor.escaped || actor.hooked || actor.downed) return null;
  if (!(actor.injured || actor.health === 1)) return null;
  if (threat?.danger) return null;

  const healDistance = Number(helpers?.healDistance || 82);
  let best = null;
  let bestScore = Infinity;
  for (const other of game?.actors?.values?.() || []) {
    if (!healerCanStillHealMe(game, actor, other, helpers, threat)) continue;
    const d = helperDist(helpers, actor.x, actor.y, other.x, other.y);
    const otherBrain = other.bot?.simpleAi || null;
    const assigned = otherBrain?.healTask?.id === actor.id && (otherBrain.healTask.lockUntil || 0) > now(game);
    const alreadyHealing = other.healingTargetId === actor.id || (actor.activeHealers || []).includes(other.id);
    const score = d - (assigned ? 220 : 0) - (alreadyHealing ? 420 : 0) - (d <= healDistance + 28 ? 70 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

function clearStaleReceiveHeal(brain) {
  if (brain?.task?.kind !== "receive-heal") return;
  brain.task = null;
  if (brain.nextStep?.kind === "receive-heal") brain.nextStep = null;
  clearPath(brain);
}

function runReceiveHeal(game, actor, helpers, dt, threat) {
  const brain = ensureBotBrain(actor);

  const lockedHealer = brain.task?.kind === "receive-heal" && brain.task.id
    ? getActorById(game, brain.task.id)
    : null;
  const lockedStillValid = lockedHealer
    && (brain.task.lockUntil || 0) > now(game)
    && !threat?.hardDanger
    && healerCanStillHealMe(game, actor, lockedHealer, helpers, threat);

  const healer = lockedStillValid ? lockedHealer : healerTryingToHealMe(game, actor, helpers, threat);
  if (!healer) {
    clearStaleReceiveHeal(brain);
    return false;
  }

  clearNonSlotTasks(brain, null);
  clearPath(brain);
  stopAndFace(actor, healer);
  brain.nextStep = { kind: "receive-heal", targetId: healer.id };
  brain.task = {
    kind: "receive-heal",
    id: healer.id,
    x: healer.x,
    y: healer.y,
    lockUntil: now(game) + RECEIVE_HEAL_LOCK_SECONDS,
    reason: "let teammate heal"
  };
  return true;
}

function runObjectives(game, actor, helpers, dt, threat = null) {
  if (!unfinishedRifts(game).length && !game.escapeOpen) return runIdle(game, actor, helpers, dt);

  const carried = carriedOrbs(actor);
  if (carried <= 0) clearZeroOrbDepositState(actor, ensureBotBrain(actor));

  if (carried > 0 && shouldDeposit(game, actor, helpers) && runDeposit(game, actor, helpers, dt, threat)) return true;

  tryUseObjectiveAbilities(game, actor, helpers, threat);
  if (runDartBox(game, actor, helpers, dt, threat, { force: runnerDartAmmo(actor, helpers) <= 0 })) return true;

  if (runCollectOrb(game, actor, helpers, dt, threat)) return true;
  if (carriedOrbs(actor) > 0 && runDeposit(game, actor, helpers, dt, threat)) return true;
  if (runDartBox(game, actor, helpers, dt, threat)) return true;
  return runIdle(game, actor, helpers, dt);
}

function updateRunner(game, actor, helpers, dt) {
  const brain = ensureBotBrain(actor);
  if (carriedOrbs(actor) <= 0) clearZeroOrbDepositState(actor, brain);

  if (actor.vault) {
    brain.nextStep = { kind: "vaulting", targetId: actor.vault.objectId || null };
    return;
  }

  if (runPostInteract(game, actor, helpers, dt)) return;

  const threat = threatInfo(game, actor, helpers, brain);

  tryUseSupportBolts(game, actor, helpers, threat);

  // Let an active heal finish unless The Void is actually close/visible enough to
  // matter. Stale chase state used to yank bots out of heals from outside terror
  // radius, then healing yanked them back, hence the tiny idiot metronome.
  if (!threat.hardDanger && runReceiveHeal(game, actor, helpers, dt, threat)) return;

  // The simple priority stack. Rescue/deposit/etc. are boring on purpose now.
  if (threat.danger) {
    runFlee(game, actor, helpers, dt, threat);
    return;
  }


  if (runUnhook(game, actor, helpers, dt, threat)) return;

  if (!threat.threatened && runHeal(game, actor, helpers, dt, threat)) return;

  if (game.escapeOpen) {
    if (runEscape(game, actor, helpers, dt)) return;
  }

  runObjectives(game, actor, helpers, dt, threat);
}

function assignRunnerBotPersonalities(game) {
  if (!game?.actors) return;
  const matchKey = String(game.matchId || game.startedAt || game.id || "match");
  for (const actor of game.actors.values()) {
    if (!actor?.isBot || actor.role !== "survivor") continue;
    actor.bot = actor.bot || {};
    actor.bot.personality = { id: PERSONALITY_ID, label: PERSONALITY_LABEL };

    // Do not carry objective intent across matches/spawns. A stale "deposit"
    // task from the previous run is exactly how a zero-orb bot starts praying at
    // a Rift instead of going to collect. Beautiful little disaster.
    if (actor.bot.simpleAiMatchKey !== matchKey) {
      actor.bot.simpleAi = {};
      actor.bot.simpleAiMatchKey = matchKey;
      actor.dotDepositTargetId = null;
      actor.dotDepositProgress = 0;
      actor.dotDepositChain = 0;
    }

    const brain = ensureBotBrain(actor);
    clearZeroOrbDepositState(actor, brain);
  }
}

function updateBotInputs(game, dt, helpers = {}) {
  if (!game?.actors) return;

  // Path caches are per match/map epoch. Clear them if a different map object replaced the old one.
  if (game.__basicRunnerCacheMap !== game.map) {
    game.__basicRunnerGrid = null;
    game.__basicRunnerPathCache = new Map();
    game.__basicRunnerCacheMap = game.map;
  }

  for (const actor of game.actors.values()) {
    if (!actor?.isBot) continue;
    const brain = ensureBotBrain(actor);
    brain.aiNow = now(game);
    const hadMoveInput = !!(actor.input?.up || actor.input?.down || actor.input?.left || actor.input?.right);
    updateStuckState(game, actor, brain, dt, hadMoveInput);

    resetActorInput(actor, helpers);
    actor.bot.actionCooldown = Math.max(0, (actor.bot.actionCooldown || 0) - dt);

    if (actor.dead || actor.escaped || actor.hooked || actor.downed) {
      clearTasks(brain);
      brain.nextStep = { kind: actor.dead ? "dead" : actor.escaped ? "escaped" : actor.hooked ? "hooked" : "downed", targetId: null };
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

    updateRunner(game, actor, helpers, dt);
  }
}

module.exports = {
  assignRunnerBotPersonalities,
  updateBotInputs
};
