function createBotDebugTools({ nowMs, clamp, survivorDotMax, killerDotMax }) {
  const SURVIVOR_DOT_MAX = survivorDotMax;
  const KILLER_DOT_MAX = killerDotMax;

  function botDebugWallNow() {
    try { return nowMs(); }
    catch (_) { return Date.now(); }
  }

  function cloneBotAiDebug(debug) {
    if (!debug || typeof debug !== "object") return null;
    try { return JSON.parse(JSON.stringify(debug)); }
    catch (_) { return { ...debug }; }
  }

  function currentBotMovementLabel(actor) {
    const input = actor?.input || {};
    return [
      input.up ? "U" : "",
      input.down ? "D" : "",
      input.left ? "L" : "",
      input.right ? "R" : ""
    ].join("") || "none";
  }

  function freezeBotAiDebug(game, actor) {
    const bot = actor?.bot;
    const lastLive = cloneBotAiDebug(bot?.lastLiveAiDebug);
    if (!lastLive) return null;
    const wallNow = botDebugWallNow();
    const pausedAt = Number(game?.pausedAt || 0);
    const capturedAt = Number(lastLive.liveCapturedWallAt || wallNow);
    const frozenMove = currentBotMovementLabel(actor);
    return {
      ...lastLive,
      pausedSnapshot: true,
      pausedFor: Number(Math.max(0, (pausedAt ? wallNow - pausedAt : 0) / 1000).toFixed(2)),
      liveAge: Number((Math.max(0, (pausedAt || wallNow) - capturedAt) / 1000).toFixed(2)),
      frozenMove,
      frozenPathLength: Array.isArray(bot?.simpleAi?.path)
        ? bot.simpleAi.path.length
        : Array.isArray(bot?.voidRiftAi?.path)
          ? bot.voidRiftAi.path.length
          : 0
    };
  }

  function captureLiveBotAiDebug(game) {
    if (!game?.actors) return;
    for (const actor of game.actors.values()) {
      if (!actor?.isBot) continue;
      serializeBotAiDebug(game, actor, { forceLive: true });
    }
  }

  function serializeBotAiDebug(game, actor, options = {}) {
    if (!actor?.isBot) return null;
    if (game?.paused && !options.forceLive) {
      const frozen = freezeBotAiDebug(game, actor);
      if (frozen) return frozen;
    }
    const input = actor.input || {};
    const isMoving = !!(input.up || input.down || input.left || input.right || actor.vault);
    const movement = [
      input.up ? "U" : "",
      input.down ? "D" : "",
      input.left ? "L" : "",
      input.right ? "R" : ""
    ].join("") || "none";

    const runnerBrain = actor.role === "survivor" ? actor.bot?.simpleAi : null;
    const voidBrain = actor.role === "killer" ? actor.bot?.voidRiftAi : null;
    const brain = runnerBrain || voidBrain;
    if (!brain) return null;

    let mode = "idle";
    let task = brain.task || null;
    let targetId = task?.id || null;
    let reason = "";

    if (actor.role === "survivor") {
      if (actor.vault) {
        mode = "vaulting";
        reason = "server vault animation";
      } else if (brain.postTraversalTarget && (game.time || 0) <= (brain.postTraversalUntil || 0)) {
        mode = "post-vault move";
        reason = "moving away from used window/pallet";
      } else if (brain.survivalTask) {
        task = brain.survivalTask;
        targetId = task.id || null;
        mode = actor.chaseHold > 0 ? "chase escape" : "danger escape";
        reason = task.kind || "safe task";
      } else if (brain.unhookTask) {
        task = brain.unhookTask;
        targetId = task.id || null;
        mode = "unhook";
        reason = "rescue teammate";
      } else if (brain.healTask) {
        task = brain.healTask;
        targetId = task.id || null;
        mode = "heal";
        reason = "heal teammate";
      } else if (brain.nextStep?.kind === "receive-heal") {
        mode = "receive heal";
        targetId = brain.nextStep.targetId || null;
        reason = "waiting for nearby healer";
      } else if (brain.task) {
        task = brain.task;
        targetId = task.id || null;
        mode = task.kind === "deposit" ? "deposit" : task.kind === "orb" ? "collect orb" : task.kind || "objective";
        reason = task.reason || (task.nextKind ? `next:${task.nextKind}` : "objective");
      }
    } else if (actor.role === "killer") {
      if (actor.hookActionTargetId || voidBrain.hookCommitTargetId) {
        mode = "hook/execute";
        targetId = actor.hookActionTargetId || voidBrain.hookCommitTargetId || null;
        reason = "holding interaction";
      } else if (actor.vault) {
        mode = "vaulting";
        reason = "window traversal";
      } else if (actor.breakTarget) {
        mode = "breaking pallet";
        targetId = actor.breakTarget?.id || null;
        reason = "obstacle clear";
      } else if (voidBrain.lungeCommitTargetId && (game.time || 0) <= (voidBrain.lungeCommitUntil || 0)) {
        mode = "lunge commit";
        targetId = voidBrain.lungeCommitTargetId;
        reason = "holding M1";
      } else if (voidBrain.huntTargetId) {
        mode = "hunt";
        targetId = voidBrain.huntTargetId;
        reason = voidBrain.nextStep?.kind || "chasing runner";
      } else if (voidBrain.task) {
        task = voidBrain.task;
        targetId = task.id || null;
        mode = task.kind === "kick" ? "kick rift" : task.kind === "check" ? "check rift" : task.kind || "rift control";
        reason = voidBrain.nextStep?.kind || "objective pressure";
      }
    }

    const nextStep = brain.nextStep || null;
    const pathLength = Array.isArray(brain.path) ? brain.path.length : 0;
    const liveCapturedWallAt = botDebugWallNow();
    const debug = {
      mode,
      reason,
      pausedSnapshot: false,
      liveCapturedWallAt,
      liveCapturedGameTime: Number((game.time || 0).toFixed(3)),
      targetId: targetId || nextStep?.targetId || null,
      taskKind: task?.kind || null,
      nextKind: nextStep?.kind || null,
      nextTargetId: nextStep?.targetId || null,
      pathLength,
      repathIn: Number(Math.max(0, brain.repathIn || 0).toFixed(2)),
      stuckFor: Number(Math.max(0, brain.stuckFor || 0).toFixed(2)),
      move: movement,
      moving: isMoving,
      sprint: !!input.sprint,
      action: !!input.action,
      repair: !!input.repair,
      attackHeld: !!input.attackHeld,
      attackState: actor.attackState || null,
      vaulting: !!actor.vault,
      breaking: !!actor.breakTarget,
      chase: actor.role === "survivor" ? (actor.chaseHold || 0) > 0 : false,
      dots: actor.role === "survivor" ? clamp(actor.dots || 0, 0, SURVIVOR_DOT_MAX) : clamp(actor.dots || 0, 0, KILLER_DOT_MAX)
    };

    if (runnerBrain?.survivalTask) {
      debug.survivalKind = runnerBrain.survivalTask.kind || null;
      debug.survivalLock = Number(Math.max(0, (runnerBrain.survivalTask.lockUntil || 0) - (game.time || 0)).toFixed(2));
    }
    if (runnerBrain?.moveIntent) {
      debug.moveIntent = {
        x: Math.round(runnerBrain.moveIntent.x || 0),
        y: Math.round(runnerBrain.moveIntent.y || 0),
        ttl: Number(Math.max(0, (runnerBrain.moveIntent.until || 0) - (game.time || 0)).toFixed(2))
      };
    }
    if (voidBrain?.obstacleCommit) {
      debug.obstacleCommit = {
        type: voidBrain.obstacleCommit.type || null,
        targetId: voidBrain.obstacleCommit.id || null,
        ttl: Number(Math.max(0, (voidBrain.obstacleCommit.until || 0) - (game.time || 0)).toFixed(2))
      };
    }

    if (actor.bot && (!game?.paused || options.forceLive)) {
      actor.bot.lastLiveAiDebug = cloneBotAiDebug(debug);
    }

    return debug;
  }

  function serializeBotDebug(debug) {
    if (!debug || typeof debug !== "object") return null;
    const cleanText = (value, fallback = "") => String(value ?? fallback).slice(0, 96);
    const cleanNumber = (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    const cleanBool = (value) => value === true;
    const moveIntent = debug.moveIntent && typeof debug.moveIntent === "object" ? {
      x: Math.round(cleanNumber(debug.moveIntent.x)),
      y: Math.round(cleanNumber(debug.moveIntent.y)),
      ttl: Number(cleanNumber(debug.moveIntent.ttl).toFixed(2))
    } : null;
    const obstacleCommit = debug.obstacleCommit && typeof debug.obstacleCommit === "object" ? {
      type: debug.obstacleCommit.type ? cleanText(debug.obstacleCommit.type) : null,
      targetId: debug.obstacleCommit.targetId ? cleanText(debug.obstacleCommit.targetId) : null
    } : null;
    return {
      mode: cleanText(debug.mode, "bot"),
      task: cleanText(debug.task, "none"),
      taskKind: debug.taskKind ? cleanText(debug.taskKind) : null,
      reason: debug.reason ? cleanText(debug.reason) : null,
      path: Math.max(0, Math.floor(cleanNumber(debug.path))),
      pathLength: Math.max(0, Math.floor(cleanNumber(debug.pathLength ?? debug.path))),
      stuck: Number(cleanNumber(debug.stuck).toFixed(2)),
      stuckFor: Number(cleanNumber(debug.stuckFor ?? debug.stuck).toFixed(2)),
      repathIn: Number(cleanNumber(debug.repathIn).toFixed(2)),
      moveLock: Number(cleanNumber(debug.moveLock).toFixed(2)),
      input: cleanText(debug.input, "idle"),
      move: cleanText(debug.move, "idle"),
      sprint: cleanBool(debug.sprint),
      action: cleanBool(debug.action),
      repair: cleanBool(debug.repair),
      attackHeld: cleanBool(debug.attackHeld),
      attackReleased: cleanBool(debug.attackReleased),
      targetId: debug.targetId ? cleanText(debug.targetId) : null,
      nextTargetId: debug.nextTargetId ? cleanText(debug.nextTargetId) : null,
      nextKind: debug.nextKind ? cleanText(debug.nextKind) : null,
      survivalKind: debug.survivalKind ? cleanText(debug.survivalKind) : null,
      survivalLock: Number(cleanNumber(debug.survivalLock).toFixed(2)),
      moveIntent,
      obstacleCommit,
      x: Math.round(cleanNumber(debug.x)),
      y: Math.round(cleanNumber(debug.y)),
      line1: cleanText(debug.line1, cleanText(debug.mode, "bot")),
      line2: cleanText(debug.line2, ""),
      line3: cleanText(debug.line3, "")
    };
  }


  return {
    captureLiveBotAiDebug,
    serializeBotAiDebug,
    serializeBotDebug
  };
}

module.exports = { createBotDebugTools };
