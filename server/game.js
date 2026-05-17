const CONFIG = require("../shared/config.js");
const { parseMap, publicMapState } = require("./map-loader.js");
const {
  uid,
  clamp,
  dist,
  angleDiff,
  normalize,
  rectsOverlap,
  randItem
} = require("./utils.js");
const { hasLineOfSight, actorVisibleTo, scratchVisibleToKiller, attackBlockingRects } = require("./visibility.js");

const ROLE = { SURVIVOR: "survivor", KILLER: "killer" };
const HEALTH = {
  HEALTHY: "healthy",
  INJURED: "injured",
  DOWNED: "downed",
  HOOKED: "hooked",
  DEAD: "dead",
  ESCAPED: "escaped"
};

function makeInput() {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    sprint: false,
    action: false,
    special: false,
    attack: false,
    mouseX: 0,
    mouseY: 0
  };
}

function makeActor({ id, socketId = null, name, role, isBot = false, spawn }) {
  return {
    id,
    socketId,
    name,
    role,
    isBot,
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    input: makeInput(),
    prevInput: makeInput(),
    healthState: role === ROLE.SURVIVOR ? HEALTH.HEALTHY : "killer",
    hookCount: 0,
    invulnerable: 0,
    speedBoost: 0,
    channel: null,
    vault: null,
    attack: null,
    attackCooldown: 0,
    bot: { repath: 0, targetX: spawn.x, targetY: spawn.y, memoryId: null, memory: 0 },
    chaseTimer: 0,
    lastScratch: 0,
    beingHealedBy: null,
    lastHitBy: null
  };
}

class Game {
  constructor(lobby, io) {
    this.lobby = lobby;
    this.io = io;
    this.map = parseMap();
    this.actors = new Map();
    this.scratchMarks = [];
    this.state = "lobby";
    this.startedAt = 0;
    this.winner = null;
    this.message = "Waiting for players";
    this.requiredGenerators = CONFIG.objective.requiredGenerators;
    this.nextBotNumber = 1;
  }

  resetRound() {
    this.map = parseMap();
    this.scratchMarks = [];
    this.startedAt = Date.now();
    this.winner = null;
    this.message = "Survive the trial";
    const survivors = this.survivors();
    let survivorIndex = 0;
    for (const actor of this.actors.values()) {
      const spawn = actor.role === ROLE.KILLER
        ? this.map.killerSpawns[0]
        : this.map.survivorSpawns[survivorIndex++ % this.map.survivorSpawns.length];
      Object.assign(actor, makeActor({ id: actor.id, socketId: actor.socketId, name: actor.name, role: actor.role, isBot: actor.isBot, spawn }));
    }
    if (!survivors.length) this.addBot(ROLE.SURVIVOR);
    if (!this.killer()) this.addBot(ROLE.KILLER);
  }

  start() {
    this.state = "playing";
    this.resetRound();
  }

  addHuman(socketId, name) {
    const id = socketId;
    if (this.actors.has(id)) return this.actors.get(id);
    const spawn = this.map.survivorSpawns[this.survivors().length % this.map.survivorSpawns.length];
    const actor = makeActor({ id, socketId, name: name || `Player ${this.actors.size + 1}`, role: ROLE.SURVIVOR, spawn });
    this.actors.set(id, actor);
    return actor;
  }

  removeHuman(socketId) {
    const actor = this.actors.get(socketId);
    if (!actor) return;
    this.actors.delete(socketId);
    if (this.state === "playing") this.checkWinConditions();
  }

  setRole(actorId, role) {
    const actor = this.actors.get(actorId);
    if (!actor || this.state !== "lobby") return { ok: false, reason: "Role can only be changed in the lobby." };
    if (role === ROLE.KILLER && this.killer() && this.killer().id !== actorId) return { ok: false, reason: "There is already a killer." };
    if (role === ROLE.SURVIVOR && this.survivors().filter((a) => !a.isBot || a.id !== actorId).length >= CONFIG.lobby.maxSurvivors) {
      return { ok: false, reason: "Survivor slots are full." };
    }
    actor.role = role;
    actor.healthState = role === ROLE.SURVIVOR ? HEALTH.HEALTHY : "killer";
    const spawn = role === ROLE.KILLER ? this.map.killerSpawns[0] : this.map.survivorSpawns[0];
    actor.x = spawn.x;
    actor.y = spawn.y;
    return { ok: true };
  }

  addBot(role = ROLE.SURVIVOR) {
    if (this.state !== "lobby") return null;
    if (role === ROLE.KILLER && this.killer()) return null;
    if (role === ROLE.SURVIVOR && this.survivors().length >= CONFIG.lobby.maxSurvivors) return null;
    const spawn = role === ROLE.KILLER ? this.map.killerSpawns[0] : this.map.survivorSpawns[this.survivors().length % this.map.survivorSpawns.length];
    const actor = makeActor({
      id: uid(role === ROLE.KILLER ? "botkiller" : "botsurvivor"),
      name: role === ROLE.KILLER ? "Bot Killer" : `Bot Survivor ${this.nextBotNumber++}`,
      role,
      isBot: true,
      spawn
    });
    this.actors.set(actor.id, actor);
    return actor;
  }

  updateInput(actorId, input) {
    const actor = this.actors.get(actorId);
    if (!actor || actor.isBot) return;
    actor.input = { ...actor.input, ...input };
  }

  killer() {
    return [...this.actors.values()].find((a) => a.role === ROLE.KILLER) || null;
  }

  survivors() {
    return [...this.actors.values()].filter((a) => a.role === ROLE.SURVIVOR);
  }

  liveSurvivors() {
    return this.survivors().filter((s) => s.healthState !== HEALTH.DEAD && s.healthState !== HEALTH.ESCAPED);
  }

  emitEvent(event) {
    this.io.to(this.lobby.id).emit("gameEvent", { id: uid("evt"), at: Date.now(), ...event });
  }

  tick(dt) {
    if (this.state !== "playing") return;
    for (const actor of this.actors.values()) actor.beingHealedBy = null;
    for (const actor of this.actors.values()) {
      if (actor.channel?.type === "heal") {
        const target = this.actors.get(actor.channel.targetId);
        if (target) target.beingHealedBy = actor.id;
      }
    }
    this.updateBots(dt);
    this.updateChase(dt);
    this.updateActors(dt);
    this.updateInteractions(dt);
    this.cleanupScratchMarks(dt);
    this.checkWinConditions();
  }

  updateActors(dt) {
    for (const actor of this.actors.values()) {
      actor.invulnerable = Math.max(0, actor.invulnerable - dt);
      actor.speedBoost = Math.max(0, actor.speedBoost - dt);
      actor.attackCooldown = Math.max(0, actor.attackCooldown - dt);
      if (actor.healthState === HEALTH.DEAD || actor.healthState === HEALTH.ESCAPED || actor.healthState === HEALTH.HOOKED) continue;
      this.updateFacing(actor);
      this.updateAttack(actor, dt);
      this.updateVault(actor, dt);
      if (!actor.vault) this.updateMovement(actor, dt);
      this.maybeCreateScratchMark(actor, dt);
      actor.prevInput = { ...actor.input };
    }
  }

  updateFacing(actor) {
    if (Number.isFinite(actor.input.mouseX) && Number.isFinite(actor.input.mouseY)) {
      actor.angle = Math.atan2(actor.input.mouseY - actor.y, actor.input.mouseX - actor.x);
      return;
    }
    const dx = (actor.input.right ? 1 : 0) - (actor.input.left ? 1 : 0);
    const dy = (actor.input.down ? 1 : 0) - (actor.input.up ? 1 : 0);
    if (dx || dy) actor.angle = Math.atan2(dy, dx);
  }

  updateMovement(actor, dt) {
    if (actor.attack?.phase === "active" && actor.attack.type === "lunge") {
      const speed = CONFIG.killer.speed * Math.max(CONFIG.attack.lungeSpeedMultiplier || 1, 1.42);
      this.moveActor(actor, Math.cos(actor.angle) * speed * dt, Math.sin(actor.angle) * speed * dt);
      return;
    }

    const dx = (actor.input.right ? 1 : 0) - (actor.input.left ? 1 : 0);
    const dy = (actor.input.down ? 1 : 0) - (actor.input.up ? 1 : 0);
    const n = normalize(dx, dy);
    if (!n.len) return;

    let speed = 0;
    if (actor.role === ROLE.KILLER) {
      speed = CONFIG.killer.speed;
      if (actor.attack?.phase === "recovery") speed *= CONFIG.killer.recoverySpeedMultiplier;
    } else {
      if (actor.healthState === HEALTH.DOWNED) speed = CONFIG.survivor.crawlSpeed;
      else speed = actor.input.sprint ? CONFIG.survivor.sprintSpeed : CONFIG.survivor.walkSpeed;
      if (actor.speedBoost > 0) speed = Math.max(speed, CONFIG.survivor.hitBurstSpeed);
    }

    this.moveActor(actor, n.x * speed * dt, n.y * speed * dt);
  }

  moveActor(actor, dx, dy) {
    const nx = clamp(actor.x + dx, 0, this.map.width);
    const ny = clamp(actor.y + dy, 0, this.map.height);
    if (!this.wouldCollide(actor, nx, actor.y)) actor.x = nx;
    if (!this.wouldCollide(actor, actor.x, ny)) actor.y = ny;
  }

  updateVault(actor, dt) {
    if (!actor.vault) return;
    actor.vault.t += dt;
    const t = clamp(actor.vault.t / actor.vault.duration, 0, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    actor.x = actor.vault.fromX + (actor.vault.toX - actor.vault.fromX) * eased;
    actor.y = actor.vault.fromY + (actor.vault.toY - actor.vault.fromY) * eased;
    if (t >= 1) actor.vault = null;
  }

  actorRect(actor, x = actor.x, y = actor.y) {
    const size = actor.role === ROLE.KILLER ? CONFIG.actor.killerSize : CONFIG.actor.survivorSize;
    return { x: x - size / 2, y: y - size / 2, w: size, h: size };
  }

  generatorCollisionRects() {
    const size = CONFIG.objective.generatorCollisionSize;
    return this.map.generators.map((g) => ({ id: g.id, x: g.x - size / 2, y: g.y - size / 2, w: size, h: size }));
  }

  solidRects(actor) {
    const solids = [...this.map.walls, ...this.map.windows];
    for (const pallet of this.map.pallets) {
      if (!pallet.broken && pallet.state === "dropped") solids.push(pallet);
    }
    if (actor?.role === ROLE.SURVIVOR) solids.push(...this.generatorCollisionRects());
    return solids;
  }

  wouldCollide(actor, x, y) {
    const box = this.actorRect(actor, x, y);
    return this.solidRects(actor).some((r) => rectsOverlap(box, r));
  }

  updateAttack(actor, dt) {
    if (actor.role !== ROLE.KILLER) return;
    const pressed = !!actor.input.attack;
    const justPressed = pressed && !actor.prevInput.attack;
    const released = !pressed && actor.prevInput.attack;

    if (!actor.attack && justPressed && actor.attackCooldown <= 0) {
      actor.attack = { phase: "charging", t: 0, held: 0, type: null, hitIds: new Set() };
    }

    if (!actor.attack) return;

    if (actor.attack.phase === "charging") {
      actor.attack.t += dt;
      actor.attack.held += dt;
      if (released || actor.attack.held >= CONFIG.attack.chargeSeconds) {
        this.beginAttack(actor, actor.attack.held >= CONFIG.attack.chargeSeconds ? "lunge" : "quick");
      }
      return;
    }

    actor.attack.t += dt;
    const startup = actor.attack.type === "lunge" ? CONFIG.attack.lungeStartupSeconds : CONFIG.attack.quickStartupSeconds;
    const active = actor.attack.type === "lunge" ? CONFIG.attack.lungeActiveSeconds : CONFIG.attack.quickActiveSeconds;

    if (actor.attack.phase === "windup" && actor.attack.t >= startup) {
      actor.attack.phase = "active";
      actor.attack.t = 0;
    }

    if (actor.attack.phase === "active") {
      this.checkAttackHits(actor);
      if (actor.attack.t >= active) this.finishAttack(actor);
    }

    if (actor.attack?.phase === "recovery") {
      actor.attack.recovery -= dt;
      if (actor.attack.recovery <= 0) actor.attack = null;
    }
  }

  beginAttack(actor, type) {
    actor.attack = { phase: "windup", t: 0, held: actor.attack?.held || 0, type, hitIds: new Set(), landed: false };
    actor.attackCooldown = CONFIG.attack.cooldownSeconds;
    this.emitEvent({ type: "swing", actorId: actor.id, x: actor.x, y: actor.y, attackType: type, range: type === "lunge" ? Math.max(CONFIG.attack.lungeRange, 118) : CONFIG.attack.quickRange });
  }

  finishAttack(actor) {
    const type = actor.attack.type;
    const landed = actor.attack.landed;
    const recovery = type === "lunge"
      ? (landed ? CONFIG.attack.lungeHitRecoverySeconds : CONFIG.attack.lungeMissRecoverySeconds)
      : (landed ? CONFIG.attack.quickHitRecoverySeconds : CONFIG.attack.quickMissRecoverySeconds);
    actor.attack = { phase: "recovery", type, t: 0, recovery, hitIds: new Set(), landed };
  }

  checkAttackHits(killer) {
    const range = killer.attack.type === "lunge" ? Math.max(CONFIG.attack.lungeRange, 118) : CONFIG.attack.quickRange;
    for (const survivor of this.survivors()) {
      if (killer.attack.hitIds.has(survivor.id)) continue;
      if (![HEALTH.HEALTHY, HEALTH.INJURED].includes(survivor.healthState)) continue;
      if (survivor.invulnerable > 0) continue;

      const d = dist(killer.x, killer.y, survivor.x, survivor.y);
      const toTarget = Math.atan2(survivor.y - killer.y, survivor.x - killer.x);
      const arc = killer.attack.type === "lunge" ? CONFIG.attack.arcRadians * 1.12 : CONFIG.attack.arcRadians;
      const insideCone = d <= range && angleDiff(killer.angle, toTarget) <= arc / 2;
      const closeAoe = d <= CONFIG.attack.closeAoeRadius;
      const clear = hasLineOfSight(this, killer.x, killer.y, survivor.x, survivor.y, attackBlockingRects(this));
      if ((insideCone || closeAoe) && clear) {
        killer.attack.hitIds.add(survivor.id);
        killer.attack.landed = true;
        this.damageSurvivor(survivor, killer);
      }
    }
  }

  damageSurvivor(survivor, killer) {
    survivor.lastHitBy = killer.id;
    survivor.invulnerable = CONFIG.survivor.invulnerableSeconds;
    survivor.speedBoost = CONFIG.survivor.hitBurstSeconds;
    survivor.channel = null;
    if (survivor.healthState === HEALTH.HEALTHY) {
      survivor.healthState = HEALTH.INJURED;
      this.emitEvent({ type: "hit", x: survivor.x, y: survivor.y, survivorId: survivor.id, healthState: survivor.healthState });
    } else if (survivor.healthState === HEALTH.INJURED) {
      survivor.healthState = HEALTH.DOWNED;
      this.emitEvent({ type: "downed", x: survivor.x, y: survivor.y, survivorId: survivor.id, healthState: survivor.healthState, impact: true });
    }
  }

  updateInteractions(dt) {
    for (const actor of this.actors.values()) {
      if (actor.healthState === HEALTH.DEAD || actor.healthState === HEALTH.ESCAPED) continue;
      if (actor.input.special && !actor.prevInput.special) this.handleSpecial(actor);
      this.handleHeldAction(actor, dt);
    }
  }

  handleSpecial(actor) {
    if (actor.healthState === HEALTH.HOOKED || actor.healthState === HEALTH.DEAD || actor.healthState === HEALTH.ESCAPED) return;
    if (actor.role === ROLE.SURVIVOR) {
      if (actor.healthState === HEALTH.DOWNED) return;
      const pallet = this.nearestPallet(actor, CONFIG.actor.interactDistance, "upright");
      const vaultable = this.nearestVaultable(actor, CONFIG.actor.interactDistance);
      if (pallet && (!vaultable || dist(actor.x, actor.y, pallet.x + pallet.w / 2, pallet.y + pallet.h / 2) <= dist(actor.x, actor.y, vaultable.x + vaultable.w / 2, vaultable.y + vaultable.h / 2))) {
        this.dropPallet(actor, pallet);
      } else if (vaultable) {
        this.beginVault(actor, vaultable);
      }
    } else {
      const pallet = this.nearestPallet(actor, CONFIG.actor.interactDistance, "dropped");
      if (pallet) {
        actor.channel = { type: "break", targetId: pallet.id, t: 0, duration: CONFIG.killer.breakPalletSeconds };
        return;
      }
      const vaultable = this.nearestVaultable(actor, CONFIG.actor.interactDistance);
      if (vaultable) this.beginVault(actor, vaultable);
    }
  }

  handleHeldAction(actor, dt) {
    if (!actor.input.action) {
      if (actor.channel && actor.channel.type !== "break") actor.channel = null;
      return;
    }

    if (actor.role === ROLE.KILLER) return this.handleKillerAction(actor, dt);
    return this.handleSurvivorAction(actor, dt);
  }

  handleKillerAction(killer, dt) {
    const target = this.nearestDownedSurvivorForHook(killer);
    if (target) {
      const type = target.hookCount >= CONFIG.hooks.beforeExecution ? "execute" : "hook";
      const duration = type === "execute" ? CONFIG.hooks.executeSeconds : CONFIG.hooks.hookSeconds;
      if (!killer.channel || killer.channel.type !== type || killer.channel.targetId !== target.id) {
        killer.channel = { type, targetId: target.id, t: 0, duration };
      }
      target.channel = { type: "beingHooked", targetId: killer.id, t: killer.channel.t, duration };
      killer.channel.t += dt;
      if (killer.channel.t >= duration) {
        if (type === "execute") this.executeSurvivor(target, killer);
        else this.hookSurvivor(target, killer);
        killer.channel = null;
      }
      return;
    }

    const gen = this.nearestGeneratorForKick(killer);
    if (gen) return this.channelAction(killer, gen, "kickGen", CONFIG.objective.generatorKickSeconds, dt, () => this.kickGenerator(gen, killer));

    killer.channel = null;
  }

  handleSurvivorAction(actor, dt) {
    if ([HEALTH.DOWNED, HEALTH.HOOKED].includes(actor.healthState)) return;
    if (actor.beingHealedBy) return;

    const hooked = this.nearestHookedSurvivor(actor);
    if (hooked) return this.channelAction(actor, hooked, "rescue", CONFIG.hooks.unhookSeconds, dt, () => this.rescueSurvivor(hooked, actor));

    const healTarget = this.nearestHealableSurvivor(actor);
    if (healTarget) {
      healTarget.beingHealedBy = actor.id;
      return this.channelAction(actor, healTarget, "heal", CONFIG.healing.healSeconds, dt, () => this.completeHeal(healTarget, actor));
    }

    const gate = this.nearestGate(actor);
    if (gate && gate.open) return this.channelAction(actor, gate, "escape", CONFIG.objective.gateEscapeSeconds, dt, () => this.escapeSurvivor(actor));

    const gen = this.nearestGenerator(actor);
    if (gen && !gen.done && !this.gatesPowered()) {
      actor.channel = { type: "repair", targetId: gen.id, t: 0, duration: CONFIG.objective.generatorRepairSeconds, progress: gen.progress };
      gen.progress = clamp(gen.progress + dt / CONFIG.objective.generatorRepairSeconds, 0, 1);
      if (gen.progress >= 1 && !gen.done) {
        gen.done = true;
        this.emitEvent({ type: "gen", x: gen.x, y: gen.y, genId: gen.id });
        if (this.gatesPowered()) this.map.gates.forEach((g) => { g.open = true; });
      }
      return;
    }

    actor.channel = null;
  }

  channelAction(actor, target, type, duration, dt, complete) {
    if (!actor.channel || actor.channel.type !== type || actor.channel.targetId !== target.id) {
      actor.channel = { type, targetId: target.id, t: 0, duration };
    }
    actor.channel.t += dt;
    if (actor.channel.t >= duration) {
      complete();
      actor.channel = null;
    }
  }

  kickGenerator(gen, killer) {
    if (!gen || gen.done) return;
    const oldProgress = gen.progress || 0;
    gen.progress = clamp(oldProgress - CONFIG.objective.generatorKickRegression, 0, 1);
    this.emitEvent({
      type: "genKick",
      x: gen.x,
      y: gen.y,
      genId: gen.id,
      killerId: killer.id,
      oldProgress,
      progress: gen.progress
    });
  }

  hookSurvivor(survivor, killer) {
    const tile = randItem(this.map.floorTiles) || { x: survivor.x, y: survivor.y };
    survivor.healthState = HEALTH.HOOKED;
    survivor.hookCount += 1;
    survivor.x = tile.x;
    survivor.y = tile.y;
    survivor.channel = null;
    this.map.hooks = this.map.hooks.filter((h) => h.survivorId !== survivor.id);
    this.map.hooks.push({ id: uid("hook"), x: tile.x, y: tile.y, survivorId: survivor.id });
    this.emitEvent({ type: "hooked", x: tile.x, y: tile.y, survivorId: survivor.id, killerId: killer.id });
  }

  executeSurvivor(survivor, killer) {
    survivor.healthState = HEALTH.DEAD;
    survivor.channel = null;
    this.map.hooks = this.map.hooks.filter((h) => h.survivorId !== survivor.id);
    this.emitEvent({ type: "dead", x: survivor.x, y: survivor.y, survivorId: survivor.id, killerId: killer.id });
  }

  rescueSurvivor(survivor, rescuer) {
    survivor.healthState = HEALTH.INJURED;
    survivor.invulnerable = CONFIG.survivor.invulnerableSeconds;
    survivor.speedBoost = CONFIG.survivor.hitBurstSeconds;
    survivor.x += 34;
    survivor.y += 34;
    this.map.hooks = this.map.hooks.filter((h) => h.survivorId !== survivor.id);
    this.emitEvent({ type: "rescued", x: survivor.x, y: survivor.y, survivorId: survivor.id, rescuerId: rescuer.id });
  }

  completeHeal(target, healer) {
    if (target.healthState === HEALTH.DOWNED) target.healthState = HEALTH.INJURED;
    else if (target.healthState === HEALTH.INJURED) target.healthState = HEALTH.HEALTHY;
    target.channel = null;
    target.beingHealedBy = null;
    this.emitEvent({ type: "healed", x: target.x, y: target.y, survivorId: target.id, healerId: healer.id });
  }

  escapeSurvivor(actor) {
    actor.healthState = HEALTH.ESCAPED;
    actor.channel = null;
    this.emitEvent({ type: "escaped", x: actor.x, y: actor.y, survivorId: actor.id });
  }

  dropPallet(actor, pallet) {
    const dx = (actor.input.right ? 1 : 0) - (actor.input.left ? 1 : 0);
    const dy = (actor.input.down ? 1 : 0) - (actor.input.up ? 1 : 0);
    const cx = pallet.x + pallet.w / 2;
    const cy = pallet.y + pallet.h / 2;
    if (dx || dy) {
      if (Math.abs(dx) > Math.abs(dy)) actor.x = cx + Math.sign(dx) * (pallet.w / 2 + CONFIG.actor.survivorSize);
      else actor.y = cy + Math.sign(dy) * (pallet.h / 2 + CONFIG.actor.survivorSize);
    }
    pallet.state = "dropped";
    this.emitEvent({ type: "pallet", x: cx, y: cy, palletId: pallet.id });
  }

  beginVault(actor, obj) {
    const cx = obj.x + obj.w / 2;
    const cy = obj.y + obj.h / 2;
    const duration = actor.role === ROLE.KILLER ? CONFIG.killer.vaultSeconds : CONFIG.survivor.vaultSeconds;
    let toX = actor.x;
    let toY = actor.y;
    if (obj.orientation === "horizontal") {
      const side = actor.y < cy ? -1 : 1;
      toY = cy - side * (obj.h / 2 + 44);
      toX = clamp(actor.x, obj.x + 12, obj.x + obj.w - 12);
    } else {
      const side = actor.x < cx ? -1 : 1;
      toX = cx - side * (obj.w / 2 + 44);
      toY = clamp(actor.y, obj.y + 12, obj.y + obj.h - 12);
    }
    actor.vault = { fromX: actor.x, fromY: actor.y, toX, toY, t: 0, duration };
    this.emitEvent({ type: "vault", x: cx, y: cy, actorId: actor.id });
  }

  nearestPallet(actor, range, state) {
    return this.map.pallets
      .filter((p) => !p.broken && p.state === state && dist(actor.x, actor.y, p.x + p.w / 2, p.y + p.h / 2) <= range)
      .sort((a, b) => dist(actor.x, actor.y, a.x + a.w / 2, a.y + a.h / 2) - dist(actor.x, actor.y, b.x + b.w / 2, b.y + b.h / 2))[0] || null;
  }

  nearestVaultable(actor, range) {
    const droppedPallets = this.map.pallets.filter((p) => !p.broken && p.state === "dropped");
    return [...this.map.windows, ...droppedPallets]
      .filter((o) => dist(actor.x, actor.y, o.x + o.w / 2, o.y + o.h / 2) <= range)
      .sort((a, b) => dist(actor.x, actor.y, a.x + a.w / 2, a.y + a.h / 2) - dist(actor.x, actor.y, b.x + b.w / 2, b.y + b.h / 2))[0] || null;
  }

  nearestGenerator(actor) {
    return this.map.generators
      .filter((g) => !g.done && dist(actor.x, actor.y, g.x, g.y) <= CONFIG.actor.interactDistance)
      .sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0] || null;
  }

  nearestGeneratorForKick(actor) {
    return this.map.generators
      .filter((g) => !g.done && (g.progress || 0) > 0 && dist(actor.x, actor.y, g.x, g.y) <= CONFIG.actor.interactDistance)
      .sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0] || null;
  }

  nearestGate(actor) {
    return this.map.gates
      .filter((g) => dist(actor.x, actor.y, g.x, g.y) <= CONFIG.actor.interactDistance)
      .sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0] || null;
  }

  nearestHealableSurvivor(actor) {
    return this.survivors()
      .filter((s) => s.id !== actor.id && [HEALTH.INJURED, HEALTH.DOWNED].includes(s.healthState) && !s.beingHealedBy && dist(actor.x, actor.y, s.x, s.y) <= CONFIG.healing.distance)
      .sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0] || null;
  }

  nearestHookedSurvivor(actor) {
    return this.survivors()
      .filter((s) => s.id !== actor.id && s.healthState === HEALTH.HOOKED && dist(actor.x, actor.y, s.x, s.y) <= CONFIG.hooks.rescueDistance)
      .sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0] || null;
  }

  nearestDownedSurvivorForHook(killer) {
    return this.survivors()
      .filter((s) => s.healthState === HEALTH.DOWNED && dist(killer.x, killer.y, s.x, s.y) <= CONFIG.hooks.hookDistance && hasLineOfSight(this, killer.x, killer.y, s.x, s.y))
      .sort((a, b) => dist(killer.x, killer.y, a.x, a.y) - dist(killer.x, killer.y, b.x, b.y))[0] || null;
  }

  completedGenerators() {
    return this.map.generators.filter((g) => g.done).length;
  }

  gatesPowered() {
    return this.completedGenerators() >= this.requiredGenerators;
  }

  maybeCreateScratchMark(actor, dt) {
    if (actor.role !== ROLE.SURVIVOR || actor.healthState !== HEALTH.HEALTHY && actor.healthState !== HEALTH.INJURED) return;
    if (!actor.input.sprint) return;
    actor.lastScratch += dt;
    if (actor.lastScratch >= CONFIG.visibility.scratchMarkSpacingSeconds) {
      actor.lastScratch = 0;
      this.scratchMarks.push({ id: uid("scratch"), x: actor.x, y: actor.y, t: CONFIG.visibility.scratchMarkLifetimeSeconds });
    }
  }

  cleanupScratchMarks(dt) {
    for (const mark of this.scratchMarks) mark.t -= dt;
    this.scratchMarks = this.scratchMarks.filter((m) => m.t > 0);
  }

  updateChase(dt) {
    const killer = this.killer();
    if (!killer) return;
    for (const survivor of this.survivors()) {
      if (![HEALTH.HEALTHY, HEALTH.INJURED].includes(survivor.healthState)) {
        survivor.chaseTimer = 0;
        continue;
      }
      const d = dist(killer.x, killer.y, survivor.x, survivor.y);
      const seen = actorVisibleTo(this, killer, survivor);
      const inStart = d <= CONFIG.visibility.chaseStartRadius && seen;
      if (inStart) survivor.chaseTimer = CONFIG.visibility.chaseHoldSeconds;
      else survivor.chaseTimer = Math.max(0, survivor.chaseTimer - dt);
    }
  }

  updateBots(dt) {
    for (const actor of this.actors.values()) {
      if (!actor.isBot) continue;
      actor.bot.repath -= dt;
      if (actor.bot.repath <= 0) {
        actor.bot.repath = CONFIG.bot.repathMinSeconds + Math.random() * (CONFIG.bot.repathMaxSeconds - CONFIG.bot.repathMinSeconds);
        if (actor.role === ROLE.KILLER) this.thinkKillerBot(actor);
        else this.thinkSurvivorBot(actor);
      }
    }
  }

  thinkSurvivorBot(bot) {
    bot.input = makeInput();
    if (![HEALTH.HEALTHY, HEALTH.INJURED, HEALTH.DOWNED].includes(bot.healthState)) return;
    const killer = this.killer();
    const threat = killer ? dist(bot.x, bot.y, killer.x, killer.y) : Infinity;

    if (bot.healthState !== HEALTH.DOWNED) {
      const hooked = this.survivors().find((s) => s.id !== bot.id && s.healthState === HEALTH.HOOKED);
      const downed = this.survivors().find((s) => s.id !== bot.id && s.healthState === HEALTH.DOWNED);
      if (hooked && threat > CONFIG.bot.survivorPanicRadius) return this.botMoveAndAction(bot, hooked.x, hooked.y, CONFIG.hooks.rescueDistance, true);
      if (downed && threat > CONFIG.bot.survivorPanicRadius) return this.botMoveAndAction(bot, downed.x, downed.y, CONFIG.healing.distance, true);
    }

    if (killer && threat < CONFIG.bot.survivorThreatRadius) {
      const away = normalize(bot.x - killer.x, bot.y - killer.y);
      this.applyBotDirection(bot, away.x, away.y);
      bot.input.sprint = bot.healthState !== HEALTH.DOWNED;
      if (threat < CONFIG.bot.survivorPanicRadius && bot.healthState !== HEALTH.DOWNED) bot.input.special = !!this.nearestVaultable(bot, CONFIG.actor.interactDistance) || Math.random() < 0.35;
      return;
    }

    if (this.gatesPowered()) {
      const gate = this.map.gates[0];
      if (gate) return this.botMoveAndAction(bot, gate.x, gate.y, CONFIG.actor.interactDistance, true);
    }

    const gen = this.map.generators.find((g) => !g.done);
    if (gen && bot.healthState !== HEALTH.DOWNED) return this.botMoveAndAction(bot, gen.x, gen.y, CONFIG.actor.interactDistance, true);
  }

  thinkKillerBot(bot) {
    bot.input = makeInput();
    const downed = this.survivors().find((s) => s.healthState === HEALTH.DOWNED);
    if (downed) return this.botMoveAndAction(bot, downed.x, downed.y, CONFIG.hooks.hookDistance * 0.72, true);

    const kickable = this.map.generators
      .filter((g) => !g.done && (g.progress || 0) > 0.18)
      .sort((a, b) => dist(bot.x, bot.y, a.x, a.y) - dist(bot.x, bot.y, b.x, b.y))[0];
    const targets = this.survivors().filter((s) => [HEALTH.HEALTHY, HEALTH.INJURED].includes(s.healthState));
    if (kickable && (!targets.length || dist(bot.x, bot.y, kickable.x, kickable.y) < 135)) {
      return this.botMoveAndAction(bot, kickable.x, kickable.y, CONFIG.actor.interactDistance, true);
    }

    if (!targets.length) return;
    targets.sort((a, b) => dist(bot.x, bot.y, a.x, a.y) - dist(bot.x, bot.y, b.x, b.y));
    const target = targets[0];
    const targetDistance = dist(bot.x, bot.y, target.x, target.y);
    const clear = hasLineOfSight(this, bot.x, bot.y, target.x, target.y, attackBlockingRects(this));

    bot.input.mouseX = target.x;
    bot.input.mouseY = target.y;

    const vaultable = this.nearestVaultable(bot, CONFIG.actor.interactDistance + 10);
    if (vaultable && (!clear || dist(target.x, target.y, vaultable.x + vaultable.w / 2, vaultable.y + vaultable.h / 2) < CONFIG.actor.interactDistance * 2.2)) {
      bot.input.special = true;
      return;
    }

    this.botMoveAndAction(bot, target.x, target.y, Math.max(CONFIG.attack.lungeRange, 118), false);

    if (clear && targetDistance <= Math.max(CONFIG.attack.lungeRange, 118) + 18) {
      bot.input.attack = true;
    }
  }

  botMoveAndAction(bot, tx, ty, actionRange, holdAction) {
    const d = dist(bot.x, bot.y, tx, ty);
    const n = normalize(tx - bot.x, ty - bot.y);
    if (d > actionRange * 0.82) this.applyBotDirection(bot, n.x, n.y);
    if (d <= actionRange) bot.input.action = !!holdAction;
    bot.input.mouseX = tx;
    bot.input.mouseY = ty;
  }

  applyBotDirection(bot, dx, dy) {
    bot.input.right = dx > 0.2;
    bot.input.left = dx < -0.2;
    bot.input.down = dy > 0.2;
    bot.input.up = dy < -0.2;
  }

  checkWinConditions() {
    const survivors = this.survivors();
    if (!survivors.length) return;
    const active = survivors.filter((s) => ![HEALTH.DEAD, HEALTH.ESCAPED].includes(s.healthState));
    const allGone = survivors.every((s) => [HEALTH.DEAD, HEALTH.ESCAPED].includes(s.healthState));
    const allBad = active.length > 0 && active.every((s) => [HEALTH.HOOKED, HEALTH.DEAD].includes(s.healthState));
    if (allGone && survivors.some((s) => s.healthState === HEALTH.ESCAPED)) return this.end("survivors", "All survivors escaped or died. Trial over.");
    if (allBad || survivors.every((s) => s.healthState === HEALTH.DEAD)) return this.end("killer", "All survivors are hooked or dead.");
  }

  end(winner, message) {
    if (this.state === "ended") return;
    this.state = "ended";
    this.winner = winner;
    this.message = message;
    this.emitEvent({ type: winner === "killer" ? "dead" : "escaped", x: this.map.width / 2, y: this.map.height / 2, global: true });
  }

  serializeActor(viewer, actor) {
    const visible = actorVisibleTo(this, viewer, actor);
    return {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      isBot: actor.isBot,
      x: actor.x,
      y: actor.y,
      angle: actor.angle,
      visible,
      healthState: actor.healthState,
      hookCount: actor.hookCount,
      chase: actor.chaseTimer > 0,
      channel: actor.channel ? { type: actor.channel.type, t: actor.channel.t, duration: actor.channel.duration, targetId: actor.channel.targetId } : null,
      attack: actor.attack ? { phase: actor.attack.phase, type: actor.attack.type, t: actor.attack.t, recovery: actor.attack.recovery || 0, held: actor.attack.held || 0 } : null,
      invulnerable: actor.invulnerable > 0,
      local: viewer.id === actor.id
    };
  }

  audioStateFor(viewer) {
    if (!viewer || viewer.role === ROLE.KILLER) {
      const anyChase = this.survivors().some((s) => s.chaseTimer > 0);
      return anyChase ? { layer1: 0, layer2: 0, layer3: CONFIG.audio.layer3Volume } : { layer1: CONFIG.audio.layer1Volume, layer2: 0, layer3: 0 };
    }
    const killer = this.killer();
    if (!killer || viewer.healthState === HEALTH.DEAD || viewer.healthState === HEALTH.ESCAPED) return { layer1: CONFIG.audio.layer1Volume, layer2: 0, layer3: 0 };
    if (viewer.chaseTimer > 0) return { layer1: 0, layer2: 0, layer3: CONFIG.audio.layer3Volume };
    const d = dist(viewer.x, viewer.y, killer.x, killer.y);
    const near = d < CONFIG.visibility.terrorRadius ? (1 - d / CONFIG.visibility.terrorRadius) : 0;
    return { layer1: CONFIG.audio.layer1Volume, layer2: near * CONFIG.audio.layer2MaxVolume, layer3: 0 };
  }

  snapshotFor(viewer) {
    const killer = this.killer();
    return {
      now: Date.now(),
      state: this.state,
      winner: this.winner,
      message: this.message,
      selfId: viewer.id,
      map: publicMapState(this.map, this.actors.values()),
      objective: {
        completed: this.completedGenerators(),
        required: this.requiredGenerators,
        total: this.map.generators.length,
        gatesPowered: this.gatesPowered()
      },
      actors: [...this.actors.values()].map((actor) => this.serializeActor(viewer, actor)),
      scratchMarks: viewer.role === ROLE.KILLER
        ? this.scratchMarks.filter((m) => scratchVisibleToKiller(this, viewer, m)).map((m) => ({ id: m.id, x: m.x, y: m.y, t: m.t }))
        : [],
      audio: this.audioStateFor(viewer),
      prompts: this.promptsFor(viewer, killer)
    };
  }

  promptsFor(actor) {
    if (this.state !== "playing") return [];
    const prompts = [];
    if (actor.role === ROLE.KILLER) {
      const target = this.nearestDownedSurvivorForHook(actor);
      if (target) prompts.push(target.hookCount >= CONFIG.hooks.beforeExecution ? "Hold E: Execute" : "Hold E: Hook survivor");
      if (this.nearestGeneratorForKick(actor)) prompts.push("Hold E: Kick generator");
      if (this.nearestPallet(actor, CONFIG.actor.interactDistance, "dropped")) prompts.push("Space: Break pallet");
      if (this.nearestVaultable(actor, CONFIG.actor.interactDistance)) prompts.push("Space: Vault");
    } else {
      if (this.nearestHookedSurvivor(actor)) prompts.push("Hold E: Rescue");
      if (this.nearestHealableSurvivor(actor)) prompts.push("Hold E: Heal");
      if (this.nearestGenerator(actor)) prompts.push("Hold E: Repair");
      const gate = this.nearestGate(actor);
      if (gate?.open) prompts.push("Hold E: Escape");
      if (this.nearestPallet(actor, CONFIG.actor.interactDistance, "upright")) prompts.push("Space: Drop pallet");
      if (this.nearestVaultable(actor, CONFIG.actor.interactDistance)) prompts.push("Space: Vault");
    }
    return prompts;
  }
}

module.exports = { Game, ROLE, HEALTH };
