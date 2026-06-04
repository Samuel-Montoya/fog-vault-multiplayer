"use strict";

// =============================================================================
// Runner Bot Class-Ability Decisions
//
// Called from ai/server-bot-ai.cjs during flee, heal, unhook, and collect
// phases.  Each runner class has one entry point that fires its abilities
// through the same engine helpers human players use (fireRunnerShootAbility,
// applySurvivorAbility), so server rules are identical for bots and humans.
//
// Gate rules:
//   canAffordAbility  — orb-cost check; waived in ability-test mode.
//   abilityReady      — cooldown check; NEVER waived (test mode keeps CDs).
//   gateAbilityTry    — per-brain throttle so the AI does not call fire every
//                       tick.  Dev servers retry faster for rapid iteration.
// =============================================================================

// --- Timing -------------------------------------------------------------------
const ABILITY_RETRY_SECONDS = 1.75;
const ABILITY_RETRY_SECONDS_DEV = 0.35;

// --- Orb thresholds per class -------------------------------------------------
const SMOKE_MIN_ORBS = 10;
const DASH_MIN_ORBS = 2;
const HEAL_DART_MIN_ORBS = 2;
const HEAL_DART_MAX_ORBS = 10;
const DOUBLE_ORB_MIN_ORBS = 10;
const SWIFT_VAULT_MIN_ORBS = 5;

// --- Shared constants ---------------------------------------------------------
const RUNNER_SPEED_BURST_ID = "speedBurst";
/** Within this radius the bot considers the killer an immediate panic threat. */
const SPEED_BURST_PANIC_RADIUS = 360;
/** Within this radius a chase signal extends speed-burst eligibility. */
const KILLER_CHASE_RADIUS = 430;

// =============================================================================
// Shared Helpers
// =============================================================================

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

/** True when in-match ability testing is active (orb costs are waived). */
function abilityTestingActive(actor, helpers) {
  if (typeof helpers?.abilityTestingEnabled === "function") return helpers.abilityTestingEnabled(actor);
  return Number(actor?.abilityTestLevel || 0) > 0 || !!actor?.abilityTestMode;
}

function abilityCooldownRemaining(actor, abilityId) {
  return Math.max(0, Number(actor?.survivorAbilityCooldowns?.[abilityId] || 0));
}

/** Server cooldown must be clear; ability-test mode does NOT bypass cooldowns. */
function abilityReady(actor, helpers, abilityId) {
  return abilityCooldownRemaining(actor, abilityId) <= 0;
}

/** Orb-cost gate — waived in ability-test mode so bots can cast without farming. */
function canAffordAbility(actor, helpers, minOrbs) {
  if (abilityTestingActive(actor, helpers)) return true;
  return carriedOrbs(actor) >= minOrbs;
}

function abilityRetrySeconds(helpers) {
  if (helpers?.devServer) return ABILITY_RETRY_SECONDS_DEV;
  return ABILITY_RETRY_SECONDS;
}

/** Throttle: prevents calling fireRunnerShootAbility on every tick. */
function gateAbilityTry(brain, helpers, seconds) {
  const wait = Number.isFinite(seconds) ? seconds : abilityRetrySeconds(helpers);
  const t = Number(brain?.aiNow || 0);
  if ((brain.nextAbilityTry || 0) > t) return false;
  brain.nextAbilityTry = t + wait;
  return true;
}

/** Returns a world point at `distance` pixels from (fromX,fromY) toward (towardX,towardY). */
function aimPoint(fromX, fromY, towardX, towardY, distance) {
  const dx = towardX - fromX;
  const dy = towardY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: fromX + (dx / len) * distance,
    y: fromY + (dy / len) * distance
  };
}

// =============================================================================
// Engine Wrappers
// =============================================================================

/** Fire a projectile ability (smoke dart, dash dart, collection bolt, heal dart). */
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

/** Apply a self-buff ability (swift vault, double orb, speed burst). */
function tryApplyBuffAbility(game, actor, helpers, abilityId) {
  if (typeof helpers?.applySurvivorAbility !== "function") return false;
  if (!abilityReady(actor, helpers, abilityId)) return false;
  const result = helpers.applySurvivorAbility(game, actor, abilityId);
  return !!result?.ok;
}

// =============================================================================
// Legacy Speed Burst (non-Escapist classes)
// =============================================================================

/** Activate speed burst when the killer is within panic range or actively chasing. */
function tryUseLegacySpeedBurst(game, actor, helpers, threat) {
  if (!threat?.killer || typeof helpers?.applySurvivorAbility !== "function") return false;
  if ((actor.speedBurst || 0) > 0) return false;
  if (threat.distance > SPEED_BURST_PANIC_RADIUS
      && !(actor.chaseHold > 0 && threat.distance < KILLER_CHASE_RADIUS)) return false;
  const result = helpers.applySurvivorAbility(game, actor, RUNNER_SPEED_BURST_ID);
  return !!result?.ok;
}

// =============================================================================
// Nebulizer — Smoke Dart
// =============================================================================

/**
 * Drop smoke between self and the chasing Void when danger is close.
 * The drop point is placed closer to the Void than to the runner so the cloud
 * forms where it obstructs the killer's sightline.
 */
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

// =============================================================================
// Escapist — Dash Dart + Swift Vault
// =============================================================================

/**
 * Fire a dash dart in the direction away from the killer while fleeing.
 * Pre-arm swift vault when near vaults and under soft threat so the next
 * vault action is instant.
 */
function tryUseEscapistAbilities(game, actor, helpers, brain, threat, phase) {
  if (runnerClassId(actor) !== "escapist") return false;

  if (phase === "flee" && threat?.danger) {
    if (!gateAbilityTry(brain, helpers)) return false;
    if (!canAffordAbility(actor, helpers, DASH_MIN_ORBS)) return false;
    // Aim dart in the direction the runner is moving away (away from killer).
    const away = aimPoint(threat.killer.x, threat.killer.y, actor.x, actor.y, 120);
    const ahead = aimPoint(actor.x, actor.y, away.x, away.y, 90);
    if (tryFireShootAbility(game, actor, helpers, "dashDart", ahead.x, ahead.y)) return true;
  }

  // Pre-arm swift vault when threatened but not in full panic.
  if (phase === "safety" && threat?.threatened && !(Number(actor.swiftVaultReady || 0) > 0)) {
    if (!gateAbilityTry(brain, helpers, 3)) return false;
    if (!canAffordAbility(actor, helpers, SWIFT_VAULT_MIN_ORBS)) return false;
    return tryApplyBuffAbility(game, actor, helpers, "swiftVault");
  }

  return false;
}

// =============================================================================
// Healer — Healing Dart
// =============================================================================

/**
 * Fire a healing dart at the closest eligible teammate.
 * Prioritises downed teammates (cost scales with orbs carried) over merely
 * injured ones, and respects the 680-pixel range limit.
 */
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

// =============================================================================
// Orb Collector — Collection Bolt + Double Orb
// =============================================================================

/**
 * Magnetically pull the target orb with a collection bolt, and activate the
 * double-orb buff when 3+ orbs are within range (so the bonus applies
 * to an efficient harvest burst).
 */
function tryUseCollectorAbilities(game, actor, helpers, brain, context) {
  if (runnerClassId(actor) !== "orbCollector") return false;
  const { phase, dot } = context;

  if (phase === "collect" && dot) {
    if (!gateAbilityTry(brain, helpers, 2.5)) return false;
    if (tryFireShootAbility(game, actor, helpers, "collectionBolt", dot.x, dot.y)) return true;
  }

  if (phase === "collect" && !(Number(actor.doubleOrb || 0) > 0)) {
    const nearbyDots = (game.collectibleDots || [])
      .filter((entry) => dist(actor.x, actor.y, entry.x, entry.y) < 420).length;
    if (nearbyDots >= 3 && canAffordAbility(actor, helpers, DOUBLE_ORB_MIN_ORBS)) {
      if (!gateAbilityTry(brain, helpers, 4)) return false;
      if (tryApplyBuffAbility(game, actor, helpers, "doubleOrb")) return true;
    }
  }

  return false;
}

// =============================================================================
// Entry Point
// =============================================================================

/**
 * Try class-specific abilities for the current AI phase.
 * Called once (or twice for flee+safety) per bot tick from server-bot-ai.cjs.
 *
 * @param {object} context
 * @param {"flee"|"safety"|"heal"|"unhook"|"collect"|"any"} context.phase
 * @param {object|null} context.threat   - Threat info from threatInfo().
 * @param {object|null} context.target   - Heal/unhook target actor.
 * @param {object|null} context.dot      - Nearest collectible dot.
 * @returns {boolean} True when an ability was successfully fired.
 */
function tryUseRunnerClassAbilities(game, actor, helpers, brain, context = {}) {
  const { phase = "any", threat = null, target = null, dot = null } = context;

  if (tryUseNebulizerAbilities(game, actor, helpers, brain, threat)) return true;
  if (tryUseEscapistAbilities(game, actor, helpers, brain, threat, phase)) return true;
  if ((phase === "heal" || phase === "unhook") && tryUseHealerDart(game, actor, helpers, brain, target)) return true;
  if (tryUseCollectorAbilities(game, actor, helpers, brain, { phase, dot, threat })) return true;

  // All non-Escapist classes fall back to the universal speed burst when fleeing.
  if (phase === "flee" && runnerClassId(actor) !== "escapist") {
    return tryUseLegacySpeedBurst(game, actor, helpers, threat);
  }

  return false;
}

module.exports = {
  tryUseRunnerClassAbilities
};
