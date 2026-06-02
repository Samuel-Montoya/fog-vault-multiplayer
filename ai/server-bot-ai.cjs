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
  brain.nextStep = brain.nextStep || null;
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
  actor.input.sprint = true;
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
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
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

    for (const [dx, dy] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isPassable(grid, nx, ny)) continue;
      const nk = cellKey(nx, ny);
      if (closed.has(nk)) continue;
      const g = current.g + 1;
      const h = Math.abs(goal.x - nx) + Math.abs(goal.y - ny);
      const existing = best.get(nk);
      if (existing && existing.g <= g) continue;
      const node = { x: nx, y: ny, g, f: g + h * 1.05, parent: current };
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

function interactionObjects(game) {
  const windows = (game?.map?.windows || []).map((object) => ({ type: "window", object, x: centerOf(object).x, y: centerOf(object).y }));
  const pallets = (game?.map?.pallets || [])
    .filter((object) => object && !object.broken)
    .map((object) => ({ type: object.state === "dropped" ? "palletVault" : "palletDrop", object, x: centerOf(object).x, y: centerOf(object).y }));
  return [...windows, ...pallets];
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
  for (const item of interactionObjects(game)) {
    const d = helperDist(helpers, actor.x, actor.y, item.x, item.y);
    if (d > interactDistance + 12) continue;
    if (!best || d < best.d) best = { ...item, d };
  }
  return best;
}

function chooseSafetyObject(game, actor, helpers, threat) {
  const killer = threat?.killer;
  if (!killer) return null;
  const objects = interactionObjects(game)
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

function runFlee(game, actor, helpers, dt, threat) {
  const brain = ensureBotBrain(actor);
  clearNonSlotTasks(brain, "survivalTask");
  tryUseSpeedBurst(game, actor, helpers, threat);

  const current = nearestCurrentInteractable(game, actor, helpers);
  if (current) {
    const shouldUse = current.type !== "palletDrop" || threat.distance <= 250 || threat.panic;
    if (shouldUse) {
      actor.input.action = true;
      actor.input.sprint = true;
      actor.input.angle = Math.atan2(current.y - actor.y, current.x - actor.x);
      brain.survivalTask = { kind: current.type, id: current.object.id, lockUntil: now(game) + CHASE_COMMIT_SECONDS, reason: "use safety" };
      brain.afterInteractTarget = postObjectTarget(game, actor, current.object, helpers, threat.killer);
      brain.afterInteractUntil = now(game) + POST_INTERACT_SECONDS;
      return true;
    }
  }

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
    stopDistance: 34,
    repathSeconds: CHASE_PATH_REPLAN_SECONDS,
    nodeLimit: 650
  });
  if (!ok) directFlee(actor, threat.killer);
  return true;
}

function approachPointForTarget(game, actor, helpers, target, radius, options = {}) {
  const rings = [radius * 0.72, radius * 0.92, radius * 1.15].filter((r) => r > 24);
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
  const d = helperDist(helpers, actor.x, actor.y, choice.target.x, choice.target.y);
  if (d <= rescueDistance - 8 && segmentClear(game, actor.x, actor.y, choice.target.x, choice.target.y, helpers)) {
    stopAndFace(actor, choice.target);
    brain.nextStep = { kind: "hold-unhook", targetId: choice.target.id };
    return true;
  }

  const ok = followPath(game, actor, helpers, choice.approach, {
    key: `unhook:${choice.target.id}`,
    kind: "unhook",
    targetId: choice.target.id,
    sprint: true,
    stopDistance: 28,
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
    const score = d + approach.path.length * 35 - (target.downed ? 260 : 0);
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
  const d = helperDist(helpers, actor.x, actor.y, choice.target.x, choice.target.y);
  if (d <= healDistance - 6 && segmentClear(game, actor.x, actor.y, choice.target.x, choice.target.y, helpers)) {
    stopAndFace(actor, choice.target);
    brain.nextStep = { kind: "hold-heal", targetId: choice.target.id };
    return true;
  }
  return followPath(game, actor, helpers, choice.approach, {
    key: `heal:${choice.target.id}`,
    kind: "heal",
    targetId: choice.target.id,
    sprint: true,
    stopDistance: 24,
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
  if (helperDist(helpers, actor.x, actor.y, choice.gate.x, choice.gate.y) <= gateDistance) {
    stopAndFace(actor, choice.gate);
    brain.nextStep = { kind: "hold-escape", targetId: choice.gate.id };
    return true;
  }

  return followPath(game, actor, helpers, choice.approach, {
    key: `escape:${choice.gate.id}`,
    kind: "escape",
    targetId: choice.gate.id,
    sprint: true,
    stopDistance: 28,
    repathSeconds: THINK_PATH_REPLAN_SECONDS,
    nodeLimit: 850
  });
}

function unfinishedRifts(game) {
  return (game?.map?.generators || []).filter((g) => g && !g.done);
}

function chooseRift(game, actor, helpers) {
  const carried = Math.max(0, Math.floor(actor.dots || 0));
  let best = null;
  let bestScore = Infinity;
  for (const rift of unfinishedRifts(game)) {
    const approach = approachPointForTarget(game, actor, helpers, rift, Number(helpers?.dotDepositDistance || 96) * 0.76, { nodeLimit: 950 });
    if (!approach) continue;
    const d = helperDist(helpers, actor.x, actor.y, rift.x, rift.y);
    const progress = clamp(Number(rift.progress || 0), 0, 1);
    const score = d + approach.path.length * 36 - progress * 520 - Math.min(carried, 12) * 18;
    if (score < bestScore) {
      bestScore = score;
      best = { rift, approach };
    }
  }
  return best;
}

function chooseOrb(game, actor, helpers) {
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
    const score = item.d + path.length * 34;
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
  const carried = Math.max(0, Math.floor(actor.dots || 0));
  if (carried <= 0) return false;
  if (nearAnyRift(game, actor, helpers)) return true;
  if (carried >= Number(helpers?.survivorDotMax || 30)) return true;
  if (carried >= DEPOSIT_AFTER_ORBS) return true;
  if (!(game.collectibleDots || []).length) return true;
  return false;
}

function runDeposit(game, actor, helpers, dt) {
  const brain = ensureBotBrain(actor);
  const lockedRift = brain.task?.kind === "deposit" && brain.task.id
    ? (game.map.generators || []).find((g) => g.id === brain.task.id && !g.done)
    : null;
  let choice = null;
  if (lockedRift && (brain.task.lockUntil || 0) > now(game)) {
    const approach = approachPointForTarget(game, actor, helpers, lockedRift, Number(helpers?.dotDepositDistance || 96) * 0.76, { nodeLimit: 950 });
    if (approach) choice = { rift: lockedRift, approach };
  }
  if (!choice) choice = chooseRift(game, actor, helpers);
  if (!choice) return false;

  clearNonSlotTasks(brain, "task");
  setTask(brain, "task", "deposit", choice.rift, game, { lockSeconds: TASK_COMMIT_SECONDS, reason: "deposit carried orbs" });
  const depositDistance = Number(helpers?.dotDepositDistance || 96);
  if (helperDist(helpers, actor.x, actor.y, choice.rift.x, choice.rift.y) <= depositDistance - 6 && segmentClear(game, actor.x, actor.y, choice.rift.x, choice.rift.y, helpers)) {
    stopAndFace(actor, choice.rift);
    brain.nextStep = { kind: "hold-deposit", targetId: choice.rift.id };
    return true;
  }
  return followPath(game, actor, helpers, choice.approach, {
    key: `deposit:${choice.rift.id}`,
    kind: "deposit",
    targetId: choice.rift.id,
    sprint: true,
    stopDistance: 26,
    repathSeconds: THINK_PATH_REPLAN_SECONDS,
    nodeLimit: 950
  });
}

function runCollectOrb(game, actor, helpers, dt) {
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
  if (!choice) choice = chooseOrb(game, actor, helpers);
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

function healerTryingToHealMe(game, actor, helpers, threat) {
  if (!actor || actor.dead || actor.escaped || actor.hooked || actor.downed) return null;
  if (!(actor.injured || actor.health === 1)) return null;
  if (threat?.danger) return null;

  const healDistance = Number(helpers?.healDistance || 82);
  let best = null;
  let bestScore = Infinity;
  for (const other of game?.actors?.values?.() || []) {
    if (!other || other.id === actor.id || other.role !== "survivor" || other.dead || other.escaped || other.hooked || other.downed) continue;
    const d = helperDist(helpers, actor.x, actor.y, other.x, other.y);
    const otherBrain = other.bot?.simpleAi || null;
    const assigned = otherBrain?.healTask?.id === actor.id && (otherBrain.healTask.lockUntil || 0) > now(game);
    const alreadyHealing = other.healingTargetId === actor.id || (actor.activeHealers || []).includes(other.id);
    const otherMoving = !!(other.input?.up || other.input?.down || other.input?.left || other.input?.right || other.vault);
    const closeStationary = d <= healDistance + 28 && !otherMoving && segmentClear(game, actor.x, actor.y, other.x, other.y, helpers);
    if (!assigned && !alreadyHealing && !closeStationary) continue;
    const score = d - (assigned ? 220 : 0) - (alreadyHealing ? 420 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

function runReceiveHeal(game, actor, helpers, dt, threat) {
  const brain = ensureBotBrain(actor);
  const lockedHealer = brain.task?.kind === "receive-heal" && brain.task.id
    ? getActorById(game, brain.task.id)
    : null;
  const lockedStillValid = lockedHealer
    && (brain.task.lockUntil || 0) > now(game)
    && !threat?.hardDanger
    && helperDist(helpers, actor.x, actor.y, lockedHealer.x, lockedHealer.y) <= Number(helpers?.healDistance || 82) + 70;

  const healer = lockedStillValid ? lockedHealer : healerTryingToHealMe(game, actor, helpers, threat);
  if (!healer) return false;

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

function runObjectives(game, actor, helpers, dt) {
  if (!unfinishedRifts(game).length && !game.escapeOpen) return runIdle(game, actor, helpers, dt);
  if (shouldDeposit(game, actor, helpers) && runDeposit(game, actor, helpers, dt)) return true;
  if (runCollectOrb(game, actor, helpers, dt)) return true;
  if ((actor.dots || 0) > 0 && runDeposit(game, actor, helpers, dt)) return true;
  return runIdle(game, actor, helpers, dt);
}

function updateRunner(game, actor, helpers, dt) {
  const brain = ensureBotBrain(actor);

  if (actor.vault) {
    brain.nextStep = { kind: "vaulting", targetId: actor.vault.objectId || null };
    return;
  }

  if (runPostInteract(game, actor, helpers, dt)) return;

  const threat = threatInfo(game, actor, helpers, brain);

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

  runObjectives(game, actor, helpers, dt);
}

function assignRunnerBotPersonalities(game) {
  if (!game?.actors) return;
  for (const actor of game.actors.values()) {
    if (!actor?.isBot || actor.role !== "survivor") continue;
    actor.bot = actor.bot || {};
    actor.bot.personality = { id: PERSONALITY_ID, label: PERSONALITY_LABEL };
    ensureBotBrain(actor);
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
