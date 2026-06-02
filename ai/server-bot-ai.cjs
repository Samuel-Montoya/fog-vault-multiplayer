"use strict";

const voidAi = require("./server-void-ai.cjs");

let FastPriorityQueue = null;
try {
  FastPriorityQueue = require("fastpriorityqueue");
} catch {
  // npm install has not run yet. The tiny local heap below keeps the server alive,
  // because nothing says "fun" like a dependency throwing before the menu loads.
}

class LocalMinHeap {
  constructor(comparator) {
    this.compare = comparator || ((a, b) => a < b);
    this.items = [];
  }

  get size() { return this.items.length; }
  get length() { return this.items.length; }
  isEmpty() { return this.items.length === 0; }

  add(value) {
    this.items.push(value);
    this._siftUp(this.items.length - 1);
  }

  push(value) { this.add(value); }

  poll() {
    if (!this.items.length) return undefined;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last !== undefined) {
      this.items[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  pop() { return this.poll(); }

  _siftUp(index) {
    const item = this.items[index];
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.compare(item, this.items[parent])) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  _siftDown(index) {
    const length = this.items.length;
    const item = this.items[index];
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < length && this.compare(this.items[left], this.items[best])) best = left;
      if (right < length && this.compare(this.items[right], this.items[best])) best = right;
      if (best === index) break;
      this.items[index] = this.items[best];
      index = best;
    }
    this.items[index] = item;
  }
}

function createPriorityQueue(comparator) {
  if (FastPriorityQueue) {
    return new FastPriorityQueue(comparator);
  }
  return new LocalMinHeap(comparator);
}

function queueAdd(queue, value) {
  if (typeof queue.add === "function") queue.add(value);
  else queue.push(value);
}

function queuePoll(queue) {
  return typeof queue.poll === "function" ? queue.poll() : queue.pop();
}

function queueSize(queue) {
  return Number(queue.size ?? queue.length ?? 0);
}

const PERSONALITY_ID = "orb-runner";
const PERSONALITY_LABEL = "Orb Runner";
const PATH_REPLAN_SECONDS = 1.05;
const STUCK_SAMPLE_SECONDS = 0.42;
const STUCK_REPATH_DISTANCE = 4.2;
const STUCK_CLEAR_SECONDS = 0.82;
const STUCK_ESCAPE_SECONDS = 1.45;
const WAYPOINT_REACHED_DISTANCE = 24;
const PATHFIND_LOOP_LIMIT = 4200;
const DEPOSIT_AFTER_ORBS = 6;
const NEAR_RIFT_DEPOSIT_MULT = 2.15;
const ORB_CANDIDATE_LIMIT = 48;

// Team coordination is the difference between bots that look intentional and
// bots that recreate a school hallway fire drill around one orb/window.
const COORDINATION_TTL_SECONDS = 2.2;
const ORB_RESERVED_PENALTY = 3600;
const ORB_CLUSTER_RADIUS = 210;
const ORB_CLUSTER_PENALTY = 760;
const RIFT_SOFT_DEPOSITOR_CAP = 2;
const RIFT_EXTRA_DEPOSITOR_PENALTY = 520;
const SAFE_OBJECT_RESERVED_PENALTY = 2400;
const SAFE_OBJECT_CLUSTER_RADIUS = 320;
const SAFE_OBJECT_CLUSTER_PENALTY = 900;
const RESCUE_RESERVED_PENALTY = 1650;
const RESCUE_RESERVED_HARD_LOCK_SECONDS = 2.8;
const RUNNER_RESCUE_STALL_SECONDS = 1.35;
const RUNNER_RESCUE_GIVEUP_SECONDS = 4.2;
const UNREACHABLE_TARGET_COOLDOWN_SECONDS = 4.25;
const UNREACHABLE_HOOK_COOLDOWN_SECONDS = 2.15;
const HEAL_RESERVED_PENALTY = 1200;
const TEAMMATE_SAFE_POINT_RADIUS = 250;
const TEAMMATE_SAFE_POINT_PENALTY = 520;

const RUNNER_THREAT_RADIUS = 760;
const RUNNER_DANGER_RADIUS = 390;
const RUNNER_SAFE_DISTANCE = 910;
const RUNNER_FLEE_LOCK_SECONDS = 2.45;
const RUNNER_FLEE_REPLAN_SECONDS = 1.25;
const RUNNER_INTERACT_DISTANCE = 74;
const RUNNER_PALLET_DROP_KILLER_RADIUS = 138;
const RUNNER_PALLET_DROP_PANIC_RADIUS = 230;
const RUNNER_SAFE_OBJECT_RADIUS = 1020;
const RUNNER_SAFE_SAMPLE_RINGS = [260, 430, 600];
const RUNNER_SAFE_SAMPLE_STEPS = 10;
const RUNNER_HOOK_RESCUE_DISTANCE = 108;
const RUNNER_HOOK_TARGET_RADIUS = 1800;
const RUNNER_HOOK_KILLER_CAMP_DISTANCE = 315;
const RUNNER_UNHOOK_COMMIT_SECONDS = 3.2;
const RUNNER_HEAL_DISTANCE = 82;
const RUNNER_HEAL_TARGET_RADIUS = 860;
const RUNNER_HEAL_KILLER_UNSAFE_DISTANCE = 430;
const RUNNER_HEAL_COMMIT_SECONDS = 4.8;
const RUNNER_HEALER_NEAR_DISTANCE = 150;
const RUNNER_POST_INTERACT_SECONDS = 2.75;
const RUNNER_INTERACT_REUSE_COOLDOWN_SECONDS = 7.0;
const RUNNER_INTERACT_ACTION_HOLD_SECONDS = 0.62;
const RUNNER_PALLET_THROUGH_DISTANCE = 118;
const RUNNER_PALLET_EXIT_REACHED_DISTANCE = 52;
const RUNNER_POST_TRAVERSAL_REACHED_DISTANCE = 96;
const RUNNER_POST_TRAVERSAL_EXTEND_SECONDS = 1.15;
const RUNNER_SAFEPOINT_REACHED_DISTANCE = 92;
const RUNNER_SAFEPOINT_MIN_DISTANCE = 170;
const RUNNER_FORCED_ESCAPE_MIN_DISTANCE = 260;
const RUNNER_EDGE_ESCAPE_MARGIN = 150;
const RUNNER_CORNER_ESCAPE_MARGIN = 230;
const RUNNER_CORNER_ESCAPE_FORCE = 0.28;
const RUNNER_ESCAPE_GATE_DISTANCE = 108;
const RUNNER_ESCAPE_GATE_TARGET_RADIUS = 2200;
const RUNNER_ESCAPE_COMMIT_SECONDS = 4.8;
const RUNNER_ESCAPE_RESERVED_PENALTY = 720;
const RUNNER_ESCAPE_KILLER_DANGER_DISTANCE = 420;
const RUNNER_IDLE_PATROL_COMMIT_SECONDS = 2.6;
const RUNNER_ESCAPE_ROUTE_TILE_RADIUS = 18;
const RUNNER_ESCAPE_ROUTE_NODE_LIMIT = 520;
const RUNNER_ESCAPE_LANE_SCAN_STEPS = 4;
const RUNNER_ESCAPE_MIN_ROUTE_TILES = 4;
const RUNNER_ESCAPE_TOWARD_KILLER_DOT_LIMIT = 0.30;
const RUNNER_ESCAPE_HARD_TOWARD_KILLER_DOT = 0.58;
const RUNNER_ESCAPE_ROUTE_COMMIT_SECONDS = 2.15;
const RUNNER_ESCAPE_CANDIDATE_EVAL_LIMIT = 72;
const NAV_MIN_CLEARANCE_TILES = 2;
const NAV_GOOD_CLEARANCE_TILES = 4;
const NAV_WALL_COST = 0.42;
const NAV_DEAD_END_COST = 7.5;
const NAV_CORNER_COST = 4.2;
const NAV_REVERSE_PATH_PENALTY = 1.8;
const NAV_DIAGONAL_CORNER_GRACE = 0;
const NAV_CACHE_MAX_AGE_SECONDS = 999999;

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

function actorIdHash(value) {
  const str = String(value || "bot");
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getActorById(game, id) {
  if (!id || !game?.actors) return null;
  return game.actors.get?.(id) || [...game.actors.values()].find((actor) => actor?.id === id) || null;
}

function isActiveRunner(game, actorOrId) {
  const actor = typeof actorOrId === "object" ? actorOrId : getActorById(game, actorOrId);
  return !!(actor && actor.role === "survivor" && !actor.dead && !actor.escaped && !actor.hooked && !actor.downed);
}

function ensureCoordination(game) {
  game.botCoordination = game.botCoordination || { reservations: Object.create(null) };
  const coord = game.botCoordination;
  coord.reservations = coord.reservations || Object.create(null);
  return coord;
}

function reservationMap(game, kind) {
  const coord = ensureCoordination(game);
  coord.reservations[kind] = coord.reservations[kind] || new Map();
  if (!(coord.reservations[kind] instanceof Map)) {
    coord.reservations[kind] = new Map(Object.entries(coord.reservations[kind] || {}));
  }
  return coord.reservations[kind];
}

function purgeCoordination(game) {
  const coord = ensureCoordination(game);
  const now = game.time || 0;
  for (const kind of Object.keys(coord.reservations)) {
    const map = reservationMap(game, kind);
    for (const [id, reservation] of map.entries()) {
      if (!reservation || reservation.until <= now || !isActiveRunner(game, reservation.ownerId)) {
        map.delete(id);
      }
    }
  }
}

function clearOwnedReservations(game, actor, kinds = null) {
  if (!game || !actor?.id) return;
  const coord = ensureCoordination(game);
  const kindSet = kinds ? new Set(Array.isArray(kinds) ? kinds : [kinds]) : null;
  for (const kind of Object.keys(coord.reservations)) {
    if (kindSet && !kindSet.has(kind)) continue;
    const map = reservationMap(game, kind);
    for (const [id, reservation] of map.entries()) {
      if (reservation?.ownerId === actor.id) map.delete(id);
    }
  }
}

function reserveTarget(game, actor, kind, id, ttl = COORDINATION_TTL_SECONDS, meta = {}) {
  if (!game || !actor?.id || !id) return;
  const map = reservationMap(game, kind);
  map.set(String(id), {
    ownerId: actor.id,
    until: (game.time || 0) + ttl,
    ...meta
  });
}

function getReservation(game, kind, id) {
  if (!game || !id) return null;
  purgeCoordination(game);
  return reservationMap(game, kind).get(String(id)) || null;
}

function isReservedByOther(game, actor, kind, id) {
  const reservation = getReservation(game, kind, id);
  return !!(reservation && reservation.ownerId !== actor?.id);
}

function reservationCount(game, actor, kind, id) {
  const reservation = getReservation(game, kind, id);
  return reservation && reservation.ownerId !== actor?.id ? 1 : 0;
}

function reservationPenalty(game, actor, kind, id, amount) {
  return isReservedByOther(game, actor, kind, id) ? amount : 0;
}

function teammateClusterPenalty(game, actor, x, y, radius, amount, targetKind = null, targetId = null) {
  if (!game?.actors) return 0;
  let penalty = 0;
  for (const other of game.actors.values()) {
    if (!other || other.id === actor.id || other.role !== "survivor" || other.dead || other.escaped || other.hooked || other.downed) continue;
    const d = distance(other.x, other.y, x, y);
    if (d > radius) continue;
    let sameTargetBonus = 0;
    const otherBrain = other.bot?.simpleAi;
    if (targetKind === "orb" && otherBrain?.task?.kind === "orb" && otherBrain.task.id === targetId) sameTargetBonus = amount * 0.85;
    if (targetKind === "safeObject" && otherBrain?.survivalTask?.id === targetId) sameTargetBonus = amount * 0.85;
    penalty += amount * (1 - d / radius) + sameTargetBonus;
  }
  return penalty;
}

const MOVE_INTENT_LOCK_SECONDS = 0.58;
const MOVE_INTENT_REACHED_DISTANCE = 26;
const MOVE_VECTOR_LOCK_SECONDS = 0.38;
const MOVE_VECTOR_REVERSE_DOT = -0.18;
const MOVE_VECTOR_AXIS_THRESHOLD = 0.14;
const MOVE_VECTOR_TARGET_MIN_DISTANCE = 72;
const MOVE_DIGITAL_LOCK_SECONDS = 0.34;
const MOVE_DIGITAL_TURN_DOT = 0.42;
const MOVE_DIGITAL_CLOSE_TARGET_DISTANCE = 88;
const PATH_LOOKAHEAD_TILES = 4.35;
const OBJECTIVE_PROGRESS_STALL_SECONDS = 0.72;
const OBJECTIVE_PROGRESS_EPSILON = 10;
const INTERACTION_APPROACH_SAMPLE_STEPS = 14;
const BODY_SEGMENT_SAMPLE_STEP = 15;
const BODY_SEGMENT_EXTRA_RADIUS = 7;
const LOCAL_DETOUR_PROBE_DISTANCES = [54, 82, 116, 154];
const LOCAL_DETOUR_ANGLE_STEPS = 18;
const CORNER_ESCAPE_LOOKAHEAD_SECONDS = 1.15;
const HARD_STUCK_DETOUR_SECONDS = 1.05;
const NAV_ROUTE_SMOOTHING_PASSES = 2;
const RUNNER_PALLET_FORCE_DROP_KILLER_DISTANCE = 270;
const RUNNER_PALLET_FORCE_DROP_RECT_DISTANCE = 175;
const RUNNER_PALLET_APPROACH_DISTANCE = 300;
const RUNNER_PALLET_STUN_COMMIT_SECONDS = 1.18;
const RUNNER_SPEED_BURST_ID = "speedBurst";
const RUNNER_SPEED_BURST_COST = 10;
const RUNNER_SPEED_BURST_TRIGGER_DISTANCE = 470;
const RUNNER_SPEED_BURST_PANIC_DISTANCE = 330;
const RUNNER_SPEED_BURST_RETRY_SECONDS = 0.65;
const RUNNER_SPEED_BURST_TASK_CLEAR_DISTANCE = 540;
const COLLISION_STEER_PROBE_DISTANCE = 46;
const COLLISION_STEER_TARGET_DISTANCE = 150;
const SAFE_OBJECT_MIN_ROUTE_SCORE = -1200;
const SAFE_OBJECT_ROUTE_PATH_PENALTY = 12;



function quantizeMoveVector(vx, vy, threshold) {
  let x = 0;
  let y = 0;
  if (vx < -threshold) x = -1;
  else if (vx > threshold) x = 1;
  if (vy < -threshold) y = -1;
  else if (vy > threshold) y = 1;

  if (!x && !y) {
    if (Math.abs(vx) >= Math.abs(vy)) x = vx < 0 ? -1 : 1;
    else y = vy < 0 ? -1 : 1;
  }

  const len = Math.hypot(x, y) || 1;
  return { x, y, vx: x / len, vy: y / len };
}

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
      if ((dot < -0.18 || targetShift < 92) && notActuallyStuck) {
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

function applyMoveVector(actor, tx, ty, sprint = true, options = {}) {
  const brain = actor.bot?.simpleAi || null;
  const dx = tx - actor.x;
  const dy = ty - actor.y;
  const distToTarget = Math.hypot(dx, dy);

  if (distToTarget < 0.001) {
    actor.input.left = false;
    actor.input.right = false;
    actor.input.up = false;
    actor.input.down = false;
    actor.input.sprint = !!sprint;
    if (brain) brain.lastIssuedMove = false;
    return;
  }

  let vx = dx / distToTarget;
  let vy = dy / distToTarget;
  const now = Number(brain?.aiNow || 0);
  const old = brain?.moveVectorIntent || null;
  const force = !!options.force;
  const stuckFor = Number(brain?.stuckFor || 0);

  // Keep the input vector stable for a few frames. Without this, a runner following
  // tight route waypoints can flip LEFT/RIGHT every tick as it crosses one waypoint,
  // losing chase distance like a tiny panicked windshield wiper.
  if (!force && old && now <= (old.until || 0) && distToTarget > MOVE_VECTOR_TARGET_MIN_DISTANCE && stuckFor < STUCK_SAMPLE_SECONDS) {
    const dot = vx * (old.vx || 0) + vy * (old.vy || 0);
    if (dot < MOVE_VECTOR_REVERSE_DOT) {
      vx = old.vx || vx;
      vy = old.vy || vy;
    }
  }

  if (brain) {
    brain.moveVectorIntent = {
      vx,
      vy,
      until: now + (force ? MOVE_VECTOR_LOCK_SECONDS * 0.55 : MOVE_VECTOR_LOCK_SECONDS)
    };
  }

  const threshold = force ? MOVE_VECTOR_AXIS_THRESHOLD * 0.55 : MOVE_VECTOR_AXIS_THRESHOLD;
  let digital = quantizeMoveVector(vx, vy, threshold);

  // Digital inputs are coarse, so tiny target/waypoint changes can look like a
  // visible left-right twitch. Hold the previous digital direction briefly when
  // the new route is broadly the same. If it needs a real turn, the dot check lets it turn.
  const oldDigital = brain?.moveDigitalIntent || null;
  if (!force && oldDigital && now <= (oldDigital.until || 0) && distToTarget > MOVE_DIGITAL_CLOSE_TARGET_DISTANCE && stuckFor < STUCK_SAMPLE_SECONDS) {
    const digitalDot = digital.vx * (oldDigital.vx || 0) + digital.vy * (oldDigital.vy || 0);
    if (digitalDot >= MOVE_DIGITAL_TURN_DOT) {
      digital = oldDigital;
    }
  }

  actor.input.left = digital.x < 0;
  actor.input.right = digital.x > 0;
  actor.input.up = digital.y < 0;
  actor.input.down = digital.y > 0;
  actor.input.sprint = !!sprint;
  actor.input.angle = Math.atan2(vy, vx);

  if (brain) {
    brain.moveDigitalIntent = {
      x: digital.x,
      y: digital.y,
      vx: digital.vx,
      vy: digital.vy,
      until: now + (force ? MOVE_DIGITAL_LOCK_SECONDS * 0.5 : MOVE_DIGITAL_LOCK_SECONDS)
    };
    brain.lastIssuedMove = !!(actor.input.left || actor.input.right || actor.input.up || actor.input.down);
    brain.lastIssuedMoveAt = now;
    brain.lastIssuedMoveVector = { vx, vy };
    brain.lastIssuedDigitalMove = { x: digital.x, y: digital.y };
  }
}

function setMoveToward(actor, tx, ty, sprint = true) {
  const brain = actor.bot?.simpleAi || null;
  const stable = stableMoveTarget(actor, tx, ty, brain);
  applyMoveVector(actor, stable.x, stable.y, sprint, { force: false });
}

function forceMoveToward(actor, tx, ty, sprint = true) {
  const brain = actor.bot?.simpleAi || null;
  if (brain) {
    const dxIntent = tx - actor.x;
    const dyIntent = ty - actor.y;
    const len = Math.hypot(dxIntent, dyIntent) || 1;
    brain.moveIntent = {
      x: tx,
      y: ty,
      nx: dxIntent / len,
      ny: dyIntent / len,
      until: Number(brain.aiNow || 0) + MOVE_INTENT_LOCK_SECONDS
    };
  }
  applyMoveVector(actor, tx, ty, sprint, { force: true });
}

function stopAndFace(actor, target) {
  const brain = actor.bot?.simpleAi || null;
  if (brain) {
    brain.moveIntent = null;
    brain.moveVectorIntent = null;
    brain.moveDigitalIntent = null;
    brain.lastIssuedMove = false;
  }
  actor.input.left = false;
  actor.input.right = false;
  actor.input.up = false;
  actor.input.down = false;
  actor.input.sprint = false;
  if (target) actor.input.angle = Math.atan2(target.y - actor.y, target.x - actor.x);
}

function chooseCollisionSafeMovePoint(game, actor, target, helpers, options = {}) {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  const desired = normalizeVector(target.x - actor.x, target.y - actor.y);
  if (desired.len <= 0.001) return null;

  const probe = Math.max(18, Number(options.probe || COLLISION_STEER_PROBE_DISTANCE));
  const far = Math.max(probe * 2.3, Number(options.far || COLLISION_STEER_TARGET_DISTANCE));
  const killer = options.killer || null;
  const awayKiller = killer ? normalizeVector(actor.x - killer.x, actor.y - killer.y) : null;
  const center = mapCenter(game);
  const inward = normalizeVector(center.x - actor.x, center.y - actor.y);
  const current = actorMoveVector(actor);
  const oldDigital = actor.bot?.simpleAi?.lastIssuedDigitalMove || null;
  const currentKillerD = killer ? helperDist(helpers, actor.x, actor.y, killer.x, killer.y) : Infinity;
  const nearWall = cornerTrapSeverity(game, actor.x, actor.y) > 0.06 || edgeTrapSeverity(game, actor.x, actor.y) > 0.30;

  const candidateVectors = [];
  const addVec = (x, y) => {
    const v = normalizeVector(x, y);
    if (v.len <= 0.001) return;
    if (candidateVectors.some((c) => c.x * v.x + c.y * v.y > 0.985)) return;
    candidateVectors.push(v);
  };

  addVec(desired.x, desired.y);
  addVec(desired.x, 0);
  addVec(0, desired.y);
  addVec(desired.x + inward.x * (nearWall ? 1.2 : 0.28), desired.y + inward.y * (nearWall ? 1.2 : 0.28));
  if (awayKiller) {
    addVec(awayKiller.x, awayKiller.y);
    addVec(desired.x + awayKiller.x * 0.75, desired.y + awayKiller.y * 0.75);
    addVec(awayKiller.x + inward.x * (nearWall ? 1.8 : 0.45), awayKiller.y + inward.y * (nearWall ? 1.8 : 0.45));
  }
  addVec(-desired.y, desired.x);
  addVec(desired.y, -desired.x);
  if (oldDigital) addVec(oldDigital.vx || oldDigital.x || 0, oldDigital.vy || oldDigital.y || 0);

  let best = null;
  let bestScore = -Infinity;
  for (const v of candidateVectors) {
    const probePoint = { x: actor.x + v.x * probe, y: actor.y + v.y * probe };
    const farPoint = clampToMapInterior(game, actor.x + v.x * far, actor.y + v.y * far);
    if (!actorCanStandAt(game, actor, probePoint.x, probePoint.y, helpers)) continue;
    if (!movementClear(game, actor, probePoint.x, probePoint.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.3, step: 9 })) continue;
    if (!actorCanStandAt(game, actor, farPoint.x, farPoint.y, helpers)) continue;

    const targetGain = helperDist(helpers, actor.x, actor.y, target.x, target.y) - helperDist(helpers, farPoint.x, farPoint.y, target.x, target.y);
    const dotDesired = v.x * desired.x + v.y * desired.y;
    const dotCurrent = v.x * (current.x || 0) + v.y * (current.y || 0);
    const edgeGain = edgeClearance(game, farPoint.x, farPoint.y) - edgeClearance(game, actor.x, actor.y);
    const lineOpenBonus = bodySegmentClear(game, actor, probePoint.x, probePoint.y, farPoint.x, farPoint.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.2, step: 10 }) ? 120 : 0;
    let score = targetGain * 2.1
      + dotDesired * 420
      + Math.max(0, dotCurrent) * 120
      + Math.max(0, edgeGain) * (nearWall ? 3.2 : 0.7)
      + lineOpenBonus
      - Math.max(0, -dotCurrent) * 170
      - edgePenalty(game, farPoint.x, farPoint.y) * 0.10
      - localClearancePenalty(game, actor, farPoint.x, farPoint.y, helpers) * 0.18;

    if (killer && awayKiller) {
      const dotAway = v.x * awayKiller.x + v.y * awayKiller.y;
      const killerGain = helperDist(helpers, farPoint.x, farPoint.y, killer.x, killer.y) - currentKillerD;
      score += dotAway * (currentKillerD < RUNNER_DANGER_RADIUS ? 740 : 320) + killerGain * 1.55;
      if (currentKillerD < RUNNER_DANGER_RADIUS && dotAway < -0.05) score -= 1800;
    }

    if (score > bestScore) {
      bestScore = score;
      best = farPoint;
    }
  }

  return best;
}

function setCollisionAwareMoveToward(game, actor, tx, ty, helpers, sprint = true, options = {}) {
  const target = { x: tx, y: ty };
  const safe = chooseCollisionSafeMovePoint(game, actor, target, helpers, options);
  const point = safe || target;
  if (options.force) forceMoveToward(actor, point.x, point.y, sprint);
  else setMoveToward(actor, point.x, point.y, sprint);
  return !!safe;
}

function runnerCanUseSpeedBurst(actor) {
  if (!actor || actor.role !== "survivor" || actor.dead || actor.escaped || actor.hooked || actor.downed || actor.vault || actor.actionLock > 0) return false;
  if ((actor.speedBurst || 0) > 0) return false;
  if (Math.floor(actor.dots || 0) < RUNNER_SPEED_BURST_COST) return false;
  const remaining = Number(actor.survivorAbilityCooldowns?.[RUNNER_SPEED_BURST_ID] || 0);
  return remaining <= 0;
}

function tryUseRunnerSpeedBurst(game, actor, threat, helpers, reason = "chase") {
  if (!runnerCanUseSpeedBurst(actor)) return false;
  const brain = ensureSurvivalBrain(actor);
  const now = game.time || 0;
  if (now < Number(brain.nextSpeedBurstTryAt || 0)) return false;

  const killer = threat?.killer || getLivingKiller(game);
  const d = Number.isFinite(threat?.distance) && threat.distance > 0
    ? threat.distance
    : killer ? helperDist(helpers, actor.x, actor.y, killer.x, killer.y) : Infinity;
  const killerCharging = !!(killer && (killer.attackState === "charging" || killer.attackState === "lunge" || killer.input?.attackHeld));
  const nearBadGeometry = cornerTrapSeverity(game, actor.x, actor.y) > 0.08 || edgeTrapSeverity(game, actor.x, actor.y) > 0.38;
  const shouldUse = !!(
    threat?.panic
    || (threat?.chase && d <= RUNNER_SPEED_BURST_TRIGGER_DISTANCE)
    || (killerCharging && d <= RUNNER_SPEED_BURST_TRIGGER_DISTANCE + 90)
    || d <= RUNNER_SPEED_BURST_PANIC_DISTANCE
    || (nearBadGeometry && d <= RUNNER_SPEED_BURST_TASK_CLEAR_DISTANCE)
  );
  if (!shouldUse) return false;

  brain.nextSpeedBurstTryAt = now + RUNNER_SPEED_BURST_RETRY_SECONDS;
  if (typeof helpers?.applySurvivorAbility !== "function") return false;
  const result = helpers.applySurvivorAbility(game, actor, RUNNER_SPEED_BURST_ID);
  if (!result?.ok) return false;

  brain.threatUntil = Math.max(brain.threatUntil || 0, now + RUNNER_FLEE_LOCK_SECONDS + 1.4);
  brain.speedBurstUsedAt = now;
  brain.speedBurstReason = reason;
  if (d <= RUNNER_SPEED_BURST_TASK_CLEAR_DISTANCE || threat?.panic) clearTask(actor, game);
  clearPath(brain);
  brain.nextStep = { kind: "speed-burst", targetId: null, reason };
  brain.repathIn = 0;
  return true;
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
    lastIssuedMove: false,
    previousTickHadMoveInput: false,
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

function compactId(id) {
  const value = String(id || "-");
  if (value.length <= 12) return value;
  return value.slice(0, 5) + "…" + value.slice(-4);
}

function inputSummary(input = {}) {
  const move = [
    input.up ? "U" : "",
    input.down ? "D" : "",
    input.left ? "L" : "",
    input.right ? "R" : ""
  ].join("") || "idle";
  const actions = [
    input.sprint ? "sprint" : "",
    input.action ? "action" : "",
    input.repair ? "repair" : "",
    input.attackHeld ? "M1-hold" : "",
    input.attackReleased ? "M1-release" : ""
  ].filter(Boolean);
  return actions.length ? `${move} ${actions.join("+")}` : move;
}

function targetLabel(task) {
  if (!task) return "none";
  const kind = task.kind || "task";
  const id = compactId(task.id || task.targetId || task.target || task.nextId);
  return id && id !== "-" ? `${kind}:${id}` : kind;
}

function movementLockRemaining(brain, now) {
  return Math.max(0, Number(brain?.moveIntent?.until || 0) - now);
}

function setBotDebug(game, actor, mode = "thinking") {
  if (!actor?.isBot) return;
  actor.bot = actor.bot || {};
  const now = Number(game?.time || 0);
  const brain = actor.role === "killer" ? actor.bot.voidRiftAi : actor.bot.simpleAi;
  const task = actor.role === "killer"
    ? (brain?.obstacleCommit || brain?.task || (brain?.huntTargetId ? { kind: "hunt", id: brain.huntTargetId } : null))
    : (brain?.survivalTask || brain?.unhookTask || brain?.healTask || brain?.escapeTask || brain?.idlePatrolTask || brain?.task);
  const next = brain?.nextStep || null;
  const target = targetLabel(task);
  const stuckFor = Math.max(0, Number(brain?.stuckFor || 0));
  const pathLen = Array.isArray(brain?.path) ? brain.path.length : 0;
  const moveLock = movementLockRemaining(brain, now);
  const survivalLock = Math.max(0, Number(brain?.survivalTask?.lockUntil || 0) - now);
  const reason = task?.reason || next?.kind || (actor.chaseHold > 0 ? "chase" : "");
  const modeText = String(mode || "thinking");
  const move = [
    actor.input?.up ? "U" : "",
    actor.input?.down ? "D" : "",
    actor.input?.left ? "L" : "",
    actor.input?.right ? "R" : ""
  ].join("") || "idle";

  actor.bot.aiDebug = {
    mode: modeText,
    task: target,
    taskKind: task?.kind || null,
    reason: reason || null,
    path: pathLen,
    pathLength: pathLen,
    stuck: Number(stuckFor.toFixed(2)),
    stuckFor: Number(stuckFor.toFixed(2)),
    repathIn: Number(Math.max(0, Number(brain?.repathIn || 0)).toFixed(2)),
    moveLock: Number(moveLock.toFixed(2)),
    input: inputSummary(actor.input),
    move,
    sprint: !!actor.input?.sprint,
    action: !!actor.input?.action,
    repair: !!actor.input?.repair,
    attackHeld: !!actor.input?.attackHeld,
    attackReleased: !!actor.input?.attackReleased,
    targetId: task?.id || task?.targetId || next?.targetId || null,
    nextTargetId: next?.targetId || null,
    nextKind: next?.kind || null,
    survivalKind: brain?.survivalTask?.kind || null,
    survivalLock: Number(survivalLock.toFixed(2)),
    moveIntent: brain?.moveIntent ? {
      x: Math.round(brain.moveIntent.x || 0),
      y: Math.round(brain.moveIntent.y || 0),
      ttl: Number(Math.max(0, Number(brain.moveIntent.until || 0) - now).toFixed(2))
    } : null,
    obstacleCommit: brain?.obstacleCommit ? {
      type: brain.obstacleCommit.type || null,
      targetId: brain.obstacleCommit.id || brain.obstacleCommit.targetId || null
    } : null,
    navMode: brain?.navMode || null,
    x: Math.round(actor.x || 0),
    y: Math.round(actor.y || 0),
    line1: `${modeText} → ${target}`,
    line2: `path:${pathLen} stuck:${stuckFor.toFixed(1)} lock:${moveLock.toFixed(1)}`,
    line3: `${inputSummary(actor.input)}${reason ? ` • ${reason}` : ""}${brain?.navMode ? ` • ${brain.navMode}` : ""}`
  };
}

function clearBotDebug(actor, mode = "inactive") {
  if (!actor?.isBot) return;
  actor.bot = actor.bot || {};
  actor.bot.aiDebug = {
    mode,
    task: "none",
    taskKind: null,
    reason: null,
    path: 0,
    pathLength: 0,
    stuck: 0,
    stuckFor: 0,
    repathIn: 0,
    moveLock: 0,
    input: "idle",
    move: "idle",
    sprint: false,
    action: false,
    repair: false,
    attackHeld: false,
    attackReleased: false,
    targetId: null,
    nextTargetId: null,
    nextKind: null,
    survivalKind: null,
    survivalLock: 0,
    moveIntent: null,
    obstacleCommit: null,
    x: Math.round(actor.x || 0),
    y: Math.round(actor.y || 0),
    line1: mode,
    line2: "path:0 stuck:0.0 lock:0.0",
    line3: "idle"
  };
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

function segmentClearFromPoint(game, ax, ay, bx, by, helpers) {
  if (typeof helpers?.segmentClear === "function") return !!helpers.segmentClear(game, ax, ay, bx, by);
  return true;
}

function bodySegmentClear(game, actor, ax, ay, bx, by, helpers, options = {}) {
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
  if (typeof helpers?.segmentClear === "function" && !helpers.segmentClear(game, ax, ay, bx, by)) return false;

  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / Math.max(8, Number(options.step || BODY_SEGMENT_SAMPLE_STEP))));
  const nx = dist > 0.001 ? -dy / dist : 0;
  const ny = dist > 0.001 ? dx / dist : 0;
  const extra = Math.max(0, Number(options.extra || 0));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t;
    const y = ay + dy * t;
    if (!actorCanStandAt(game, actor, x, y, helpers)) return false;
    if (extra > 0) {
      if (!actorCanStandAt(game, actor, x + nx * extra, y + ny * extra, helpers)) return false;
      if (!actorCanStandAt(game, actor, x - nx * extra, y - ny * extra, helpers)) return false;
    }
  }
  return true;
}

function movementClear(game, actor, x, y, helpers, options = {}) {
  return bodySegmentClear(game, actor, actor.x, actor.y, x, y, helpers, options);
}

function localClearancePenalty(game, actor, x, y, helpers) {
  const tile = game.map?.tile || 32;
  const probes = [tile * 0.55, tile * 0.82];
  let blocked = 0;
  let total = 0;
  for (const radius of probes) {
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      total++;
      if (!actorCanStandAt(game, actor, x + Math.cos(a) * radius, y + Math.sin(a) * radius, helpers)) blocked++;
    }
  }
  return total ? (blocked / total) * 900 : 0;
}

function detourCacheKey(target) {
  return `${Math.round(target?.x || 0)},${Math.round(target?.y || 0)}`;
}

function chooseLocalDetourPoint(game, actor, target, helpers, options = {}) {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  const brain = ensureBotBrain(actor);
  const now = Number(options.now ?? game.time ?? 0);
  const key = detourCacheKey(target);

  if (brain.localDetour && brain.localDetour.key === key && now <= (brain.localDetour.until || 0)) {
    const cached = brain.localDetour;
    if (actorCanStandAt(game, actor, cached.x, cached.y, helpers) && movementClear(game, actor, cached.x, cached.y, helpers)) {
      return { x: cached.x, y: cached.y };
    }
  }

  const tile = game.map?.tile || 32;
  const baseAngle = Math.atan2(target.y - actor.y, target.x - actor.x);
  const current = actorMoveVector(actor);
  const center = mapCenter(game);
  const corner = cornerTrapSeverity(game, actor.x, actor.y);
  const edge = edgeTrapSeverity(game, actor.x, actor.y);
  const centerAngle = Math.atan2(center.y - actor.y, center.x - actor.x);
  const towardTarget = normalizeVector(target.x - actor.x, target.y - actor.y);
  const killer = options.killer || null;
  const awayKiller = killer ? normalizeVector(actor.x - killer.x, actor.y - killer.y) : null;
  const angles = [];

  for (let i = 0; i < LOCAL_DETOUR_ANGLE_STEPS; i++) {
    const offset = ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 10));
    angles.push(baseAngle + offset);
  }
  if (corner > 0.05 || edge > 0.28) angles.push(centerAngle, centerAngle + Math.PI / 8, centerAngle - Math.PI / 8);
  if (awayKiller) angles.push(Math.atan2(awayKiller.y, awayKiller.x), Math.atan2(awayKiller.y, awayKiller.x) + Math.PI / 5, Math.atan2(awayKiller.y, awayKiller.x) - Math.PI / 5);

  let best = null;
  let bestScore = -Infinity;
  for (const distProbe of LOCAL_DETOUR_PROBE_DISTANCES) {
    for (const angle of angles) {
      const rawX = actor.x + Math.cos(angle) * distProbe;
      const rawY = actor.y + Math.sin(angle) * distProbe;
      const p = (corner > 0.08 || edge > 0.38) ? clampToMapInterior(game, rawX, rawY) : { x: rawX, y: rawY };
      if (!actorCanStandAt(game, actor, p.x, p.y, helpers)) continue;
      if (!movementClear(game, actor, p.x, p.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.45 })) continue;

      const toPoint = normalizeVector(p.x - actor.x, p.y - actor.y);
      const progressDot = toPoint.x * towardTarget.x + toPoint.y * towardTarget.y;
      const currentDot = toPoint.x * current.x + toPoint.y * current.y;
      const targetGain = helperDist(helpers, actor.x, actor.y, target.x, target.y) - helperDist(helpers, p.x, p.y, target.x, target.y);
      const edgeGain = edgeClearance(game, p.x, p.y) - edgeClearance(game, actor.x, actor.y);
      const cornerPenalty = cornerTrapSeverity(game, p.x, p.y) * 2600 + edgeTrapSeverity(game, p.x, p.y) * 760;
      const clearancePenalty = localClearancePenalty(game, actor, p.x, p.y, helpers);
      const lineBonus = bodySegmentClear(game, actor, p.x, p.y, target.x, target.y, helpers, { step: BODY_SEGMENT_SAMPLE_STEP * 1.25 }) ? 260 : 0;
      let score = targetGain * 2.2
        + progressDot * 210
        + Math.max(0, currentDot) * 145
        + Math.max(0, edgeGain) * (corner > 0.05 ? 2.1 : 0.45)
        + lineBonus
        - Math.max(0, -currentDot) * 260
        - cornerPenalty
        - clearancePenalty
        - distProbe * 0.22;

      if (killer) {
        const awayDot = toPoint.x * awayKiller.x + toPoint.y * awayKiller.y;
        const killerGain = helperDist(helpers, p.x, p.y, killer.x, killer.y) - helperDist(helpers, actor.x, actor.y, killer.x, killer.y);
        score += awayDot * 320 + killerGain * 1.1;
        if (awayDot < -0.22 && helperDist(helpers, actor.x, actor.y, killer.x, killer.y) < RUNNER_DANGER_RADIUS * 1.25) score -= 1300;
      }

      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
  }

  if (best) {
    brain.localDetour = {
      key,
      x: best.x,
      y: best.y,
      until: now + ((brain.stuckFor || 0) >= STUCK_CLEAR_SECONDS ? HARD_STUCK_DETOUR_SECONDS : 0.48)
    };
  }
  return best;
}

function smoothPath(game, actor, path, helpers) {
  if (!Array.isArray(path) || path.length <= 2) return path || [];
  let out = path.slice();
  for (let pass = 0; pass < NAV_ROUTE_SMOOTHING_PASSES; pass++) {
    const smoothed = [];
    let i = 0;
    while (i < out.length) {
      smoothed.push(out[i]);
      let next = i + 1;
      for (let j = out.length - 1; j > i + 1; j--) {
        if (bodySegmentClear(game, actor, out[i].x, out[i].y, out[j].x, out[j].y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.95 })) {
          next = j;
          break;
        }
      }
      i = next;
    }
    if (smoothed.length === out.length) break;
    out = smoothed;
  }
  return out;
}

function chooseInteractionApproachPoint(game, actor, target, helpers, interactDistance, options = {}) {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;

  const now = game.time || 0;
  const brain = ensureBotBrain(actor);
  const key = `${options.kind || "interact"}:${target.id || "point"}:${Math.round(target.x)},${Math.round(target.y)}`;
  const cached = brain.interactionApproach;
  if (cached && cached.key === key && now <= (cached.until || 0) && actorCanStandAt(game, actor, cached.x, cached.y, helpers)) {
    return cached;
  }

  const safeDistance = Math.max(28, Number(interactDistance || 96) * 0.72);
  const radii = [safeDistance * 0.72, safeDistance, Math.max(safeDistance + 18, Number(interactDistance || 96) * 0.92)];
  const toActorAngle = Math.atan2(actor.y - target.y, actor.x - target.x);
  const hashOffset = ((actorIdHash(actor.id) % 997) / 997) * Math.PI * 2;
  const candidates = [];

  for (const radius of radii) {
    for (let i = 0; i < INTERACTION_APPROACH_SAMPLE_STEPS; i++) {
      const spread = i === 0 ? 0 : ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI * 2 / INTERACTION_APPROACH_SAMPLE_STEPS));
      const angle = toActorAngle + spread + hashOffset * 0.05;
      candidates.push({
        x: target.x + Math.cos(angle) * radius,
        y: target.y + Math.sin(angle) * radius,
        radius
      });
    }
  }

  let best = null;
  let bestScore = Infinity;
  for (const raw of candidates) {
    const point = clampToMapInterior(game, raw.x, raw.y);
    if (!actorCanStandAt(game, actor, point.x, point.y, helpers)) continue;
    const interactionClear = segmentClearFromPoint(game, point.x, point.y, target.x, target.y, helpers);
    if (!interactionClear) continue;

    const directClear = movementClear(game, actor, point.x, point.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.35 });
    const path = directClear ? [] : buildPath(game, actor, point.x, point.y, helpers, { allowPartial: false });
    if (!directClear && !pathReachesPoint(game, actor, path, point.x, point.y, helpers, Math.max(36, raw.radius * 0.45))) continue;
    const pathPenalty = directClear ? 0 : path.length * 9;
    const actorDistance = helperDist(helpers, actor.x, actor.y, point.x, point.y);
    const targetDistance = Math.abs(helperDist(helpers, point.x, point.y, target.x, target.y) - safeDistance);
    const lineBonus = movementClear(game, actor, point.x, point.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.35 }) ? -120 : 0;
    const edgePenalty = Math.max(0, 120 - edgeClearance(game, point.x, point.y)) * 0.9;
    const score = actorDistance + pathPenalty + targetDistance * 1.2 + edgePenalty + lineBonus;
    if (score < bestScore) {
      best = { x: point.x, y: point.y, key, until: now + 1.4 };
      bestScore = score;
    }
  }

  if (best) {
    brain.interactionApproach = best;
    return best;
  }

  const fallback = clampToMapInterior(game, target.x, target.y);
  if (actorCanStandAt(game, actor, fallback.x, fallback.y, helpers)) {
    const reach = reachablePathCheck(game, actor, fallback, helpers, { tolerance: Math.max(36, safeDistance * 0.5) });
    if (reach.reachable) {
      brain.interactionApproach = { x: fallback.x, y: fallback.y, key, until: now + 0.6 };
      return brain.interactionApproach;
    }
  }

  return null;
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

function semanticMapAnalysis(game, helpers) {
  if (typeof helpers?.getMapAnalysis === "function") return helpers.getMapAnalysis(game);
  return game?.mapAnalysis || null;
}

function semanticTileMeta(game, tx, ty, helpers) {
  const analysis = semanticMapAnalysis(game, helpers);
  return analysis?.grid?.tileMeta?.get?.(tileKey(tx, ty)) || null;
}

function semanticResourceHint(game, x, y, helpers) {
  const analysis = semanticMapAnalysis(game, helpers);
  if (!analysis?.resources) return null;
  const resources = [
    ...(analysis.resources.windows || []),
    ...(analysis.resources.pallets || []),
    ...(analysis.resources.exits || [])
  ];
  let best = null;
  let bestD = Infinity;
  for (const resource of resources) {
    const d = distance(x, y, resource.x, resource.y);
    if (d < bestD) { best = resource; bestD = d; }
  }
  if (!best) return null;
  const hint = (analysis.chase?.routeHints || []).find((entry) => entry.id === best.id);
  return { resource: best, distance: bestD, hint: hint || null };
}

function navPalletSignature(game) {
  return (game?.map?.pallets || [])
    .map((pallet) => `${pallet?.id || "p"}:${pallet?.state || "none"}:${pallet?.broken ? 1 : 0}`)
    .join("|");
}

function navGridKey(game, actor) {
  const map = game?.map || {};
  const role = actor?.role || "actor";
  const size = Math.round(Number(actor?.size || (role === "killer" ? 38 : 30)));
  return [
    role,
    size,
    map.id || map.name || "map",
    map.cols || 0,
    map.rows || 0,
    map.tile || 32,
    navPalletSignature(game)
  ].join(":");
}

function navIndex(game, tx, ty) {
  return ty * (game.map?.cols || 0) + tx;
}

function navInBounds(game, tx, ty) {
  return !!(game?.map && tx >= 0 && ty >= 0 && tx < game.map.cols && ty < game.map.rows);
}

function buildNavigationGrid(game, actor, helpers) {
  const cols = game.map.cols || 0;
  const rows = game.map.rows || 0;
  const tile = game.map.tile || 32;
  const total = cols * rows;
  const walkable = new Uint8Array(total);
  const clearance = new Uint8Array(total);
  const degree = new Uint8Array(total);
  const edge = new Uint16Array(total);

  const crossProbe = Math.max(tile * 0.22, BODY_SEGMENT_EXTRA_RADIUS + tile * 0.08);
  const cornerProbe = Math.max(tile * 0.28, BODY_SEGMENT_EXTRA_RADIUS + tile * 0.13);

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const idx = ty * cols + tx;
      const c = tileCenter(game, tx, ty);
      // Body-aware walkability: a tile center is not enough. Probe a small diamond
      // around the center so the route never asks runners to kiss wall corners.
      const ok = actorCanStandAt(game, actor, c.x, c.y, helpers)
        && actorCanStandAt(game, actor, c.x + crossProbe, c.y, helpers)
        && actorCanStandAt(game, actor, c.x - crossProbe, c.y, helpers)
        && actorCanStandAt(game, actor, c.x, c.y + crossProbe, helpers)
        && actorCanStandAt(game, actor, c.x, c.y - crossProbe, helpers)
        && actorCanStandAt(game, actor, c.x + cornerProbe, c.y + cornerProbe, helpers)
        && actorCanStandAt(game, actor, c.x - cornerProbe, c.y + cornerProbe, helpers)
        && actorCanStandAt(game, actor, c.x + cornerProbe, c.y - cornerProbe, helpers)
        && actorCanStandAt(game, actor, c.x - cornerProbe, c.y - cornerProbe, helpers);
      walkable[idx] = ok ? 1 : 0;
      edge[idx] = Math.min(tx, ty, cols - 1 - tx, rows - 1 - ty);
    }
  }

  // Clearance field: distance in tiles from walls/blockers. This gives the bots
  // real map knowledge, not just a path. A higher-clearance route is smoother and
  // far less likely to snag a corner.
  const queue = [];
  let head = 0;
  const seen = new Uint8Array(total);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const idx = ty * cols + tx;
      if (!walkable[idx]) {
        seen[idx] = 1;
        queue.push({ x: tx, y: ty, d: 0 });
      }
    }
  }
  // Treat outside-map as a blocker for edge clearance too.
  for (let tx = 0; tx < cols; tx++) {
    for (const ty of [0, rows - 1]) {
      const idx = ty * cols + tx;
      if (!seen[idx]) { seen[idx] = 1; queue.push({ x: tx, y: ty, d: 0 }); }
    }
  }
  for (let ty = 0; ty < rows; ty++) {
    for (const tx of [0, cols - 1]) {
      const idx = ty * cols + tx;
      if (!seen[idx]) { seen[idx] = 1; queue.push({ x: tx, y: ty, d: 0 }); }
    }
  }

  const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (head < queue.length) {
    const cur = queue[head++];
    for (const [dx, dy] of dirs4) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      clearance[ni] = Math.min(255, cur.d + 1);
      queue.push({ x: nx, y: ny, d: cur.d + 1 });
    }
  }

  const dirs8 = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const idx = ty * cols + tx;
      if (!walkable[idx]) continue;
      let count = 0;
      for (const [dx, dy] of dirs8) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!navInBounds(game, nx, ny)) continue;
        const ni = ny * cols + nx;
        if (!walkable[ni]) continue;
        if (dx && dy) {
          const sideA = ty * cols + nx;
          const sideB = ny * cols + tx;
          if (!walkable[sideA] || !walkable[sideB]) continue;
        }
        count++;
      }
      degree[idx] = count;
    }
  }

  return {
    key: navGridKey(game, actor),
    builtAt: game.time || 0,
    cols,
    rows,
    tile,
    walkable,
    clearance,
    degree,
    edge
  };
}

function getNavigationGrid(game, actor, helpers) {
  if (!game?.map) return null;
  const key = navGridKey(game, actor);
  const now = Number(game.time || 0);
  const nav = game.__runnerNavigationGrid;
  if (nav && nav.key === key && (now - Number(nav.builtAt || 0)) < NAV_CACHE_MAX_AGE_SECONDS) return nav;
  game.__runnerNavigationGrid = buildNavigationGrid(game, actor, helpers);
  return game.__runnerNavigationGrid;
}

function navWalkable(game, actor, tx, ty, helpers) {
  if (!navInBounds(game, tx, ty)) return false;
  const nav = getNavigationGrid(game, actor, helpers);
  if (!nav) return false;
  return !!nav.walkable[navIndex(game, tx, ty)];
}

function navCanStep(game, actor, fromX, fromY, toX, toY, helpers) {
  if (!navWalkable(game, actor, toX, toY, helpers)) return false;
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx && dy) {
    // No diagonal corner clipping. This single rule kills a depressing amount of
    // "bot is technically pathing but physically stuck" nonsense.
    if (!navWalkable(game, actor, fromX + dx, fromY, helpers)) return false;
    if (!navWalkable(game, actor, fromX, fromY + dy, helpers)) return false;
  }
  return true;
}

function navTileCost(game, actor, tx, ty, helpers, options = {}) {
  const nav = getNavigationGrid(game, actor, helpers);
  if (!nav) return 0;
  const idx = navIndex(game, tx, ty);
  const c = tileCenter(game, tx, ty);
  const clearance = Number(nav.clearance[idx] || 0);
  const degree = Number(nav.degree[idx] || 0);
  const edgeTiles = Number(nav.edge[idx] || 0);

  const lowClearanceCost = Math.max(0, NAV_GOOD_CLEARANCE_TILES - clearance) * NAV_WALL_COST;
  const deadEndCost = degree <= 1 ? NAV_DEAD_END_COST : degree === 2 ? NAV_DEAD_END_COST * 0.34 : 0;
  const cornerCost = (cornerTrapSeverity(game, c.x, c.y) * 1.35 + edgeTrapSeverity(game, c.x, c.y) * 0.45) * NAV_CORNER_COST;
  const edgeCost = Math.max(0, NAV_MIN_CLEARANCE_TILES - edgeTiles) * 0.38;

  const semantic = semanticTileMeta(game, tx, ty, helpers);
  const semanticCost = semantic
    ? Math.max(0, 3 - Number(semantic.clearance || 0)) * 1.15
      + Number(semantic.deadEndRisk || 0) * 0.085
      + Number(semantic.cornerRisk || 0) * 0.11
      + Number(semantic.edgeDanger || 0) * 0.28
    : 0;

  let chaseCost = 0;
  const killer = options.killer || null;
  if (killer) {
    const d = distance(c.x, c.y, killer.x, killer.y);
    const danger = Math.max(0, RUNNER_DANGER_RADIUS - d) / Math.max(1, RUNNER_DANGER_RADIUS);
    chaseCost += danger * danger * 12.5;
  }

  return lowClearanceCost + deadEndCost + cornerCost + edgeCost + semanticCost + chaseCost;
}

function findNearestStandableTile(game, actor, targetX, targetY, helpers) {
  const target = tileAt(game, targetX, targetY);
  if (navWalkable(game, actor, target.x, target.y, helpers)) return target;

  const nav = getNavigationGrid(game, actor, helpers);
  const maxRadius = 9;
  let best = null;
  let bestScore = Infinity;
  for (let r = 1; r <= maxRadius; r++) {
    for (let y = target.y - r; y <= target.y + r; y++) {
      for (let x = target.x - r; x <= target.x + r; x++) {
        if (!navInBounds(game, x, y)) continue;
        if (Math.abs(x - target.x) !== r && Math.abs(y - target.y) !== r) continue;
        if (!navWalkable(game, actor, x, y, helpers)) continue;
        const idx = navIndex(game, x, y);
        const c = tileCenter(game, x, y);
        const score = distance(c.x, c.y, targetX, targetY)
          - Number(nav?.clearance?.[idx] || 0) * 9
          - Number(nav?.degree?.[idx] || 0) * 2
          + cornerTrapSeverity(game, c.x, c.y) * 520;
        if (score < bestScore) {
          best = { x, y };
          bestScore = score;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function walkableTileCache(game, actor) {
  // Kept only for legacy helper call sites. The real map knowledge lives in
  // getNavigationGrid(), which must be built with the server movement helpers.
  game.__runnerBotWalkableCache = game.__runnerBotWalkableCache || { values: new Map() };
  return game.__runnerBotWalkableCache.values;
}

function isTileBlocked(game, actor, tx, ty, helpers) {
  return !navWalkable(game, actor, tx, ty, helpers);
}

function buildPath(game, actor, targetX, targetY, helpers, options = {}) {
  const nav = getNavigationGrid(game, actor, helpers);
  if (!nav) return [];

  let start = tileAt(game, actor.x, actor.y);
  if (!navWalkable(game, actor, start.x, start.y, helpers)) {
    const nearby = findNearestStandableTile(game, actor, actor.x, actor.y, helpers);
    if (!nearby) return [];
    start = nearby;
  }
  const goal = findNearestStandableTile(game, actor, targetX, targetY, helpers);
  if (!goal) return [];

  const startKey = tileKey(start.x, start.y);
  const goalKey = tileKey(goal.x, goal.y);
  if (startKey === goalKey) {
    const point = actorCanStandAt(game, actor, targetX, targetY, helpers) ? { x: targetX, y: targetY } : tileCenter(game, goal.x, goal.y);
    return [point];
  }

  const open = createPriorityQueue((a, b) => a.f < b.f);
  queueAdd(open, { x: start.x, y: start.y, g: 0, f: 0, dx: 0, dy: 0 });
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const closed = new Set();

  const heuristic = (x, y) => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };

  const dirs = [
    { x: 1, y: 0, diagonal: false },
    { x: -1, y: 0, diagonal: false },
    { x: 0, y: 1, diagonal: false },
    { x: 0, y: -1, diagonal: false },
    { x: 1, y: 1, diagonal: true },
    { x: -1, y: 1, diagonal: true },
    { x: 1, y: -1, diagonal: true },
    { x: -1, y: -1, diagonal: true }
  ];

  let loops = 0;
  let bestSeen = { x: start.x, y: start.y, h: heuristic(start.x, start.y), key: startKey };
  while (queueSize(open) && loops++ < PATHFIND_LOOP_LIMIT) {
    const current = queuePoll(open);
    if (!current) break;
    const currentKey = tileKey(current.x, current.y);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    const h = heuristic(current.x, current.y);
    if (h < bestSeen.h) bestSeen = { x: current.x, y: current.y, h, key: currentKey };

    if (currentKey === goalKey) {
      const path = [];
      let k = currentKey;
      let guard = 0;
      while (k && guard++ < PATHFIND_LOOP_LIMIT) {
        const [x, y] = k.split(",").map(Number);
        path.push(tileCenter(game, x, y));
        k = cameFrom.get(k);
      }
      path.reverse();
      const last = path[path.length - 1];
      if (last && distance(last.x, last.y, targetX, targetY) > (game.map.tile || 32) * 0.25 && actorCanStandAt(game, actor, targetX, targetY, helpers)) {
        path.push({ x: targetX, y: targetY });
      }
      const smoothed = smoothPath(game, actor, path, helpers);
      if (actor?.bot?.simpleAi) {
        const hasSemantic = !!semanticMapAnalysis(game, helpers);
        actor.bot.simpleAi.navMode = `${hasSemantic ? "semantic-map" : "known-map"}+${FastPriorityQueue ? "fastpq" : "heap"}`;
      }
      return smoothed;
    }

    for (const dir of dirs) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (!navCanStep(game, actor, current.x, current.y, nx, ny, helpers)) continue;
      const nk = tileKey(nx, ny);
      if (closed.has(nk)) continue;
      const baseStep = dir.diagonal ? Math.SQRT2 : 1;
      const turnPenalty = current.dx && current.dy && (dir.x !== current.dx || dir.y !== current.dy) ? 0.08 : 0;
      const reversePenalty = (dir.x === -current.dx && dir.y === -current.dy) ? NAV_REVERSE_PATH_PENALTY : 0;
      const cost = baseStep + navTileCost(game, actor, nx, ny, helpers, options) + turnPenalty + reversePenalty;
      const tentative = (gScore.get(currentKey) ?? Infinity) + cost;
      if (tentative >= (gScore.get(nk) ?? Infinity)) continue;
      cameFrom.set(nk, currentKey);
      gScore.set(nk, tentative);
      queueAdd(open, {
        x: nx,
        y: ny,
        g: tentative,
        f: tentative + heuristic(nx, ny),
        dx: dir.x,
        dy: dir.y
      });
    }
  }

  // Partial route fallback: good for fleeing, bad for objectives. Objectives need
  // a real route, otherwise bots march into a wall and contemplate drywall.
  if (options.allowPartial !== false && bestSeen && bestSeen.key !== startKey && cameFrom.has(bestSeen.key)) {
    const path = [];
    let k = bestSeen.key;
    let guard = 0;
    while (k && guard++ < PATHFIND_LOOP_LIMIT) {
      const [x, y] = k.split(",").map(Number);
      path.push(tileCenter(game, x, y));
      if (k === startKey) break;
      k = cameFrom.get(k);
    }
    path.reverse();
    if (path.length > 1) return smoothPath(game, actor, path, helpers);
  }

  return [];
}

function clearPath(brain) {
  brain.path = [];
  brain.pathTargetKey = null;
  brain.repathIn = 0;
}

function botHadMoveIntentLastTick(actor, brain) {
  if (!brain) return false;
  if (brain.previousTickHadMoveInput) return true;
  if (brain.lastIssuedMove) return true;
  if (brain.moveIntent && Number(brain.moveIntent.until || 0) >= Number(brain.aiNow || 0)) return true;
  if (brain.moveVectorIntent && Number(brain.moveVectorIntent.until || 0) >= Number(brain.aiNow || 0)) return true;
  return false;
}

function resetPathStuckState(brain, actor) {
  if (!brain || !actor) return;
  brain.stuckFor = 0;
  brain.stuckSampleIn = STUCK_SAMPLE_SECONDS;
  brain.stuckX = actor.x;
  brain.stuckY = actor.y;
}

function targetCooldownKey(kind, targetOrId) {
  if (targetOrId && typeof targetOrId === "object") {
    const id = targetOrId.id || `${Math.round(targetOrId.x || 0)},${Math.round(targetOrId.y || 0)}`;
    return `${kind}:${id}`;
  }
  return `${kind}:${targetOrId || "unknown"}`;
}

function purgeUnreachableTargets(brain, now) {
  if (!brain?.unreachableTargets) return;
  for (const [key, until] of Object.entries(brain.unreachableTargets)) {
    if (Number(until || 0) <= now) delete brain.unreachableTargets[key];
  }
}

function isTargetTemporarilyUnreachable(actor, kind, targetOrId, game = null) {
  const brain = actor?.bot?.simpleAi;
  if (!brain?.unreachableTargets) return false;
  const now = Number(game?.time ?? brain.aiNow ?? 0);
  purgeUnreachableTargets(brain, now);
  return Number(brain.unreachableTargets[targetCooldownKey(kind, targetOrId)] || 0) > now;
}

function markTargetTemporarilyUnreachable(actor, kind, targetOrId, game = null, seconds = UNREACHABLE_TARGET_COOLDOWN_SECONDS) {
  const brain = ensureBotBrain(actor);
  const now = Number(game?.time ?? brain.aiNow ?? 0);
  brain.unreachableTargets = brain.unreachableTargets || Object.create(null);
  brain.unreachableTargets[targetCooldownKey(kind, targetOrId)] = now + Math.max(0.35, Number(seconds || UNREACHABLE_TARGET_COOLDOWN_SECONDS));
  brain.progressWatch = null;
  brain.interactionApproach = null;
  clearPath(brain);
}

function clearTargetUnreachable(actor, kind, targetOrId) {
  const brain = actor?.bot?.simpleAi;
  if (!brain?.unreachableTargets) return;
  delete brain.unreachableTargets[targetCooldownKey(kind, targetOrId)];
}

function pathReachesPoint(game, actor, path, x, y, helpers, tolerance = null) {
  if (!Array.isArray(path) || !path.length || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const last = path[path.length - 1];
  if (!last) return false;
  const tile = game.map?.tile || 32;
  const allowed = Math.max(Number(tolerance || 0), tile * 1.15);
  if (helperDist(helpers, last.x, last.y, x, y) <= allowed) return true;
  const goal = findNearestStandableTile(game, actor, x, y, helpers);
  if (goal) {
    const center = tileCenter(game, goal.x, goal.y);
    if (helperDist(helpers, last.x, last.y, center.x, center.y) <= allowed) return true;
  }
  return false;
}

function reachablePathCheck(game, actor, point, helpers, options = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { reachable: false, path: [], directClear: false };
  const extra = Number(options.extra ?? BODY_SEGMENT_EXTRA_RADIUS * 0.25);
  const directClear = actorCanStandAt(game, actor, point.x, point.y, helpers)
    && movementClear(game, actor, point.x, point.y, helpers, { extra });
  if (directClear) return { reachable: true, path: [], directClear: true };
  const path = buildPath(game, actor, point.x, point.y, helpers, { ...options, allowPartial: false });
  const reachable = pathReachesPoint(game, actor, path, point.x, point.y, helpers, options.tolerance);
  return { reachable, path, directClear: false };
}

function resetObjectiveProgressWatch(brain, actor, key, target, helpers) {
  if (!brain) return;
  brain.progressWatch = {
    key,
    bestDistance: Number.isFinite(target?.x) ? helperDist(helpers, actor.x, actor.y, target.x, target.y) : Infinity,
    stalledFor: 0,
    lastDistance: Number.isFinite(target?.x) ? helperDist(helpers, actor.x, actor.y, target.x, target.y) : Infinity
  };
}

function objectiveProgressIsStalled(game, actor, target, helpers, options = {}) {
  const brain = ensureBotBrain(actor);
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;

  const now = game.time || 0;
  const dt = Math.max(0, Number(options.dt || 0));
  const key = String(options.progressKey || `${Math.round(target.x)},${Math.round(target.y)}`);
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
  const hadMove = botHadMoveIntentLastTick(actor, brain) || !!(actor.input?.up || actor.input?.down || actor.input?.left || actor.input?.right);

  if (!brain.progressWatch || brain.progressWatch.key !== key) {
    resetObjectiveProgressWatch(brain, actor, key, target, helpers);
    return false;
  }

  const watch = brain.progressWatch;
  const improved = d < (Number(watch.bestDistance || Infinity) - OBJECTIVE_PROGRESS_EPSILON);
  const gotMuchWorse = d > (Number(watch.lastDistance || d) + OBJECTIVE_PROGRESS_EPSILON * 1.6);

  if (improved || !hadMove) {
    watch.bestDistance = Math.min(Number(watch.bestDistance || d), d);
    watch.stalledFor = Math.max(0, Number(watch.stalledFor || 0) - dt * 0.75);
  } else if (gotMuchWorse || Math.abs(d - Number(watch.lastDistance || d)) <= OBJECTIVE_PROGRESS_EPSILON * 0.65) {
    watch.stalledFor = Number(watch.stalledFor || 0) + dt;
  } else {
    watch.stalledFor = Math.max(0, Number(watch.stalledFor || 0) - dt * 0.35);
  }

  watch.lastDistance = d;
  if (watch.stalledFor < OBJECTIVE_PROGRESS_STALL_SECONDS) return false;

  watch.stalledFor = 0;
  watch.bestDistance = d;
  brain.stuckFor = Math.max(Number(brain.stuckFor || 0), STUCK_CLEAR_SECONDS);
  brain.escapeSteer = null;
  brain.moveIntent = null;
  brain.moveVectorIntent = null;
  brain.moveDigitalIntent = null;
  clearPath(brain);
  return true;
}

function fallbackMoveToward(game, actor, target, helpers, options = {}) {
  const brain = ensureBotBrain(actor);
  const now = Number(options.now ?? game.time ?? 0);
  const detour = chooseLocalDetourPoint(game, actor, target, helpers, options);
  if (detour) {
    setCollisionAwareMoveToward(game, actor, detour.x, detour.y, helpers, options.sprint !== false, { ...options, force: true });
    return;
  }

  const tile = game.map?.tile || 32;
  const center = mapCenter(game);
  const corner = cornerTrapSeverity(game, actor.x, actor.y);
  const edge = edgeTrapSeverity(game, actor.x, actor.y);
  const baseAngle = corner > 0.08 || edge > 0.45
    ? Math.atan2(center.y - actor.y, center.x - actor.x)
    : Math.atan2(target.y - actor.y, target.x - actor.x);
  const probeDistance = Math.max(tile * 1.35, 52);

  if (!brain.escapeSteer || now > (brain.escapeSteer.until || 0)) {
    brain.escapeSteer = {
      until: now + STUCK_ESCAPE_SECONDS,
      side: Math.random() < 0.5 ? -1 : 1
    };
  }

  const side = brain.escapeSteer.side || 1;
  const angles = [
    0,
    side * Math.PI / 6,
    -side * Math.PI / 6,
    side * Math.PI / 3,
    -side * Math.PI / 3,
    side * Math.PI / 2,
    -side * Math.PI / 2
  ];

  let best = null;
  let bestScore = -Infinity;
  for (const offset of angles) {
    const angle = baseAngle + offset;
    const px = actor.x + Math.cos(angle) * probeDistance;
    const py = actor.y + Math.sin(angle) * probeDistance;
    const point = (corner > 0.08 || edge > 0.45) ? clampToMapInterior(game, px, py) : { x: px, y: py };
    if (!actorCanStandAt(game, actor, point.x, point.y, helpers)) continue;
    if (!movementClear(game, actor, point.x, point.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.35 })) continue;
    const directGain = helperDist(helpers, actor.x, actor.y, target.x, target.y) - helperDist(helpers, point.x, point.y, target.x, target.y);
    const edgeGain = edgeClearance(game, point.x, point.y) - edgeClearance(game, actor.x, actor.y);
    const clearance = localClearancePenalty(game, actor, point.x, point.y, helpers);
    const score = directGain * 2.1 + Math.max(0, edgeGain) * 1.1 - Math.abs(offset) * 38 - clearance - edgePenalty(game, point.x, point.y) * 0.18;
    if (score > bestScore) {
      best = point;
      bestScore = score;
    }
  }

  const moveTarget = best || clampToMapInterior(game, target.x, target.y);
  setCollisionAwareMoveToward(game, actor, moveTarget.x, moveTarget.y, helpers, options.sprint !== false, { ...options, force: true });
}

function selectPathMoveTarget(game, actor, target, helpers, options = {}) {
  const brain = ensureBotBrain(actor);
  const path = Array.isArray(brain.path) ? brain.path : [];
  if (!path.length) return target;

  const tile = game.map?.tile || 32;
  const maxLookahead = tile * PATH_LOOKAHEAD_TILES;
  const currentVector = brain.moveVectorIntent
    ? { x: brain.moveVectorIntent.vx || 0, y: brain.moveVectorIntent.vy || 0 }
    : actorMoveVector(actor);
  const hasVector = Math.hypot(currentVector.x || 0, currentVector.y || 0) > 0.25;
  const stuckFor = Number(brain.stuckFor || 0);
  let chosenIndex = 0;
  let chosen = path[0];
  let lastClearIndex = 0;

  // Pull the steering point forward along the path. Chasing the nearest tile center
  // is what creates visible left-right/right-left jiggle after every little corner.
  // Runners should look through the route, not worship the next breadcrumb.
  for (let i = 0; i < Math.min(path.length, 6); i++) {
    const node = path[i];
    const d = helperDist(helpers, actor.x, actor.y, node.x, node.y);
    if (i > 0 && d > maxLookahead) break;
    if (i > 0 && !movementClear(game, actor, node.x, node.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.35 })) break;
    lastClearIndex = i;
    chosenIndex = i;
    chosen = node;
  }

  if (hasVector && stuckFor < STUCK_SAMPLE_SECONDS && path.length > 1) {
    const currentDir = normalizeVector(currentVector.x, currentVector.y);
    const first = path[0];
    const firstDir = normalizeVector(first.x - actor.x, first.y - actor.y);
    const firstDot = firstDir.x * currentDir.x + firstDir.y * currentDir.y;

    if (firstDot < -0.16) {
      for (let i = 1; i <= lastClearIndex; i++) {
        const node = path[i];
        const nodeDir = normalizeVector(node.x - actor.x, node.y - actor.y);
        const dot = nodeDir.x * currentDir.x + nodeDir.y * currentDir.y;
        if (dot > -0.02) {
          chosenIndex = i;
          chosen = node;
          break;
        }
      }
    }
  }

  if (chosenIndex > 0) {
    brain.path.splice(0, chosenIndex);
  }

  return chosen || target;
}

function followPath(game, actor, target, helpers, options = {}) {
  const brain = ensureBotBrain(actor);
  brain.aiNow = game.time || 0;
  const stopDistance = Math.max(8, options.stopDistance || 18);
  const targetKeyValue = `${Math.round(target.x)},${Math.round(target.y)}:${Math.round(stopDistance)}`;
  const now = game.time || 0;

  // Post-window/pallet movement is a hard escape commitment, not a suggestion.
  // Check it before the normal stop-distance logic so a bot never "arrives" at
  // a stale near target and freezes under the debug label. Tiny mercy.
  if (applyPostTraversalMovement(game, actor, helpers, { ...options, now })) return false;

  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);

  if (d <= stopDistance && movementClear(game, actor, target.x, target.y, helpers)) {
    stopAndFace(actor, target);
    return true;
  }

  brain.stuckSampleIn = (brain.stuckSampleIn || 0) - (options.dt || 0);
  if (brain.stuckSampleIn <= 0) {
    const moved = helperDist(helpers, actor.x, actor.y, brain.stuckX ?? actor.x, brain.stuckY ?? actor.y);
    const hadMove = botHadMoveIntentLastTick(actor, brain);
    brain.stuckFor = hadMove && moved < STUCK_REPATH_DISTANCE
      ? (brain.stuckFor || 0) + STUCK_SAMPLE_SECONDS
      : Math.max(0, (brain.stuckFor || 0) - STUCK_SAMPLE_SECONDS * 0.75);
    if (hadMove && moved < STUCK_REPATH_DISTANCE && options.taskKind === "unhook") {
      brain.unhookStallFor = (brain.unhookStallFor || 0) + STUCK_SAMPLE_SECONDS;
    }
    brain.stuckX = actor.x;
    brain.stuckY = actor.y;
    brain.stuckSampleIn = STUCK_SAMPLE_SECONDS;
  }

  brain.repathIn = (brain.repathIn || 0) - (options.dt || 0);
  const mustRepath = !brain.path?.length
    || brain.pathTargetKey !== targetKeyValue
    || brain.repathIn <= 0
    || (brain.stuckFor || 0) >= STUCK_CLEAR_SECONDS;

  if (mustRepath) {
    brain.path = buildPath(game, actor, target.x, target.y, helpers, options);
    brain.pathTargetKey = targetKeyValue;
    brain.repathIn = PATH_REPLAN_SECONDS + Math.random() * 0.18;
    if ((brain.stuckFor || 0) >= STUCK_SAMPLE_SECONDS && (brain.stuckFor || 0) < STUCK_CLEAR_SECONDS) {
      brain.stuckFor = Math.max(0, (brain.stuckFor || 0) - STUCK_SAMPLE_SECONDS);
    }
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
    if (skipDistance > (game.map.tile || 32) * 2.4 || !movementClear(game, actor, skip.x, skip.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.25 })) break;
    brain.path.shift();
  }

  let next = selectPathMoveTarget(game, actor, target, helpers, options);

  if (!movementClear(game, actor, next.x, next.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.35 })) {
    const reachable = (brain.path || []).find((node) => movementClear(game, actor, node.x, node.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.25 }));
    if (reachable) {
      next = reachable;
    } else {
      const detour = chooseLocalDetourPoint(game, actor, target, helpers, { ...options, now: game.time || 0 });
      clearPath(brain);
      if (detour) {
        setCollisionAwareMoveToward(game, actor, detour.x, detour.y, helpers, options.sprint !== false, { ...options, force: true });
        return false;
      }
      fallbackMoveToward(game, actor, target, helpers, { ...options, now: game.time || 0, sprint: options.sprint !== false });
      return false;
    }
  }

  const targetTrap = cornerTrapSeverity(game, next.x, next.y) + edgeTrapSeverity(game, next.x, next.y) * 0.35;
  if (targetTrap > 0.52 && (brain.stuckFor || 0) >= STUCK_SAMPLE_SECONDS) {
    const detour = chooseLocalDetourPoint(game, actor, target, helpers, { ...options, now: game.time || 0 });
    if (detour) {
      setCollisionAwareMoveToward(game, actor, detour.x, detour.y, helpers, options.sprint !== false, { ...options, force: true });
      return false;
    }
  }

  const progressTarget = options.progressTarget || next;
  if (objectiveProgressIsStalled(game, actor, progressTarget, helpers, {
    dt: options.dt,
    progressKey: options.progressKey || `${targetKeyValue}:${Math.round(next.x)},${Math.round(next.y)}`
  })) {
    if (tryUseNearbyTraversalObject(game, actor, target, helpers, { ...options, force: true })) return false;
    fallbackMoveToward(game, actor, target, helpers, { ...options, now: game.time || 0, sprint: options.sprint !== false });
    return false;
  }

  if ((brain.stuckFor || 0) >= STUCK_SAMPLE_SECONDS && tryUseNearbyTraversalObject(game, actor, target, helpers, { ...options, force: true })) {
    return false;
  }
  setCollisionAwareMoveToward(game, actor, next.x, next.y, helpers, !!options.sprint, { ...options, force: false });

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
    if (isTargetTemporarilyUnreachable(actor, "rift", rift, game)) continue;
    const route = reachablePathBonus(game, actor, rift, helpers);
    if (!route.reachable) continue;
    const d = distance(fromPoint.x, fromPoint.y, rift.x, rift.y);
    const progress = riftProgress(rift);
    const canFinish = progress + carried / dotsPerRift >= 1;
    const activeDepositBonus = rift.dotDepositing ? 140 : 0;
    const depositors = reservationCount(game, actor, "rift", rift.id);
    const crowdPenalty = Math.max(0, depositors + 1 - RIFT_SOFT_DEPOSITOR_CAP) * RIFT_EXTRA_DEPOSITOR_PENALTY;
    const teammatePenalty = teammateClusterPenalty(game, actor, rift.x, rift.y, 240, 420, "rift", rift.id);
    const score = progress * 1800
      + (canFinish ? 420 : 0)
      + activeDepositBonus
      - d * 0.30
      - route.pathLength * 9.5
      - crowdPenalty
      - teammatePenalty;
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
    if (isTargetTemporarilyUnreachable(actor, "rift", rift, game)) continue;
    const d = helperDist(helpers, actor.x, actor.y, rift.x, rift.y);
    if (d > nearbyDistance) continue;
    const route = reachablePathBonus(game, actor, rift, helpers);
    if (!route.reachable) continue;
    const depositors = reservationCount(game, actor, "rift", rift.id);
    const crowdPenalty = Math.max(0, depositors + 1 - RIFT_SOFT_DEPOSITOR_CAP) * (RIFT_EXTRA_DEPOSITOR_PENALTY * 0.75);
    const score = riftProgress(rift) * 1200 - d - route.pathLength * 8 - crowdPenalty;
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
    if (isTargetTemporarilyUnreachable(actor, "orb", item.dot, game)) continue;
    const route = reachablePathBonus(game, actor, item.dot, helpers);
    if (!route.reachable) continue;
    const nextRift = chooseBestRift(game, actor, helpers, item.dot);
    const riftDistance = nextRift ? distance(item.dot.x, item.dot.y, nextRift.x, nextRift.y) : 0;
    const progressPull = nextRift ? riftProgress(nextRift) * 260 : 0;
    const reservedPenalty = reservationPenalty(game, actor, "orb", item.dot.id, ORB_RESERVED_PENALTY);
    const clusterPenalty = teammateClusterPenalty(game, actor, item.dot.x, item.dot.y, ORB_CLUSTER_RADIUS, ORB_CLUSTER_PENALTY, "orb", item.dot.id);
    const score = item.d + riftDistance * 0.22 + route.pathLength * 7.5 - progressPull + reservedPenalty + clusterPenalty;
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
  if (same) {
    if (kind === "orb") reserveTarget(game, actor, "orb", target?.id);
    if (kind === "deposit") reserveTarget(game, actor, "rift", target?.id);
    return old;
  }

  clearOwnedReservations(game, actor, kind === "orb" ? "orb" : kind === "deposit" ? "rift" : ["orb", "rift"]);
  brain.task = makeTask(kind, target, game, actor, helpers);
  brain.idlePatrolTask = null;
  brain.progressWatch = null;
  brain.interactionApproach = null;
  if (kind === "orb") reserveTarget(game, actor, "orb", target?.id);
  if (kind === "deposit") reserveTarget(game, actor, "rift", target?.id);
  clearPath(brain);
  return brain.task;
}

function clearTask(actor, game = null) {
  if (game) clearOwnedReservations(game, actor, ["orb", "rift"]);
  const brain = ensureBotBrain(actor);
  brain.task = null;
  brain.nextStep = null;
  brain.progressWatch = null;
  brain.interactionApproach = null;
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
    if (isTargetTemporarilyUnreachable(actor, "orb", target, game)) return false;
    if ((actor.dots || 0) >= Number(helpers?.survivorDotMax || 30)) return false;
    return (game.collectibleDots || []).some((dot) => dot.id === target.id);
  }
  if (task.kind === "deposit") {
    if (isTargetTemporarilyUnreachable(actor, "rift", target, game)) return false;
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
  const brain = ensureBotBrain(actor);
  actor.bot.simpleAi.nextStep = { kind: "deposit-until-empty", targetId: rift.id };

  if (d <= depositDistance && lineClear(game, actor, rift.x, rift.y, helpers)) {
    stopAndFace(actor, rift);
    brain.stuckFor = 0;
    brain.progressWatch = null;
    return;
  }

  const approach = chooseInteractionApproachPoint(game, actor, rift, helpers, depositDistance, { kind: "deposit" });
  if (!approach) {
    markTargetTemporarilyUnreachable(actor, "rift", rift, game);
    clearTask(actor, game);
    brain.nextStep = { kind: "deposit-unreachable", targetId: rift.id };
    return;
  }
  brain.nextStep = { kind: "deposit-approach", targetId: rift.id };

  followPath(game, actor, approach, helpers, {
    sprint: true,
    stopDistance: Math.max(16, Math.min(34, depositDistance * 0.32)),
    dt,
    taskKind: "deposit",
    progressTarget: approach,
    progressKey: `deposit:${rift.id}:${Math.round(approach.x)},${Math.round(approach.y)}`
  });

  if (!(actor.input.up || actor.input.down || actor.input.left || actor.input.right) && d > depositDistance * 0.84) {
    if (movementClear(game, actor, approach.x, approach.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.25 })) {
      fallbackMoveToward(game, actor, approach, helpers, { sprint: true, now: game.time || 0 });
    } else {
      markTargetTemporarilyUnreachable(actor, "rift", rift, game);
      clearTask(actor, game);
      brain.nextStep = { kind: "deposit-path-failed", targetId: rift.id };
    }
  }
}

function collectOrb(game, actor, orb, helpers, dt) {
  const pickupRadius = Number(helpers?.survivorPickupRadius || 48);
  const brain = ensureBotBrain(actor);
  const route = reachablePathBonus(game, actor, orb, helpers);
  if (!route.reachable) {
    markTargetTemporarilyUnreachable(actor, "orb", orb, game);
    clearTask(actor, game);
    brain.nextStep = { kind: "orb-unreachable", targetId: orb.id };
    return;
  }
  actor.bot.simpleAi.nextStep = { kind: "collect-then-deposit", targetId: orb.id };
  followPath(game, actor, orb, helpers, {
    sprint: true,
    stopDistance: Math.max(12, pickupRadius * 0.35),
    dt,
    taskKind: "orb",
    progressTarget: orb,
    progressKey: `orb:${orb.id}`
  });

  if (!(actor.input.up || actor.input.down || actor.input.left || actor.input.right)) {
    if (movementClear(game, actor, orb.x, orb.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.25 })) {
      fallbackMoveToward(game, actor, orb, helpers, { sprint: true, now: game.time || 0 });
    } else {
      markTargetTemporarilyUnreachable(actor, "orb", orb, game);
      clearTask(actor, game);
      brain.nextStep = { kind: "orb-path-failed", targetId: orb.id };
    }
  }
}


function centerOf(rect) {
  return {
    x: (rect?.x || 0) + (rect?.w || 0) / 2,
    y: (rect?.y || 0) + (rect?.h || 0) / 2
  };
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const denom = abx * abx + aby * aby;
  if (denom <= 0.0001) return distance(px, py, ax, ay);
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / denom, 0, 1);
  return distance(px, py, ax + abx * t, ay + aby * t);
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
  brain.escapeTask = brain.escapeTask || null;
  brain.idlePatrolTask = brain.idlePatrolTask || null;
  return brain;
}

function sameTargetTask(task, kind, id) {
  if (!task || task.kind !== kind) return false;
  // Coordinate-only tasks like safePoint do not have a stable id. Treating every
  // safe point as the same target was the root of the "chase escape -> none / move:none" bug:
  // the bot reached a stale safe point, then future replans quietly reused it forever.
  if (!id) return false;
  return task.id === id;
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

function choosePostTraversalPoint(game, actor, object, target, helpers) {
  const tile = game.map?.tile || 32;
  const c = centerOf(object);
  let vx = (target?.x ?? actor.x) - c.x;
  let vy = (target?.y ?? actor.y) - c.y;
  let len = Math.hypot(vx, vy);
  if (len < 1) {
    vx = actor.x - c.x;
    vy = actor.y - c.y;
    len = Math.hypot(vx, vy) || 1;
  }
  vx /= len;
  vy /= len;

  const distances = [tile * 3.2, tile * 4.8, tile * 6.2, tile * 2.2];
  const sideOffsets = [0, tile * 1.25, -tile * 1.25, tile * 2.3, -tile * 2.3];
  let best = null;
  let bestScore = Infinity;

  for (const forward of distances) {
    for (const side of sideOffsets) {
      const point = clampToMapInterior(game, c.x + vx * forward + -vy * side, c.y + vy * forward + vx * side);
      const px = point.x;
      const py = point.y;
      if (!actorCanStandAt(game, actor, px, py, helpers)) continue;
      const pathClear = movementClear(game, actor, px, py, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.25 });
      const awayFromObject = distance(px, py, c.x, c.y);
      const towardGoal = target ? distance(px, py, target.x, target.y) : 0;
      const score = towardGoal - awayFromObject * 0.35 + Math.abs(side) * 0.16 + edgePenalty(game, px, py) * 0.22 + (pathClear ? -160 : 260);
      if (score < bestScore) {
        best = { x: px, y: py };
        bestScore = score;
      }
    }
  }

  return best || clampToMapInterior(game, actor.x + vx * tile * 4, actor.y + vy * tile * 4);
}

function findPostTraversalObject(game, brain) {
  const id = brain?.postTraversalObjectId || brain?.recentInteract?.id || null;
  if (!id) return null;
  const kind = brain?.postTraversalObjectKind || brain?.recentInteract?.kind || "";
  if (kind === "windowVault") return objectById(game.map?.windows, id);
  if (kind === "palletDrop" || kind === "palletVault") return objectById(game.map?.pallets, id);
  return objectById(game.map?.windows, id) || objectById(game.map?.pallets, id);
}

function rememberPostTraversalMove(game, actor, object, kind, point, seconds = RUNNER_POST_INTERACT_SECONDS) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const brain = ensureSurvivalBrain(actor);
  const now = game.time || 0;
  const c = object ? centerOf(object) : null;
  brain.postTraversalTarget = { x: point.x, y: point.y };
  brain.postTraversalUntil = Math.max(brain.postTraversalUntil || 0, now + seconds);
  brain.postTraversalObjectId = object?.id || brain.postTraversalObjectId || brain.recentInteract?.id || null;
  brain.postTraversalObjectKind = kind || brain.postTraversalObjectKind || brain.recentInteract?.kind || null;
  brain.postTraversalOrigin = c ? { x: c.x, y: c.y } : (brain.postTraversalOrigin || null);
  brain.postTraversalBoostUntil = Math.max(brain.postTraversalBoostUntil || 0, now + RUNNER_POST_TRAVERSAL_EXTEND_SECONDS);
  brain.moveIntent = null;
}

function clearPostTraversalMove(actor) {
  const brain = ensureSurvivalBrain(actor);
  brain.postTraversalTarget = null;
  brain.postTraversalUntil = 0;
  brain.postTraversalObjectId = null;
  brain.postTraversalObjectKind = null;
  brain.postTraversalOrigin = null;
  brain.postTraversalBoostUntil = 0;
}

function chooseExtendedPostTraversalPoint(game, actor, helpers, baseTarget = null) {
  const brain = ensureSurvivalBrain(actor);
  const object = findPostTraversalObject(game, brain);
  const objectCenter = object ? centerOf(object) : null;
  const killer = getLivingKiller(game);
  const origin = objectCenter || brain.postTraversalOrigin || (killer ? { x: killer.x, y: killer.y } : null);
  const tile = game.map?.tile || 32;

  let vx = actor.x - (origin?.x ?? (baseTarget?.x ?? actor.x - Math.cos(actor.angle || 0) * 100));
  let vy = actor.y - (origin?.y ?? (baseTarget?.y ?? actor.y - Math.sin(actor.angle || 0) * 100));
  let len = Math.hypot(vx, vy);

  if (len < 8 && baseTarget) {
    vx = baseTarget.x - actor.x;
    vy = baseTarget.y - actor.y;
    len = Math.hypot(vx, vy);
  }
  if (len < 8 && killer) {
    vx = actor.x - killer.x;
    vy = actor.y - killer.y;
    len = Math.hypot(vx, vy);
  }
  if (len < 8) {
    vx = Math.cos(actor.angle || 0);
    vy = Math.sin(actor.angle || 0);
    len = 1;
  }

  vx /= len;
  vy /= len;

  const distances = [tile * 4.2, tile * 6.2, tile * 8.4, tile * 10.5];
  const sideOffsets = [0, tile * 1.4, -tile * 1.4, tile * 2.8, -tile * 2.8];
  let best = null;
  let bestScore = -Infinity;

  for (const forward of distances) {
    for (const side of sideOffsets) {
      const point = clampToMapInterior(game, actor.x + vx * forward + -vy * side, actor.y + vy * forward + vx * side);
      const px = point.x;
      const py = point.y;
      if (!actorCanStandAt(game, actor, px, py, helpers)) continue;
      const fromObject = origin ? helperDist(helpers, px, py, origin.x, origin.y) : 0;
      const fromKiller = killer ? helperDist(helpers, px, py, killer.x, killer.y) : 0;
      const fromActor = helperDist(helpers, actor.x, actor.y, px, py);
      const clearBonus = movementClear(game, actor, px, py, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.25 }) ? 180 : 0;
      const edge = edgePenalty(game, px, py);
      const score = fromObject * 0.9 + fromKiller * 1.35 + clearBonus - fromActor * 0.10 - Math.abs(side) * 0.18 - edge;
      if (score > bestScore) {
        best = { x: px, y: py };
        bestScore = score;
      }
    }
  }

  const fallback = best || clampToMapInterior(game, actor.x + vx * tile * 6, actor.y + vy * tile * 6);
  if (killer && (cornerTrapSeverity(game, actor.x, actor.y) > 0.12 || cornerTrapSeverity(game, fallback.x, fallback.y) > 0.18 || edgeTrapSeverity(game, fallback.x, fallback.y) > 0.70)) {
    return chooseMapEscapePoint(game, actor, killer, helpers, fallback);
  }
  return fallback;
}

function applyPostTraversalMovement(game, actor, helpers, options = {}) {
  const brain = ensureSurvivalBrain(actor);
  const now = options.now ?? (game.time || 0);
  if (!brain.postTraversalTarget) return false;

  if (actor.vault) return true;

  if (now > (brain.postTraversalUntil || 0)) {
    clearPostTraversalMove(actor);
    return false;
  }

  let target = brain.postTraversalTarget;
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
  const targetBad = !actorCanStandAt(game, actor, target.x, target.y, helpers);
  const tooClose = d <= RUNNER_POST_TRAVERSAL_REACHED_DISTANCE;
  const lineBlocked = !movementClear(game, actor, target.x, target.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.35 });

  const killer = getLivingKiller(game);
  const cornerBlocked = !!killer && (cornerTrapSeverity(game, actor.x, actor.y) > RUNNER_CORNER_ESCAPE_FORCE || cornerTrapSeverity(game, target.x, target.y) > 0.18 || edgeTrapSeverity(game, target.x, target.y) > 0.78);
  if (targetBad || tooClose || cornerBlocked || (lineBlocked && now <= (brain.postTraversalBoostUntil || 0))) {
    target = cornerBlocked
      ? chooseMapEscapePoint(game, actor, killer, helpers, target)
      : chooseExtendedPostTraversalPoint(game, actor, helpers, target);
    brain.postTraversalTarget = target;
    brain.postTraversalUntil = Math.max(brain.postTraversalUntil || 0, now + RUNNER_POST_TRAVERSAL_EXTEND_SECONDS);
    brain.moveIntent = null;
  }

  actor.input.action = false;
  actor.input.repair = false;
  actor.input.attack = false;
  actor.input.attackHeld = false;
  actor.input.sprint = true;
  brain.nextStep = { kind: "post-traversal", targetId: brain.postTraversalObjectId || null };

  if (lineBlocked) {
    fallbackMoveToward(game, actor, target, helpers, { ...options, sprint: true, now, killer });
  } else {
    setCollisionAwareMoveToward(game, actor, target.x, target.y, helpers, true, { ...options, killer, force: false });
  }

  // If the stable movement governor still leaves us with no input, extend again and force
  // a clean direction. This is the exact screenshot bug: post-vault task alive, move:none.
  if (!(actor.input.up || actor.input.down || actor.input.left || actor.input.right)) {
    const killerForEscape = getLivingKiller(game);
    target = killerForEscape
      ? chooseMapEscapePoint(game, actor, killerForEscape, helpers, target)
      : chooseExtendedPostTraversalPoint(game, actor, helpers, target);
    brain.postTraversalTarget = target;
    brain.moveIntent = null;
    setCollisionAwareMoveToward(game, actor, target.x, target.y, helpers, true, { ...options, killer: killerForEscape, force: true });
  }

  return true;
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
    const reservedPenalty = reservationPenalty(game, actor, "safeObject", object.id, options.force ? SAFE_OBJECT_RESERVED_PENALTY * 0.35 : SAFE_OBJECT_RESERVED_PENALTY);
    const clusterPenalty = teammateClusterPenalty(game, actor, c.x, c.y, SAFE_OBJECT_CLUSTER_RADIUS, SAFE_OBJECT_CLUSTER_PENALTY, "safeObject", object.id);
    const score = d + targetRectD * 0.12 + (blockedToTarget ? -180 : 60) + reservedPenalty + clusterPenalty;
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

  const postPoint = choosePostTraversalPoint(game, actor, best.object, target, helpers);
  actor.input.action = true;
  setCollisionAwareMoveToward(game, actor, postPoint.x, postPoint.y, helpers, true, { ...options, force: false });
  actor.input.sprint = true;
  actor.input.angle = Math.atan2(best.center.y - actor.y, best.center.x - actor.x);
  reserveTarget(game, actor, "safeObject", best.object.id, RUNNER_POST_INTERACT_SECONDS, { kind: best.kind });
  rememberSurvivalInteract(actor, best.kind, best.object.id, now);
  brain.traversalPostUntil = now + RUNNER_POST_INTERACT_SECONDS;
  rememberPostTraversalMove(game, actor, best.object, best.kind, postPoint);
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
  if (sameTargetTask(brain.survivalTask, kind, id)) {
    if (id && (kind === "windowVault" || kind === "palletDrop" || kind === "palletVault")) {
      reserveTarget(game, actor, "safeObject", id, Math.max(COORDINATION_TTL_SECONDS, RUNNER_FLEE_REPLAN_SECONDS + 0.8), { kind });
    }
    return brain.survivalTask;
  }

  clearOwnedReservations(game, actor, "safeObject");
  brain.survivalTask = {
    kind,
    id,
    x: target?.x || 0,
    y: target?.y || 0,
    committedAt: game.time || 0,
    lockUntil: (game.time || 0) + RUNNER_FLEE_REPLAN_SECONDS,
    ...extra
  };
  if (id && (kind === "windowVault" || kind === "palletDrop" || kind === "palletVault")) {
    reserveTarget(game, actor, "safeObject", id, Math.max(COORDINATION_TTL_SECONDS, RUNNER_FLEE_REPLAN_SECONDS + 0.8), { kind });
  }
  clearPath(brain);
  return brain.survivalTask;
}

function clearSurvivalTask(actor, game = null) {
  if (game) clearOwnedReservations(game, actor, "safeObject");
  const brain = ensureSurvivalBrain(actor);
  brain.survivalTask = null;
  clearPath(brain);
}

function clearUnhookTask(actor, game = null) {
  if (game) clearOwnedReservations(game, actor, "unhook");
  const brain = ensureSurvivalBrain(actor);
  brain.unhookTask = null;
  clearPath(brain);
}

function clearHealTask(actor, game = null) {
  if (game) clearOwnedReservations(game, actor, "heal");
  const brain = ensureSurvivalBrain(actor);
  brain.healTask = null;
  clearPath(brain);
}

function clearEscapeTask(actor, game = null) {
  if (game) clearOwnedReservations(game, actor, "escapeGate");
  const brain = ensureSurvivalBrain(actor);
  brain.escapeTask = null;
  clearPath(brain);
}

function clearIdlePatrolTask(actor) {
  const brain = ensureSurvivalBrain(actor);
  brain.idlePatrolTask = null;
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
    const reservedPenalty = reservationPenalty(game, actor, "heal", target.id, HEAL_RESERVED_PENALTY);
    const clusterPenalty = teammateClusterPenalty(game, actor, target.x, target.y, RUNNER_HEAL_DISTANCE * 2.7, 360, "heal", target.id);
    const score = 1500 + progressBonus + downedBonus + injuredBonus - d * 0.72 - reservedPenalty - clusterPenalty;
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
    clearHealTask(actor, game);
    return false;
  }

  let target = brain.healTask?.id ? [...(game?.actors?.values?.() || [])].find((p) => p?.id === brain.healTask.id) : null;
  if (!target || !isRunnerWounded(target) || !isSafeForHeal(game, actor, helpers, target) || now > (brain.healTask?.commitUntil || 0)) {
    target = chooseHealTarget(game, actor, helpers);
    if (target) {
      clearOwnedReservations(game, actor, "heal");
      brain.healTask = { id: target.id, x: target.x, y: target.y, commitUntil: now + RUNNER_HEAL_COMMIT_SECONDS };
      reserveTarget(game, actor, "heal", target.id, RUNNER_HEAL_COMMIT_SECONDS);
      clearPath(brain);
    } else {
      clearHealTask(actor, game);
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

  const approach = chooseInteractionApproachPoint(game, actor, target, helpers, healDistance, { kind: "heal" });
  if (!approach) {
    clearHealTask(actor, game);
    brain.nextStep = { kind: "heal-unreachable", targetId: target.id };
    return false;
  }

  followPath(game, actor, approach, helpers, {
    sprint: true,
    stopDistance: Math.max(18, healDistance * 0.42),
    progressTarget: approach,
    progressKey: `heal:${target.id}:${Math.round(approach.x)},${Math.round(approach.y)}`,
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
  const targetRadius = game?.escapeOpen ? Math.max(RUNNER_HOOK_TARGET_RADIUS, RUNNER_ESCAPE_GATE_TARGET_RADIUS) : RUNNER_HOOK_TARGET_RADIUS;

  for (const target of game?.actors?.values?.() || []) {
    if (!target || target.id === actor.id || target.role !== "survivor" || !target.hooked || target.dead || target.escaped) continue;
    if (isTargetTemporarilyUnreachable(actor, "unhook", target, game)) continue;
    const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
    if (d > targetRadius) continue;

    const killerD = killer ? helperDist(helpers, killer.x, killer.y, target.x, target.y) : Infinity;
    const killerActorD = killer ? helperDist(helpers, killer.x, killer.y, actor.x, actor.y) : Infinity;
    const killerCamping = killerD < RUNNER_HOOK_KILLER_CAMP_DISTANCE && killerD < killerActorD + 140;
    const alreadyRescuing = d <= rescueDistance + 24 && (target.unhookProgress || 0) > 0;
    const reservedByOther = isReservedByOther(game, actor, "unhook", target.id);
    const hookAlreadyProgressing = (target.unhookProgress || 0) > 0.04;
    if (reservedByOther && !alreadyRescuing && !hookAlreadyProgressing) {
      const reservation = getReservation(game, "unhook", target.id);
      const freshReservation = reservation && (reservation.until || 0) - (game.time || 0) > RESCUE_RESERVED_HARD_LOCK_SECONDS * 0.35;
      if (freshReservation) continue;
    }
    const threat = survivorThreatInfo(game, actor, helpers);
    const endgameSave = !!game?.escapeOpen && d < targetRadius * 0.92;
    if (threat?.panic && !alreadyRescuing) continue;
    if (threat?.threatened && !alreadyRescuing && !endgameSave) continue;
    if (killerCamping && !alreadyRescuing && !endgameSave) continue;

    const progressBonus = (target.unhookProgress || 0) * 900;
    const urgency = (target.hookCount || 0) * 240;
    const reservedPenalty = reservationPenalty(game, actor, "unhook", target.id, hookAlreadyProgressing ? RESCUE_RESERVED_PENALTY * 0.35 : RESCUE_RESERVED_PENALTY * 2.4);
    const clusterPenalty = teammateClusterPenalty(game, actor, target.x, target.y, rescueDistance * 3.2, 520, "unhook", target.id);
    const score = 1800 + urgency + progressBonus - d * 0.82 - (killerCamping ? 600 : 0) - reservedPenalty - clusterPenalty;
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
      clearOwnedReservations(game, actor, "unhook");
      brain.unhookTask = {
        id: target.id,
        x: target.x,
        y: target.y,
        commitUntil: now + RUNNER_UNHOOK_COMMIT_SECONDS,
        startedAt: now,
        lastProgress: target.unhookProgress || 0,
        lastDistance: helperDist(helpers, actor.x, actor.y, target.x, target.y),
        stallFor: 0
      };
      reserveTarget(game, actor, "unhook", target.id, Math.max(RUNNER_UNHOOK_COMMIT_SECONDS, RESCUE_RESERVED_HARD_LOCK_SECONDS));
      clearPath(brain);
    } else {
      clearUnhookTask(actor, game);
      return false;
    }
  }

  const threat = survivorThreatInfo(game, actor, helpers);
  const rescueDistance = Number(helpers?.hookRescueDistance || RUNNER_HOOK_RESCUE_DISTANCE);
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
  const progressNow = Number(target.unhookProgress || 0);
  const progressDelta = progressNow - Number(brain.unhookTask?.lastProgress || 0);
  const distanceImproved = d < Number(brain.unhookTask?.lastDistance ?? Infinity) - 10;
  if (progressDelta > 0.005 || distanceImproved) {
    brain.unhookTask.stallFor = 0;
    brain.unhookTask.lastProgress = progressNow;
    brain.unhookTask.lastDistance = d;
    brain.unhookStallFor = 0;
  } else {
    brain.unhookTask.stallFor = (brain.unhookTask.stallFor || 0) + dt;
  }

  if ((brain.unhookTask.stallFor || 0) >= RUNNER_RESCUE_STALL_SECONDS && d > rescueDistance + 18) {
    clearPath(brain);
    brain.repathIn = 0;
    resetPathStuckState(brain, actor);
  }

  if ((brain.unhookTask.stallFor || 0) >= RUNNER_RESCUE_GIVEUP_SECONDS && progressNow <= 0.02) {
    clearUnhookTask(actor, game);
    brain.nextStep = { kind: "unhook-stalled", targetId: target.id };
    return false;
  }

  if (threat?.panic && d > rescueDistance + 14) {
    clearUnhookTask(actor, game);
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

  const approach = chooseInteractionApproachPoint(game, actor, target, helpers, rescueDistance, { kind: "unhook" });
  if (!approach) {
    markTargetTemporarilyUnreachable(actor, "unhook", target, game, UNREACHABLE_HOOK_COOLDOWN_SECONDS);
    clearUnhookTask(actor, game);
    brain.nextStep = { kind: "unhook-unreachable", targetId: target.id };
    return false;
  }

  brain.nextStep = { kind: "unhook-approach", targetId: target.id };
  followPath(game, actor, approach, helpers, {
    sprint: true,
    stopDistance: Math.max(18, rescueDistance * 0.36),
    taskKind: "unhook",
    progressTarget: approach,
    progressKey: `unhook:${target.id}:${Math.round(approach.x)},${Math.round(approach.y)}`,
    dt
  });
  if (!(actor.input.up || actor.input.down || actor.input.left || actor.input.right) && d > rescueDistance + 14) {
    if (movementClear(game, actor, approach.x, approach.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.25 })) {
      fallbackMoveToward(game, actor, approach, helpers, { sprint: true, now: game.time || 0 });
    } else {
      markTargetTemporarilyUnreachable(actor, "unhook", target, game, UNREACHABLE_HOOK_COOLDOWN_SECONDS);
      clearUnhookTask(actor, game);
      brain.nextStep = { kind: "unhook-path-failed", targetId: target.id };
      return false;
    }
  }
  actor.input.action = false;
  actor.input.repair = false;
  return true;
}


function openEscapeGates(game) {
  return (game?.map?.gates || []).filter((gate) => gate && gate.open);
}

function getEscapeGateById(game, id) {
  if (!id) return null;
  return openEscapeGates(game).find((gate) => gate.id === id) || null;
}

function chooseEscapeGate(game, actor, helpers) {
  const gates = openEscapeGates(game);
  if (!gates.length) return null;
  const killer = getLivingKiller(game);
  let best = null;
  let bestScore = -Infinity;

  for (const gate of gates) {
    if (isTargetTemporarilyUnreachable(actor, "escapeGate", gate, game)) continue;
    const route = reachablePathBonus(game, actor, gate, helpers);
    if (!route.reachable) continue;
    const d = helperDist(helpers, actor.x, actor.y, gate.x, gate.y);
    if (d > RUNNER_ESCAPE_GATE_TARGET_RADIUS) continue;
    const killerD = killer ? helperDist(helpers, killer.x, killer.y, gate.x, gate.y) : Infinity;
    const gateProgress = Math.max(0, Number(gate.escapeProgress || 0));
    const reservedPenalty = reservationPenalty(game, actor, "escapeGate", gate.id, RUNNER_ESCAPE_RESERVED_PENALTY);
    const clusterPenalty = teammateClusterPenalty(game, actor, gate.x, gate.y, TEAMMATE_SAFE_POINT_RADIUS, TEAMMATE_SAFE_POINT_PENALTY * 0.55, "escapeGate", gate.id);
    const killerPenalty = killerD < RUNNER_ESCAPE_KILLER_DANGER_DISTANCE
      ? (RUNNER_ESCAPE_KILLER_DANGER_DISTANCE - killerD) * 2.1
      : 0;
    const lineBlockedBonus = killer && typeof helpers?.segmentClear === "function" && !helpers.segmentClear(game, actor.x, actor.y, killer.x, killer.y) ? 160 : 0;
    const score = 2600
      + gateProgress * 650
      + Math.min(killerD, 900) * 0.62
      + lineBlockedBonus
      - d * 0.86
      - route.pathLength * 6
      - reservedPenalty
      - clusterPenalty
      - killerPenalty;
    if (score > bestScore) {
      best = gate;
      bestScore = score;
    }
  }

  return best || gates[0] || null;
}

function runSurvivorEscape(game, actor, helpers, dt) {
  if (!game?.escapeOpen || actor.dead || actor.escaped || actor.hooked || actor.downed) {
    clearEscapeTask(actor, game);
    return false;
  }

  const brain = ensureSurvivalBrain(actor);
  const now = game.time || 0;
  let gate = brain.escapeTask?.id ? getEscapeGateById(game, brain.escapeTask.id) : null;

  if (!gate || now > (brain.escapeTask?.commitUntil || 0)) {
    gate = chooseEscapeGate(game, actor, helpers);
    if (!gate) {
      clearEscapeTask(actor, game);
      return false;
    }
    clearOwnedReservations(game, actor, "escapeGate");
    brain.escapeTask = {
      kind: "escapeGate",
      id: gate.id,
      x: gate.x,
      y: gate.y,
      committedAt: now,
      commitUntil: now + RUNNER_ESCAPE_COMMIT_SECONDS
    };
    reserveTarget(game, actor, "escapeGate", gate.id, RUNNER_ESCAPE_COMMIT_SECONDS);
    clearPath(brain);
  }

  const d = helperDist(helpers, actor.x, actor.y, gate.x, gate.y);
  brain.nextStep = { kind: "escape-gate", targetId: gate.id };
  actor.input.action = false;
  actor.input.repair = false;
  actor.input.attack = false;
  actor.input.attackHeld = false;

  if (d <= RUNNER_ESCAPE_GATE_DISTANCE) {
    // This is the good kind of standing still: the server exit timer needs proximity.
    stopAndFace(actor, gate);
    brain.escapeTask.commitUntil = Math.max(brain.escapeTask.commitUntil || 0, now + 0.8);
    brain.stuckFor = 0;
    return true;
  }

  followPath(game, actor, gate, helpers, {
    sprint: true,
    stopDistance: Math.max(20, RUNNER_ESCAPE_GATE_DISTANCE * 0.58),
    dt
  });

  if (!(actor.input.up || actor.input.down || actor.input.left || actor.input.right)) {
    if (movementClear(game, actor, gate.x, gate.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.25 })) {
      fallbackMoveToward(game, actor, gate, helpers, { sprint: true, now: game.time || 0 });
    } else {
      markTargetTemporarilyUnreachable(actor, "escapeGate", gate, game);
      clearEscapeTask(actor, game);
      brain.nextStep = { kind: "escape-path-failed", targetId: gate.id };
      return false;
    }
  }

  return true;
}

function chooseIdlePatrolPoint(game, actor, helpers) {
  const brain = ensureSurvivalBrain(actor);
  const now = game.time || 0;
  const current = brain.idlePatrolTask;
  if (current && now <= (current.commitUntil || 0) && actorCanStandAt(game, actor, current.x, current.y, helpers)) {
    return current;
  }

  const tile = game.map?.tile || 32;
  const killer = getLivingKiller(game);
  const rifts = unfinishedRifts(game);
  let best = null;
  let bestScore = -Infinity;

  const candidates = [];
  for (const rift of rifts) {
    candidates.push({ x: rift.x, y: rift.y, kind: "rift", id: rift.id });
  }
  const center = mapCenter(game);
  const hash = actorIdHash(actor.id);
  for (let i = 0; i < 10; i++) {
    const angle = ((hash % 997) / 997) * Math.PI * 2 + i * Math.PI * 0.4;
    const radius = tile * (5 + (i % 4) * 2.5);
    candidates.push(clampToMapInterior(game, center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius));
  }

  for (const raw of candidates) {
    const point = clampToMapInterior(game, raw.x, raw.y);
    if (!actorCanStandAt(game, actor, point.x, point.y, helpers)) continue;
    const d = helperDist(helpers, actor.x, actor.y, point.x, point.y);
    const killerD = killer ? helperDist(helpers, killer.x, killer.y, point.x, point.y) : 600;
    const route = reachablePathBonus(game, actor, point, helpers);
    const score = route.score
      + Math.min(killerD, 800) * 0.3
      + edgeClearance(game, point.x, point.y) * 0.9
      - d * 0.18
      - teammateClusterPenalty(game, actor, point.x, point.y, TEAMMATE_SAFE_POINT_RADIUS, TEAMMATE_SAFE_POINT_PENALTY * 0.35);
    if (score > bestScore) {
      best = { x: point.x, y: point.y, kind: raw.kind || "patrol", id: raw.id || null, commitUntil: now + RUNNER_IDLE_PATROL_COMMIT_SECONDS };
      bestScore = score;
    }
  }

  brain.idlePatrolTask = best || { ...clampToMapInterior(game, center.x, center.y), kind: "patrol", id: null, commitUntil: now + RUNNER_IDLE_PATROL_COMMIT_SECONDS };
  clearPath(brain);
  return brain.idlePatrolTask;
}

function runSurvivorIdlePatrol(game, actor, helpers, dt) {
  const point = chooseIdlePatrolPoint(game, actor, helpers);
  if (!point) return false;
  const brain = ensureSurvivalBrain(actor);
  brain.nextStep = { kind: "idle-patrol", targetId: point.id || null };
  const d = helperDist(helpers, actor.x, actor.y, point.x, point.y);
  if (d <= 44) {
    brain.idlePatrolTask = null;
    return false;
  }
  followPath(game, actor, point, helpers, { sprint: false, stopDistance: 34, dt });
  if (!(actor.input.up || actor.input.down || actor.input.left || actor.input.right)) {
    fallbackMoveToward(game, actor, point, helpers, { sprint: false, now: game.time || 0 });
  }
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

function mapInteriorMargin(game) {
  const tile = game.map?.tile || 32;
  const shortest = Math.max(tile * 8, Math.min(game.map?.width || 0, game.map?.height || 0));
  return Math.min(Math.max(RUNNER_EDGE_ESCAPE_MARGIN, tile * 4.2), Math.max(52, shortest * 0.16));
}

function mapCenter(game) {
  return {
    x: (game.map?.width || 0) / 2,
    y: (game.map?.height || 0) / 2
  };
}

function edgeClearance(game, x, y) {
  if (!game?.map) return Infinity;
  return Math.min(x, y, game.map.width - x, game.map.height - y);
}

function edgeTrapSeverity(game, x, y) {
  const margin = mapInteriorMargin(game);
  return clamp((margin - edgeClearance(game, x, y)) / Math.max(1, margin), 0, 1);
}

function cornerTrapSeverity(game, x, y) {
  if (!game?.map) return 0;
  const margin = Math.max(RUNNER_CORNER_ESCAPE_MARGIN, (game.map.tile || 32) * 6.2);
  const nearX = Math.min(x, game.map.width - x);
  const nearY = Math.min(y, game.map.height - y);
  const sx = clamp((margin - nearX) / Math.max(1, margin), 0, 1);
  const sy = clamp((margin - nearY) / Math.max(1, margin), 0, 1);
  return sx * sy;
}

function clampToMapInterior(game, x, y) {
  const margin = mapInteriorMargin(game);
  if (!game?.map) return { x, y };
  return {
    x: clamp(x, margin, Math.max(margin, game.map.width - margin)),
    y: clamp(y, margin, Math.max(margin, game.map.height - margin))
  };
}

function edgePenalty(game, x, y) {
  const edgeSeverity = edgeTrapSeverity(game, x, y);
  const cornerSeverity = cornerTrapSeverity(game, x, y);
  return edgeSeverity * 1450 + cornerSeverity * 4200;
}

function reachablePathBonus(game, actor, point, helpers) {
  const check = reachablePathCheck(game, actor, point, helpers, { tolerance: (game.map?.tile || 32) * 1.2 });
  if (!check.reachable) return { reachable: false, score: -2200, pathLength: 0 };
  const length = check.directClear ? 1 : Math.max(1, check.path.length);
  return {
    reachable: true,
    score: 360 + Math.min(length, 18) * 22,
    pathLength: length
  };
}

function normalizeVector(x, y) {
  const len = Math.hypot(x, y);
  if (len <= 0.0001) return { x: 0, y: 0, len: 0 };
  return { x: x / len, y: y / len, len };
}

function pathDistance(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
  }
  return total;
}

function firstRouteStep(actor, path, tile = 32) {
  if (!Array.isArray(path) || !path.length) return null;
  for (const point of path) {
    if (distance(actor.x, actor.y, point.x, point.y) > tile * 0.42) return point;
  }
  return path[path.length - 1] || null;
}

function routeMinimumKillerDistance(path, killer) {
  if (!killer || !Array.isArray(path) || !path.length) return Infinity;
  let best = Infinity;
  for (const point of path) {
    best = Math.min(best, distance(point.x, point.y, killer.x, killer.y));
  }
  return best;
}

function reconstructEscapePath(game, cameFrom, startKey, endKey) {
  const keys = [];
  let key = endKey;
  let guard = 0;
  while (key && guard++ < RUNNER_ESCAPE_ROUTE_NODE_LIMIT + 8) {
    keys.push(key);
    if (key === startKey) break;
    key = cameFrom.get(key);
  }
  keys.reverse();
  return keys.map((entry) => {
    const [x, y] = entry.split(",").map(Number);
    return tileCenter(game, x, y);
  });
}

function floodRunnerEscapeCandidates(game, actor, helpers) {
  if (!game?.map || !actor) return [];
  const start = tileAt(game, actor.x, actor.y);
  const startKey = tileKey(start.x, start.y);
  const queue = [{ x: start.x, y: start.y, depth: 0 }];
  const seen = new Set([startKey]);
  const cameFrom = new Map();
  const depthByKey = new Map([[startKey, 0]]);
  const candidates = [];
  const dirs = [
    { x: 1, y: 0, diagonal: false },
    { x: -1, y: 0, diagonal: false },
    { x: 0, y: 1, diagonal: false },
    { x: 0, y: -1, diagonal: false },
    { x: 1, y: 1, diagonal: true },
    { x: -1, y: 1, diagonal: true },
    { x: 1, y: -1, diagonal: true },
    { x: -1, y: -1, diagonal: true }
  ];

  let head = 0;
  while (head < queue.length && seen.size < RUNNER_ESCAPE_ROUTE_NODE_LIMIT) {
    const current = queue[head++];
    const currentDepth = depthByKey.get(tileKey(current.x, current.y)) || 0;
    if (currentDepth >= RUNNER_ESCAPE_ROUTE_TILE_RADIUS) continue;

    for (const dir of dirs) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (nx < 0 || ny < 0 || nx >= game.map.cols || ny >= game.map.rows) continue;
      const key = tileKey(nx, ny);
      if (seen.has(key)) continue;
      if (isTileBlocked(game, actor, nx, ny, helpers)) continue;
      if (dir.diagonal && (isTileBlocked(game, actor, current.x, ny, helpers) || isTileBlocked(game, actor, nx, current.y, helpers))) continue;

      seen.add(key);
      cameFrom.set(key, tileKey(current.x, current.y));
      const depth = currentDepth + 1;
      depthByKey.set(key, depth);
      queue.push({ x: nx, y: ny, depth });
      if (depth >= RUNNER_ESCAPE_MIN_ROUTE_TILES) {
        const point = tileCenter(game, nx, ny);
        candidates.push({ x: nx, y: ny, key, depth, point });
      }
    }
  }

  return { startKey, cameFrom, candidates };
}

function selectEscapeCandidates(game, actor, killer, candidates, limit) {
  if (!Array.isArray(candidates) || candidates.length <= limit) return candidates || [];

  const center = mapCenter(game);
  const currentKillerDistance = killer ? distance(actor.x, actor.y, killer.x, killer.y) : 0;
  const currentEdge = edgeClearance(game, actor.x, actor.y);
  const currentCenterDistance = distance(actor.x, actor.y, center.x, center.y);
  const actorCornerSeverity = cornerTrapSeverity(game, actor.x, actor.y);
  const actorEdgeSeverity = edgeTrapSeverity(game, actor.x, actor.y);
  const inDeadzone = actorCornerSeverity > 0.08 || actorEdgeSeverity > 0.34;

  return candidates
    .map((candidate) => {
      const point = candidate.point;
      const fromKiller = killer ? distance(point.x, point.y, killer.x, killer.y) : 0;
      const killerGain = fromKiller - currentKillerDistance;
      const edgeGain = edgeClearance(game, point.x, point.y) - currentEdge;
      const centerGain = currentCenterDistance - distance(point.x, point.y, center.x, center.y);
      const pointCorner = cornerTrapSeverity(game, point.x, point.y);
      const pointEdge = edgeTrapSeverity(game, point.x, point.y);
      const depth = Number(candidate.depth || 0);
      const cheapScore =
        fromKiller * 1.15
        + killerGain * 2.2
        + Math.max(0, edgeGain) * (inDeadzone ? 4.4 : 1.4)
        + Math.max(0, centerGain) * (inDeadzone ? 2.0 : 0.35)
        + depth * 18
        - pointCorner * 2600
        - pointEdge * 850;
      return { candidate, cheapScore };
    })
    .sort((a, b) => b.cheapScore - a.cheapScore)
    .slice(0, Math.max(8, limit || RUNNER_ESCAPE_CANDIDATE_EVAL_LIMIT))
    .map((entry) => entry.candidate);
}

function runnerEscapeLaneValue(game, actor, killer, x, y, helpers) {
  if (!game?.map || !actor || !Number.isFinite(x) || !Number.isFinite(y)) {
    return { score: -Infinity, openExits: 0, safeExits: 0, losBreakingExits: 0, centerExits: 0, edgeExits: 0, deadEnd: true };
  }

  const tile = game.map.tile || 32;
  const here = tileAt(game, x, y);
  if (isTileBlocked(game, actor, here.x, here.y, helpers)) {
    return { score: -Infinity, openExits: 0, safeExits: 0, losBreakingExits: 0, centerExits: 0, edgeExits: 0, deadEnd: true };
  }

  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];
  const center = mapCenter(game);
  const currentKillerDistance = killer ? distance(x, y, killer.x, killer.y) : Infinity;
  const currentCenterDistance = distance(x, y, center.x, center.y);
  const currentEdge = edgeClearance(game, x, y);

  let openExits = 0;
  let safeExits = 0;
  let losBreakingExits = 0;
  let centerExits = 0;
  let edgeExits = 0;
  let bestGain = -Infinity;

  for (const [dx, dy] of dirs) {
    let laneOpen = false;
    let laneSafe = false;
    let laneBreaksLos = false;
    let laneCenter = false;
    let laneEdge = false;
    let laneBestGain = -Infinity;

    for (let step = 1; step <= RUNNER_ESCAPE_LANE_SCAN_STEPS; step++) {
      const tx = here.x + dx * step;
      const ty = here.y + dy * step;
      if (tx < 0 || ty < 0 || tx >= game.map.cols || ty >= game.map.rows) break;
      if (isTileBlocked(game, actor, tx, ty, helpers)) break;
      if (dx && dy && (isTileBlocked(game, actor, tx - dx, ty, helpers) || isTileBlocked(game, actor, tx, ty - dy, helpers))) break;
      const point = tileCenter(game, tx, ty);

      laneOpen = true;
      const killerGain = killer ? distance(point.x, point.y, killer.x, killer.y) - currentKillerDistance : 0;
      const breaksLos = killer && typeof helpers?.segmentClear === "function"
        ? !helpers.segmentClear(game, killer.x, killer.y, point.x, point.y)
        : false;
      laneBestGain = Math.max(laneBestGain, killerGain);
      if (killerGain >= tile * 0.25 || breaksLos) laneSafe = true;
      if (breaksLos) laneBreaksLos = true;
      if (distance(point.x, point.y, center.x, center.y) < currentCenterDistance - tile * 0.22) laneCenter = true;
      if (edgeClearance(game, point.x, point.y) > currentEdge + tile * 0.22) laneEdge = true;
    }

    if (laneOpen) openExits += 1;
    if (laneSafe) safeExits += 1;
    if (laneBreaksLos) losBreakingExits += 1;
    if (laneCenter) centerExits += 1;
    if (laneEdge) edgeExits += 1;
    bestGain = Math.max(bestGain, laneBestGain);
  }

  const pointEdge = edgeTrapSeverity(game, x, y);
  const pointCorner = cornerTrapSeverity(game, x, y);
  const lowExitPenalty = openExits <= 1 ? 1450 : openExits === 2 ? 520 : 0;
  const lowSafePenalty = killer && safeExits <= 0 ? 1300 : killer && safeExits === 1 ? 360 : 0;
  const score = openExits * 115
    + safeExits * 230
    + losBreakingExits * 240
    + centerExits * 80
    + edgeExits * 115
    + Math.max(-(game.map.tile || 32), Number.isFinite(bestGain) ? bestGain : 0) * 0.55
    - pointEdge * 1600
    - pointCorner * 5200
    - lowExitPenalty
    - lowSafePenalty;

  return {
    score,
    openExits,
    safeExits,
    losBreakingExits,
    centerExits,
    edgeExits,
    bestGain: Number.isFinite(bestGain) ? bestGain : 0,
    deadEnd: openExits <= 1 || (killer && safeExits <= 0)
  };
}

function rememberEscapePlan(actor, plan) {
  const brain = ensureSurvivalBrain(actor);
  brain.lastEscapePlan = plan || null;
  if (plan) {
    brain.nextStep = {
      kind: plan.deadEnd ? "route-escape-deadend-backup" : "route-escape",
      targetId: null,
      score: Math.round(plan.score || 0),
      exits: plan.openExits,
      safeExits: plan.safeExits
    };
  }
}

function chooseMapEscapePoint(game, actor, killer, helpers, previousTarget = null) {
  if (!game?.map || !killer) {
    return previousTarget || {
      x: actor.x + Math.cos(actor.angle || 0) * RUNNER_FORCED_ESCAPE_MIN_DISTANCE,
      y: actor.y + Math.sin(actor.angle || 0) * RUNNER_FORCED_ESCAPE_MIN_DISTANCE
    };
  }

  const tile = game.map.tile || 32;
  const center = mapCenter(game);
  const currentKillerDistance = Math.max(1, helperDist(helpers, killer.x, killer.y, actor.x, actor.y));
  const currentCenterDistance = helperDist(helpers, actor.x, actor.y, center.x, center.y);
  const currentEdge = edgeClearance(game, actor.x, actor.y);
  const actorEdgeSeverity = edgeTrapSeverity(game, actor.x, actor.y);
  const actorCornerSeverity = cornerTrapSeverity(game, actor.x, actor.y);
  const inDeadzone = actorEdgeSeverity > 0.34 || actorCornerSeverity > 0.08;
  const towardKiller = normalizeVector(killer.x - actor.x, killer.y - actor.y);
  const currentMove = actorMoveVector(actor);
  const flood = floodRunnerEscapeCandidates(game, actor, helpers);

  let best = null;
  let bestScore = -Infinity;
  let backup = null;
  let backupScore = -Infinity;

  const candidates = selectEscapeCandidates(game, actor, killer, flood.candidates || [], RUNNER_ESCAPE_CANDIDATE_EVAL_LIMIT);

  for (const candidate of candidates) {
    const point = candidate.point;
    if (!actorCanStandAt(game, actor, point.x, point.y, helpers)) continue;

    const path = reconstructEscapePath(game, flood.cameFrom, flood.startKey, candidate.key);
    if (!path.length) continue;
    const fromActor = helperDist(helpers, actor.x, actor.y, point.x, point.y);
    if (fromActor < RUNNER_SAFEPOINT_MIN_DISTANCE) continue;

    const first = firstRouteStep(actor, path, tile) || point;
    const firstVec = normalizeVector(first.x - actor.x, first.y - actor.y);
    const candidateVec = normalizeVector(point.x - actor.x, point.y - actor.y);
    const dotTowardKiller = firstVec.x * towardKiller.x + firstVec.y * towardKiller.y;
    const finalDotTowardKiller = candidateVec.x * towardKiller.x + candidateVec.y * towardKiller.y;
    const currentDirectionDot = firstVec.x * currentMove.x + firstVec.y * currentMove.y;
    const fromKiller = helperDist(helpers, killer.x, killer.y, point.x, point.y);
    const killerGain = fromKiller - currentKillerDistance;
    const pathMinKillerD = routeMinimumKillerDistance(path, killer);
    const routeD = pathDistance([{ x: actor.x, y: actor.y }, ...path]);
    const edgeGain = edgeClearance(game, point.x, point.y) - currentEdge;
    const centerGain = currentCenterDistance - helperDist(helpers, point.x, point.y, center.x, center.y);
    const pointEdge = edgeTrapSeverity(game, point.x, point.y);
    const pointCorner = cornerTrapSeverity(game, point.x, point.y);
    const losBlocked = typeof helpers?.segmentClear === "function"
      ? !helpers.segmentClear(game, killer.x, killer.y, point.x, point.y)
      : false;
    const directClear = movementClear(game, actor, point.x, point.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.25 });
    const lane = runnerEscapeLaneValue(game, actor, killer, point.x, point.y, helpers);
    const teammatePenalty = teammateClusterPenalty(game, actor, point.x, point.y, TEAMMATE_SAFE_POINT_RADIUS, TEAMMATE_SAFE_POINT_PENALTY);
    const previousPenalty = previousTarget ? Math.max(0, 300 - helperDist(helpers, previousTarget.x, previousTarget.y, point.x, point.y)) * 2.4 : 0;
    const turnsBackPenalty = currentDirectionDot < -0.36 && !inDeadzone ? Math.abs(currentDirectionDot) * 420 : 0;
    const towardKillerPenalty = dotTowardKiller > 0
      ? dotTowardKiller * (currentKillerDistance < RUNNER_DANGER_RADIUS ? 3300 : 1850)
      : dotTowardKiller * 260; // negative dot is a small bonus because it starts away from danger.
    const hardTurnIntoKiller = dotTowardKiller > RUNNER_ESCAPE_HARD_TOWARD_KILLER_DOT
      && !losBlocked
      && edgeGain < tile * 2.4
      && centerGain < tile * 2.0;
    const softTurnIntoKiller = dotTowardKiller > RUNNER_ESCAPE_TOWARD_KILLER_DOT_LIMIT
      && currentKillerDistance < RUNNER_SAFE_DISTANCE * 0.82
      && !losBlocked
      && edgeGain < tile * 1.3;
    const cornerDirectTowardKiller = actorCornerSeverity > 0.08
      && dotTowardKiller > 0.78
      && currentKillerDistance < RUNNER_SAFE_DISTANCE
      && !losBlocked;
    const cornerFinalIntoKiller = actorCornerSeverity > 0.08
      && finalDotTowardKiller > 0.84
      && currentKillerDistance < RUNNER_SAFE_DISTANCE
      && !losBlocked;
    if (hardTurnIntoKiller || softTurnIntoKiller || cornerFinalIntoKiller) continue;
    const cornerDirectPenalty = cornerDirectTowardKiller ? 1650 : 0;
    const finalTowardPenalty = finalDotTowardKiller > 0.64 && currentKillerDistance < RUNNER_SAFE_DISTANCE
      ? Math.pow(finalDotTowardKiller, 2) * (actorCornerSeverity > 0.08 ? 3600 : 1450)
      : 0;

    const deadEndPenalty = lane.deadEnd
      ? (inDeadzone && edgeGain > tile * 2.8 ? 420 : 1850)
      : 0;
    const routeDangerPenalty = Math.max(0, (currentKillerDistance - pathMinKillerD)) * (currentKillerDistance < RUNNER_DANGER_RADIUS ? 8.8 : inDeadzone ? 4.4 : 2.2);
    const edgePressure = 1 + actorEdgeSeverity * 1.15 + actorCornerSeverity * 2.2;
    const score = fromKiller * 2.35
      + killerGain * 3.2
      + pathMinKillerD * 0.82
      + lane.score * 1.28
      + Math.max(0, edgeGain) * 4.6 * edgePressure
      + Math.max(0, centerGain) * (inDeadzone ? 4.8 : 0.9)
      + (losBlocked ? 640 : 0)
      + (directClear ? 120 : -40)
      + Math.max(0, lane.safeExits) * 120
      + Math.max(0, lane.openExits - 2) * 80
      - routeD * 0.22
      - pointEdge * 2600
      - pointCorner * 8600
      - towardKillerPenalty
      - cornerDirectPenalty
      - finalTowardPenalty
      - turnsBackPenalty
      - routeDangerPenalty
      - deadEndPenalty
      - teammatePenalty
      - previousPenalty;

    const result = {
      x: point.x,
      y: point.y,
      route: path,
      escapeScore: score,
      escapePlan: {
        score,
        openExits: lane.openExits,
        safeExits: lane.safeExits,
        deadEnd: lane.deadEnd,
        dotTowardKiller: Number(dotTowardKiller.toFixed(2)),
        finalDotTowardKiller: Number(finalDotTowardKiller.toFixed(2)),
        edgeGain: Math.round(edgeGain),
        centerGain: Math.round(centerGain)
      }
    };

    if (score > backupScore) {
      backup = result;
      backupScore = score;
    }
    if (lane.deadEnd && !(inDeadzone && edgeGain > tile * 2.8 && centerGain > tile)) continue;
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }

  const chosen = best || backup;
  if (chosen) {
    rememberEscapePlan(actor, chosen.escapePlan);
    return chosen;
  }

  // Last resort: do not run purely away into a wall. From a corner, pick an edge lane
  // first, then bend inward. Running straight to center can be the same as running into
  // The Void, which is less "optimal bot" and more "free lunch with legs."
  const fallbackOptions = [];
  const fallbackDistance = RUNNER_FORCED_ESCAPE_MIN_DISTANCE + tile * 8;
  const inwardX = actor.x < game.map.width * 0.5 ? 1 : -1;
  const inwardY = actor.y < game.map.height * 0.5 ? 1 : -1;
  if (actorCornerSeverity > 0.08) {
    fallbackOptions.push({ x: actor.x + inwardX * fallbackDistance, y: actor.y + inwardY * tile * 0.6 });
    fallbackOptions.push({ x: actor.x + inwardX * tile * 0.6, y: actor.y + inwardY * fallbackDistance });
    fallbackOptions.push({ x: actor.x + inwardX * fallbackDistance * 0.75, y: actor.y + inwardY * fallbackDistance * 0.75 });
  }
  const away = normalizeVector(actor.x - killer.x, actor.y - killer.y);
  const inward = normalizeVector(center.x - actor.x, center.y - actor.y);
  const inwardWeight = inDeadzone ? 2.35 : 1.15;
  const blended = normalizeVector(away.x * 0.9 + inward.x * inwardWeight, away.y * 0.9 + inward.y * inwardWeight);
  fallbackOptions.push({ x: actor.x + blended.x * fallbackDistance, y: actor.y + blended.y * fallbackDistance });

  let fallback = null;
  let fallbackScore = -Infinity;
  for (const raw of fallbackOptions) {
    const point = clampToMapInterior(game, raw.x, raw.y);
    if (!actorCanStandAt(game, actor, point.x, point.y, helpers)) continue;
    const lane = runnerEscapeLaneValue(game, actor, killer, point.x, point.y, helpers);
    const score = helperDist(helpers, point.x, point.y, killer.x, killer.y)
      + edgeClearance(game, point.x, point.y) * 1.8
      + lane.score
      - cornerTrapSeverity(game, point.x, point.y) * 4800;
    if (score > fallbackScore) {
      fallback = point;
      fallbackScore = score;
    }
  }
  fallback = fallback || clampToMapInterior(game, actor.x + inward.x * fallbackDistance, actor.y + inward.y * fallbackDistance);
  rememberEscapePlan(actor, { score: -999, openExits: 0, safeExits: 0, deadEnd: false, fallback: true });
  return fallback;
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
  const teammatePenalty = teammateClusterPenalty(game, actor, point.x, point.y, TEAMMATE_SAFE_POINT_RADIUS, TEAMMATE_SAFE_POINT_PENALTY);
  return fromKiller * 2.35
    + moveAway * 360
    + (losBlocked ? 520 : 0)
    - fromActor * 0.42
    - edgePenalty(game, point.x, point.y)
    - teammatePenalty;
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

function objectSideSign(point, object) {
  if (!point || !object) return 0;
  const c = centerOf(object);
  return object.orientation === "horizontal"
    ? Math.sign(point.y - c.y) || 0
    : Math.sign(point.x - c.x) || 0;
}

function palletRunThroughPoint(game, actor, pallet, killer, helpers) {
  const c = centerOf(pallet);
  const tile = game.map?.tile || 32;
  const offset = Math.max(RUNNER_PALLET_THROUGH_DISTANCE, tile * 2.15);
  const actorSize = 32;

  let x = c.x;
  let y = c.y;
  if (pallet.orientation === "horizontal") {
    const sideAwayFromKiller = Math.sign(c.y - killer.y) || Math.sign(actor.y - killer.y) || 1;
    x = clamp(actor.x, pallet.x + actorSize, pallet.x + pallet.w - actorSize);
    y = c.y + sideAwayFromKiller * offset;
  } else {
    const sideAwayFromKiller = Math.sign(c.x - killer.x) || Math.sign(actor.x - killer.x) || 1;
    x = c.x + sideAwayFromKiller * offset;
    y = clamp(actor.y, pallet.y + actorSize, pallet.y + pallet.h - actorSize);
  }

  const interior = clampToMapInterior(game, x, y);
  x = interior.x;
  y = interior.y;
  if (actorCanStandAt(game, actor, x, y, helpers)) return { x, y };
  return choosePostTraversalPoint(game, actor, pallet, { x, y }, helpers);
}

function killerMovingTowardObject(killer, object) {
  if (!killer || !object) return false;
  const c = centerOf(object);
  const mv = actorMoveVector(killer);
  const dx = c.x - killer.x;
  const dy = c.y - killer.y;
  const len = Math.hypot(dx, dy) || 1;
  return (mv.x * (dx / len) + mv.y * (dy / len)) > 0.45;
}

function shouldDropPalletForStun(game, actor, killer, pallet, helpers) {
  if (!pallet || pallet.broken || pallet.state !== "upright" || !killer) return false;
  const killerRectD = pointRectDistance(killer.x, killer.y, pallet);
  const killerD = helperDist(helpers, actor.x, actor.y, killer.x, killer.y);
  const c = centerOf(pallet);
  const behind = killerBehindRunner(actor, killer, c);
  const oppositeSides = objectSideSign(actor, pallet) !== 0
    && objectSideSign(killer, pallet) !== 0
    && objectSideSign(actor, pallet) !== objectSideSign(killer, pallet);
  const chaseLaneToPallet = pointSegmentDistance(c.x, c.y, actor.x, actor.y, killer.x, killer.y) < (game.map?.tile || 32) * 1.4;
  const approaching = killerMovingTowardObject(killer, pallet);

  if (killerRectD <= RUNNER_PALLET_DROP_KILLER_RADIUS) return true;
  if (behind && killerD <= RUNNER_PALLET_DROP_PANIC_RADIUS) return true;
  if (oppositeSides && killerRectD <= RUNNER_PALLET_DROP_PANIC_RADIUS * 0.82) return true;
  if (approaching && chaseLaneToPallet && killerRectD <= RUNNER_PALLET_DROP_PANIC_RADIUS * 0.92) return true;
  return false;
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
    const reservedPenalty = reservationPenalty(game, actor, "safeObject", pallet.id, SAFE_OBJECT_RESERVED_PENALTY * 0.65);
    const score = (RUNNER_PALLET_DROP_KILLER_RADIUS - killerRectD) * 4 + (behind ? 240 : 0) - runnerD - reservedPenalty;
    if (score > bestScore) {
      best = pallet;
      bestScore = score;
    }
  }
  return best;
}


function palletStunOpportunityScore(game, actor, killer, pallet, helpers) {
  if (!pallet || pallet.broken || pallet.state !== "upright" || !killer) return null;
  const c = centerOf(pallet);
  const runnerCenterD = helperDist(helpers, actor.x, actor.y, c.x, c.y);
  const runnerRectD = pointRectDistance(actor.x, actor.y, pallet);
  if (Math.min(runnerCenterD, runnerRectD) > RUNNER_PALLET_APPROACH_DISTANCE) return null;

  const killerRectD = pointRectDistance(killer.x, killer.y, pallet);
  const killerD = helperDist(helpers, actor.x, actor.y, killer.x, killer.y);
  const behind = killerBehindRunner(actor, killer, c);
  const oppositeSides = objectSideSign(actor, pallet) !== 0
    && objectSideSign(killer, pallet) !== 0
    && objectSideSign(actor, pallet) !== objectSideSign(killer, pallet);
  const chaseLaneToPallet = pointSegmentDistance(c.x, c.y, actor.x, actor.y, killer.x, killer.y) < (game.map?.tile || 32) * 1.75;
  const approaching = killerMovingTowardObject(killer, pallet);
  const readyToDrop = runnerRectD <= RUNNER_INTERACT_DISTANCE + 24
    || runnerCenterD <= RUNNER_INTERACT_DISTANCE + 32;

  const mustRespectPallet = killerRectD <= RUNNER_PALLET_FORCE_DROP_RECT_DISTANCE
    || (behind && killerD <= RUNNER_PALLET_FORCE_DROP_KILLER_DISTANCE)
    || (oppositeSides && killerRectD <= RUNNER_PALLET_DROP_PANIC_RADIUS)
    || (approaching && chaseLaneToPallet && killerRectD <= RUNNER_PALLET_FORCE_DROP_KILLER_DISTANCE);

  if (!mustRespectPallet) return null;

  const exit = palletRunThroughPoint(game, actor, pallet, killer, helpers);
  if (!exit || !actorCanStandAt(game, actor, exit.x, exit.y, helpers)) return null;
  const exitPath = movementClear(game, actor, exit.x, exit.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.55 })
    ? []
    : buildPath(game, actor, exit.x, exit.y, helpers, { killer });
  if (!readyToDrop && !exitPath.length && !movementClear(game, actor, c.x, c.y, helpers, { extra: BODY_SEGMENT_EXTRA_RADIUS * 0.35 })) return null;

  const reservedPenalty = reservationPenalty(game, actor, "safeObject", pallet.id, SAFE_OBJECT_RESERVED_PENALTY * 0.42);
  const score = 1400
    + Math.max(0, RUNNER_PALLET_FORCE_DROP_KILLER_DISTANCE - killerD) * 3.4
    + Math.max(0, RUNNER_PALLET_FORCE_DROP_RECT_DISTANCE - killerRectD) * 5.8
    + (behind ? 560 : 0)
    + (oppositeSides ? 360 : 0)
    + (approaching ? 240 : 0)
    - runnerCenterD * 0.62
    - reservedPenalty;

  return { pallet, center: c, exit, readyToDrop, score, path: exitPath };
}

function choosePalletStunOpportunity(game, actor, killer, helpers) {
  let best = null;
  let bestScore = -Infinity;
  for (const pallet of game.map?.pallets || []) {
    const opportunity = palletStunOpportunityScore(game, actor, killer, pallet, helpers);
    if (!opportunity) continue;
    if (opportunity.score > bestScore) {
      best = opportunity;
      bestScore = opportunity.score;
    }
  }
  return best;
}

function runPalletStunOpportunity(game, actor, threat, helpers, dt) {
  if (!threat?.killer) return false;
  const brain = ensureSurvivalBrain(actor);
  const now = game.time || 0;
  const opportunity = choosePalletStunOpportunity(game, actor, threat.killer, helpers);
  if (!opportunity) return false;

  const pallet = opportunity.pallet;
  const exit = opportunity.exit;
  clearTask(actor, game);
  clearOwnedReservations(game, actor, "safeObject");
  reserveTarget(game, actor, "safeObject", pallet.id, RUNNER_PALLET_STUN_COMMIT_SECONDS + 0.6, { kind: "palletDrop" });
  brain.survivalTask = {
    kind: "palletDrop",
    id: pallet.id,
    x: exit.x,
    y: exit.y,
    exitX: exit.x,
    exitY: exit.y,
    committedAt: now,
    lockUntil: now + RUNNER_PALLET_STUN_COMMIT_SECONDS,
    reason: "force-stun-pallet"
  };
  brain.nextStep = { kind: "force-pallet-stun", targetId: pallet.id, score: Math.round(opportunity.score || 0) };

  const runnerRectD = pointRectDistance(actor.x, actor.y, pallet);
  const shouldDrop = opportunity.readyToDrop || shouldDropPalletForStun(game, actor, threat.killer, pallet, helpers);
  actor.input.action = shouldDrop && runnerRectD <= RUNNER_INTERACT_DISTANCE + 34;
  if (actor.input.action) {
    brain.survivalTask.actionUntil = Math.max(brain.survivalTask.actionUntil || 0, now + RUNNER_INTERACT_ACTION_HOLD_SECONDS);
  }

  if (Array.isArray(opportunity.path) && opportunity.path.length && !brain.path?.length) {
    brain.path = opportunity.path.slice();
    brain.pathTargetKey = `${Math.round(exit.x)},${Math.round(exit.y)}:${RUNNER_PALLET_EXIT_REACHED_DISTANCE}`;
    brain.repathIn = Math.max(PATH_REPLAN_SECONDS * 0.75, 0.9);
  }

  followPath(game, actor, exit, helpers, {
    sprint: true,
    stopDistance: RUNNER_PALLET_EXIT_REACHED_DISTANCE,
    dt,
    killer: threat.killer,
    progressTarget: exit,
    progressKey: `force-pallet:${pallet.id}`
  });
  actor.input.sprint = true;
  return true;
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
    const route = reachablePathCheck(game, actor, c, helpers, { tolerance: RUNNER_INTERACT_DISTANCE + 36, killer });
    if (!route.reachable) continue;
    const lineToWindow = segmentClearFromPoint(game, actor.x, actor.y, c.x, c.y, helpers);
    const reservedPenalty = reservationPenalty(game, actor, "safeObject", win.id, SAFE_OBJECT_RESERVED_PENALTY);
    const clusterPenalty = teammateClusterPenalty(game, actor, c.x, c.y, SAFE_OBJECT_CLUSTER_RADIUS, SAFE_OBJECT_CLUSTER_PENALTY, "safeObject", win.id);
    const pathPenalty = (route.path?.length || 1) * SAFE_OBJECT_ROUTE_PATH_PENALTY;
    const score = safePointScore(game, actor, killer, exit, helpers)
      + 900
      + (lineToWindow ? 180 : 0)
      - approachD * 0.28
      - pathPenalty
      - reservedPenalty
      - clusterPenalty;
    if (score > bestScore && score > SAFE_OBJECT_MIN_ROUTE_SCORE) {
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
      const exit = palletRunThroughPoint(game, actor, pallet, killer, helpers);
      if (!actorCanStandAt(game, actor, exit.x, exit.y, helpers)) continue;
      const route = reachablePathCheck(game, actor, exit, helpers, { tolerance: RUNNER_PALLET_EXIT_REACHED_DISTANCE + 28, killer });
      if (!route.reachable) continue;
      const reservedPenalty = reservationPenalty(game, actor, "safeObject", pallet.id, SAFE_OBJECT_RESERVED_PENALTY);
      const clusterPenalty = teammateClusterPenalty(game, actor, c.x, c.y, SAFE_OBJECT_CLUSTER_RADIUS, SAFE_OBJECT_CLUSTER_PENALTY, "safeObject", pallet.id);
      const pathPenalty = (route.path?.length || 1) * SAFE_OBJECT_ROUTE_PATH_PENALTY;
      const score = safePointScore(game, actor, killer, exit, helpers)
        + 980
        + (behind ? 420 : 0)
        + (killerRectD < RUNNER_PALLET_DROP_PANIC_RADIUS ? 520 : 0)
        - approachD * 0.22
        - pathPenalty
        - reservedPenalty
        - clusterPenalty;
      if (score > bestScore && score > SAFE_OBJECT_MIN_ROUTE_SCORE) {
        best = { kind: "palletDrop", object: pallet, point: exit, exit, score };
        bestScore = score;
      }
    } else if (pallet.state === "dropped") {
      const exit = oppositeSidePoint(game, actor, pallet, killer, actorSize);
      if (!actorCanStandAt(game, actor, exit.x, exit.y, helpers)) continue;
      const route = reachablePathCheck(game, actor, c, helpers, { tolerance: RUNNER_INTERACT_DISTANCE + 36, killer });
      if (!route.reachable) continue;
      const reservedPenalty = reservationPenalty(game, actor, "safeObject", pallet.id, SAFE_OBJECT_RESERVED_PENALTY);
      const clusterPenalty = teammateClusterPenalty(game, actor, c.x, c.y, SAFE_OBJECT_CLUSTER_RADIUS, SAFE_OBJECT_CLUSTER_PENALTY, "safeObject", pallet.id);
      const pathPenalty = (route.path?.length || 1) * SAFE_OBJECT_ROUTE_PATH_PENALTY;
      const score = safePointScore(game, actor, killer, exit, helpers) + 680 - approachD * 0.26 - pathPenalty - reservedPenalty - clusterPenalty;
      if (score > bestScore && score > SAFE_OBJECT_MIN_ROUTE_SCORE) {
        best = { kind: "palletVault", object: pallet, point: c, exit, score };
        bestScore = score;
      }
    }
  }

  return best;
}

function chooseRawSafePoint(game, actor, killer, helpers) {
  const routed = chooseMapEscapePoint(game, actor, killer, helpers);
  if (routed && Number.isFinite(routed.x) && Number.isFinite(routed.y)) return routed;

  let best = null;
  let bestScore = -Infinity;
  const baseAngle = Math.atan2(actor.y - killer.y, actor.x - killer.x);
  const hashOffset = ((actorIdHash(actor.id) % RUNNER_SAFE_SAMPLE_STEPS) / RUNNER_SAFE_SAMPLE_STEPS) * Math.PI * 2;
  for (const radius of RUNNER_SAFE_SAMPLE_RINGS) {
    for (let i = 0; i < RUNNER_SAFE_SAMPLE_STEPS; i++) {
      const spread = (i / RUNNER_SAFE_SAMPLE_STEPS) * Math.PI * 2;
      const angle = baseAngle + spread + hashOffset * 0.35;
      const point = clampToMapInterior(
        game,
        actor.x + Math.cos(angle) * radius,
        actor.y + Math.sin(angle) * radius
      );
      if (!actorCanStandAt(game, actor, point.x, point.y, helpers)) continue;
      const reach = reachablePathBonus(game, actor, point, helpers);
      const lane = runnerEscapeLaneValue(game, actor, killer, point.x, point.y, helpers);
      if (lane.deadEnd && edgeTrapSeverity(game, point.x, point.y) > 0.4) continue;
      const score = safePointScore(game, actor, killer, point, helpers) + reach.score + lane.score * 0.9;
      if (score > bestScore) {
        best = point;
        bestScore = score;
      }
    }
  }
  return best || clampToMapInterior(
    game,
    actor.x + Math.cos(baseAngle) * 360,
    actor.y + Math.sin(baseAngle) * 360
  );
}

function chooseForcedSafePoint(game, actor, killer, helpers, previousTarget = null) {
  if (!game?.map || !killer) {
    return previousTarget || {
      x: actor.x + Math.cos(actor.angle || 0) * RUNNER_FORCED_ESCAPE_MIN_DISTANCE,
      y: actor.y + Math.sin(actor.angle || 0) * RUNNER_FORCED_ESCAPE_MIN_DISTANCE
    };
  }

  return chooseMapEscapePoint(game, actor, killer, helpers, previousTarget);
}

function resetSafePointTask(game, actor, killer, helpers, previousTarget = null, reason = "safepoint-refresh") {
  const brain = ensureSurvivalBrain(actor);
  const point = chooseForcedSafePoint(game, actor, killer, helpers, previousTarget);
  clearOwnedReservations(game, actor, "safeObject");
  brain.survivalTask = {
    kind: "safePoint",
    id: null,
    x: point.x,
    y: point.y,
    committedAt: game.time || 0,
    lockUntil: (game.time || 0) + Math.max(RUNNER_ESCAPE_ROUTE_COMMIT_SECONDS, RUNNER_FLEE_REPLAN_SECONDS * 1.25),
    reason: point.escapePlan?.fallback ? "route-fallback" : reason,
    escapePlan: point.escapePlan || null
  };
  clearPath(brain);
  if (Array.isArray(point.route) && point.route.length) {
    brain.path = point.route.slice();
    brain.pathTargetKey = `${Math.round(point.x)},${Math.round(point.y)}:14`;
    // Keep the selected chase route long enough to actually run it. Repathing
    // every half-second was one of the causes of visible jiggle and backtracking.
    brain.repathIn = Math.max(PATH_REPLAN_SECONDS * 0.85, 1.15);
  }
  brain.moveIntent = null;
  brain.nextStep = point.escapePlan
    ? {
      kind: point.escapePlan.deadEnd ? "route-escape-backup" : "route-escape",
      targetId: null,
      score: Math.round(point.escapePlan.score || 0),
      exits: point.escapePlan.openExits || 0,
      safeExits: point.escapePlan.safeExits || 0
    }
    : { kind: "forced-safe-point", targetId: null };
  return brain.survivalTask;
}

function forceSafePointMovement(game, actor, killer, helpers, dt, reason = "safepoint-force") {
  const brain = ensureSurvivalBrain(actor);
  const previous = brain.survivalTask ? { x: brain.survivalTask.x, y: brain.survivalTask.y } : null;
  const task = resetSafePointTask(game, actor, killer, helpers, previous, reason);
  followPath(game, actor, { x: task.x, y: task.y }, helpers, {
    sprint: true,
    stopDistance: 14,
    dt
  });
  if (!(actor.input.up || actor.input.down || actor.input.left || actor.input.right)) {
    const center = mapCenter(game);
    const away = killer
      ? normalizeVector(actor.x - killer.x, actor.y - killer.y)
      : normalizeVector(Math.cos(actor.angle || 0), Math.sin(actor.angle || 0));
    const inward = normalizeVector(center.x - actor.x, center.y - actor.y);
    const deadzone = cornerTrapSeverity(game, actor.x, actor.y) > 0.08 || edgeTrapSeverity(game, actor.x, actor.y) > 0.34;
    const v = normalizeVector(away.x * 0.95 + inward.x * (deadzone ? 2.4 : 0.85), away.y * 0.95 + inward.y * (deadzone ? 2.4 : 0.85));
    const forced = clampToMapInterior(
      game,
      actor.x + v.x * (RUNNER_FORCED_ESCAPE_MIN_DISTANCE + (game.map?.tile || 32) * 5),
      actor.y + v.y * (RUNNER_FORCED_ESCAPE_MIN_DISTANCE + (game.map?.tile || 32) * 5)
    );
    const detour = chooseLocalDetourPoint(game, actor, forced, helpers, { sprint: true, now: game.time || 0, killer });
    const next = detour || forced;
    brain.survivalTask.x = next.x;
    brain.survivalTask.y = next.y;
    clearPath(brain);
    setCollisionAwareMoveToward(game, actor, next.x, next.y, helpers, true, { killer, force: true });
  }
  actor.input.action = false;
  actor.input.repair = false;
  actor.input.sprint = true;
  return true;
}

function chooseSurvivalTask(game, actor, threat, helpers) {
  const { killer } = threat;
  const palletOpportunity = choosePalletStunOpportunity(game, actor, killer, helpers);
  if (palletOpportunity) {
    return {
      kind: "palletDrop",
      target: { ...palletOpportunity.exit, id: palletOpportunity.pallet.id },
      object: palletOpportunity.pallet,
      exit: palletOpportunity.exit,
      forcedPallet: true
    };
  }

  const immediatePallet = chooseImmediatePalletDrop(game, actor, killer, helpers);
  if (immediatePallet) {
    const exit = palletRunThroughPoint(game, actor, immediatePallet, killer, helpers);
    return { kind: "palletDrop", target: { ...exit, id: immediatePallet.id }, object: immediatePallet, exit };
  }

  const point = chooseRawSafePoint(game, actor, killer, helpers);
  const rawReach = Array.isArray(point?.route) && point.route.length
    ? { reachable: true, score: 360 + Math.min(point.route.length, 18) * 22, pathLength: point.route.length }
    : reachablePathBonus(game, actor, point, helpers);
  const rawScore = Number.isFinite(point?.escapeScore)
    ? point.escapeScore
    : safePointScore(game, actor, killer, point, helpers) + rawReach.score;

  const safeObject = chooseSafeObject(game, actor, killer, helpers);
  const loopBias = threat.panic || threat.distance <= RUNNER_DANGER_RADIUS ? 1100 : 650;
  if (safeObject && safeObject.score + loopBias >= rawScore && edgeTrapSeverity(game, safeObject.exit?.x ?? safeObject.point.x, safeObject.exit?.y ?? safeObject.point.y) < 0.88) {
    return {
      kind: safeObject.kind,
      target: { ...safeObject.point, id: safeObject.object.id },
      object: safeObject.object,
      exit: safeObject.exit
    };
  }

  return { kind: "safePoint", target: { ...point, id: null }, object: null };
}

function runSurvivorSurvival(game, actor, helpers, dt) {
  const brain = ensureSurvivalBrain(actor);
  const threat = survivorThreatInfo(game, actor, helpers);
  const now = game.time || 0;

  if (applyPostTraversalMovement(game, actor, helpers, { dt, now, sprint: true })) return true;

  if (!threat?.threatened && now > (brain.threatUntil || 0) && (!brain.survivalTask || !threat?.killer || threat.distance >= RUNNER_SAFE_DISTANCE)) {
    if (brain.survivalTask) clearSurvivalTask(actor, game);
    return false;
  }

  if (threat?.threatened) {
    brain.threatUntil = Math.max(brain.threatUntil || 0, now + RUNNER_FLEE_LOCK_SECONDS);
    if (threat.panic || threat.distance <= RUNNER_THREAT_RADIUS) clearTask(actor, game);
  }

  if (!threat?.killer) return false;

  const stillUnsafe = threat.distance < RUNNER_SAFE_DISTANCE || now < (brain.threatUntil || 0);
  if (!stillUnsafe) {
    clearSurvivalTask(actor, game);
    brain.threatUntil = 0;
    return false;
  }

  tryUseRunnerSpeedBurst(game, actor, threat, helpers, threat.panic ? "panic" : "killer-close");

  // Emergency pallet logic overrides normal chase routing. If the killer is right
  // behind / crossing the pallet lane, throw the pallet. Bots were being too
  // academic here and dying with a perfectly good stun in their pocket.
  if (runPalletStunOpportunity(game, actor, threat, helpers, dt)) return true;

  const currentObject = resolveSafeObject(game, brain.survivalTask);
  const taskUnlocked = now >= (brain.survivalTask?.lockUntil || 0);
  const taskBadObject = (brain.survivalTask?.kind !== "safePoint" && !currentObject)
    || (brain.survivalTask?.kind === "palletDrop" && currentObject?.broken)
    || (brain.survivalTask?.kind === "palletVault" && currentObject?.state !== "dropped")
    || (brain.survivalTask?.kind === "windowVault" && !currentObject);
  const taskCrowded = taskUnlocked
    && brain.survivalTask?.id
    && (brain.survivalTask.kind === "windowVault" || brain.survivalTask.kind === "palletDrop" || brain.survivalTask.kind === "palletVault")
    && isReservedByOther(game, actor, "safeObject", brain.survivalTask.id)
    && !threat.panic;
  const currentSafePoint = brain.survivalTask?.kind === "safePoint" ? brain.survivalTask : null;
  const currentSafePointD = currentSafePoint
    ? helperDist(helpers, actor.x, actor.y, currentSafePoint.x, currentSafePoint.y)
    : Infinity;
  const currentSafePointBad = !!currentSafePoint && !actorCanStandAt(game, actor, currentSafePoint.x, currentSafePoint.y, helpers);
  const currentSafePointReached = !!currentSafePoint
    && taskUnlocked
    && stillUnsafe
    && currentSafePointD <= RUNNER_SAFEPOINT_REACHED_DISTANCE;
  const currentSafePointTooSmall = !!currentSafePoint
    && taskUnlocked
    && stillUnsafe
    && currentSafePointD < RUNNER_SAFEPOINT_MIN_DISTANCE
    && threat.distance < RUNNER_SAFE_DISTANCE;
  const currentInvalid = !brain.survivalTask
    || (taskUnlocked && (taskBadObject || taskCrowded))
    || currentSafePointBad
    || currentSafePointReached
    || currentSafePointTooSmall;

  if (currentInvalid) {
    const choice = chooseSurvivalTask(game, actor, threat, helpers);
    if (choice.kind === "safePoint") {
      resetSafePointTask(game, actor, threat.killer, helpers, currentSafePoint, currentSafePointReached ? "safepoint-advance" : "safepoint-refresh");
    } else {
      const extra = choice.exit ? { exitX: choice.exit.x, exitY: choice.exit.y } : {};
      setSurvivalTask(game, actor, choice.kind, choice.target, extra);
    }
  }

  const task = brain.survivalTask;
  if (!task) return false;

  const target = { x: task.x, y: task.y, id: task.id };
  const d = helperDist(helpers, actor.x, actor.y, target.x, target.y);
  const isInteractTask = task.kind === "windowVault" || task.kind === "palletDrop" || task.kind === "palletVault";

  if (isInteractTask && now <= (task.afterInteractUntil || 0)) {
    const postPoint = postInteractSafePoint(game, actor, threat.killer, task, helpers);
    if (!brain.postTraversalTarget) rememberPostTraversalMove(game, actor, currentObject, task.kind, postPoint);
    applyPostTraversalMovement(game, actor, helpers, { dt, now, sprint: true });
    return true;
  }

  if (isInteractTask && actor.vault) {
    const postPoint = postInteractSafePoint(game, actor, threat.killer, task, helpers);
    task.afterInteractUntil = Math.max(task.afterInteractUntil || 0, now + RUNNER_POST_INTERACT_SECONDS);
    rememberPostTraversalMove(game, actor, currentObject, task.kind, postPoint);
    reserveTarget(game, actor, "safeObject", task.id, RUNNER_POST_INTERACT_SECONDS, { kind: task.kind });
    rememberSurvivalInteract(actor, task.kind, task.id, now);
    return true;
  }

  const objectD = currentObject ? helperDist(helpers, actor.x, actor.y, centerOf(currentObject).x, centerOf(currentObject).y) : d;
  const postPoint = isInteractTask ? postInteractSafePoint(game, actor, threat.killer, task, helpers) : null;
  const palletDropped = task.kind === "palletDrop" && currentObject?.state === "dropped";

  if (palletDropped) {
    task.afterInteractUntil = Math.max(task.afterInteractUntil || 0, now + RUNNER_POST_INTERACT_SECONDS);
    rememberPostTraversalMove(game, actor, currentObject, task.kind, postPoint);
    reserveTarget(game, actor, "safeObject", task.id, RUNNER_POST_INTERACT_SECONDS, { kind: task.kind });
    rememberSurvivalInteract(actor, task.kind, task.id, now);
    actor.input.action = false;
    applyPostTraversalMovement(game, actor, helpers, { dt, now, sprint: true });
    return true;
  }

  if (task.kind === "palletDrop" && currentObject) {
    const runnerRectD = pointRectDistance(actor.x, actor.y, currentObject);
    const shouldDrop = (objectD <= RUNNER_INTERACT_DISTANCE + 28 || runnerRectD <= RUNNER_INTERACT_DISTANCE + 26)
      && shouldDropPalletForStun(game, actor, threat.killer, currentObject, helpers);

    if (shouldDrop) {
      actor.input.action = true;
      task.actionUntil = Math.max(task.actionUntil || 0, now + RUNNER_INTERACT_ACTION_HOLD_SECONDS);
    } else {
      actor.input.action = false;
    }

    // Pallets are not a bus stop. Run through the pallet line, press action only when the
    // killer is in the stun/wall zone, then keep moving away either way.
    followPath(game, actor, postPoint || target, helpers, {
      sprint: true,
      stopDistance: RUNNER_PALLET_EXIT_REACHED_DISTANCE,
      dt,
      killer: threat.killer,
      progressTarget: postPoint || target,
      progressKey: `pallet-run:${task.id}`
    });

    if (!shouldDrop && helperDist(helpers, actor.x, actor.y, postPoint.x, postPoint.y) <= RUNNER_PALLET_EXIT_REACHED_DISTANCE) {
      const point = chooseRawSafePoint(game, actor, threat.killer, helpers);
      setSurvivalTask(game, actor, "safePoint", { ...point, id: null });
    }
    return true;
  }

  if ((task.kind === "windowVault" || task.kind === "palletVault") && currentObject && objectD <= RUNNER_INTERACT_DISTANCE + 14) {
    // Do not stop at the window/pallet. Press action while moving through the exit point.
    // Stopping here was the tiny digital hesitation that got bots slapped.
    actor.input.action = true;
    task.actionUntil = Math.max(task.actionUntil || 0, now + RUNNER_INTERACT_ACTION_HOLD_SECONDS);
    setCollisionAwareMoveToward(game, actor, postPoint.x, postPoint.y, helpers, true, { killer: threat.killer, force: false });
    actor.input.sprint = true;
    actor.input.angle = Math.atan2(centerOf(currentObject).y - actor.y, centerOf(currentObject).x - actor.x);
    return true;
  }

  if (task.kind === "safePoint") {
    const targetBad = !actorCanStandAt(game, actor, target.x, target.y, helpers);
    const targetTooClose = stillUnsafe && d <= RUNNER_SAFEPOINT_REACHED_DISTANCE;
    if (targetBad || targetTooClose) {
      return forceSafePointMovement(game, actor, threat.killer, helpers, dt, targetTooClose ? "safepoint-continue" : "safepoint-bad");
    }

    followPath(game, actor, target, helpers, {
      sprint: true,
      stopDistance: 14,
      dt,
      killer: threat.killer,
      progressTarget: target,
      progressKey: `survival:${Math.round(target.x)},${Math.round(target.y)}`
    });
    actor.input.action = false;
    actor.input.repair = false;

    if (!(actor.input.up || actor.input.down || actor.input.left || actor.input.right)) {
      return forceSafePointMovement(game, actor, threat.killer, helpers, dt, "safepoint-no-move");
    }
    return true;
  }

  followPath(game, actor, target, helpers, {
    sprint: true,
    stopDistance: isInteractTask ? RUNNER_INTERACT_DISTANCE * 0.42 : 38,
    dt,
    killer: threat.killer,
    progressTarget: target,
    progressKey: `survival-task:${task.kind}:${task.id || Math.round(target.x)}`
  });
  actor.input.action = false;
  return true;
}

function refreshTeamReservations(game) {
  purgeCoordination(game);
  if (!game?.actors) return;

  for (const actor of game.actors.values()) {
    if (!actor?.isBot || actor.role !== "survivor" || !isActiveRunner(game, actor)) {
      if (actor?.id) clearOwnedReservations(game, actor);
      continue;
    }

    const brain = ensureSurvivalBrain(actor);
    if (brain.task?.kind === "orb" && brain.task.id) {
      reserveTarget(game, actor, "orb", brain.task.id);
    } else if (brain.task?.kind === "deposit" && brain.task.id) {
      reserveTarget(game, actor, "rift", brain.task.id);
    }

    if (brain.survivalTask?.id && (brain.survivalTask.kind === "windowVault" || brain.survivalTask.kind === "palletDrop" || brain.survivalTask.kind === "palletVault")) {
      reserveTarget(game, actor, "safeObject", brain.survivalTask.id, Math.max(COORDINATION_TTL_SECONDS, RUNNER_FLEE_REPLAN_SECONDS + 0.8), { kind: brain.survivalTask.kind });
    }

    if (brain.unhookTask?.id) {
      reserveTarget(game, actor, "unhook", brain.unhookTask.id, RUNNER_UNHOOK_COMMIT_SECONDS);
    }

    if (brain.healTask?.id) {
      reserveTarget(game, actor, "heal", brain.healTask.id, RUNNER_HEAL_COMMIT_SECONDS);
    }

    if (brain.escapeTask?.id) {
      reserveTarget(game, actor, "escapeGate", brain.escapeTask.id, RUNNER_ESCAPE_COMMIT_SECONDS);
    }
  }
}

function runSurvivorOrbRunner(game, actor, helpers, dt) {
  const brain = ensureBotBrain(actor);
  const carried = Math.max(0, Math.floor(actor.dots || 0));

  if (game.escapeOpen) {
    clearTask(actor, game);
    if (!runSurvivorEscape(game, actor, helpers, dt)) runSurvivorIdlePatrol(game, actor, helpers, dt);
    return;
  }

  if (!unfinishedRifts(game).length) {
    clearTask(actor, game);
    runSurvivorIdlePatrol(game, actor, helpers, dt);
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
    clearTask(actor, game);
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
    clearTask(actor, game);
    runSurvivorIdlePatrol(game, actor, helpers, dt);
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

  refreshTeamReservations(game);

  for (const actor of game.actors.values()) {
    if (!actor?.isBot) continue;
    const brain = ensureBotBrain(actor);
    brain.aiNow = game.time || 0;
    brain.previousTickHadMoveInput = !!(actor.input?.up || actor.input?.down || actor.input?.left || actor.input?.right || brain.lastIssuedMove);

    if (typeof helpers.resetInput === "function") helpers.resetInput(actor.input);
    actor.bot.actionCooldown = Math.max(0, (actor.bot.actionCooldown || 0) - dt);

    if (actor.dead || actor.escaped || actor.hooked || actor.downed) {
      clearTask(actor, game);
      clearSurvivalTask(actor, game);
      clearUnhookTask(actor, game);
      clearHealTask(actor, game);
      clearEscapeTask(actor, game);
      clearIdlePatrolTask(actor);
      clearBotDebug(actor, actor.dead ? "dead" : actor.escaped ? "escaped" : actor.hooked ? "hooked" : "downed");
      continue;
    }

    if (actor.role === "killer") {
      voidAi.runVoidRiftAi(game, actor, helpers, dt);
      setBotDebug(game, actor, "void");
      continue;
    }

    if (actor.role !== "survivor") {
      stopAndFace(actor, null);
      clearBotDebug(actor, "idle");
      continue;
    }

    if (applyPostTraversalMovement(game, actor, helpers, { dt, now: game.time || 0, sprint: true })) {
      setBotDebug(game, actor, "post-vault move");
      continue;
    }

    if (runSurvivorSurvival(game, actor, helpers, dt)) {
      setBotDebug(game, actor, "flee");
      continue;
    }
    if (runSurvivorUnhook(game, actor, helpers, dt)) {
      setBotDebug(game, actor, "unhook");
      continue;
    }
    if (runSurvivorWaitForHeal(game, actor, helpers)) {
      setBotDebug(game, actor, "receive-heal");
      continue;
    }
    if (runSurvivorHeal(game, actor, helpers, dt)) {
      setBotDebug(game, actor, "heal");
      continue;
    }
    if (runSurvivorEscape(game, actor, helpers, dt)) {
      setBotDebug(game, actor, "escape");
      continue;
    }

    runSurvivorOrbRunner(game, actor, helpers, dt);
    setBotDebug(game, actor, "objective");
  }
}

module.exports = {
  assignRunnerBotPersonalities,
  updateBotInputs
};
