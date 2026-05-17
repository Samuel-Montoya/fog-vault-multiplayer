const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const GAME_MAPS = require("./public/maps.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  // Realtime games send lots of tiny snapshots. Compressing every message can
  // cost more CPU than it saves here, especially on free hosts and laptops.
  perMessageDeflate: false
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const PHASER_FILE = path.join(__dirname, "node_modules", "phaser", "dist", "phaser.min.js");

app.get("/vendor/phaser.min.js", (req, res) => res.sendFile(PHASER_FILE));
app.use(express.static(PUBLIC_DIR));
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const TICK_RATE = 60;
const SNAPSHOT_RATE = 24;
const BOT_THINK_RATE = 8;
const SCRATCH_MARK_MAX = 45;
const MAX_SURVIVORS = 4;
const SURVIVOR_SKINS = new Set(["blueSquare", "yellowStar", "purplePentagon"]);
function sanitizeSkin(value) {
  return SURVIVOR_SKINS.has(value) ? value : "blueSquare";
}
const PLAYER_SIZE = 30;
const KILLER_SIZE = 38;
const INTERACT_DISTANCE = 74;
const QUICK_ATTACK_RANGE = 62;
const LUNGE_ATTACK_RANGE = 98;
const ATTACK_ARC = Math.PI * 0.44;
const ATTACK_SIDE_RADIUS = 24;
// Tiny "standing on top of them" AOE so an M1 still connects when survivors are hugging the killer.
const ATTACK_CLOSE_AOE_RADIUS = 26;
const ATTACK_TAP_MAX = 0.18;
const LUNGE_CHARGE_TIME = 0.32;
const QUICK_ATTACK_ACTIVE = 0.20;
const LUNGE_ATTACK_ACTIVE = 0.34;
const QUICK_ATTACK_STARTUP = 0.075;
const LUNGE_ATTACK_STARTUP = 0.095;
const LUNGE_SPEED_MULT = 1.22;
const SURVIVOR_WALK_SPEED = 170;
const SURVIVOR_SPRINT_SPEED = 285;
const SURVIVOR_HIT_BURST_SPEED = 350;
const KILLER_SPEED = 310;
const KILLER_RECOVERY_SPEED_MULT = 0.28;
const KILLER_QUICK_MISS_RECOVERY = 1.05;
const KILLER_QUICK_HIT_RECOVERY = 1.55;
const KILLER_LUNGE_MISS_RECOVERY = 1.35;
const KILLER_LUNGE_HIT_RECOVERY = 1.85;
const KILLER_ATTACK_COOLDOWN = 0.24;
const SURVIVOR_INVULN = 1.45;
const SURVIVOR_HIT_BOOST = 1.0;
const SURVIVOR_VAULT_TIME = 0.38;
const KILLER_VAULT_TIME = 1.05;
const KILLER_BREAK_TIME = 1.25;
// Adjustable generator speed: raise this number to make generators slower.
const GENERATOR_REPAIR_TIME = 28.0;
// Max completed generators required to power the gates / finish the objective.
// Add 8, 12, or 40 gens to the map if you want. The match still only asks for this many.
const REQUIRED_GENERATORS_TO_COMPLETE = 5;
const GENERATOR_COLLISION_SIZE = 54;
// Killer generator kick: hold E near a partially repaired gen to regress it.
const GENERATOR_KICK_TIME = 1.0;
const GENERATOR_KICK_REGRESSION = 0.10;
const GATE_ESCAPE_TIME = 0.75;
const HEAL_TIME = 6.0;
const HEAL_DISTANCE = 82;
const DOWNED_CRAWL_SPEED = 62;
const HOOK_CHANNEL_TIME = 1.35;
const EXECUTE_CHANNEL_TIME = 2.15;
const UNHOOK_TIME = 3.25;
const HOOKS_BEFORE_EXECUTION = 2;
const HOOK_INTERACT_DISTANCE = 128;
const HOOK_RESCUE_DISTANCE = 108;
const TERROR_RADIUS = 760;
const CHASE_START_RADIUS = 520;
const CHASE_HOLD_SECONDS = 3;
const CLOSE_REVEAL_RADIUS = 120;
const SURVIVOR_CONE_LENGTH = 620;
const SURVIVOR_CONE_ANGLE = Math.PI / 2.6;
const KILLER_CONE_LENGTH = 920;
const KILLER_CONE_ANGLE = Math.PI / 1.75;
const KILLER_SCRATCH_MARK_VISIBILITY_RANGE = 520;
const MUSIC_LAYER_1_VOLUME = 0.12;
const MUSIC_LAYER_2_MAX_VOLUME = 0.30;
const MUSIC_LAYER_3_VOLUME = 0.30;
const BOT_REPATH_MIN = 0.58;
const BOT_REPATH_MAX = 1.15;
const BOT_SURVIVOR_THREAT_RADIUS = 640;
const BOT_SURVIVOR_PANIC_RADIUS = 285;
const BOT_SURVIVOR_LOOP_RADIUS = 430;
const BOT_KILLER_MEMORY_SECONDS = 6.0;
const BOT_KILLER_SCRATCH_MEMORY_SECONDS = 2.5;
const BOT_KILLER_INTERACT_COOLDOWN = 1.25;
const BOT_KILLER_WINDOW_REUSE_COOLDOWN = 2.2;
const BOT_KILLER_STUCK_SECONDS = 0.85;

const CHAT_MESSAGE_DURATION = 3.0;
const CHAT_WHEEL_MESSAGES = {
  survivor: {
    normal: ["Let's do a generator.", "I'm so scared...", "Here he comes!", "What was that?!"],
    chase: ["He's on me...!", "Leave me alone!", "I'm so scared!", "AHHHH!"],
    injured: ["I need healing...", "Please, help me...", "I need to hide.", "Over here..."],
    downed: ["Pick me up!", "Help, please...", "I don't wanna die...", "I'm down...!"],
    hooked: ["Save me!", "Unhook me!", "Grab me!", "He's here..."]
  },
  killer: ["Im going to get you", "You cant hide forever", "Ill be back...", "What the...?!"]
};

function getSurvivorChatState(actor) {
  if (!actor || actor.role !== "survivor") return "normal";
  if (actor.hooked) return "hooked";
  if (actor.downed || actor.health <= 0) return "downed";
  if (actor.chaseHold > 0) return "chase";
  if (actor.injured || actor.health <= 1) return "injured";
  return "normal";
}

function getChatWheelMessagesForActor(actor) {
  if (actor?.role === "killer") return CHAT_WHEEL_MESSAGES.killer;
  const survivorMessages = CHAT_WHEEL_MESSAGES.survivor;
  return survivorMessages[getSurvivorChatState(actor)] || survivorMessages.normal;
}

let nextLobbyNumber = 1;
const lobbies = new Map();
const socketToLobby = new Map();

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function nowMs() {
  return Date.now();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function actorRect(actor, x = actor.x, y = actor.y) {
  const size = actor.role === "killer" ? KILLER_SIZE : PLAYER_SIZE;
  return { x: x - size / 2, y: y - size / 2, w: size, h: size };
}

function centerOf(obj) {
  return { x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 };
}

function normalizeRows(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(width, "."));
}

function orientationForWindow(rows, cx, cy) {
  const left = rows[cy]?.[cx - 1] === "X";
  const right = rows[cy]?.[cx + 1] === "X";
  const up = rows[cy - 1]?.[cx] === "X";
  const down = rows[cy + 1]?.[cx] === "X";
  if ((left || right) && !(up && down)) return "horizontal";
  if ((up || down) && !(left && right)) return "vertical";
  return left || right ? "horizontal" : "vertical";
}

function parseMap(mapDef) {
  const rows = normalizeRows(mapDef.rows);
  const tile = mapDef.tile || 72;
  const map = {
    name: mapDef.name || "Unnamed Map",
    tile,
    cols: rows[0].length,
    rows: rows.length,
    width: rows[0].length * tile,
    height: rows.length * tile,
    rawRows: rows,
    walls: [],
    windows: [],
    pallets: [],
    generators: [],
    gates: [],
    hooks: [],
    survivorSpawns: [],
    killerSpawns: []
  };

  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      const rx = x * tile;
      const ry = y * tile;
      const base = { x: rx, y: ry, w: tile, h: tile, tileX: x, tileY: y };
      if (ch === "X") map.walls.push({ ...base, id: uid("wall") });
      if (ch === "+") map.windows.push({ ...base, id: uid("window"), orientation: orientationForWindow(rows, x, y) });
      if (ch === "-") map.pallets.push({ ...base, id: uid("pallet"), orientation: "horizontal", state: "upright", broken: false });
      if (ch === "|") map.pallets.push({ ...base, id: uid("pallet"), orientation: "vertical", state: "upright", broken: false });
      if (ch === "G") map.generators.push({
        id: uid("gen"),
        x: rx + tile / 2,
        y: ry + tile / 2,
        progress: 0,
        done: false,
        activeRepairers: [],
        beingKicked: false,
        kickProgress: 0,
        // Prevent kick spam: after a successful kick, this stays true
        // until a survivor actually repairs this generator again.
        kickLocked: false
      });
      if (ch === "E") map.gates.push({ id: uid("gate"), x: rx + tile / 2, y: ry + tile / 2, open: false });
      if (ch === "P") map.survivorSpawns.push({ x: rx + tile / 2, y: ry + tile / 2 });
      if (ch === "K") map.killerSpawns.push({ x: rx + tile / 2, y: ry + tile / 2 });
    }
  }

  if (!map.survivorSpawns.length) map.survivorSpawns.push({ x: tile * 2, y: tile * 2 });
  if (!map.killerSpawns.length) map.killerSpawns.push({ x: map.width - tile * 3, y: map.height - tile * 3 });
  return map;
}

function getActiveMapDef() {
  const active = GAME_MAPS[GAME_MAPS.active] || GAME_MAPS.bloodyard || Object.values(GAME_MAPS).find((m) => m && m.rows);
  return active;
}

function solidRects(game) {
  const solids = [...game.map.walls, ...game.map.windows];
  for (const pallet of game.map.pallets) {
    if (!pallet.broken && pallet.state === "dropped") solids.push(pallet);
  }
  return solids;
}

function generatorCollisionRects(game) {
  const size = GENERATOR_COLLISION_SIZE;
  return game.map.generators.map((g) => ({
    id: g.id,
    x: g.x - size / 2,
    y: g.y - size / 2,
    w: size,
    h: size
  }));
}

function movementBlockingRects(game, actor) {
  const solids = solidRects(game);
  // Survivors must path around generators. Killers get to phase through them,
  // because horror balance apparently requires forklift privileges.
  if (actor?.role === "survivor") return [...solids, ...generatorCollisionRects(game)];
  return solids;
}

function visionBlockingRects(game) {
  // Only true walls block sight. Windows and dropped pallets block bodies, not eyeballs.
  return game.map.walls;
}

function attackBlockingRects(game) {
  // Attacks should not hit through walls, windows, or dropped pallets.
  return solidRects(game);
}

function wouldCollide(game, actor, x, y) {
  const box = actorRect(actor, x, y);
  return movementBlockingRects(game, actor).some((r) => {
    // If a survivor drops a pallet while standing still on top of the interaction zone,
    // give them a tiny pass-through grace on that one pallet so they can step out instead of
    // becoming part of the furniture. Humans apparently dislike being furniture.
    if (actor.palletGraceId && actor.palletGraceTime > 0 && r.id === actor.palletGraceId) return false;
    return rectsOverlap(box, r);
  });
}

function segmentClearAgainst(blockers, ax, ay, bx, by) {
  const distance = dist(ax, ay, bx, by);
  const steps = Math.max(2, Math.ceil(distance / 18));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (blockers.some((r) => pointInRect(x, y, r))) return false;
  }
  return true;
}

function segmentClear(game, ax, ay, bx, by) {
  return segmentClearAgainst(visionBlockingRects(game), ax, ay, bx, by);
}

function attackSegmentClear(game, ax, ay, bx, by) {
  return segmentClearAgainst(attackBlockingRects(game), ax, ay, bx, by);
}

function coneSees(viewer, target, length, angle) {
  const d = dist(viewer.x, viewer.y, target.x, target.y);
  if (d > length) return false;
  const a = Math.atan2(target.y - viewer.y, target.x - viewer.x);
  return angleDiff(a, viewer.angle || 0) <= angle / 2;
}

function getLobbySummary(lobby) {
  const players = [...lobby.players.values()];
  const survivors = players.filter((p) => p.role === "survivor").length;
  const killer = players.some((p) => p.role === "killer");
  return {
    id: lobby.id,
    name: lobby.name,
    mapName: lobby.mapName,
    phase: lobby.phase,
    playerCount: players.length,
    survivors,
    killer,
    maxSurvivors: MAX_SURVIVORS,
    createdAt: lobby.createdAt
  };
}

function broadcastLobbyList() {
  const list = [...lobbies.values()]
    .map(getLobbySummary)
    .sort((a, b) => a.createdAt - b.createdAt);
  io.emit("lobbyList", list);
}

function makePlayer(socket, role, name, options = {}) {
  return {
    id: socket.id,
    name: String(name || "Player").slice(0, 18),
    isBot: !!options.isBot,
    role,
    skin: role === "survivor" ? sanitizeSkin(options.skin) : "killerCircle",
    ready: false,
    x: 0,
    y: 0,
    angle: 0,
    health: role === "survivor" ? 2 : 999,
    dead: false,
    escaped: false,
    downed: false,
    hooked: false,
    hookId: null,
    hookProgress: 0,
    unhookProgress: 0,
    hookCount: 0,
    hookActionTargetId: null,
    hookActionType: null,
    unhookTargetId: null,
    injured: false,
    invuln: 0,
    hitBoost: 0,
    healProgress: 0,
    activeHealers: [],
    healingTargetId: null,
    recovery: 0,
    actionLock: 0,
    vault: null,
    breakTarget: null,
    attackCooldown: 0,
    attackState: null,
    attackType: null,
    attackTimer: 0,
    attackDuration: 0,
    attackCharge: 0,
    attackHasHit: false,
    attackNeedsRelease: false,
    attackStartup: 0,
    attackSweepStartX: 0,
    attackSweepStartY: 0,
    swingTime: 0,
    chaseHold: 0,
    // For chase music: once the survivor sees the killer during chase, keep layer_3 alive briefly
    // after they look away. This avoids frantic on/off music when checking behind you.
    killerVisibleHold: 0,
    chatText: null,
    chatUntil: 0,
    palletGraceId: null,
    palletGraceTime: 0,
    bot: {
      repath: 0,
      path: [],
      targetId: null,
      lastSeenX: 0,
      lastSeenY: 0,
      lastSeenTime: 0,
      goalX: 0,
      goalY: 0,
      stuckTimer: 0,
      lastX: 0,
      lastY: 0,
      actionCooldown: 0,
      fleeTimer: 0,
      fleeX: 0,
      fleeY: 0
    },
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      sprint: false,
      action: false,
      repair: false,
      attack: false,
      attackHeld: false,
      attackReleased: false,
      actionDir: null,
      angle: 0
    }
  };
}

function createLobby(name) {
  const id = uid("lobby");
  const mapDef = getActiveMapDef();
  const lobby = {
    id,
    name: String(name || `Open Lobby ${nextLobbyNumber++}`).slice(0, 28),
    mapName: mapDef.name,
    phase: "lobby",
    createdAt: nowMs(),
    players: new Map(),
    game: null
  };
  lobbies.set(id, lobby);
  return lobby;
}

function joinLobby(socket, lobby, requestedRole, name, skin) {
  leaveCurrentLobby(socket);

  let role = requestedRole === "killer" ? "killer" : "survivor";
  const players = [...lobby.players.values()];
  const hasKiller = players.some((p) => p.role === "killer");
  const survivorCount = players.filter((p) => p.role === "survivor").length;

  if (role === "killer" && hasKiller) {
    socket.emit("toast", { type: "error", message: "This lobby already has a killer. Tragic scarcity." });
    return false;
  }
  if (role === "survivor" && survivorCount >= MAX_SURVIVORS) {
    socket.emit("toast", { type: "error", message: "This lobby already has four survivors." });
    return false;
  }
  if (lobby.phase !== "lobby") {
    socket.emit("toast", { type: "error", message: "That lobby is already in a match." });
    return false;
  }

  const player = makePlayer(socket, role, name, { isBot: false, skin });
  lobby.players.set(socket.id, player);
  socketToLobby.set(socket.id, lobby.id);
  socket.join(lobby.id);
  socket.emit("joinedLobby", { lobbyId: lobby.id, playerId: socket.id });
  broadcastLobbyState(lobby);
  broadcastLobbyList();
  return true;
}

function leaveCurrentLobby(socket) {
  const lobbyId = socketToLobby.get(socket.id);
  if (!lobbyId) return;
  const lobby = lobbies.get(lobbyId);
  socketToLobby.delete(socket.id);
  socket.leave(lobbyId);

  if (!lobby) return;
  lobby.players.delete(socket.id);

  const humanCount = [...lobby.players.values()].filter((p) => !p.isBot).length;
  if (lobby.players.size === 0 || humanCount === 0) {
    lobbies.delete(lobby.id);
  } else {
    if (lobby.phase === "game" && lobby.game) {
      const actor = lobby.game.actors.get(socket.id);
      if (actor) {
        if (actor.role === "killer") {
          endGame(lobby, "survivors", "The killer disconnected. Survivors win by administrative collapse.");
        } else {
          actor.dead = true;
          checkWinConditions(lobby);
        }
      }
    }
    broadcastLobbyState(lobby);
  }
  broadcastLobbyList();
}

function broadcastLobbyState(lobby) {
  io.to(lobby.id).emit("lobbyState", {
    id: lobby.id,
    name: lobby.name,
    phase: lobby.phase,
    mapName: lobby.mapName,
    players: [...lobby.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, skin: p.skin || "blueSquare", ready: p.ready, isBot: !!p.isBot }))
  });
}

function addBotToLobby(lobby, role) {
  if (!lobby || lobby.phase !== "lobby") return { ok: false, message: "Bots can only be added in the lobby." };
  const roleValue = role === "killer" ? "killer" : "survivor";
  const players = [...lobby.players.values()];
  if (roleValue === "killer" && players.some((p) => p.role === "killer")) {
    return { ok: false, message: "Killer is already taken." };
  }
  if (roleValue === "survivor" && players.filter((p) => p.role === "survivor").length >= MAX_SURVIVORS) {
    return { ok: false, message: "Survivor slots are full." };
  }
  const id = uid("bot");
  const count = players.filter((p) => p.isBot && p.role === roleValue).length + 1;
  const name = roleValue === "killer" ? "Bot Killer" : `Bot Survivor ${count}`;
  const bot = makePlayer({ id }, roleValue, name, { isBot: true, skin: ["blueSquare", "yellowStar", "purplePentagon"][count % 3] });
  bot.ready = true;
  lobby.players.set(id, bot);
  return { ok: true };
}

function canChangeRole(lobby, player, role) {
  if (role === player.role) return true;
  const players = [...lobby.players.values()].filter((p) => p.id !== player.id);
  if (role === "killer") return !players.some((p) => p.role === "killer");
  if (role === "survivor") return players.filter((p) => p.role === "survivor").length < MAX_SURVIVORS;
  return false;
}

function startGame(lobby) {
  const players = [...lobby.players.values()];
  const killers = players.filter((p) => p.role === "killer");
  const survivors = players.filter((p) => p.role === "survivor");
  if (lobby.phase !== "lobby") return false;
  if (killers.length !== 1 || survivors.length < 1) {
    io.to(lobby.id).emit("toast", { type: "error", message: "Need exactly 1 killer and at least 1 survivor." });
    return false;
  }

  const map = parseMap(getActiveMapDef());
  const game = {
    map,
    phase: "game",
    startedAt: nowMs(),
    endedAt: null,
    winner: null,
    endReason: "",
    actors: new Map(),
    events: [],
    particles: [],
    scratchMarks: [],
    requiredGenerators: Math.min(REQUIRED_GENERATORS_TO_COMPLETE, map.generators.length),
    escapeOpen: false,
    time: 0,
    botThinkAccumulator: 0
  };

  let survivorSpawnIndex = 0;
  for (const player of players) {
    const actor = makePlayer({ id: player.id }, player.role, player.name, { isBot: !!player.isBot, skin: player.skin });
    actor.ready = player.ready;
    if (actor.role === "killer") {
      const spawn = map.killerSpawns[0];
      actor.x = spawn.x;
      actor.y = spawn.y;
    } else {
      const spawn = map.survivorSpawns[survivorSpawnIndex % map.survivorSpawns.length];
      survivorSpawnIndex++;
      actor.x = spawn.x;
      actor.y = spawn.y;
    }
    game.actors.set(actor.id, actor);
  }

  lobby.phase = "game";
  lobby.game = game;
  for (const player of lobby.players.values()) player.ready = false;
  io.to(lobby.id).emit("gameStarted", serializeMapForClient(map));
  broadcastLobbyState(lobby);
  broadcastLobbyList();
  return true;
}

function serializeMapForClient(map) {
  return {
    name: map.name,
    tile: map.tile,
    width: map.width,
    height: map.height,
    rows: map.rawRows,
    walls: map.walls.map(stripRect),
    windows: map.windows.map((w) => ({ ...stripRect(w), orientation: w.orientation })),
    pallets: map.pallets.map((p) => ({ ...stripRect(p), orientation: p.orientation, state: p.state, broken: p.broken })),
    generators: map.generators.map((g) => ({ id: g.id, x: g.x, y: g.y, progress: g.progress, done: g.done })),
    gates: map.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, open: g.open })),
    hooks: (map.hooks || []).map((h) => ({ id: h.id, x: h.x, y: h.y, survivorId: h.survivorId, active: h.active }))
  };
}

function stripRect(r) {
  return { id: r.id, x: r.x, y: r.y, w: r.w, h: r.h };
}

function addEvent(game, type, data = {}) {
  game.events.push({ id: uid("evt"), type, ...data });
  if (game.events.length > 40) game.events.splice(0, game.events.length - 40);
}

function addScratch(game, actor) {
  game.scratchMarks.push({ id: uid("scratch"), x: actor.x, y: actor.y, angle: actor.angle + (Math.random() - 0.5), ttl: 4.0, createdAt: game.time || 0 });
  if (game.scratchMarks.length > SCRATCH_MARK_MAX) game.scratchMarks.splice(0, game.scratchMarks.length - SCRATCH_MARK_MAX);
}

function moveActor(game, actor, dt) {
  if (actor.dead || actor.escaped || actor.hooked) return;

  actor.angle = Number.isFinite(actor.input.angle) ? actor.input.angle : actor.angle;

  if (actor.role === "survivor" && actor.downed) {
    actor.input.sprint = false;
    actor.input.action = false;
  }

  if (actor.vault) {
    actor.vault.t += dt;
    const t = clamp(actor.vault.t / actor.vault.duration, 0, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    actor.x = actor.vault.fromX + (actor.vault.toX - actor.vault.fromX) * eased;
    actor.y = actor.vault.fromY + (actor.vault.toY - actor.vault.fromY) * eased;
    if (t >= 1) actor.vault = null;
    return;
  }

  if (actor.breakTarget) {
    actor.actionLock -= dt;
    if (actor.actionLock <= 0) {
      const pallet = game.map.pallets.find((p) => p.id === actor.breakTarget);
      if (pallet && pallet.state === "dropped") {
        pallet.broken = true;
        pallet.state = "broken";
        addEvent(game, "palletBreak", { x: pallet.x + pallet.w / 2, y: pallet.y + pallet.h / 2 });
      }
      actor.breakTarget = null;
      actor.actionLock = 0;
    }
    return;
  }

  if (actor.actionLock > 0) {
    actor.actionLock = Math.max(0, actor.actionLock - dt);
    return;
  }

  let dx = 0;
  let dy = 0;
  if (actor.input.up) dy -= 1;
  if (actor.input.down) dy += 1;
  if (actor.input.left) dx -= 1;
  if (actor.input.right) dx += 1;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  // During a lunge the killer gets a short forward burst in their facing direction.
  // This is server-authoritative so the client can't fake a giga-lunge. Truly tragic.
  if (actor.role === "killer" && actor.attackState === "lunge") {
    const lungeSpeed = KILLER_SPEED * LUNGE_SPEED_MULT;
    const lx = Math.cos(actor.angle || 0);
    const ly = Math.sin(actor.angle || 0);
    const nextX = clamp(actor.x + lx * lungeSpeed * dt, 36, game.map.width - 36);
    const nextY = clamp(actor.y + ly * lungeSpeed * dt, 36, game.map.height - 36);
    if (!wouldCollide(game, actor, nextX, actor.y)) actor.x = nextX;
    if (!wouldCollide(game, actor, actor.x, nextY)) actor.y = nextY;
    return;
  }

  // Quick attacks commit the killer briefly. Charging still allows normal movement.
  if (actor.role === "killer" && actor.attackState === "quick") return;

  let speed = actor.role === "killer" ? KILLER_SPEED : (actor.input.sprint ? SURVIVOR_SPRINT_SPEED : SURVIVOR_WALK_SPEED);
  if (actor.role === "survivor" && actor.downed) speed = DOWNED_CRAWL_SPEED;
  else if (actor.role === "survivor" && actor.hitBoost > 0) speed = SURVIVOR_HIT_BURST_SPEED;
  if (actor.role === "killer" && actor.recovery > 0) speed *= KILLER_RECOVERY_SPEED_MULT;

  const nextX = clamp(actor.x + dx * speed * dt, 36, game.map.width - 36);
  const nextY = clamp(actor.y + dy * speed * dt, 36, game.map.height - 36);

  if (!wouldCollide(game, actor, nextX, actor.y)) actor.x = nextX;
  if (!wouldCollide(game, actor, actor.x, nextY)) actor.y = nextY;

  if (actor.role === "survivor" && !actor.downed && actor.input.sprint && (Math.abs(dx) + Math.abs(dy) > 0.05)) {
    if (Math.random() < 0.45) addScratch(game, actor);
  }
}

function nearestInteractable(game, actor, includePalletDrop = true) {
  const options = [];
  for (const win of game.map.windows) {
    const c = centerOf(win);
    const d = dist(actor.x, actor.y, c.x, c.y);
    if (d <= INTERACT_DISTANCE) options.push({ type: "window", object: win, d });
  }
  for (const pallet of game.map.pallets) {
    if (pallet.broken) continue;
    const c = centerOf(pallet);
    const d = dist(actor.x, actor.y, c.x, c.y);
    if (d <= INTERACT_DISTANCE) {
      if (pallet.state === "upright" && includePalletDrop) options.push({ type: "palletDrop", object: pallet, d });
      if (pallet.state === "dropped") options.push({ type: actor.role === "killer" ? "palletBreak" : "palletVault", object: pallet, d });
    }
  }
  options.sort((a, b) => a.d - b.d);
  return options[0] || null;
}

function startVault(game, actor, object, vaultType = "window") {
  const c = centerOf(object);
  const duration = actor.role === "killer" ? KILLER_VAULT_TIME : SURVIVOR_VAULT_TIME;
  let toX = actor.x;
  let toY = actor.y;
  const offset = game.map.tile * 0.92;

  if (object.orientation === "horizontal") {
    const side = actor.y < c.y ? -1 : 1;
    toX = clamp(actor.x, object.x + PLAYER_SIZE, object.x + object.w - PLAYER_SIZE);
    toY = c.y - side * offset;
  } else {
    const side = actor.x < c.x ? -1 : 1;
    toX = c.x - side * offset;
    toY = clamp(actor.y, object.y + PLAYER_SIZE, object.y + object.h - PLAYER_SIZE);
  }

  actor.vault = {
    t: 0,
    duration,
    fromX: actor.x,
    fromY: actor.y,
    toX: clamp(toX, 44, game.map.width - 44),
    toY: clamp(toY, 44, game.map.height - 44)
  };
  addEvent(game, "vault", { x: c.x, y: c.y, role: actor.role, actorId: actor.id, vaultType });
}

function movementDirection(input) {
  return {
    dx: (input.right ? 1 : 0) - (input.left ? 1 : 0),
    dy: (input.down ? 1 : 0) - (input.up ? 1 : 0)
  };
}

function directionFromInput(input) {
  if (["up", "down", "left", "right"].includes(input.actionDir)) return input.actionDir;
  const { dx, dy } = movementDirection(input);
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "up" : "down";
  return dx < 0 ? "left" : "right";
}

function palletSidePosition(actor, pallet, direction, slideOffset = 0) {
  const size = actor.role === "killer" ? KILLER_SIZE : PLAYER_SIZE;
  const margin = size / 2 + 7;
  const minX = pallet.x + margin;
  const maxX = pallet.x + pallet.w - margin;
  const minY = pallet.y + margin;
  const maxY = pallet.y + pallet.h - margin;

  if (direction === "up") {
    return { x: clamp(actor.x + slideOffset, minX, maxX), y: pallet.y - margin };
  }
  if (direction === "down") {
    return { x: clamp(actor.x + slideOffset, minX, maxX), y: pallet.y + pallet.h + margin };
  }
  if (direction === "left") {
    return { x: pallet.x - margin, y: clamp(actor.y + slideOffset, minY, maxY) };
  }
  return { x: pallet.x + pallet.w + margin, y: clamp(actor.y + slideOffset, minY, maxY) };
}

function wouldCollideWithFuturePallet(game, actor, x, y, pallet) {
  const box = actorRect(actor, x, y);
  const blockers = [...movementBlockingRects(game, actor)];
  if (!pallet.broken) blockers.push(pallet);
  return blockers.some((r) => rectsOverlap(box, r));
}

function moveToPalletSideByInput(game, actor, pallet) {
  const direction = directionFromInput(actor.input);

  // No movement key held: do not move the player. Drop the pallet and grant a short
  // grace window so they can walk out if the collision volume overlaps them.
  if (!direction) {
    actor.palletGraceId = pallet.id;
    actor.palletGraceTime = 0.65;
    return;
  }

  // IMPORTANT: never fall back to the opposite side. If the player presses W,
  // they go to the top side or stay put with grace. The old fallback system was
  // what caused the cursed random-side teleport nonsense.
  const offsets = [0, -18, 18, -36, 36, -54, 54];
  for (const offset of offsets) {
    const pos = palletSidePosition(actor, pallet, direction, offset);
    const x = clamp(pos.x, 36, game.map.width - 36);
    const y = clamp(pos.y, 36, game.map.height - 36);
    if (!wouldCollideWithFuturePallet(game, actor, x, y, pallet)) {
      actor.x = x;
      actor.y = y;
      actor.palletGraceId = null;
      actor.palletGraceTime = 0;
      return;
    }
  }

  actor.palletGraceId = pallet.id;
  actor.palletGraceTime = 0.65;
}

function handleAction(game, actor) {
  if (actor.dead || actor.escaped || actor.hooked || actor.downed || actor.vault || actor.breakTarget || actor.actionLock > 0) return;
  const hit = nearestInteractable(game, actor, actor.role === "survivor");
  if (!hit) return;

  if (hit.type === "window" || hit.type === "palletVault") {
    startVault(game, actor, hit.object, hit.type === "palletVault" ? "pallet" : "window");
  } else if (hit.type === "palletDrop") {
    moveToPalletSideByInput(game, actor, hit.object);
    hit.object.state = "dropped";
    addEvent(game, "palletDrop", { x: hit.object.x + hit.object.w / 2, y: hit.object.y + hit.object.h / 2 });

    const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);
    if (killer && circleNearRect(killer.x, killer.y, KILLER_SIZE * 0.65, hit.object)) {
      killer.recovery = Math.max(killer.recovery, 2.4);
      addEvent(game, "killerStun", { x: killer.x, y: killer.y });
    }
  } else if (hit.type === "palletBreak") {
    actor.breakTarget = hit.object.id;
    actor.actionLock = KILLER_BREAK_TIME;
    addEvent(game, "palletBreakStart", { x: hit.object.x + hit.object.w / 2, y: hit.object.y + hit.object.h / 2 });
  }
}

function circleNearRect(cx, cy, r, rect) {
  const closestX = clamp(cx, rect.x, rect.x + rect.w);
  const closestY = clamp(cy, rect.y, rect.y + rect.h);
  return dist(cx, cy, closestX, closestY) <= r;
}

function damageSurvivor(game, killer, survivor) {
  if (!survivor || survivor.dead || survivor.escaped || survivor.hooked || survivor.downed || survivor.invuln > 0) return false;
  survivor.health -= 1;
  survivor.healProgress = 0;
  survivor.activeHealers = [];
  survivor.healingTargetId = null;
  survivor.hookProgress = 0;
  survivor.unhookProgress = 0;

  if (survivor.health <= 0) {
    survivor.health = 0;
    survivor.injured = true;
    survivor.downed = true;
    survivor.hitBoost = 0;
    survivor.invuln = 0;
    survivor.chaseHold = 0;
    survivor.input.sprint = false;
    addEvent(game, "downed", { x: survivor.x, y: survivor.y, survivorId: survivor.id });
  } else {
    survivor.injured = true;
    survivor.invuln = SURVIVOR_INVULN;
    survivor.hitBoost = SURVIVOR_HIT_BOOST;
    addEvent(game, "hit", { x: survivor.x, y: survivor.y, survivorId: survivor.id, health: survivor.health });
  }

  if (killer && killer.attackState) killer.attackHasHit = true;
  else if (killer) {
    killer.recovery = Math.max(killer.recovery, KILLER_QUICK_HIT_RECOVERY);
    killer.attackCooldown = Math.max(killer.attackCooldown, KILLER_ATTACK_COOLDOWN);
  }
  return true;
}

function attackProfile(type) {
  const lunge = type === "lunge";
  return {
    type: lunge ? "lunge" : "quick",
    range: lunge ? LUNGE_ATTACK_RANGE : QUICK_ATTACK_RANGE,
    arc: ATTACK_ARC,
    duration: lunge ? LUNGE_ATTACK_ACTIVE : QUICK_ATTACK_ACTIVE,
    startup: lunge ? LUNGE_ATTACK_STARTUP : QUICK_ATTACK_STARTUP,
    hitRecovery: lunge ? KILLER_LUNGE_HIT_RECOVERY : KILLER_QUICK_HIT_RECOVERY,
    missRecovery: lunge ? KILLER_LUNGE_MISS_RECOVERY : KILLER_QUICK_MISS_RECOVERY
  };
}

function startKillerAttack(game, killer, type) {
  const profile = attackProfile(type);
  killer.attackState = profile.type;
  killer.attackType = profile.type;
  killer.attackTimer = 0;
  killer.attackDuration = profile.duration;
  killer.attackStartup = profile.startup;
  killer.attackSweepStartX = killer.x;
  killer.attackSweepStartY = killer.y;
  killer.attackHasHit = false;
  killer.attackCharge = 0;
  killer.attackNeedsRelease = true;
  addEvent(game, "swipe", {
    actorId: killer.id,
    x: killer.x,
    y: killer.y,
    angle: killer.angle,
    type: profile.type,
    range: profile.range,
    arc: profile.arc,
    duration: profile.duration,
    startup: profile.startup
  });
}

function finishKillerAttack(killer) {
  const profile = attackProfile(killer.attackType || "quick");
  killer.recovery = Math.max(killer.recovery, killer.attackHasHit ? profile.hitRecovery : profile.missRecovery);
  killer.attackCooldown = Math.max(killer.attackCooldown, KILLER_ATTACK_COOLDOWN);
  killer.attackState = null;
  killer.attackType = null;
  killer.attackTimer = 0;
  killer.attackDuration = 0;
  killer.attackStartup = 0;
  killer.attackCharge = 0;
  killer.attackHasHit = false;
}

function pointInAttackSwipe(originX, originY, angle, survivor, profile) {
  const dx = survivor.x - originX;
  const dy = survivor.y - originY;
  const d = Math.hypot(dx, dy);

  // Very small local AOE at the killer's feet. This catches survivors who are basically
  // touching the killer, including slightly behind them, without turning M1 into a lawn sprinkler.
  if (d <= ATTACK_CLOSE_AOE_RADIUS + PLAYER_SIZE / 2) return true;

  if (d > profile.range + PLAYER_SIZE / 2) return false;

  const facingX = Math.cos(angle || 0);
  const facingY = Math.sin(angle || 0);
  const forward = dx * facingX + dy * facingY;
  if (forward < 0 || forward > profile.range + PLAYER_SIZE / 2) return false;

  const perp = Math.abs(dx * facingY - dy * facingX);
  const targetAngle = Math.atan2(dy, dx);
  const inCone = angleDiff(targetAngle, angle || 0) <= profile.arc / 2;
  const inCapsule = perp <= ATTACK_SIDE_RADIUS + PLAYER_SIZE / 2;

  // Tone-down from the old giga-hitbox: the target must be inside the front cone
  // AND inside the narrow swipe capsule. No more "barely in the wedge so I die" nonsense.
  return inCone && inCapsule;
}

function survivorInAttackSwipe(killer, survivor, profile) {
  const samples = killer.attackType === "lunge"
    ? [
        { x: killer.attackSweepStartX || killer.x, y: killer.attackSweepStartY || killer.y },
        { x: (killer.x + (killer.attackSweepStartX || killer.x)) / 2, y: (killer.y + (killer.attackSweepStartY || killer.y)) / 2 },
        { x: killer.x, y: killer.y }
      ]
    : [{ x: killer.x, y: killer.y }];

  return samples.some((p) => pointInAttackSwipe(p.x, p.y, killer.angle || 0, survivor, profile));
}

function resolveKillerAttackHit(game, killer) {
  if (!killer.attackState || killer.attackHasHit) return;
  const profile = attackProfile(killer.attackType || killer.attackState);
  const survivors = [...game.actors.values()]
    .filter((p) => p.role === "survivor" && !p.dead && !p.escaped && !p.hooked && !p.downed && p.invuln <= 0)
    .sort((a, b) => dist(killer.x, killer.y, a.x, a.y) - dist(killer.x, killer.y, b.x, b.y));

  for (const survivor of survivors) {
    if (!survivorInAttackSwipe(killer, survivor, profile)) continue;
    if (!attackSegmentClear(game, killer.x, killer.y, survivor.x, survivor.y)) continue;
    if (damageSurvivor(game, killer, survivor)) {
      // End the active hit window once the swing connects, then enter slowdown.
      finishKillerAttack(killer);
      return;
    }
  }
}

function updateKillerAttack(game, killer, dt) {
  if (!killer || killer.dead) return;

  if (killer.input.attackReleased) killer.attackNeedsRelease = false;

  if (killer.actionLock > 0 || killer.vault || killer.breakTarget) {
    killer.attackState = null;
    killer.attackType = null;
    killer.attackCharge = 0;
    return;
  }

  if (killer.attackState === "quick" || killer.attackState === "lunge") {
    killer.attackTimer += dt;
    if (killer.attackTimer >= (killer.attackStartup || 0)) resolveKillerAttackHit(game, killer);
    if (killer.attackState && killer.attackTimer >= killer.attackDuration) finishKillerAttack(killer);
    return;
  }

  if (killer.recovery > 0 || killer.attackCooldown > 0) {
    killer.attackCharge = 0;
    if (!killer.input.attackHeld) killer.attackNeedsRelease = false;
    return;
  }

  if (killer.attackNeedsRelease) {
    killer.attackCharge = 0;
    if (!killer.input.attackHeld) killer.attackNeedsRelease = false;
    return;
  }

  if (killer.input.attackHeld) {
    killer.attackState = "charging";
    killer.attackCharge += dt;
    if (killer.attackCharge >= LUNGE_CHARGE_TIME) startKillerAttack(game, killer, "lunge");
    return;
  }

  if (killer.input.attackReleased || killer.input.attack) {
    startKillerAttack(game, killer, "quick");
    return;
  }

  killer.attackState = null;
  killer.attackCharge = 0;
}

function updateTimers(game, dt) {
  for (const actor of game.actors.values()) {
    actor.invuln = Math.max(0, actor.invuln - dt);
    actor.hitBoost = Math.max(0, actor.hitBoost - dt);
    actor.recovery = Math.max(0, actor.recovery - dt);
    actor.attackCooldown = Math.max(0, actor.attackCooldown - dt);
    actor.chaseHold = Math.max(0, actor.chaseHold - dt);
    actor.killerVisibleHold = Math.max(0, (actor.killerVisibleHold || 0) - dt);
    actor.palletGraceTime = Math.max(0, actor.palletGraceTime - dt);
    if (actor.palletGraceTime <= 0) actor.palletGraceId = null;
  }
  for (let i = game.scratchMarks.length - 1; i >= 0; i--) {
    game.scratchMarks[i].ttl -= dt;
    if (game.scratchMarks[i].ttl <= 0) game.scratchMarks.splice(i, 1);
  }
}


function randomFloorHookSpot(game) {
  const tile = game.map.tile;
  const candidates = [];
  for (let y = 1; y < game.map.rows - 1; y++) {
    for (let x = 1; x < game.map.cols - 1; x++) {
      if (game.map.rawRows[y]?.[x] !== ".") continue;
      const p = tileCenter(game, x, y);
      const tooCloseToExisting = (game.map.hooks || []).some((h) => h.active && dist(h.x, h.y, p.x, p.y) < tile * 3);
      if (tooCloseToExisting) continue;
      const nearObjective = [...game.map.generators, ...game.map.gates].some((o) => dist(o.x, o.y, p.x, p.y) < tile * 1.4);
      if (nearObjective) continue;
      candidates.push(p);
    }
  }
  const list = candidates.length ? candidates : [{ x: game.map.width / 2, y: game.map.height / 2 }];
  return list[Math.floor(Math.random() * list.length)];
}

function releasePositionNearHook(game, hook, survivor) {
  const tile = game.map.tile;
  const offsets = [
    { x: tile * 0.72, y: 0 },
    { x: -tile * 0.72, y: 0 },
    { x: 0, y: tile * 0.72 },
    { x: 0, y: -tile * 0.72 },
    { x: tile * 0.72, y: tile * 0.72 },
    { x: -tile * 0.72, y: tile * 0.72 },
    { x: tile * 0.72, y: -tile * 0.72 },
    { x: -tile * 0.72, y: -tile * 0.72 }
  ];
  for (const o of offsets) {
    const x = clamp(hook.x + o.x, 44, game.map.width - 44);
    const y = clamp(hook.y + o.y, 44, game.map.height - 44);
    if (!wouldCollide(game, survivor, x, y)) return { x, y };
  }
  return { x: hook.x, y: hook.y };
}

function nearestDownedSurvivorForHook(game, killer) {
  if (!killer || killer.role !== "killer" || killer.dead || killer.escaped) return null;

  return [...game.actors.values()]
    .filter((target) => target.role === "survivor" && target.downed && !target.hooked && !target.dead && !target.escaped && target.health <= 0)
    .filter((target) => dist(killer.x, killer.y, target.x, target.y) <= HOOK_INTERACT_DISTANCE)
    // Hooking is a pickup/channel interaction, not an attack. Walls should block it,
    // but dropped pallets and windows should not silently cancel it when the killer is standing on the body.
    .filter((target) => segmentClear(game, killer.x, killer.y, target.x, target.y))
    .sort((a, b) => dist(killer.x, killer.y, a.x, a.y) - dist(killer.x, killer.y, b.x, b.y))[0] || null;
}

function nearestHookedSurvivorForRescue(game, healer) {
  if (!healer || healer.role !== "survivor" || healer.dead || healer.escaped || healer.downed || healer.hooked) return null;
  return [...game.actors.values()]
    .filter((target) => target.id !== healer.id && target.role === "survivor" && target.hooked && !target.dead && !target.escaped)
    .filter((target) => dist(healer.x, healer.y, target.x, target.y) <= HOOK_RESCUE_DISTANCE)
    .filter((target) => segmentClear(game, healer.x, healer.y, target.x, target.y))
    .sort((a, b) => dist(healer.x, healer.y, a.x, a.y) - dist(healer.x, healer.y, b.x, b.y))[0] || null;
}

function sendSurvivorToHook(game, survivor) {
  const spot = randomFloorHookSpot(game);
  const hook = {
    id: uid("hook"),
    x: spot.x,
    y: spot.y,
    survivorId: survivor.id,
    active: true
  };
  game.map.hooks.push(hook);
  survivor.x = hook.x;
  survivor.y = hook.y;
  survivor.hooked = true;
  survivor.downed = true;
  survivor.hookId = hook.id;
  survivor.hookCount = (survivor.hookCount || 0) + 1;
  survivor.hookProgress = 0;
  survivor.unhookProgress = 0;
  survivor.healProgress = 0;
  survivor.activeHealers = [];
  survivor.healingTargetId = null;
  survivor.input.up = survivor.input.down = survivor.input.left = survivor.input.right = false;
  addEvent(game, "hooked", { x: hook.x, y: hook.y, survivorId: survivor.id, hookId: hook.id, hookCount: survivor.hookCount });
}

function executeSurvivor(game, survivor) {
  const oldHook = survivor.hookId ? game.map.hooks.find((h) => h.id === survivor.hookId) : null;
  if (oldHook) oldHook.active = false;
  survivor.dead = true;
  survivor.downed = false;
  survivor.hooked = false;
  survivor.hookId = null;
  survivor.health = 0;
  survivor.injured = true;
  survivor.invuln = 0;
  survivor.hitBoost = 0;
  survivor.healProgress = 0;
  survivor.hookProgress = 0;
  survivor.unhookProgress = 0;
  survivor.activeHealers = [];
  survivor.healingTargetId = null;
  survivor.input.up = survivor.input.down = survivor.input.left = survivor.input.right = false;
  addEvent(game, "execute", { x: survivor.x, y: survivor.y, survivorId: survivor.id });
}

function freeSurvivorFromHook(game, survivor) {
  const hook = game.map.hooks.find((h) => h.id === survivor.hookId);
  if (hook) hook.active = false;
  const pos = hook ? releasePositionNearHook(game, hook, survivor) : { x: survivor.x, y: survivor.y };
  survivor.x = pos.x;
  survivor.y = pos.y;
  survivor.hooked = false;
  survivor.downed = false;
  survivor.hookId = null;
  survivor.health = 1;
  survivor.injured = true;
  survivor.invuln = SURVIVOR_INVULN;
  survivor.hitBoost = SURVIVOR_HIT_BOOST * 0.55;
  survivor.hookProgress = 0;
  survivor.unhookProgress = 0;
  survivor.activeHealers = [];
  addEvent(game, "unhooked", { x: survivor.x, y: survivor.y, survivorId: survivor.id });
}

function updateHookInteractions(game, dt) {
  for (const actor of game.actors.values()) {
    actor.hookActionTargetId = null;
    actor.hookActionType = null;
    actor.unhookTargetId = null;
  }

  const activeHookTargets = new Set();
  const activeUnhookTargets = new Set();
  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);

  if (killer && killer.input.repair && !killer.vault && !killer.breakTarget && !killer.attackState && killer.actionLock <= 0) {
    const target = nearestDownedSurvivorForHook(game, killer);
    if (target) {
      killer.hookActionTargetId = target.id;
      killer.input.up = killer.input.down = killer.input.left = killer.input.right = false;
      killer.input.sprint = false;
      killer.input.angle = Math.atan2(target.y - killer.y, target.x - killer.x);

      // Keep the downed survivor from crawling out of the pickup channel. Without this,
      // bots can inch away during the hold and make E feel like it is doing nothing.
      target.input.up = target.input.down = target.input.left = target.input.right = false;
      target.input.sprint = false;

      const shouldExecute = (target.hookCount || 0) >= HOOKS_BEFORE_EXECUTION;
      killer.hookActionType = shouldExecute ? "execute" : "hook";
      const channelTime = shouldExecute ? EXECUTE_CHANNEL_TIME : HOOK_CHANNEL_TIME;
      target.hookProgress = clamp((target.hookProgress || 0) + dt / channelTime, 0, 1);
      activeHookTargets.add(target.id);
      if (target.hookProgress >= 1) {
        if (shouldExecute) executeSurvivor(game, target);
        else sendSurvivorToHook(game, target);
      }
    }
  }

  for (const healer of game.actors.values()) {
    if (healer.role !== "survivor" || healer.dead || healer.escaped || healer.downed || healer.hooked) continue;
    if (!healer.input.repair || healer.input.sprint || healer.vault || healer.actionLock > 0) continue;
    const target = nearestHookedSurvivorForRescue(game, healer);
    if (!target) continue;
    healer.unhookTargetId = target.id;
    healer.input.up = healer.input.down = healer.input.left = healer.input.right = false;
    healer.input.angle = Math.atan2(target.y - healer.y, target.x - healer.x);
    target.unhookProgress = clamp((target.unhookProgress || 0) + dt / UNHOOK_TIME, 0, 1);
    activeUnhookTargets.add(target.id);
    if (target.unhookProgress >= 1) freeSurvivorFromHook(game, target);
  }

  for (const target of game.actors.values()) {
    if (target.role !== "survivor") continue;
    if (target.downed && !target.hooked && !activeHookTargets.has(target.id)) target.hookProgress = Math.max(0, (target.hookProgress || 0) - dt * 0.45);
    if (target.hooked && !activeUnhookTargets.has(target.id)) target.unhookProgress = Math.max(0, (target.unhookProgress || 0) - dt * 0.35);
    if (!target.downed) target.hookProgress = 0;
    if (!target.hooked) target.unhookProgress = 0;
  }
}

function nearestHealTarget(game, healer) {
  if (!healer || healer.role !== "survivor" || healer.dead || healer.escaped || healer.downed || healer.hooked) return null;
  return [...game.actors.values()]
    .filter((target) => target.id !== healer.id && target.role === "survivor" && !target.dead && !target.escaped && !target.hooked)
    .filter((target) => !target.healingTargetId)
    .filter((target) => target.health === 1 && target.injured || (target.downed && target.health <= 0))
    .filter((target) => !target.vault && !target.input.sprint)
    .filter((target) => dist(healer.x, healer.y, target.x, target.y) <= HEAL_DISTANCE)
    .filter((target) => segmentClear(game, healer.x, healer.y, target.x, target.y))
    .sort((a, b) => dist(healer.x, healer.y, a.x, a.y) - dist(healer.x, healer.y, b.x, b.y))[0] || null;
}

function updateHealing(game, dt) {
  for (const actor of game.actors.values()) {
    actor.activeHealers = [];
    actor.healingTargetId = null;
  }

  const activeHealTargets = new Set();

  for (const healer of game.actors.values()) {
    if (healer.role !== "survivor" || healer.dead || healer.escaped || healer.downed || healer.hooked) continue;
    if (activeHealTargets.has(healer.id)) continue; // Being healed means no healing others this tick.
    if (!healer.input.repair || healer.input.sprint || healer.vault || healer.actionLock > 0) continue;
    const target = nearestHealTarget(game, healer);
    if (!target || activeHealTargets.has(target.id)) continue;

    healer.healingTargetId = target.id;
    healer.input.up = false;
    healer.input.down = false;
    healer.input.left = false;
    healer.input.right = false;
    healer.input.sprint = false;
    healer.input.angle = Math.atan2(target.y - healer.y, target.x - healer.x);

    // A survivor being healed cannot simultaneously repair or heal someone else.
    target.input.repair = false;
    target.input.sprint = false;
    target.healingTargetId = null;
    target.activeHealers.push(healer.id);
    activeHealTargets.add(target.id);

    target.healProgress = clamp((target.healProgress || 0) + dt / HEAL_TIME, 0, 1);
  }

  for (const target of game.actors.values()) {
    if (target.role !== "survivor") continue;
    const canBeHealed = !target.dead && !target.escaped && !target.hooked && ((target.downed && target.health <= 0) || (target.health === 1 && target.injured));
    if (!canBeHealed) {
      target.healProgress = 0;
      target.activeHealers = [];
      continue;
    }

    if (target.activeHealers.length > 0 && target.healProgress >= 1) {
      if (target.downed) {
        target.downed = false;
        target.health = 1;
        target.injured = true;
        target.invuln = Math.max(target.invuln || 0, SURVIVOR_INVULN * 0.65);
        target.hitBoost = Math.max(target.hitBoost || 0, SURVIVOR_HIT_BOOST * 0.55);
        target.hookProgress = 0;
      } else {
        target.health = 2;
        target.injured = false;
        target.invuln = 0;
      }
      target.healProgress = 0;
      target.activeHealers = [];
      addEvent(game, "healDone", { x: target.x, y: target.y, survivorId: target.id });
    } else if (target.activeHealers.length === 0) {
      target.healProgress = Math.max(0, (target.healProgress || 0) - dt * 0.08);
    }
  }
}


function nearestKickableGenerator(game, killer) {
  if (!killer || killer.role !== "killer" || killer.dead || killer.escaped) return null;
  let best = null;
  let bestD2 = Infinity;
  const maxD = INTERACT_DISTANCE + 10;
  const maxD2 = maxD * maxD;
  for (const gen of game.map.generators) {
    if (gen.done || gen.progress <= 0.001 || gen.kickLocked) continue;
    const dx = killer.x - gen.x;
    const dy = killer.y - gen.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > maxD2 || d2 >= bestD2) continue;
    if (!segmentClear(game, killer.x, killer.y, gen.x, gen.y)) continue;
    best = gen;
    bestD2 = d2;
  }
  return best;
}

function resetGeneratorKick(killer) {
  if (!killer) return;
  killer.generatorKickTargetId = null;
  killer.generatorKickChannelId = null;
  killer.generatorKickProgress = 0;
}

function updateGeneratorKicks(game, dt) {
  for (const gen of game.map.generators) {
    gen.beingKicked = false;
    gen.kickProgress = Math.max(0, (gen.kickProgress || 0) - dt * 1.8);
  }

  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);
  if (!killer) return;

  killer.generatorKickTargetId = null;

  const busy = killer.vault || killer.breakTarget || killer.attackState || killer.actionLock > 0 || killer.hookActionTargetId;
  if (!killer.input.repair || busy) {
    resetGeneratorKick(killer);
    return;
  }

  const gen = nearestKickableGenerator(game, killer);
  if (!gen) {
    resetGeneratorKick(killer);
    return;
  }

  if (killer.generatorKickChannelId !== gen.id) {
    killer.generatorKickChannelId = gen.id;
    killer.generatorKickProgress = 0;
  }

  killer.generatorKickTargetId = gen.id;
  killer.input.up = killer.input.down = killer.input.left = killer.input.right = false;
  killer.input.sprint = false;
  killer.input.angle = Math.atan2(gen.y - killer.y, gen.x - killer.x);

  killer.generatorKickProgress = clamp((killer.generatorKickProgress || 0) + dt / GENERATOR_KICK_TIME, 0, 1);
  gen.beingKicked = true;
  gen.kickProgress = killer.generatorKickProgress;

  if (killer.generatorKickProgress >= 1) {
    const oldProgress = gen.progress;
    gen.progress = clamp(gen.progress - GENERATOR_KICK_REGRESSION, 0, 1);
    // A kicked generator cannot be kicked again until survivors work on it.
    gen.kickLocked = true;
    gen.beingKicked = false;
    gen.kickProgress = 0;
    addEvent(game, "genKick", { x: gen.x, y: gen.y, generatorId: gen.id, oldProgress, progress: gen.progress });
    resetGeneratorKick(killer);
  }
}

function updateGeneratorsAndGates(game, dt) {
  for (const gen of game.map.generators) gen.activeRepairers = [];

  for (const actor of game.actors.values()) {
    if (actor.role !== "survivor" || actor.dead || actor.escaped || actor.downed || actor.hooked) continue;
    if (actor.healingTargetId || actor.unhookTargetId || (actor.activeHealers && actor.activeHealers.length > 0)) continue;
    if (!actor.input.repair || actor.input.sprint) continue;
    let gen = null;
    let bestD2 = INTERACT_DISTANCE * INTERACT_DISTANCE;
    for (const candidate of game.map.generators) {
      if (candidate.done) continue;
      const dx = actor.x - candidate.x;
      const dy = actor.y - candidate.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        gen = candidate;
        bestD2 = d2;
      }
    }
    if (gen) {
      const oldProgress = gen.progress;
      gen.progress = clamp(gen.progress + dt / GENERATOR_REPAIR_TIME, 0, 1);
      if (gen.progress > oldProgress) {
        // Survivors touched the gen again, so the killer can kick it once more later.
        gen.kickLocked = false;
      }
      gen.activeRepairers.push(actor.id);
      if (gen.progress >= 1 && !gen.done) {
        gen.done = true;
        addEvent(game, "genDone", { x: gen.x, y: gen.y });
      }
    }
  }

  const doneCount = game.map.generators.filter((g) => g.done).length;
  if (game.map.generators.length > 0 && doneCount >= game.requiredGenerators) {
    game.escapeOpen = true;
    for (const gate of game.map.gates) gate.open = true;
  }

  for (const actor of game.actors.values()) {
    if (actor.role !== "survivor" || actor.dead || actor.escaped || actor.downed || actor.hooked || !game.escapeOpen) continue;
    if (actor.healingTargetId || actor.unhookTargetId || (actor.activeHealers && actor.activeHealers.length > 0)) continue;
    const gate = game.map.gates.find((g) => dist(actor.x, actor.y, g.x, g.y) < INTERACT_DISTANCE);
    if (gate && actor.input.repair) {
      actor.escapeProgress = (actor.escapeProgress || 0) + dt;
      if (actor.escapeProgress >= GATE_ESCAPE_TIME) {
        actor.escaped = true;
        addEvent(game, "escape", { x: actor.x, y: actor.y, survivorId: actor.id });
      }
    } else {
      actor.escapeProgress = 0;
    }
  }
}

function updateChaseState(game, dt) {
  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);
  if (!killer) return;

  for (const survivor of game.actors.values()) {
    if (survivor.role !== "survivor" || survivor.dead || survivor.escaped || survivor.downed || survivor.hooked) continue;

    const d = dist(killer.x, killer.y, survivor.x, survivor.y);
    const los = segmentClear(game, killer.x, killer.y, survivor.x, survivor.y);
    const killerLooking = coneSees(killer, survivor, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE);
    const killerMoving = Math.abs(killer.input.up - killer.input.down) + Math.abs(killer.input.left - killer.input.right) > 0;

    // Start chase only when the killer actually sees the survivor.
    const startsChase = d <= CHASE_START_RADIUS && los && killerLooking && killerMoving;

    // Once chase has started, keep it alive while the killer is still meaningfully on them.
    // Windows and pallets do not block this, but walls do. When this stops being true,
    // chaseHold counts down for three seconds and the layer_3 music fades out.
    const closePressure = d <= CLOSE_REVEAL_RADIUS * 2.4;
    const keepsChase = survivor.chaseHold > 0 && los && d <= TERROR_RADIUS && (killerLooking || closePressure);

    if (startsChase || keepsChase) {
      survivor.chaseHold = CHASE_HOLD_SECONDS;
    }

    // Music-only memory: if the survivor sees the killer during chase, keep the high chase
    // layer for a few seconds after they look away, until they spot the killer again.
    // This is intentionally separate from chaseHold so audio can be dramatic without
    // changing chase rules, visibility, or win conditions.
    const survivorCanSeeKiller = survivor.chaseHold > 0 && isActorVisibleToViewer(game, survivor, killer);
    if (survivorCanSeeKiller) {
      survivor.killerVisibleHold = CHASE_HOLD_SECONDS;
    }
  }
}

function checkWinConditions(lobby) {
  const game = lobby.game;
  if (!game || game.phase !== "game") return;
  const survivors = [...game.actors.values()].filter((p) => p.role === "survivor");
  const doneGens = game.map.generators.reduce((count, g) => count + (g.done ? 1 : 0), 0);

  if (survivors.length && survivors.every((p) => p.escaped)) {
    endGame(lobby, "survivors", "All survivors escaped.");
    return;
  }

  if (survivors.length && survivors.every((p) => p.dead || p.hooked || p.escaped) && survivors.some((p) => p.dead || p.hooked)) {
    endGame(lobby, "killer", "All remaining survivors are hooked or dead.");
    return;
  }

  if (game.map.generators.length > 0 && doneGens >= game.requiredGenerators) {
    endGame(lobby, "survivors", "All generators are complete.");
  }
}

function endGame(lobby, winner, reason) {
  if (!lobby.game || lobby.game.phase === "ended") return;
  lobby.game.phase = "ended";
  lobby.game.endedAt = nowMs();
  lobby.game.winner = winner;
  lobby.game.endReason = reason;
  lobby.phase = "ended";
  io.to(lobby.id).emit("matchEnded", { winner, reason });
  broadcastLobbyState(lobby);
  broadcastLobbyList();
}



function resetInput(input) {
  input.up = false;
  input.down = false;
  input.left = false;
  input.right = false;
  input.sprint = false;
  input.action = false;
  input.repair = false;
  input.attack = false;
  input.attackHeld = false;
  input.attackReleased = false;
  input.actionDir = null;
}

function setMoveToward(actor, tx, ty, sprint = false) {
  const dx = tx - actor.x;
  const dy = ty - actor.y;
  actor.input.left = dx < -8;
  actor.input.right = dx > 8;
  actor.input.up = dy < -8;
  actor.input.down = dy > 8;
  actor.input.sprint = !!sprint;
  actor.input.angle = Math.atan2(dy, dx);
}

function setMoveAway(actor, fromX, fromY, sprint = true) {
  const dx = actor.x - fromX;
  const dy = actor.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  setMoveToward(actor, actor.x + (dx / len) * 300, actor.y + (dy / len) * 300, sprint);
}

function botRandomRepath() {
  return BOT_REPATH_MIN + Math.random() * (BOT_REPATH_MAX - BOT_REPATH_MIN);
}

function tileAt(game, x, y) {
  return {
    x: clamp(Math.floor(x / game.map.tile), 0, game.map.cols - 1),
    y: clamp(Math.floor(y / game.map.tile), 0, game.map.rows - 1)
  };
}

function tileCenter(game, tx, ty) {
  return {
    x: tx * game.map.tile + game.map.tile / 2,
    y: ty * game.map.tile + game.map.tile / 2
  };
}

function isWallTile(game, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= game.map.cols || ty >= game.map.rows) return true;
  return game.map.rawRows[ty]?.[tx] === "X";
}

function isDroppedPalletTile(game, tx, ty) {
  return game.map.pallets.some((p) => !p.broken && p.state === "dropped" && p.tileX === tx && p.tileY === ty);
}

function isPathTileBlocked(game, tx, ty, role) {
  if (isWallTile(game, tx, ty)) return true;
  // Windows and dropped pallets are intentionally allowed in bot paths. The bot will
  // vault or break them when it reaches the interaction range instead of walking
  // around every useful loop forever like a confused office printer.
  return false;
}

function findPath(game, actor, targetX, targetY, options = {}) {
  const role = options.role || actor.role;
  const start = tileAt(game, actor.x, actor.y);
  const goal = tileAt(game, targetX, targetY);
  const key = (x, y) => `${x},${y}`;
  if (isPathTileBlocked(game, goal.x, goal.y, role)) return [];
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);
  if (startKey === goalKey) return [tileCenter(game, goal.x, goal.y)];
  if (dist(actor.x, actor.y, targetX, targetY) < game.map.tile * 6 && segmentClear(game, actor.x, actor.y, targetX, targetY)) {
    return [{ x: targetX, y: targetY }];
  }

  const open = [{ x: start.x, y: start.y, f: 0, g: 0 }];
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const seen = new Set();
  let loops = 0;

  function h(x, y) {
    return Math.abs(x - goal.x) + Math.abs(y - goal.y);
  }

  while (open.length && loops++ < 950) {
    let bestIndex = 0;
    let bestF = open[0].f;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < bestF) {
        bestF = open[i].f;
        bestIndex = i;
      }
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = key(current.x, current.y);
    if (seen.has(currentKey)) continue;
    seen.add(currentKey);

    if (currentKey === goalKey) {
      const tiles = [];
      let k = currentKey;
      while (k) {
        const [x, y] = k.split(",").map(Number);
        tiles.push(tileCenter(game, x, y));
        k = cameFrom.get(k);
      }
      tiles.reverse();
      return tiles;
    }

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 }
    ];

    for (const n of neighbors) {
      if (isPathTileBlocked(game, n.x, n.y, role)) continue;
      const nk = key(n.x, n.y);
      if (seen.has(nk)) continue;
      const passableButSlower = isDroppedPalletTile(game, n.x, n.y) ? 3.5 : 1;
      const tentative = (gScore.get(currentKey) ?? Infinity) + passableButSlower;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, currentKey);
        gScore.set(nk, tentative);
        open.push({ x: n.x, y: n.y, g: tentative, f: tentative + h(n.x, n.y) });
      }
    }
  }
  return [];
}

function followPath(game, actor, targetX, targetY, sprint = false, options = {}) {
  const bot = actor.bot;
  bot.repath -= 1 / TICK_RATE;
  const targetChanged = dist(bot.goalX || 0, bot.goalY || 0, targetX, targetY) > game.map.tile * 0.6;
  if (!bot.path?.length || bot.repath <= 0 || targetChanged) {
    bot.goalX = targetX;
    bot.goalY = targetY;
    bot.path = findPath(game, actor, targetX, targetY, { role: actor.role });
    bot.repath = botRandomRepath();
  }

  if (!bot.path?.length) {
    setMoveToward(actor, targetX, targetY, sprint);
    return;
  }

  while (bot.path.length > 1 && dist(actor.x, actor.y, bot.path[0].x, bot.path[0].y) < game.map.tile * 0.28) {
    bot.path.shift();
  }

  const next = bot.path[Math.min(1, bot.path.length - 1)] || bot.path[0];
  setMoveToward(actor, next.x, next.y, sprint);

  // If the next node is a vault/window/pallet tile and we're close, interact with it.
  // Killers do NOT auto-vault from generic pathing anymore. That caused bot killers
  // to ping-pong between windows. Killer interaction is handled tactically in
  // updateBotInputs() where we know whether the obstacle actually helps the chase.
  const allowAutoInteract = actor.role === "survivor" || options.allowKillerInteract === true;
  if (!allowAutoInteract) return;

  const hit = nearestInteractable(game, actor, actor.role === "survivor");
  if (hit && actor.bot.actionCooldown <= 0) {
    const tactical = hit.type === "window" || hit.type === "palletVault" || hit.type === "palletBreak";
    const objectId = hit.object?.id || `${hit.type}:${hit.object?.x}:${hit.object?.y}`;
    const recentlyUsed = actor.bot.lastInteractableId === objectId && game.time < (actor.bot.lastInteractableUntil || 0);
    if (!recentlyUsed && tactical && dist(actor.x, actor.y, hit.object.x + hit.object.w / 2, hit.object.y + hit.object.h / 2) <= INTERACT_DISTANCE) {
      actor.input.action = true;
      actor.bot.actionCooldown = actor.role === "killer" ? BOT_KILLER_INTERACT_COOLDOWN : 0.18;
      actor.bot.lastInteractableId = objectId;
      actor.bot.lastInteractableUntil = game.time + (actor.role === "killer" ? BOT_KILLER_WINDOW_REUSE_COOLDOWN : 0.55);
    }
  }
}

function nearestLivingSurvivor(game, actor) {
  let best = null;
  let bestDist = Infinity;
  for (const p of game.actors.values()) {
    if (p.role !== "survivor" || p.dead || p.escaped || p.hooked) continue;
    const d = dist(actor.x, actor.y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function visibleSurvivorsForKiller(game, killer) {
  const visible = [];
  for (const p of game.actors.values()) {
    if (p.role !== "survivor" || p.dead || p.escaped || p.hooked) continue;
    const d = dist(killer.x, killer.y, p.x, p.y);
    const los = segmentClear(game, killer.x, killer.y, p.x, p.y);
    if (!los) continue;
    if (d <= CLOSE_REVEAL_RADIUS || coneSees(killer, p, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE)) {
      visible.push({ survivor: p, d });
    }
  }
  return visible;
}

function chooseKillerTarget(game, killer) {
  let target = null;
  let bestDist = Infinity;
  for (const item of visibleSurvivorsForKiller(game, killer)) {
    if (item.d < bestDist) {
      bestDist = item.d;
      target = item.survivor;
    }
  }

  if (target) {
    killer.bot.targetId = target.id;
    killer.bot.lastSeenX = target.x;
    killer.bot.lastSeenY = target.y;
    killer.bot.lastSeenTime = game.time;
    return { actor: target, x: target.x, y: target.y, visible: true };
  }

  const remembered = killer.bot.targetId ? game.actors.get(killer.bot.targetId) : null;
  if (remembered && !remembered.dead && !remembered.escaped && !remembered.hooked && game.time - killer.bot.lastSeenTime < BOT_KILLER_MEMORY_SECONDS) {
    return { actor: remembered, x: killer.bot.lastSeenX, y: killer.bot.lastSeenY, visible: false };
  }

  let scratch = null;
  let scratchDist = Infinity;
  for (const s of game.scratchMarks) {
    if (s.ttl <= 0 || game.time - (s.createdAt || 0) >= BOT_KILLER_SCRATCH_MEMORY_SECONDS) continue;
    const d = dist(killer.x, killer.y, s.x, s.y);
    if (d < scratchDist) {
      scratchDist = d;
      scratch = s;
    }
  }
  if (scratch) return { actor: null, x: scratch.x, y: scratch.y, visible: false };

  const nearest = nearestLivingSurvivor(game, killer);
  if (nearest) return { actor: nearest, x: nearest.x, y: nearest.y, visible: false };
  return null;
}


function botKillerCanStartAttack(killer) {
  return killer
    && killer.attackCooldown <= 0
    && killer.recovery <= 0
    && !killer.attackState
    && !killer.vault
    && !killer.breakTarget
    && killer.actionLock <= 0;
}

function botTargetIsInFacingArc(killer, target, arc = ATTACK_ARC * 1.15) {
  if (!killer || !target) return false;
  const angleToTarget = Math.atan2(target.y - killer.y, target.x - killer.x);
  return angleDiff(angleToTarget, killer.angle || 0) <= arc / 2;
}

function botFaceTarget(killer, target) {
  if (!killer || !target) return;
  const angleToTarget = Math.atan2(target.y - killer.y, target.x - killer.x);
  killer.input.angle = angleToTarget;
  killer.angle = angleToTarget;
}

function botShouldVaultWindow(game, killer, target, hit, hasClearAttack, targetDistance) {
  if (!hit || hit.type !== "window" || !target) return false;
  if (targetDistance < QUICK_ATTACK_RANGE * 1.15 && hasClearAttack) return false;

  const objectId = hit.object?.id || `window:${hit.object?.x}:${hit.object?.y}`;
  if (killer.bot.lastInteractableId === objectId && game.time < (killer.bot.lastInteractableUntil || 0)) return false;

  const c = centerOf(hit.object);
  if (dist(killer.x, killer.y, c.x, c.y) > INTERACT_DISTANCE) return false;

  const windowBetweenKillerAndTarget = segmentClearAgainst([hit.object], killer.x, killer.y, target.x, target.y) === false;
  const targetNearWindow = dist(target.x, target.y, c.x, c.y) < game.map.tile * 1.7;
  const attackBlockedAndClose = !hasClearAttack && targetDistance < 360;

  // Only vault when the survivor is actually using the window/loop or the window is
  // what blocks a near attack. Otherwise keep pathing around and committing to chase.
  return (windowBetweenKillerAndTarget && targetNearWindow) || attackBlockedAndClose;
}

function botUseKillerObstacle(game, killer, target, hit, hasClearAttack, targetDistance) {
  if (!hit || killer.bot.actionCooldown > 0) return false;
  const objectId = hit.object?.id || `${hit.type}:${hit.object?.x}:${hit.object?.y}`;
  if (killer.bot.lastInteractableId === objectId && game.time < (killer.bot.lastInteractableUntil || 0)) return false;

  if (hit.type === "palletBreak") {
    const c = centerOf(hit.object);
    // Break pallets aggressively if they block a close chase or are directly in front
    // of the target path. This gets the killer out of loop purgatory.
    const shouldBreak = !hasClearAttack || targetDistance < 430 || dist(target.x, target.y, c.x, c.y) < game.map.tile * 2.4;
    if (shouldBreak) {
      killer.input.action = true;
      killer.bot.actionCooldown = 1.0;
      killer.bot.lastInteractableId = objectId;
      killer.bot.lastInteractableUntil = game.time + 1.1;
      return true;
    }
  }

  if (botShouldVaultWindow(game, killer, target, hit, hasClearAttack, targetDistance)) {
    killer.input.action = true;
    killer.bot.actionCooldown = BOT_KILLER_INTERACT_COOLDOWN;
    killer.bot.lastInteractableId = objectId;
    killer.bot.lastInteractableUntil = game.time + BOT_KILLER_WINDOW_REUSE_COOLDOWN;
    return true;
  }

  return false;
}

function botSetAttackIntent(game, killer, target, targetDistance, hasClearAttack) {
  if (!target || !hasClearAttack) return false;

  // Finish an existing charge/lunge instead of releasing and re-pressing every bot tick.
  if (killer.attackState === "charging") {
    killer.input.attackHeld = true;
    botFaceTarget(killer, target);
    return true;
  }

  if (!botKillerCanStartAttack(killer)) return false;

  botFaceTarget(killer, target);

  const targetInFront = botTargetIsInFacingArc(killer, target, ATTACK_ARC * 1.08);
  const huggingTarget = targetDistance <= ATTACK_CLOSE_AOE_RADIUS + PLAYER_SIZE * 0.55;
  if (!targetInFront && !huggingTarget) return false;

  // Only quick swing when the survivor is truly close. Otherwise hold M1 for lunge
  // when the distance is appropriate. This prevents the bot from spamming tiny whiffs.
  const quickRange = QUICK_ATTACK_RANGE * 0.62;
  const lungeMin = QUICK_ATTACK_RANGE * 0.72;
  const lungeMax = LUNGE_ATTACK_RANGE * 0.92;

  if (targetDistance <= quickRange || huggingTarget) {
    killer.input.attackReleased = true;
    return true;
  }

  if (targetDistance >= lungeMin && targetDistance <= lungeMax) {
    killer.input.attackHeld = true;
    return true;
  }

  return false;
}

function chooseFleePoint(game, survivor, killer) {
  const actorTile = tileAt(game, survivor.x, survivor.y);
  let best = { x: survivor.x, y: survivor.y, score: -Infinity };
  const radius = 5;

  for (let ty = actorTile.y - radius; ty <= actorTile.y + radius; ty++) {
    for (let tx = actorTile.x - radius; tx <= actorTile.x + radius; tx++) {
      if (isPathTileBlocked(game, tx, ty, survivor.role)) continue;
      const p = tileCenter(game, tx, ty);
      const distanceFromKiller = dist(p.x, p.y, killer.x, killer.y);
      const distanceFromSelf = dist(p.x, p.y, survivor.x, survivor.y);
      if (distanceFromSelf < game.map.tile * 1.5) continue;
      const breaksLos = !segmentClear(game, killer.x, killer.y, p.x, p.y);
      const towardMapCenter = -dist(p.x, p.y, game.map.width / 2, game.map.height / 2) * 0.04;
      const score = distanceFromKiller + (breaksLos ? 260 : 0) - distanceFromSelf * 0.22 + towardMapCenter;
      if (score > best.score) best = { x: p.x, y: p.y, score };
    }
  }
  return best;
}

function botShouldDropPallet(game, survivor, killer, hit) {
  if (!hit || hit.type !== "palletDrop") return false;
  const killerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  if (killerDistance > BOT_SURVIVOR_PANIC_RADIUS) return false;
  // Drop if the killer is behind/near the survivor and not on the survivor's escape side.
  return segmentClear(game, survivor.x, survivor.y, killer.x, killer.y) || killerDistance < 190;
}

function botUseLoopObject(game, survivor, killer) {
  if (!killer || survivor.bot.actionCooldown > 0) return false;
  const hit = nearestInteractable(game, survivor, true);
  if (!hit) return false;
  const killerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  if ((hit.type === "window" || hit.type === "palletVault") && killerDistance < BOT_SURVIVOR_LOOP_RADIUS) {
    survivor.input.action = true;
    survivor.bot.actionCooldown = 0.22;
    return true;
  }
  if (botShouldDropPallet(game, survivor, killer, hit)) {
    const md = movementDirection(survivor.input);
    if (Math.abs(md.dx) > Math.abs(md.dy)) survivor.input.actionDir = md.dx < 0 ? "left" : "right";
    else if (md.dy !== 0) survivor.input.actionDir = md.dy < 0 ? "up" : "down";
    survivor.input.action = true;
    survivor.bot.actionCooldown = 0.35;
    return true;
  }
  return false;
}

function botMoveToObjective(game, actor) {
  if (game.escapeOpen && game.map.gates.length) {
    const gate = [...game.map.gates].sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0];
    followPath(game, actor, gate.x, gate.y, true);
    if (dist(actor.x, actor.y, gate.x, gate.y) < INTERACT_DISTANCE) actor.input.repair = true;
    return;
  }


  const hookedAlly = [...game.actors.values()]
    .filter((p) => p.id !== actor.id && p.role === "survivor" && !p.dead && !p.escaped && p.hooked)
    .sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0];
  if (hookedAlly) {
    if (dist(actor.x, actor.y, hookedAlly.x, hookedAlly.y) <= HOOK_RESCUE_DISTANCE && segmentClear(game, actor.x, actor.y, hookedAlly.x, hookedAlly.y)) {
      actor.input.repair = true;
      actor.input.angle = Math.atan2(hookedAlly.y - actor.y, hookedAlly.x - actor.x);
    } else {
      followPath(game, actor, hookedAlly.x, hookedAlly.y, true);
    }
    return;
  }

  const injuredAlly = [...game.actors.values()]
    .filter((p) => p.id !== actor.id && p.role === "survivor" && !p.dead && !p.escaped && !p.hooked && ((p.downed && p.health <= 0) || (!p.downed && p.health === 1 && p.injured)))
    .sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0];
  if (injuredAlly && dist(actor.x, actor.y, injuredAlly.x, injuredAlly.y) < 620) {
    if (dist(actor.x, actor.y, injuredAlly.x, injuredAlly.y) <= HEAL_DISTANCE && segmentClear(game, actor.x, actor.y, injuredAlly.x, injuredAlly.y)) {
      actor.input.repair = true;
      actor.input.angle = Math.atan2(injuredAlly.y - actor.y, injuredAlly.x - actor.x);
    } else {
      followPath(game, actor, injuredAlly.x, injuredAlly.y, false);
    }
    return;
  }

  const gen = game.map.generators
    .filter((g) => !g.done)
    .sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0];

  if (gen) {
    if (dist(actor.x, actor.y, gen.x, gen.y) < INTERACT_DISTANCE && segmentClear(game, actor.x, actor.y, gen.x, gen.y)) {
      actor.input.repair = true;
      actor.input.angle = Math.atan2(gen.y - actor.y, gen.x - actor.x);
    } else {
      followPath(game, actor, gen.x, gen.y, false);
    }
  }
}

function updateBotInputs(game, dt) {
  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);

  for (const actor of game.actors.values()) {
    if (!actor.isBot || actor.dead || actor.escaped || actor.hooked || actor.downed) continue;
    resetInput(actor.input);
    actor.bot.actionCooldown = Math.max(0, actor.bot.actionCooldown - dt);

    if (actor.role === "killer") {
      const downedTarget = nearestDownedSurvivorForHook(game, actor);
      if (downedTarget) {
        actor.input.repair = true;
        actor.input.angle = Math.atan2(downedTarget.y - actor.y, downedTarget.x - actor.x);
        continue;
      }

      const target = chooseKillerTarget(game, actor);
      if (!target) continue;

      if (target.actor && target.actor.downed && !target.actor.hooked) {
        followPath(game, actor, target.actor.x, target.actor.y, false);
        if (dist(actor.x, actor.y, target.actor.x, target.actor.y) <= HOOK_INTERACT_DISTANCE) actor.input.repair = true;
        continue;
      }

      if (target.actor) botFaceTarget(actor, target.actor);
      else actor.input.angle = Math.atan2(target.y - actor.y, target.x - actor.x);

      const targetDistance = dist(actor.x, actor.y, target.x, target.y);
      const hasClearAttack = target.actor && attackSegmentClear(game, actor.x, actor.y, target.actor.x, target.actor.y);
      const attacking = target.actor && botSetAttackIntent(game, actor, target.actor, targetDistance, hasClearAttack);

      if (!attacking) {
        followPath(game, actor, target.x, target.y, false, { allowKillerInteract: false });
      }

      const hit = target.actor ? nearestInteractable(game, actor, false) : null;
      if (target.actor && !attacking) {
        botUseKillerObstacle(game, actor, target.actor, hit, hasClearAttack, targetDistance);
      }
      continue;
    }

    if (actor.role === "survivor") {
      const killerDistance = killer && !killer.dead ? dist(actor.x, actor.y, killer.x, killer.y) : Infinity;
      const killerHasLos = killer && segmentClear(game, actor.x, actor.y, killer.x, killer.y);
      const threatened = killer && killerDistance < BOT_SURVIVOR_THREAT_RADIUS && (killerHasLos || actor.chaseHold > 0 || killerDistance < BOT_SURVIVOR_PANIC_RADIUS);

      if (threatened) {
        actor.bot.fleeTimer = Math.max(0, (actor.bot.fleeTimer || 0) - dt);
        if (actor.bot.fleeTimer <= 0 || !Number.isFinite(actor.bot.fleeX) || !Number.isFinite(actor.bot.fleeY)) {
          const flee = chooseFleePoint(game, actor, killer);
          actor.bot.fleeX = flee.x;
          actor.bot.fleeY = flee.y;
          actor.bot.fleeTimer = 0.34 + Math.random() * 0.16;
        }
        followPath(game, actor, actor.bot.fleeX, actor.bot.fleeY, true);
        botUseLoopObject(game, actor, killer);
        continue;
      }

      botMoveToObjective(game, actor);
    }
  }
}

function updateGame(lobby, dt) {
  const game = lobby.game;
  if (!game || game.phase !== "game") return;

  game.time = (game.time || 0) + dt;
  game.botThinkAccumulator = (game.botThinkAccumulator || 0) + dt;
  if (game.botThinkAccumulator >= 1 / BOT_THINK_RATE) {
    const botDt = game.botThinkAccumulator;
    game.botThinkAccumulator = 0;
    updateBotInputs(game, botDt);
  }
  updateTimers(game, dt);
  updateHookInteractions(game, dt);
  updateGeneratorKicks(game, dt);
  const killer = [...game.actors.values()].find((p) => p.role === "killer");
  for (const actor of game.actors.values()) moveActor(game, actor, dt);
  updateKillerAttack(game, killer, dt);
  for (const actor of game.actors.values()) {
    if (actor.input.action) handleAction(game, actor);
  }
  updateHealing(game, dt);
  updateGeneratorsAndGates(game, dt);
  updateChaseState(game, dt);
  checkWinConditions(lobby);

  for (const actor of game.actors.values()) {
    actor.input.action = false;
    actor.input.attack = false;
    actor.input.attackReleased = false;
  }
}

function isActorVisibleToViewer(game, viewer, actor) {
  if (!viewer || !actor) return false;
  if (viewer.id === actor.id) return true;
  if (actor.dead || actor.escaped) return false;

  const d = dist(viewer.x, viewer.y, actor.x, actor.y);
  const los = segmentClear(game, viewer.x, viewer.y, actor.x, actor.y);

  if (viewer.role === "survivor" && actor.role === "killer") {
    if (d <= CLOSE_REVEAL_RADIUS && los) return true;
    return los && coneSees(viewer, actor, SURVIVOR_CONE_LENGTH, SURVIVOR_CONE_ANGLE);
  }

  if (viewer.role === "killer" && actor.role === "survivor") {
    // Killers only see survivors through line of sight: inside their cone,
    // or extremely close, including right behind them. No global sprint/repair wallhack nonsense.
    if (!los) return false;
    if (d <= CLOSE_REVEAL_RADIUS) return true;
    return coneSees(viewer, actor, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE);
  }

  if (viewer.role === "survivor" && actor.role === "survivor") {
    return d < 1200 || los;
  }

  return true;
}

function serializeActor(game, actor, visible = true) {
  // Always send position, angle, and skin, even when the viewer cannot see this actor.
  // The client hides the sprite locally but keeps interpolating it, so reappearing actors
  // do not teleport from an old stale position. The fog may lie, the server does not.
  const actorSkin = actor.role === "survivor" ? sanitizeSkin(actor.skin) : "killerCircle";
  return {
    id: actor.id,
    name: actor.name,
    role: actor.role,
    skin: actorSkin,
    visible: !!visible,
    x: Number(actor.x.toFixed(2)),
    y: Number(actor.y.toFixed(2)),
    angle: actor.angle,
    health: actor.health,
    injured: actor.injured,
    dead: actor.dead,
    escaped: actor.escaped,
    downed: actor.downed,
    hooked: actor.hooked,
    hookId: actor.hookId,
    hookCount: actor.hookCount || 0,
    hookProgress: actor.hookProgress || 0,
    unhookProgress: actor.unhookProgress || 0,
    hookActionTargetId: actor.hookActionTargetId || null,
    hookActionType: actor.hookActionType || null,
    hookReadyTargetId: actor.role === "killer" ? (nearestDownedSurvivorForHook(game, actor)?.id || null) : null,
    generatorKickTargetId: actor.generatorKickTargetId || null,
    generatorKickProgress: actor.generatorKickProgress || 0,
    unhookTargetId: actor.unhookTargetId || null,
    recovery: actor.recovery,
    attackState: actor.attackState,
    attackType: actor.attackType,
    attackCharge: actor.attackCharge,
    attackTimer: actor.attackTimer,
    attackDuration: actor.attackDuration,
    attackStartup: actor.attackStartup,
    attacking: actor.attackState === "quick" || actor.attackState === "lunge",
    vaulting: !!actor.vault,
    breaking: !!actor.breakTarget,
    invuln: actor.invuln,
    hitBoost: actor.hitBoost,
    healProgress: actor.healProgress || 0,
    activeHealers: actor.activeHealers || [],
    healingTargetId: actor.healingTargetId || null,
    chase: actor.chaseHold > 0,
    killerVisibleHold: actor.killerVisibleHold || 0,
    chatText: actor.chatUntil > (game.time || 0) ? actor.chatText : null
  };
}

function buildSnapshotFor(lobby, socketId) {
  const game = lobby.game;
  const viewer = game.actors.get(socketId);
  const map = game.map;
  const actors = [];
  for (const actor of game.actors.values()) {
    actors.push(serializeActor(game, actor, isActorVisibleToViewer(game, viewer, actor)));
  }

  const killer = [...game.actors.values()].find((p) => p.role === "killer");
  let music = {
    layer1: MUSIC_LAYER_1_VOLUME,
    layer2: 0,
    layer3: 0,
    chase: false,
    terror: 0,
    distance: 9999,
    killerVisible: false,
    visibleHold: false
  };

  if (viewer && viewer.role === "survivor" && killer && !viewer.dead && !viewer.escaped) {
    const d = dist(viewer.x, viewer.y, killer.x, killer.y);
    const terror = clamp(1 - d / TERROR_RADIUS, 0, 1);
    const chase = viewer.chaseHold > 0;
    const killerVisible = isActorVisibleToViewer(game, viewer, killer);

    // Clean three-layer music ladder:
    // layer_1 = normal ambient when the survivor is safe / no meaningful terror pressure.
    // layer_2 = killer is nearby, but the survivor is NOT in chase.
    // layer_3 = survivor is in chase, regardless of whether the killer is currently on-screen.
    const nearbyNoChase = !chase && terror > 0;
    const terrorRamp = Math.pow(terror, 0.72);

    music = {
      layer1: chase ? 0 : MUSIC_LAYER_1_VOLUME * (nearbyNoChase ? clamp(1 - terrorRamp * 0.85, 0.15, 1) : 1),
      layer2: nearbyNoChase ? terrorRamp * MUSIC_LAYER_2_MAX_VOLUME : 0,
      layer3: chase ? MUSIC_LAYER_3_VOLUME : 0,
      chase,
      terror,
      distance: d,
      killerVisible,
      visibleHold: chase
    };
  }

  const visibleScratchMarks = viewer?.role === "killer"
    ? game.scratchMarks.filter((s) => {
        if (!viewer) return false;
        const d = dist(viewer.x, viewer.y, s.x, s.y);
        if (d > KILLER_SCRATCH_MARK_VISIBILITY_RANGE) return false;
        const target = { x: s.x, y: s.y };
        return coneSees(viewer, target, KILLER_SCRATCH_MARK_VISIBILITY_RANGE, KILLER_CONE_ANGLE) && segmentClear(game, viewer.x, viewer.y, s.x, s.y);
      })
    : game.scratchMarks.filter((s) => dist(viewer?.x || 0, viewer?.y || 0, s.x, s.y) < 180);

  const doneGenerators = map.generators.reduce((count, g) => count + (g.done ? 1 : 0), 0);
  const requiredGenerators = game.requiredGenerators;

  return {
    lobbyId: lobby.id,
    map: {
      width: map.width,
      height: map.height,
      tile: map.tile,
      pallets: map.pallets.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, orientation: p.orientation, state: p.state, broken: p.broken })),
      generators: map.generators.map((g) => ({ id: g.id, x: g.x, y: g.y, progress: g.progress, done: g.done, activeRepairers: g.activeRepairers, beingKicked: !!g.beingKicked, kickProgress: g.kickProgress || 0, kickLocked: !!g.kickLocked })),
      gates: map.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, open: g.open })),
      hooks: (map.hooks || []).filter((h) => h.active).map((h) => ({ id: h.id, x: h.x, y: h.y, survivorId: h.survivorId, active: h.active }))
    },
    phase: game.phase,
    winner: game.winner,
    endReason: game.endReason,
    viewerId: socketId,
    actors,
    events: game.events.slice(),
    scratchMarks: visibleScratchMarks.map((s) => ({ id: s.id, x: s.x, y: s.y, angle: s.angle, ttl: s.ttl })),
    objective: {
      doneGenerators,
      requiredGenerators,
      totalGenerators: map.generators.length,
      remainingGenerators: Math.max(0, requiredGenerators - doneGenerators),
      escapeOpen: game.escapeOpen
    },
    music
  };
}

function sendSnapshots() {
  for (const lobby of lobbies.values()) {
    if (!lobby.game) continue;
    for (const socketId of lobby.players.keys()) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.compress(false).volatile.emit("snapshot", buildSnapshotFor(lobby, socketId));
    }
    if (lobby.game.events.length) lobby.game.events.length = 0;
  }
}

setInterval(() => {
  const dt = 1 / TICK_RATE;
  for (const lobby of lobbies.values()) updateGame(lobby, dt);
}, 1000 / TICK_RATE);

setInterval(sendSnapshots, 1000 / SNAPSHOT_RATE);

io.on("connection", (socket) => {
  socket.emit("hello", { id: socket.id });
  socket.emit("lobbyList", [...lobbies.values()].map(getLobbySummary));

  socket.on("createLobby", ({ name, role, playerName, skin } = {}) => {
    const lobby = createLobby(name);
    joinLobby(socket, lobby, role, playerName, skin);
  });

  socket.on("joinLobby", ({ lobbyId, role, playerName, skin } = {}) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) {
      socket.emit("toast", { type: "error", message: "Lobby not found." });
      return;
    }
    joinLobby(socket, lobby, role, playerName, skin);
  });

  socket.on("quickJoin", ({ role, playerName, skin } = {}) => {
    const available = [...lobbies.values()].filter((l) => l.phase === "lobby");
    const roleValue = role === "killer" ? "killer" : "survivor";
    const lobby = available.find((l) => {
      const players = [...l.players.values()];
      if (roleValue === "killer") return !players.some((p) => p.role === "killer");
      return players.filter((p) => p.role === "survivor").length < MAX_SURVIVORS;
    }) || createLobby("Open Lobby");
    joinLobby(socket, lobby, roleValue, playerName, skin);
  });

  socket.on("leaveLobby", () => leaveCurrentLobby(socket));

  socket.on("setRole", ({ role, skin } = {}) => {
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || lobby.phase !== "lobby") return;
    const player = lobby.players.get(socket.id);
    if (!player) return;
    const nextRole = role === "killer" ? "killer" : "survivor";
    if (!canChangeRole(lobby, player, nextRole)) {
      socket.emit("toast", { type: "error", message: nextRole === "killer" ? "Killer is already taken." : "Survivor slots are full." });
      return;
    }
    player.role = nextRole;
    // If the player picked a survivor skin before switching back from killer,
    // preserve that choice instead of silently resetting them to blue square.
    player.skin = nextRole === "survivor" ? sanitizeSkin(skin || player.skin) : "killerCircle";
    player.ready = false;
    broadcastLobbyState(lobby);
    broadcastLobbyList();
  });

  socket.on("setSkin", ({ skin } = {}) => {
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || lobby.phase !== "lobby") return;
    const player = lobby.players.get(socket.id);
    if (!player || player.role !== "survivor") return;
    player.skin = sanitizeSkin(skin);
    player.ready = false;
    broadcastLobbyState(lobby);
  });

  socket.on("setReady", ({ ready } = {}) => {
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || lobby.phase !== "lobby") return;
    const player = lobby.players.get(socket.id);
    if (!player) return;
    player.ready = !!ready;
    broadcastLobbyState(lobby);
  });

  socket.on("addBot", ({ role } = {}) => {
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby) return;
    const result = addBotToLobby(lobby, role);
    if (!result.ok) {
      socket.emit("toast", { type: "error", message: result.message });
      return;
    }
    broadcastLobbyState(lobby);
    broadcastLobbyList();
  });

  socket.on("startGame", () => {
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby) return;
    startGame(lobby);
  });

  socket.on("input", (input = {}) => {
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || !lobby.game) return;
    const actor = lobby.game.actors.get(socket.id);
    if (!actor) return;
    actor.input.up = !!input.up;
    actor.input.down = !!input.down;
    actor.input.left = !!input.left;
    actor.input.right = !!input.right;
    actor.input.sprint = actor.role === "survivor" && !!input.sprint;
    actor.input.repair = !!input.repair;
    actor.input.action = actor.input.action || !!input.action;
    if (["up", "down", "left", "right"].includes(input.actionDir)) actor.input.actionDir = input.actionDir;
    if (actor.role === "killer") {
      actor.input.attack = actor.input.attack || !!input.attack;
      actor.input.attackHeld = !!input.attackHeld;
      actor.input.attackReleased = actor.input.attackReleased || !!input.attackReleased;
    }
    if (Number.isFinite(input.angle)) actor.input.angle = input.angle;
  });

  socket.on("chatWheel", (payload = {}) => {
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
    const actor = lobby.game.actors.get(socket.id);
    if (!actor || actor.dead || actor.escaped) return;
    const messages = getChatWheelMessagesForActor(actor);
    const index = Number.isInteger(payload.index) ? payload.index : Math.floor(Number(payload.index));
    if (!Number.isInteger(index) || index < 0 || index >= messages.length) return;
    actor.chatText = messages[index];
    actor.chatUntil = (lobby.game.time || 0) + CHAT_MESSAGE_DURATION;
  });

  socket.on("backToLobby", () => {
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby) return;
    if (lobby.phase === "ended") {
      lobby.phase = "lobby";
      lobby.game = null;
      for (const p of lobby.players.values()) p.ready = false;
      broadcastLobbyState(lobby);
      broadcastLobbyList();
    }
  });

  socket.on("disconnect", () => leaveCurrentLobby(socket));
});

server.listen(PORT, () => {
  console.log(`survive.io running at http://localhost:${PORT}`);
});
