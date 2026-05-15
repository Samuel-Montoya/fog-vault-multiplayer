const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const GAME_MAPS = require("./public/maps.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.static(PUBLIC_DIR));
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const TICK_RATE = 60;
const SNAPSHOT_RATE = 30;
const MAX_SURVIVORS = 4;
const PLAYER_SIZE = 30;
const KILLER_SIZE = 38;
const INTERACT_DISTANCE = 74;
const HIT_RANGE = 64;
const TOUCH_HIT_RANGE = 32;
const ATTACK_ARC = Math.PI * 0.62;
const SURVIVOR_WALK_SPEED = 170;
const SURVIVOR_SPRINT_SPEED = 285;
const SURVIVOR_HIT_BURST_SPEED = 350;
const KILLER_SPEED = 310;
const KILLER_RECOVERY_SPEED_MULT = 0.28;
const KILLER_MISS_RECOVERY = 1.15;
const KILLER_HIT_RECOVERY = 1.65;
const KILLER_ATTACK_COOLDOWN = 0.7;
const SURVIVOR_INVULN = 1.45;
const SURVIVOR_HIT_BOOST = 1.0;
const SURVIVOR_VAULT_TIME = 0.38;
const KILLER_VAULT_TIME = 1.05;
const KILLER_BREAK_TIME = 1.25;
const GENERATOR_REPAIR_TIME = 12.0;
const GATE_ESCAPE_TIME = 0.75;
const TERROR_RADIUS = 760;
const CHASE_START_RADIUS = 520;
const CHASE_HOLD_SECONDS = 3;
const CLOSE_REVEAL_RADIUS = 180;
const SURVIVOR_CONE_LENGTH = 620;
const SURVIVOR_CONE_ANGLE = Math.PI / 2.6;
const KILLER_CONE_LENGTH = 850;
const KILLER_CONE_ANGLE = Math.PI / 1.8;

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
      if (ch === "G") map.generators.push({ id: uid("gen"), x: rx + tile / 2, y: ry + tile / 2, progress: 0, done: false, activeRepairers: [] });
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
  return solidRects(game).some((r) => rectsOverlap(box, r));
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

function makePlayer(socket, role, name) {
  return {
    id: socket.id,
    name: String(name || "Player").slice(0, 18),
    role,
    ready: false,
    x: 0,
    y: 0,
    angle: 0,
    health: role === "survivor" ? 2 : 999,
    dead: false,
    escaped: false,
    injured: false,
    invuln: 0,
    hitBoost: 0,
    recovery: 0,
    actionLock: 0,
    vault: null,
    breakTarget: null,
    attackCooldown: 0,
    swingTime: 0,
    chaseHold: 0,
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      sprint: false,
      action: false,
      repair: false,
      attack: false,
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

function joinLobby(socket, lobby, requestedRole, name) {
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

  const player = makePlayer(socket, role, name);
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

  if (lobby.players.size === 0) {
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
    players: [...lobby.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, ready: p.ready }))
  });
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
    requiredGenerators: map.generators.length,
    escapeOpen: false
  };

  let survivorSpawnIndex = 0;
  for (const player of players) {
    const actor = makePlayer({ id: player.id }, player.role, player.name);
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
    gates: map.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, open: g.open }))
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
  game.scratchMarks.push({ id: uid("scratch"), x: actor.x, y: actor.y, angle: actor.angle + (Math.random() - 0.5), ttl: 4.0 });
  if (game.scratchMarks.length > 180) game.scratchMarks.splice(0, game.scratchMarks.length - 180);
}

function moveActor(game, actor, dt) {
  if (actor.dead || actor.escaped) return;

  actor.angle = Number.isFinite(actor.input.angle) ? actor.input.angle : actor.angle;

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

  let speed = actor.role === "killer" ? KILLER_SPEED : (actor.input.sprint ? SURVIVOR_SPRINT_SPEED : SURVIVOR_WALK_SPEED);
  if (actor.role === "survivor" && actor.hitBoost > 0) speed = SURVIVOR_HIT_BURST_SPEED;
  if (actor.role === "killer" && actor.recovery > 0) speed *= KILLER_RECOVERY_SPEED_MULT;

  const nextX = clamp(actor.x + dx * speed * dt, 36, game.map.width - 36);
  const nextY = clamp(actor.y + dy * speed * dt, 36, game.map.height - 36);

  if (!wouldCollide(game, actor, nextX, actor.y)) actor.x = nextX;
  if (!wouldCollide(game, actor, actor.x, nextY)) actor.y = nextY;

  if (actor.role === "survivor" && actor.input.sprint && (Math.abs(dx) + Math.abs(dy) > 0.05)) {
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

function startVault(game, actor, object) {
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
  addEvent(game, "vault", { x: c.x, y: c.y, role: actor.role });
}

function moveToNearestSafeSide(actor, pallet, tile) {
  const c = centerOf(pallet);
  const gap = tile * 0.48 + PLAYER_SIZE * 0.65;
  if (pallet.orientation === "horizontal") {
    actor.x = clamp(actor.x, pallet.x + PLAYER_SIZE, pallet.x + pallet.w - PLAYER_SIZE);
    actor.y = actor.y < c.y ? c.y - gap : c.y + gap;
  } else {
    actor.x = actor.x < c.x ? c.x - gap : c.x + gap;
    actor.y = clamp(actor.y, pallet.y + PLAYER_SIZE, pallet.y + pallet.h - PLAYER_SIZE);
  }
}

function handleAction(game, actor) {
  if (actor.dead || actor.escaped || actor.vault || actor.breakTarget || actor.actionLock > 0) return;
  const hit = nearestInteractable(game, actor, actor.role === "survivor");
  if (!hit) return;

  if (hit.type === "window" || hit.type === "palletVault") {
    startVault(game, actor, hit.object);
  } else if (hit.type === "palletDrop") {
    moveToNearestSafeSide(actor, hit.object, game.map.tile);
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
  if (!survivor || survivor.dead || survivor.escaped || survivor.invuln > 0) return false;
  survivor.health -= 1;
  survivor.injured = survivor.health === 1;
  survivor.invuln = SURVIVOR_INVULN;
  survivor.hitBoost = SURVIVOR_HIT_BOOST;
  killer.recovery = Math.max(killer.recovery, KILLER_HIT_RECOVERY);
  killer.attackCooldown = Math.max(killer.attackCooldown, KILLER_ATTACK_COOLDOWN);
  addEvent(game, "hit", { x: survivor.x, y: survivor.y, survivorId: survivor.id, health: survivor.health });

  if (survivor.health <= 0) {
    survivor.dead = true;
    survivor.health = 0;
    addEvent(game, "death", { x: survivor.x, y: survivor.y, survivorId: survivor.id });
  }
  return true;
}

function handleKillerAttack(game, killer) {
  if (!killer || killer.dead || killer.actionLock > 0 || killer.vault || killer.breakTarget) return;

  const survivors = [...game.actors.values()].filter((p) => p.role === "survivor" && !p.dead && !p.escaped);
  for (const survivor of survivors) {
    if (dist(killer.x, killer.y, survivor.x, survivor.y) < TOUCH_HIT_RANGE + PLAYER_SIZE * 0.5) {
      if (killer.attackCooldown <= 0) damageSurvivor(game, killer, survivor);
      return;
    }
  }

  if (!killer.input.attack || killer.attackCooldown > 0 || killer.recovery > 0) return;

  killer.attackCooldown = KILLER_ATTACK_COOLDOWN;
  killer.recovery = KILLER_MISS_RECOVERY;
  addEvent(game, "swing", { x: killer.x, y: killer.y, angle: killer.angle });

  for (const survivor of survivors) {
    const d = dist(killer.x, killer.y, survivor.x, survivor.y);
    if (d > HIT_RANGE) continue;
    const a = Math.atan2(survivor.y - killer.y, survivor.x - killer.x);
    if (angleDiff(a, killer.angle) > ATTACK_ARC / 2) continue;
    if (!attackSegmentClear(game, killer.x, killer.y, survivor.x, survivor.y)) continue;
    damageSurvivor(game, killer, survivor);
    break;
  }
}

function updateTimers(game, dt) {
  for (const actor of game.actors.values()) {
    actor.invuln = Math.max(0, actor.invuln - dt);
    actor.hitBoost = Math.max(0, actor.hitBoost - dt);
    actor.recovery = Math.max(0, actor.recovery - dt);
    actor.attackCooldown = Math.max(0, actor.attackCooldown - dt);
    actor.chaseHold = Math.max(0, actor.chaseHold - dt);
  }
  for (const s of game.scratchMarks) s.ttl -= dt;
  game.scratchMarks = game.scratchMarks.filter((s) => s.ttl > 0);
}

function updateGeneratorsAndGates(game, dt) {
  for (const gen of game.map.generators) gen.activeRepairers = [];

  for (const actor of game.actors.values()) {
    if (actor.role !== "survivor" || actor.dead || actor.escaped) continue;
    if (!actor.input.repair || actor.input.sprint) continue;
    const gen = game.map.generators
      .filter((g) => !g.done)
      .sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y))[0];
    if (gen && dist(actor.x, actor.y, gen.x, gen.y) < INTERACT_DISTANCE) {
      gen.progress = clamp(gen.progress + dt / GENERATOR_REPAIR_TIME, 0, 1);
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
    if (actor.role !== "survivor" || actor.dead || actor.escaped || !game.escapeOpen) continue;
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
    if (survivor.role !== "survivor" || survivor.dead || survivor.escaped) continue;

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
  }
}

function checkWinConditions(lobby) {
  const game = lobby.game;
  if (!game || game.phase !== "game") return;
  const survivors = [...game.actors.values()].filter((p) => p.role === "survivor");
  const activeSurvivors = survivors.filter((p) => !p.dead && !p.escaped);
  const doneGens = game.map.generators.filter((g) => g.done).length;

  if (survivors.length && survivors.every((p) => p.dead)) {
    endGame(lobby, "killer", "All survivors are dead.");
    return;
  }

  if (survivors.length && activeSurvivors.length === 0 && survivors.some((p) => p.escaped)) {
    endGame(lobby, "survivors", "All remaining survivors escaped.");
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

function updateGame(lobby, dt) {
  const game = lobby.game;
  if (!game || game.phase !== "game") return;

  updateTimers(game, dt);
  for (const actor of game.actors.values()) moveActor(game, actor, dt);
  for (const actor of game.actors.values()) {
    if (actor.input.action) handleAction(game, actor);
  }
  const killer = [...game.actors.values()].find((p) => p.role === "killer");
  handleKillerAttack(game, killer);
  updateGeneratorsAndGates(game, dt);
  updateChaseState(game, dt);
  checkWinConditions(lobby);

  for (const actor of game.actors.values()) {
    actor.input.action = false;
    actor.input.attack = false;
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
    // Killer player visibility is strictly line-of-sight based. No seeing survivors through walls
    // just because they sprinted, repaired, sneezed, or offended the fog gods.
    if (!los) return false;
    if (d <= CLOSE_REVEAL_RADIUS) return true;
    if (actor.input?.sprint && d < 900) return true;
    if (actor.input?.repair && d < 700) return true;
    return coneSees(viewer, actor, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE);
  }

  if (viewer.role === "survivor" && actor.role === "survivor") {
    return d < 1200 || los;
  }

  return true;
}

function serializeActor(actor, visible = true) {
  if (!visible) {
    return { id: actor.id, role: actor.role, visible: false, dead: actor.dead, escaped: actor.escaped, name: actor.name };
  }
  return {
    id: actor.id,
    name: actor.name,
    role: actor.role,
    visible: true,
    x: Number(actor.x.toFixed(2)),
    y: Number(actor.y.toFixed(2)),
    angle: actor.angle,
    health: actor.health,
    injured: actor.injured,
    dead: actor.dead,
    escaped: actor.escaped,
    recovery: actor.recovery,
    vaulting: !!actor.vault,
    breaking: !!actor.breakTarget,
    invuln: actor.invuln,
    hitBoost: actor.hitBoost,
    chase: actor.chaseHold > 0
  };
}

function buildSnapshotFor(lobby, socketId) {
  const game = lobby.game;
  const viewer = game.actors.get(socketId);
  const map = game.map;
  const actors = [];
  for (const actor of game.actors.values()) {
    actors.push(serializeActor(actor, isActorVisibleToViewer(game, viewer, actor)));
  }

  const killer = [...game.actors.values()].find((p) => p.role === "killer");
  let music = { layer1: 0.45, layer2: 0, layer3: 0, chase: false, terror: 0, distance: 9999 };
  if (viewer && viewer.role === "survivor" && killer && !viewer.dead && !viewer.escaped) {
    const d = dist(viewer.x, viewer.y, killer.x, killer.y);
    const terror = clamp(1 - d / TERROR_RADIUS, 0, 1);
    const chase = viewer.chaseHold > 0;
    music = {
      layer1: 0.45,
      layer2: chase ? Math.max(0.22, terror * 0.58) : terror * 0.72,
      layer3: chase ? 0.95 : 0,
      chase,
      terror,
      distance: d
    };
  }

  const visibleScratchMarks = viewer?.role === "killer"
    ? game.scratchMarks
    : game.scratchMarks.filter((s) => dist(viewer?.x || 0, viewer?.y || 0, s.x, s.y) < 180);

  return {
    lobbyId: lobby.id,
    map: {
      width: map.width,
      height: map.height,
      tile: map.tile,
      pallets: map.pallets.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, orientation: p.orientation, state: p.state, broken: p.broken })),
      generators: map.generators.map((g) => ({ id: g.id, x: g.x, y: g.y, progress: g.progress, done: g.done, activeRepairers: g.activeRepairers })),
      gates: map.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, open: g.open }))
    },
    phase: game.phase,
    winner: game.winner,
    endReason: game.endReason,
    viewerId: socketId,
    actors,
    events: game.events.slice(),
    scratchMarks: visibleScratchMarks.map((s) => ({ id: s.id, x: s.x, y: s.y, angle: s.angle, ttl: s.ttl })),
    objective: {
      doneGenerators: map.generators.filter((g) => g.done).length,
      totalGenerators: map.generators.length,
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
      if (socket) socket.emit("snapshot", buildSnapshotFor(lobby, socketId));
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

  socket.on("createLobby", ({ name, role, playerName } = {}) => {
    const lobby = createLobby(name);
    joinLobby(socket, lobby, role, playerName);
  });

  socket.on("joinLobby", ({ lobbyId, role, playerName } = {}) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) {
      socket.emit("toast", { type: "error", message: "Lobby not found." });
      return;
    }
    joinLobby(socket, lobby, role, playerName);
  });

  socket.on("quickJoin", ({ role, playerName } = {}) => {
    const available = [...lobbies.values()].filter((l) => l.phase === "lobby");
    const roleValue = role === "killer" ? "killer" : "survivor";
    const lobby = available.find((l) => {
      const players = [...l.players.values()];
      if (roleValue === "killer") return !players.some((p) => p.role === "killer");
      return players.filter((p) => p.role === "survivor").length < MAX_SURVIVORS;
    }) || createLobby("Open Lobby");
    joinLobby(socket, lobby, roleValue, playerName);
  });

  socket.on("leaveLobby", () => leaveCurrentLobby(socket));

  socket.on("setRole", ({ role } = {}) => {
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
    player.ready = false;
    broadcastLobbyState(lobby);
    broadcastLobbyList();
  });

  socket.on("setReady", ({ ready } = {}) => {
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || lobby.phase !== "lobby") return;
    const player = lobby.players.get(socket.id);
    if (!player) return;
    player.ready = !!ready;
    broadcastLobbyState(lobby);
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
    actor.input.repair = actor.role === "survivor" && !!input.repair;
    actor.input.action = actor.input.action || !!input.action;
    actor.input.attack = actor.input.attack || (actor.role === "killer" && !!input.attack);
    if (Number.isFinite(input.angle)) actor.input.angle = input.angle;
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
  console.log(`Fog Vault Multiplayer running at http://localhost:${PORT}`);
});
