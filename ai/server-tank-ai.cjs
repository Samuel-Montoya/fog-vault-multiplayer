"use strict";

const STATES = { IDLE: "idle", PATROL: "patrol", ALERT: "alert", ATTACK: "attack", EVADE: "evade" };
const EVADE_DURATION = 0.34;
const EVADE_COOLDOWN = 1.05;
const ALERT_AIM_SECONDS = 0.18;
const POST_FIRE_PAUSE = 0.12;
const PATROL_WAYPOINT_REACH = 24;
const BULLET_DANGER_RADIUS = 78;
const BULLET_DANGER_LOOKAHEAD = 1.1;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function normalize(x, y) {
  const len = Math.hypot(x, y);
  return len > 0.001 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function reflect(dx, dy, nx, ny) {
  const dot = dx * nx + dy * ny;
  return normalize(dx - 2 * dot * nx, dy - 2 * dot * ny);
}

function ensureTankBrain(enemy) {
  if (!enemy._tankAi) {
    enemy._tankAi = {
      state: enemy.tier === "husk" || enemy.tier === "sniper" ? STATES.IDLE : STATES.PATROL,
      stateTimer: 0,
      targetId: null,
      aimAngle: enemy.aimAngle || 0,
      patrolTarget: null,
      patrolTimer: 0,
      evadeDir: null,
      evadeCooldown: 0,
      fireCooldown: 0,
      mineCooldown: 0,
      alertTimer: 0,
      stuckTimer: 0,
      lastX: enemy.x,
      lastY: enemy.y,
      lastMoveIntent: 0
    };
  }
  return enemy._tankAi;
}

function pointInAnyWall(game, x, y) {
  for (const wall of game.map.walls || []) {
    if (x >= wall.x && x <= wall.x + wall.w && y >= wall.y && y <= wall.y + wall.h) return true;
  }
  return false;
}

function circleIntersectsRect(cx, cy, radius, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= radius * radius;
}

function circleInAnyWall(game, x, y, radius = 18) {
  if (x - radius < 0 || y - radius < 0 || x + radius > game.map.width || y + radius > game.map.height) return true;
  for (const wall of game.map.walls || []) {
    if (circleIntersectsRect(x, y, radius, wall)) return true;
  }
  return false;
}

function tankAreaIsClear(game, x, y, radius = 18) {
  return !circleInAnyWall(game, x, y, radius);
}

function segmentHitsWall(game, ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by);
  const steps = Math.max(2, Math.ceil(d / 6));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (pointInAnyWall(game, x, y)) return true;
  }
  return false;
}

function hasLineOfSight(game, ax, ay, bx, by) {
  return !segmentHitsWall(game, ax, ay, bx, by);
}

function getPlayerById(game, id) {
  for (const p of game.tankPlayers || []) {
    if (p.id === id) return p;
  }
  return null;
}

function findNearestPlayer(game, enemy) {
  let best = null;
  let bestDist = Infinity;
  for (const player of game.tankPlayers || []) {
    if (player.dead) continue;
    const d = dist(enemy.x, enemy.y, player.x, player.y);
    if (d < bestDist) {
      bestDist = d;
      best = player;
    }
  }
  return best ? { player: best, dist: bestDist } : null;
}

function choosePatrolTarget(enemy, game) {
  const tile = game.map.tile || 56;
  const radius = enemy.config.patrolRadius || 180;
  const body = Math.max(14, (enemy.size || 24) * 0.72);
  const anchors = [
    { x: enemy.spawnX, y: enemy.spawnY },
    { x: enemy.x, y: enemy.y }
  ];

  for (const anchor of anchors) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = radius * (0.35 + Math.random() * 0.65);
      const px = anchor.x + Math.cos(angle) * r;
      const py = anchor.y + Math.sin(angle) * r;
      const cx = clamp(px, tile, game.map.width - tile);
      const cy = clamp(py, tile, game.map.height - tile);
      if (tankAreaIsClear(game, cx, cy, body) && hasLineOfSight(game, enemy.x, enemy.y, cx, cy)) return { x: cx, y: cy };
    }
  }
  return { x: enemy.spawnX, y: enemy.spawnY };
}

function nearestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.001) return { x: ax, y: ay, dist: dist(px, py, ax, ay), t: 0 };
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { x: cx, y: cy, dist: dist(px, py, cx, cy), t };
}

function incomingBulletThreat(game, enemy) {
  const bullets = game.tankBullets || [];
  const body = Math.max(20, (enemy.size || 24) * 0.82);
  for (const bullet of bullets) {
    if (bullet.ownerId === enemy.id) continue;
    if (bullet.ownerType === "enemy") continue;
    const toEnemyX = enemy.x - bullet.x;
    const toEnemyY = enemy.y - bullet.y;
    const along = toEnemyX * bullet.dx + toEnemyY * bullet.dy;
    if (along < -body || along > (bullet.speed || 500) * BULLET_DANGER_LOOKAHEAD) continue;
    const futureX = bullet.x + bullet.dx * (bullet.speed || 500) * BULLET_DANGER_LOOKAHEAD;
    const futureY = bullet.y + bullet.dy * (bullet.speed || 500) * BULLET_DANGER_LOOKAHEAD;
    const closest = nearestPointOnSegment(enemy.x, enemy.y, bullet.x, bullet.y, futureX, futureY);
    if (closest.dist < BULLET_DANGER_RADIUS + body) return bullet;
  }
  return null;
}

function computeEvadeDirection(game, enemy, bullet) {
  const perpA = normalize(-bullet.dy, bullet.dx);
  const perpB = normalize(bullet.dy, -bullet.dx);
  const body = Math.max(16, (enemy.size || 24) * 0.72);
  const step = Math.max(70, (enemy.config.speed || 140) * 0.42);
  const choices = [perpA, perpB, normalize(enemy.x - bullet.x, enemy.y - bullet.y), normalize(-bullet.dx, -bullet.dy)];
  choices.sort((a, b) => {
    const aclear = tankAreaIsClear(game, enemy.x + a.x * step, enemy.y + a.y * step, body) ? 1 : 0;
    const bclear = tankAreaIsClear(game, enemy.x + b.x * step, enemy.y + b.y * step, body) ? 1 : 0;
    return bclear - aclear;
  });
  return choices[0] || perpA;
}

function computeLeadAngle(enemy, target, bulletSpeed) {
  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return Math.atan2(dy, dx);

  const tvx = target.vx || 0;
  const tvy = target.vy || 0;
  const tSpeed = Math.hypot(tvx, tvy);
  if (tSpeed < 5 || bulletSpeed < 10) return Math.atan2(dy, dx);

  const timeToHit = d / bulletSpeed;
  const leadX = target.x + tvx * timeToHit * 0.55;
  const leadY = target.y + tvy * timeToHit * 0.55;
  return Math.atan2(leadY - enemy.y, leadX - enemy.x);
}

function findWallHit(game, startX, startY, dx, dy, maxDist) {
  const step = 4;
  const steps = Math.ceil(maxDist / step);
  let prevX = startX;
  let prevY = startY;

  for (let i = 1; i <= steps; i++) {
    const x = startX + dx * step * i;
    const y = startY + dy * step * i;

    if (x < 0 || y < 0 || x > game.map.width || y > game.map.height) {
      const nx = x < 0 ? 1 : x > game.map.width ? -1 : 0;
      const ny = y < 0 ? 1 : y > game.map.height ? -1 : 0;
      return { x: prevX, y: prevY, nx: nx || 0, ny: ny || 0 };
    }

    if (pointInAnyWall(game, x, y)) {
      const eps = 5;
      const blockedLeft = pointInAnyWall(game, prevX - eps, prevY);
      const blockedRight = pointInAnyWall(game, prevX + eps, prevY);
      const blockedUp = pointInAnyWall(game, prevX, prevY - eps);
      const blockedDown = pointInAnyWall(game, prevX, prevY + eps);
      let nx = 0;
      let ny = 0;

      if (dx > 0 && !blockedLeft) nx = -1;
      else if (dx < 0 && !blockedRight) nx = 1;
      if (dy > 0 && !blockedUp) ny = -1;
      else if (dy < 0 && !blockedDown) ny = 1;

      if (nx && ny) {
        if (Math.abs(dx) > Math.abs(dy)) ny = 0;
        else nx = 0;
      }
      if (!nx && !ny) {
        nx = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? -1 : 1) : 0;
        ny = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? -1 : 1) : 0;
      }
      return { x: prevX, y: prevY, nx, ny };
    }
    prevX = x;
    prevY = y;
  }
  return null;
}

function rayPassesNearTarget(game, sx, sy, dx, dy, target, maxDist) {
  const ex = sx + dx * maxDist;
  const ey = sy + dy * maxDist;
  const closest = nearestPointOnSegment(target.x, target.y, sx, sy, ex, ey);
  if (closest.t <= 0.02 || closest.t >= 0.98) return false;
  if (closest.dist > 48) return false;
  return !segmentHitsWall(game, sx, sy, closest.x, closest.y);
}

function tryRicochetShot(game, enemy, target) {
  const maxBounces = Math.max(1, Math.floor(enemy.config.bulletBounces || 1));
  const directAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
  const testAngles = [];
  const addAngle = (a) => {
    if (!testAngles.some((b) => Math.abs(angleDiff(a, b)) < 0.02)) testAngles.push(a);
  };
  for (let i = -10; i <= 10; i++) addAngle(directAngle + i * 0.105);
  for (let i = 0; i < 40; i++) addAngle((i / 40) * Math.PI * 2);

  for (const angle of testAngles) {
    let rx = enemy.x;
    let ry = enemy.y;
    let rdx = Math.cos(angle);
    let rdy = Math.sin(angle);

    for (let bounce = 0; bounce <= maxBounces; bounce++) {
      if (rayPassesNearTarget(game, rx, ry, rdx, rdy, target, 820)) return angle;
      const hitInfo = findWallHit(game, rx, ry, rdx, rdy, 820);
      if (!hitInfo || bounce >= maxBounces) break;
      const reflected = reflect(rdx, rdy, hitInfo.nx, hitInfo.ny);
      rx = hitInfo.x + reflected.x * 8;
      ry = hitInfo.y + reflected.y * 8;
      rdx = reflected.x;
      rdy = reflected.y;
    }
  }

  return null;
}

function countEnemyActiveBullets(game, enemyId) {
  let count = 0;
  for (const b of game.tankBullets || []) {
    if (b.ownerId === enemyId) count++;
  }
  return count;
}

function countEnemyActiveMines(game, enemyId) {
  let count = 0;
  for (const mine of game.tankMines || []) {
    if (mine.ownerId === enemyId) count++;
  }
  return count;
}

function canLayMine(game, enemy, target, config) {
  if (!config.laysMines || brainlessFalse(config.mineCooldown)) return false;
  if (!target || target.dead) return false;
  const maxMines = Math.max(1, Math.floor(config.maxMines || 2));
  if (countEnemyActiveMines(game, enemy.id) >= maxMines) return false;
  const d = dist(enemy.x, enemy.y, target.x, target.y);
  return d <= (config.mineRange || 260);
}

function brainlessFalse(value) {
  return value === false || value === null;
}

function pickClearDirection(game, enemy, desiredX, desiredY) {
  const base = Math.atan2(desiredY || 0, desiredX || 1);
  const body = Math.max(14, (enemy.size || 24) * 0.72);
  const step = Math.max(56, (enemy.config.speed || 120) * 0.45);
  const offsets = [0, 0.55, -0.55, Math.PI / 2, -Math.PI / 2, Math.PI, 1.1, -1.1, 2.1, -2.1];
  for (const offset of offsets) {
    const a = base + offset;
    const x = Math.cos(a);
    const y = Math.sin(a);
    if (tankAreaIsClear(game, enemy.x + x * step, enemy.y + y * step, body)) return { x, y };
  }
  return { x: 0, y: 0 };
}

function setMovement(enemy, game, x, y) {
  const dir = normalize(x, y);
  if (!dir.x && !dir.y) {
    enemy.moveX = 0;
    enemy.moveY = 0;
    return;
  }
  const clear = pickClearDirection(game, enemy, dir.x, dir.y);
  enemy.moveX = clear.x;
  enemy.moveY = clear.y;
}

function maintainDistanceMove(game, enemy, target, d, config) {
  const keep = config.keepDistance || 0;
  if (!keep) return false;
  const toTarget = normalize(target.x - enemy.x, target.y - enemy.y);
  if (d < keep * 0.82) {
    setMovement(enemy, game, -toTarget.x, -toTarget.y);
    return true;
  }
  if (d > keep * 1.35 && config.pursuePlayer) {
    setMovement(enemy, game, toTarget.x, toTarget.y);
    return true;
  }
  if (config.strafeSkill) {
    const side = Math.sin((game.time || 0) * 1.7 + enemy.spawnX * 0.01) >= 0 ? 1 : -1;
    setMovement(enemy, game, -toTarget.y * side, toTarget.x * side);
    return true;
  }
  return false;
}

function noteBrainMovement(enemy, brain, dt) {
  if ((brain.lastMoveIntent || 0) > 0.15) {
    const moved = dist(brain.lastX || enemy.x, brain.lastY || enemy.y, enemy.x, enemy.y);
    brain.stuckTimer = moved < 2.5 ? (brain.stuckTimer || 0) + dt : 0;
  } else {
    brain.stuckTimer = Math.max(0, (brain.stuckTimer || 0) - dt * 2);
  }
  brain.lastX = enemy.x;
  brain.lastY = enemy.y;
}

function thinkEnemy(game, enemy, dt) {
  const config = enemy.config || {};
  if (config.isBoss) {
    enemy.moveX = 0;
    enemy.moveY = 0;
    enemy.wantFire = false;
    enemy.wantMine = false;
    return;
  }
  const brain = ensureTankBrain(enemy);
  noteBrainMovement(enemy, brain, dt);
  brain.fireCooldown = Math.max(0, brain.fireCooldown - dt);
  brain.mineCooldown = Math.max(0, brain.mineCooldown - dt);
  brain.evadeCooldown = Math.max(0, brain.evadeCooldown - dt);
  brain.stateTimer += dt;

  enemy.moveX = 0;
  enemy.moveY = 0;
  enemy.wantFire = false;
  enemy.wantMine = false;
  enemy.aimAngle = brain.aimAngle;

  if (brain.stuckTimer > 0.42) {
    brain.patrolTarget = null;
    const nearest = findNearestPlayer(game, enemy);
    const away = nearest ? normalize(enemy.x - nearest.player.x, enemy.y - nearest.player.y) : normalize(enemy.x - enemy.spawnX, enemy.y - enemy.spawnY);
    const clear = pickClearDirection(game, enemy, away.x || 1, away.y || 0);
    enemy.moveX = clear.x;
    enemy.moveY = clear.y;
    brain.stuckTimer = 0;
    brain.lastMoveIntent = Math.hypot(enemy.moveX, enemy.moveY);
    return;
  }

  if ((config.evadeSkill || 0) > 0 && (config.speed || 0) > 0 && brain.evadeCooldown <= 0) {
    const threat = incomingBulletThreat(game, enemy);
    const dodgeChance = clamp(config.evadeSkill || 0, 0, 1) * 0.42;
    if (threat && Math.random() < dodgeChance) {
      brain.state = STATES.EVADE;
      brain.stateTimer = 0;
      brain.evadeCooldown = EVADE_COOLDOWN;
      brain.evadeDir = computeEvadeDirection(game, enemy, threat);
    }
  }

  const nearest = findNearestPlayer(game, enemy);
  if (nearest && (!brain.targetId || !getPlayerById(game, brain.targetId)?.dead)) {
    const current = getPlayerById(game, brain.targetId);
    if (!current || nearest.dist + 90 < dist(enemy.x, enemy.y, current.x, current.y)) brain.targetId = nearest.player.id;
  }

  switch (brain.state) {
    case STATES.IDLE:
      if (nearest && nearest.dist < (config.fireRange || 700)) {
        brain.state = STATES.ALERT;
        brain.stateTimer = 0;
        brain.targetId = nearest.player.id;
      }
      break;

    case STATES.PATROL:
      if (nearest && nearest.dist < (config.fireRange || 700) && (hasLineOfSight(game, enemy.x, enemy.y, nearest.player.x, nearest.player.y) || config.ricochetAim)) {
        brain.state = STATES.ALERT;
        brain.stateTimer = 0;
        brain.targetId = nearest.player.id;
        break;
      }
      if (!brain.patrolTarget || dist(enemy.x, enemy.y, brain.patrolTarget.x, brain.patrolTarget.y) < PATROL_WAYPOINT_REACH) {
        brain.patrolTarget = choosePatrolTarget(enemy, game);
      }
      if (brain.patrolTarget) {
        setMovement(enemy, game, brain.patrolTarget.x - enemy.x, brain.patrolTarget.y - enemy.y);
        brain.aimAngle = Math.atan2(enemy.moveY || 0, enemy.moveX || 1);
      }
      if (config.pursuePlayer && nearest && nearest.dist < (config.pursueRadius || 480)) {
        brain.state = STATES.ALERT;
        brain.stateTimer = 0;
        brain.targetId = nearest.player.id;
      }
      break;

    case STATES.ALERT: {
      const target = getPlayerById(game, brain.targetId) || nearest?.player;
      if (!target || target.dead) {
        brain.state = (config.speed || 0) > 0 ? STATES.PATROL : STATES.IDLE;
        brain.stateTimer = 0;
        break;
      }
      brain.targetId = target.id;
      const d = dist(enemy.x, enemy.y, target.x, target.y);
      brain.aimAngle = config.leadTarget
        ? computeLeadAngle(enemy, target, config.bulletSpeed || 480)
        : Math.atan2(target.y - enemy.y, target.x - enemy.x);

      if (!maintainDistanceMove(game, enemy, target, d, config) && config.pursuePlayer && d > (config.preferredRange || 170)) {
        setMovement(enemy, game, target.x - enemy.x, target.y - enemy.y);
      }

      if (brain.mineCooldown <= 0 && canLayMine(game, enemy, target, config)) {
        enemy.wantMine = true;
        brain.mineCooldown = config.mineCooldown || 4;
      }

      if (brain.stateTimer >= ALERT_AIM_SECONDS) {
        brain.state = STATES.ATTACK;
        brain.stateTimer = 0;
      }
      break;
    }

    case STATES.ATTACK: {
      const target = getPlayerById(game, brain.targetId) || nearest?.player;
      if (!target || target.dead) {
        brain.state = (config.speed || 0) > 0 ? STATES.PATROL : STATES.IDLE;
        brain.stateTimer = 0;
        break;
      }
      brain.targetId = target.id;
      const activeBullets = countEnemyActiveBullets(game, enemy.id);
      const canFire = brain.fireCooldown <= 0 && activeBullets < Math.max(1, Math.floor(config.maxBullets || 1));
      const d = dist(enemy.x, enemy.y, target.x, target.y);

      if (canFire) {
        const los = hasLineOfSight(game, enemy.x, enemy.y, target.x, target.y);
        let fireAngle = null;
        if (los) {
          fireAngle = config.leadTarget
            ? computeLeadAngle(enemy, target, config.bulletSpeed || 480)
            : Math.atan2(target.y - enemy.y, target.x - enemy.x);
        } else if (config.ricochetAim) {
          fireAngle = tryRicochetShot(game, enemy, target);
        }

        if (fireAngle !== null) {
          brain.aimAngle = fireAngle;
          enemy.aimAngle = fireAngle;
          enemy.wantFire = true;
          brain.fireCooldown = config.fireCooldown || 1.5;
        }
      }

      if (brain.mineCooldown <= 0 && canLayMine(game, enemy, target, config)) {
        enemy.wantMine = true;
        brain.mineCooldown = config.mineCooldown || 4;
      }

      if (!maintainDistanceMove(game, enemy, target, d, config) && config.pursuePlayer && d > (config.preferredRange || 180)) {
        setMovement(enemy, game, target.x - enemy.x, target.y - enemy.y);
      }

      if (brain.stateTimer > POST_FIRE_PAUSE + 0.2) {
        brain.state = STATES.ALERT;
        brain.stateTimer = 0;
      }
      break;
    }

    case STATES.EVADE:
      if (brain.evadeDir) setMovement(enemy, game, brain.evadeDir.x, brain.evadeDir.y);
      if (brain.stateTimer >= EVADE_DURATION) {
        brain.state = (config.speed || 0) > 0 ? STATES.PATROL : STATES.IDLE;
        brain.stateTimer = 0;
        brain.evadeDir = null;
      }
      break;
  }

  brain.lastMoveIntent = Math.hypot(enemy.moveX || 0, enemy.moveY || 0);
  enemy.aimAngle = brain.aimAngle;
}

function updateTankEnemies(game, dt) {
  const enemies = game.tankEnemies || [];
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    thinkEnemy(game, enemy, dt);
  }
}

module.exports = {
  updateTankEnemies,
  ensureTankBrain,
  STATES,
  pointInAnyWall,
  circleInAnyWall,
  tankAreaIsClear,
  segmentHitsWall,
  findWallHit,
  reflect,
  nearestPointOnSegment
};
