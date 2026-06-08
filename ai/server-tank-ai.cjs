"use strict";

const STATES = { IDLE: "idle", PATROL: "patrol", ALERT: "alert", ATTACK: "attack", EVADE: "evade" };
const EVADE_DURATION = 0.45;
const ALERT_AIM_SECONDS = 0.2;
const POST_FIRE_PAUSE = 0.15;
const PATROL_WAYPOINT_REACH = 30;
const BULLET_DANGER_RADIUS = 110;
const BULLET_DANGER_LOOKAHEAD = 1.5;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function normalize(x, y) {
  const len = Math.hypot(x, y);
  return len > 0.001 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

function reflect(dx, dy, nx, ny) {
  const dot = dx * nx + dy * ny;
  return { x: dx - 2 * dot * nx, y: dy - 2 * dot * ny };
}

function ensureTankBrain(enemy) {
  if (!enemy._tankAi) {
    enemy._tankAi = {
      state: enemy.tier === "husk" ? STATES.IDLE : STATES.PATROL,
      stateTimer: 0,
      targetId: null,
      aimAngle: 0,
      patrolTarget: null,
      patrolTimer: 0,
      evadeDir: null,
      fireCooldown: 0,
      alertTimer: 0
    };
  }
  return enemy._tankAi;
}

function choosePatrolTarget(enemy, game) {
  const tile = game.map.tile || 72;
  const radius = enemy.config.patrolRadius || 200;
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r = radius * (0.4 + Math.random() * 0.6);
    const px = enemy.spawnX + Math.cos(angle) * r;
    const py = enemy.spawnY + Math.sin(angle) * r;
    const cx = clamp(px, tile, game.map.width - tile);
    const cy = clamp(py, tile, game.map.height - tile);
    if (!pointInAnyWall(game, cx, cy)) return { x: cx, y: cy };
  }
  return { x: enemy.spawnX, y: enemy.spawnY };
}

function pointInAnyWall(game, x, y) {
  for (const wall of game.map.walls) {
    if (x >= wall.x && x <= wall.x + wall.w && y >= wall.y && y <= wall.y + wall.h) return true;
  }
  return false;
}

function segmentHitsWall(game, ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by);
  const steps = Math.max(2, Math.ceil(d / 8));
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

function incomingBulletThreat(game, enemy) {
  const bullets = game.tankBullets || [];
  for (const bullet of bullets) {
    if (bullet.ownerId === enemy.id) continue;
    if (bullet.ownerType === "enemy") continue;
    const futureX = bullet.x + bullet.dx * bullet.speed * BULLET_DANGER_LOOKAHEAD;
    const futureY = bullet.y + bullet.dy * bullet.speed * BULLET_DANGER_LOOKAHEAD;
    const closest = nearestPointOnSegment(enemy.x, enemy.y, bullet.x, bullet.y, futureX, futureY);
    if (closest.dist < BULLET_DANGER_RADIUS) {
      return bullet;
    }
  }
  return null;
}

function nearestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.001) return { x: ax, y: ay, dist: dist(px, py, ax, ay) };
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { x: cx, y: cy, dist: dist(px, py, cx, cy) };
}

function computeEvadeDirection(enemy, bullet) {
  const bvx = bullet.dx;
  const bvy = bullet.dy;
  const perpX = -bvy;
  const perpY = bvx;
  const toEnemy = { x: enemy.x - bullet.x, y: enemy.y - bullet.y };
  const dot = toEnemy.x * perpX + toEnemy.y * perpY;
  if (dot >= 0) return normalize(perpX, perpY);
  return normalize(-perpX, -perpY);
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
  const leadX = target.x + tvx * timeToHit * 0.7;
  const leadY = target.y + tvy * timeToHit * 0.7;
  return Math.atan2(leadY - enemy.y, leadX - enemy.x);
}

function tryRicochetShot(game, enemy, target) {
  const walls = game.map.walls;
  const tile = game.map.tile || 72;
  const maxBounces = enemy.config.bulletBounces || 1;

  const testAngles = [];
  for (let i = 0; i < 16; i++) {
    testAngles.push((i / 16) * Math.PI * 2);
  }

  for (const angle of testAngles) {
    let rx = enemy.x;
    let ry = enemy.y;
    let rdx = Math.cos(angle);
    let rdy = Math.sin(angle);
    let bounces = 0;
    let valid = false;

    for (let step = 0; step < maxBounces + 1; step++) {
      const hitInfo = findWallHit(game, rx, ry, rdx, rdy, 800);
      if (!hitInfo) break;

      const hitToTarget = dist(hitInfo.x, hitInfo.y, target.x, target.y);
      if (hitToTarget < 60 && hasLineOfSight(game, hitInfo.x, hitInfo.y, target.x, target.y)) {
        valid = true;
        break;
      }

      if (step < maxBounces) {
        const reflected = reflect(rdx, rdy, hitInfo.nx, hitInfo.ny);
        rx = hitInfo.x + reflected.x * 2;
        ry = hitInfo.y + reflected.y * 2;
        rdx = reflected.x;
        rdy = reflected.y;
        bounces++;

        const afterBounceToTarget = dist(rx, ry, target.x, target.y);
        if (afterBounceToTarget < 60 || (hasLineOfSight(game, rx, ry, target.x, target.y) && afterBounceToTarget < 200)) {
          valid = true;
          break;
        }
      }
    }

    if (valid) return angle;
  }

  return null;
}

function findWallHit(game, startX, startY, dx, dy, maxDist) {
  const step = 6;
  const steps = Math.ceil(maxDist / step);
  let prevX = startX;
  let prevY = startY;

  for (let i = 1; i <= steps; i++) {
    const x = startX + dx * step * i;
    const y = startY + dy * step * i;

    if (x < 0 || y < 0 || x > game.map.width || y > game.map.height) {
      const nx = x < 0 ? 1 : x > game.map.width ? -1 : 0;
      const ny = y < 0 ? 1 : y > game.map.height ? -1 : 0;
      return { x: prevX, y: prevY, nx: nx || 0, ny: ny || (ny === 0 ? -1 : ny) };
    }

    if (pointInAnyWall(game, x, y)) {
      const testLeft = pointInAnyWall(game, prevX - step, prevY);
      const testRight = pointInAnyWall(game, prevX + step, prevY);
      const testUp = pointInAnyWall(game, prevX, prevY - step);
      const testDown = pointInAnyWall(game, prevX, prevY + step);

      let nx = 0, ny = 0;
      if (dx > 0 && !testLeft) nx = -1;
      else if (dx < 0 && !testRight) nx = 1;
      if (dy > 0 && !testUp) ny = -1;
      else if (dy < 0 && !testDown) ny = 1;

      if (nx === 0 && ny === 0) {
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

function countEnemyActiveBullets(game, enemyId) {
  let count = 0;
  for (const b of game.tankBullets || []) {
    if (b.ownerId === enemyId) count++;
  }
  return count;
}

function thinkEnemy(game, enemy, dt) {
  const brain = ensureTankBrain(enemy);
  const config = enemy.config;
  brain.fireCooldown = Math.max(0, brain.fireCooldown - dt);
  brain.stateTimer += dt;

  enemy.moveX = 0;
  enemy.moveY = 0;
  enemy.wantFire = false;
  enemy.aimAngle = brain.aimAngle;

  if (config.evadeSkill > 0) {
    const threat = incomingBulletThreat(game, enemy);
    if (threat && Math.random() < config.evadeSkill) {
      brain.state = STATES.EVADE;
      brain.stateTimer = 0;
      brain.evadeDir = computeEvadeDirection(enemy, threat);
    }
  }

  const nearest = findNearestPlayer(game, enemy);

  switch (brain.state) {
    case STATES.IDLE:
      if (nearest && nearest.dist < config.fireRange) {
        brain.state = STATES.ALERT;
        brain.stateTimer = 0;
        brain.targetId = nearest.player.id;
      }
      break;

    case STATES.PATROL:
      if (nearest && nearest.dist < config.fireRange && hasLineOfSight(game, enemy.x, enemy.y, nearest.player.x, nearest.player.y)) {
        brain.state = STATES.ALERT;
        brain.stateTimer = 0;
        brain.targetId = nearest.player.id;
        break;
      }
      if (!brain.patrolTarget || dist(enemy.x, enemy.y, brain.patrolTarget.x, brain.patrolTarget.y) < PATROL_WAYPOINT_REACH) {
        brain.patrolTarget = choosePatrolTarget(enemy, game);
      }
      if (brain.patrolTarget) {
        const dir = normalize(brain.patrolTarget.x - enemy.x, brain.patrolTarget.y - enemy.y);
        enemy.moveX = dir.x;
        enemy.moveY = dir.y;
        brain.aimAngle = Math.atan2(dir.y, dir.x);
      }
      if (config.pursuePlayer && nearest && nearest.dist < (config.pursueRadius || 500)) {
        brain.state = STATES.ALERT;
        brain.stateTimer = 0;
        brain.targetId = nearest.player.id;
      }
      break;

    case STATES.ALERT: {
      const target = getPlayerById(game, brain.targetId);
      if (!target || target.dead) {
        brain.state = config.speed > 0 ? STATES.PATROL : STATES.IDLE;
        brain.stateTimer = 0;
        break;
      }
      const los = hasLineOfSight(game, enemy.x, enemy.y, target.x, target.y);
      const d = dist(enemy.x, enemy.y, target.x, target.y);

      if (config.leadTarget) {
        brain.aimAngle = computeLeadAngle(enemy, target, config.bulletSpeed);
      } else {
        brain.aimAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
      }

      if (config.pursuePlayer && d > 200) {
        const dir = normalize(target.x - enemy.x, target.y - enemy.y);
        enemy.moveX = dir.x;
        enemy.moveY = dir.y;
      }

      if (brain.stateTimer >= ALERT_AIM_SECONDS) {
        brain.state = STATES.ATTACK;
        brain.stateTimer = 0;
      }
      break;
    }

    case STATES.ATTACK: {
      const target = getPlayerById(game, brain.targetId);
      if (!target || target.dead) {
        brain.state = config.speed > 0 ? STATES.PATROL : STATES.IDLE;
        brain.stateTimer = 0;
        break;
      }

      const activeBullets = countEnemyActiveBullets(game, enemy.id);
      const canFire = brain.fireCooldown <= 0 && activeBullets < config.maxBullets;

      if (canFire) {
        const los = hasLineOfSight(game, enemy.x, enemy.y, target.x, target.y);
        let fireAngle = null;

        if (los) {
          if (config.leadTarget) {
            fireAngle = computeLeadAngle(enemy, target, config.bulletSpeed);
          } else {
            fireAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
          }
        } else if (config.ricochetAim) {
          fireAngle = tryRicochetShot(game, enemy, target);
        }

        if (fireAngle !== null) {
          brain.aimAngle = fireAngle;
          enemy.aimAngle = fireAngle;
          enemy.wantFire = true;
          brain.fireCooldown = config.fireCooldown;
        }
      }

      if (config.pursuePlayer) {
        const d = dist(enemy.x, enemy.y, target.x, target.y);
        if (d > 180) {
          const dir = normalize(target.x - enemy.x, target.y - enemy.y);
          enemy.moveX = dir.x;
          enemy.moveY = dir.y;
        }
      }

      if (brain.stateTimer > POST_FIRE_PAUSE + 0.2) {
        brain.state = STATES.ALERT;
        brain.stateTimer = 0;
      }
      break;
    }

    case STATES.EVADE:
      if (brain.evadeDir) {
        enemy.moveX = brain.evadeDir.x;
        enemy.moveY = brain.evadeDir.y;
      }
      if (brain.stateTimer >= EVADE_DURATION) {
        brain.state = config.speed > 0 ? STATES.PATROL : STATES.IDLE;
        brain.stateTimer = 0;
        brain.evadeDir = null;
      }
      break;
  }

  enemy.aimAngle = brain.aimAngle;
}

function getPlayerById(game, id) {
  for (const p of game.tankPlayers || []) {
    if (p.id === id) return p;
  }
  return null;
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
  segmentHitsWall,
  findWallHit,
  reflect
};
