"use strict";

/**
 * Runner bot class-ability decisions (smoke, dash, heal dart, collection bolt, etc.).
 *
 * Called from ai/server-bot-ai.cjs during flee, heal, unhook, and collect phases.
 * Uses engine helpers (fireRunnerShootAbility, applySurvivorAbility) so bots follow
 * the same server rules as human players.
 *
 * Ability testing interaction:
 * - canAffordAbility: skips orb minimums when test mode is on (abilities stay free).
 * - abilityReady: always checks survivorAbilityCooldowns (cooldowns are NOT waived).
 * - gateAbilityTry: throttles how often the AI re-attempts; dev server retries faster.
 */

const ABILITY_RETRY_SECONDS = 1.75;
const ABILITY_RETRY_SECONDS_DEV = 0.35;

const SMOKE_MIN_ORBS = 10;
const DASH_MIN_ORBS = 2;
const HEAL_DART_MIN_ORBS = 2;
const HEAL_DART_MAX_ORBS = 10;
const DOUBLE_ORB_MIN_ORBS = 10;
const SWIFT_VAULT_MIN_ORBS = 5;

const RUNNER_SPEED_BURST_ID = "speedBurst";
const SPEED_BURST_PANIC_RADIUS = 360;
const KILLER_CHASE_RADIUS = 430;

function dist(ax, ay, bx, by) {
  if (typeof ax === "object" && typeof ay === "object") {
    return Math.hypot((ax.x || 0) - (ay.x || 0), (ax.y || 0) - (ay.y || 0));
  }
  return Math.hypot((ax || 0) - (bx || 0), (ay || 0) - (by || 0));
}

function runnerClassId(actor) {
  return String(actor?.runnerClass || "orbCollector");
}

function carriedOrbs(actor) {
  return Math.max(0, Math.floor(Number(actor?.dots || 0)));
}

/** True when the actor has in-match ability testing enabled (Lv 1–3). */
function abilityTestingActive(actor, helpers) {
  if (typeof helpers?.abilityTestingEnabled === "function") return helpers.abilityTestingEnabled(actor);
  return Number(actor?.abilityTestLevel || 0) > 0 || !!actor?.abilityTestMode;
}

function abilityCooldownRemaining(actor, abilityId) {
  return Math.max(0, Number(actor?.survivorAbilityCooldowns?.[abilityId] || 0));
}

/** Server cooldown timer must be clear; test mode does not bypass this. */
function abilityReady(actor, helpers, abilityId) {
  return abilityCooldownRemaining(actor, abilityId) <= 0;
}

/** Orb cost gate — waived in ability testing so bots can cast without farming dots. */
function canAffordAbility(actor, helpers, minOrbs) {
  if (abilityTestingActive(actor, helpers)) return true;
  return carriedOrbs(actor) >= minOrbs;
}

function abilityRetrySeconds(helpers) {
  if (helpers?.devServer) return ABILITY_RETRY_SECONDS_DEV;
  return ABILITY_RETRY_SECONDS;
}

/** Per-brain throttle so the AI does not call fireRunnerShootAbility every tick. */
function gateAbilityTry(brain, helpers, seconds) {
  const wait = Number.isFinite(seconds) ? seconds : abilityRetrySeconds(helpers);
  const t = Number(brain?.aiNow || 0);
  if ((brain.nextAbilityTry || 0) > t) return false;
  brain.nextAbilityTry = t + wait;
  return true;
}

function aimPoint(fromX, fromY, towardX, towardY, distance) {
  const dx = towardX - fromX;
  const dy = towardY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: fromX + (dx / len) * distance,
    y: fromY + (dy / len) * distance
  };
}

function tryFireShootAbility(game, actor, helpers, abilityId, targetX, targetY) {
  if (typeof helpers?.fireRunnerShootAbility !== "function") return false;
  if (!abilityReady(actor, helpers, abilityId)) return false;
  const angle = Math.atan2(targetY - actor.y, targetX - actor.x);
  const result = helpers.fireRunnerShootAbility(game, actor, {
    id: abilityId,
    abilityId,
    angle,
    targetX,
    targetY
  });
  return !!result?.ok;
}

function tryApplyBuffAbility(game, actor, helpers, abilityId) {
  if (typeof helpers?.applySurvivorAbility !== "function") return false;
  if (!abilityReady(actor, helpers, abilityId)) return false;
  const result = helpers.applySurvivorAbility(game, actor, abilityId);
  return !!result?.ok;
}

function tryUseLegacySpeedBurst(game, actor, helpers, threat) {
  if (!threat?.killer || typeof helpers?.applySurvivorAbility !== "function") return false;
  if ((actor.speedBurst || 0) > 0) return false;
  if (threat.distance > SPEED_BURST_PANIC_RADIUS && !(actor.chaseHold > 0 && threat.distance < KILLER_CHASE_RADIUS)) return false;
  const result = helpers.applySurvivorAbility(game, actor, RUNNER_SPEED_BURST_ID);
  return !!result?.ok;
}

/** Drop smoke between self and the chasing Void when danger is close. */
function tryUseNebulizerAbilities(game, actor, helpers, brain, threat) {
  if (runnerClassId(actor) !== "nebulizer") return false;
  if (!threat?.killer || !threat.danger) return false;
  if (threat.distance > 520) return false;
  if (!gateAbilityTry(brain, helpers)) return false;
  if (!canAffordAbility(actor, helpers, SMOKE_MIN_ORBS)) return false;

  const dropDistance = Math.min(220, Math.max(90, threat.distance * 0.45));
  const point = aimPoint(actor.x, actor.y, threat.killer.x, threat.killer.y, dropDistance);
  return tryFireShootAbility(game, actor, helpers, "smokeDart", point.x, point.y);
}

/** Dash dart while fleeing; pre-arm swift vault when near vaults under pressure. */
function tryUseEscapistAbilities(game, actor, helpers, brain, threat, phase) {
  if (runnerClassId(actor) !== "escapist") return false;

  if (phase === "flee" && threat?.danger) {
    if (!gateAbilityTry(brain, helpers)) return false;
    if (!canAffordAbility(actor, helpers, DASH_MIN_ORBS)) return false;
    const away = aimPoint(threat.killer.x, threat.killer.y, actor.x, actor.y, 120);
    const ahead = aimPoint(actor.x, actor.y, away.x, away.y, 90);
    if (tryFireShootAbility(game, actor, helpers, "dashDart", ahead.x, ahead.y)) return true;
  }

  if (phase === "safety" && threat?.threatened && !(Number(actor.swiftVaultReady || 0) > 0)) {
    if (!gateAbilityTry(brain, helpers, 3)) return false;
    if (!canAffordAbility(actor, helpers, SWIFT_VAULT_MIN_ORBS)) return false;
    return tryApplyBuffAbility(game, actor, helpers, "swiftVault");
  }

  return false;
}

function tryUseHealerDart(game, actor, helpers, brain, target) {
  if (runnerClassId(actor) !== "healer") return false;
  if (!target || target.dead || target.escaped) return false;
  if (!target.hooked && !target.downed && !target.injured && target.health !== 1) return false;
  if (!gateAbilityTry(brain, helpers)) return false;

  const orbCost = carriedOrbs(actor) >= HEAL_DART_MAX_ORBS ? HEAL_DART_MAX_ORBS : HEAL_DART_MIN_ORBS;
  if (!canAffordAbility(actor, helpers, orbCost)) return false;

  const d = dist(actor, target);
  if (d > 680) return false;
  return tryFireShootAbility(game, actor, helpers, "healingDart", target.x, target.y);
}

function tryUseCollectorAbilities(game, actor, helpers, brain, context) {
  if (runnerClassId(actor) !== "orbCollector") return false;
  const { phase, dot } = context;

  if (phase === "collect" && dot) {
    if (!gateAbilityTry(brain, helpers, 2.5)) return false;
    if (tryFireShootAbility(game, actor, helpers, "collectionBolt", dot.x, dot.y)) return true;
  }

  if (phase === "collect" && !(Number(actor.doubleOrb || 0) > 0)) {
    const nearbyDots = (game.collectibleDots || []).filter((entry) => dist(actor.x, actor.y, entry.x, entry.y) < 420).length;
    if (nearbyDots >= 3 && canAffordAbility(actor, helpers, DOUBLE_ORB_MIN_ORBS)) {
      if (!gateAbilityTry(brain, helpers, 4)) return false;
      if (tryApplyBuffAbility(game, actor, helpers, "doubleOrb")) return true;
    }
  }

  return false;
}

/**
 * Entry point: try class-specific abilities for the current AI phase.
 * @param {object} context.phase - "flee" | "safety" | "heal" | "unhook" | "collect"
 */
function tryUseRunnerClassAbilities(game, actor, helpers, brain, context = {}) {
  const { phase = "any", threat = null, target = null, dot = null } = context;

  if (tryUseNebulizerAbilities(game, actor, helpers, brain, threat)) return true;
  if (tryUseEscapistAbilities(game, actor, helpers, brain, threat, phase)) return true;
  if ((phase === "heal" || phase === "unhook") && tryUseHealerDart(game, actor, helpers, brain, target)) return true;
  if (tryUseCollectorAbilities(game, actor, helpers, brain, { phase, dot, threat })) return true;

  if (phase === "flee" && runnerClassId(actor) !== "escapist") {
    return tryUseLegacySpeedBurst(game, actor, helpers, threat);
  }

  return false;
}

module.exports = {
  tryUseRunnerClassAbilities
};
