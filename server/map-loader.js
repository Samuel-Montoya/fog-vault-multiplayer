const GAME_MAPS = require("../../public/maps.js");
const CONFIG = require("../shared/config.js");
const { uid } = require("./utils.js");

function normalizeRows(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(width, "."));
}

function orientationForWindow(rows, x, y) {
  const left = rows[y]?.[x - 1] === "X";
  const right = rows[y]?.[x + 1] === "X";
  const up = rows[y - 1]?.[x] === "X";
  const down = rows[y + 1]?.[x] === "X";
  if ((left || right) && !(up && down)) return "horizontal";
  if ((up || down) && !(left && right)) return "vertical";
  return left || right ? "horizontal" : "vertical";
}

function activeMapDefinition() {
  return GAME_MAPS[GAME_MAPS.active] || GAME_MAPS.bloodyard || Object.values(GAME_MAPS).find((m) => m && m.rows);
}

function parseMap(mapDef = activeMapDefinition()) {
  const rows = normalizeRows(mapDef.rows);
  const tile = mapDef.tile || CONFIG.map.defaultTile;
  const map = {
    id: uid("map"),
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
    floorTiles: [],
    survivorSpawns: [],
    killerSpawns: []
  };

  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      const rx = x * tile;
      const ry = y * tile;
      const base = { id: uid("tile"), x: rx, y: ry, w: tile, h: tile, tileX: x, tileY: y };
      if (ch === ".") map.floorTiles.push({ x: rx + tile / 2, y: ry + tile / 2, tileX: x, tileY: y });
      if (ch === "X") map.walls.push({ ...base, id: uid("wall") });
      if (ch === "+") map.windows.push({ ...base, id: uid("window"), orientation: orientationForWindow(rows, x, y) });
      if (ch === "-") map.pallets.push({ ...base, id: uid("pallet"), orientation: "horizontal", state: "upright", broken: false });
      if (ch === "|") map.pallets.push({ ...base, id: uid("pallet"), orientation: "vertical", state: "upright", broken: false });
      if (ch === "G") map.generators.push({ id: uid("gen"), x: rx + tile / 2, y: ry + tile / 2, progress: 0, done: false });
      if (ch === "E") map.gates.push({ id: uid("gate"), x: rx + tile / 2, y: ry + tile / 2, open: false });
      if (ch === "P") map.survivorSpawns.push({ x: rx + tile / 2, y: ry + tile / 2 });
      if (ch === "K") map.killerSpawns.push({ x: rx + tile / 2, y: ry + tile / 2 });
    }
  }

  if (!map.floorTiles.length) {
    for (let y = 1; y < rows.length - 1; y++) {
      for (let x = 1; x < rows[y].length - 1; x++) {
        if (rows[y][x] !== "X") map.floorTiles.push({ x: x * tile + tile / 2, y: y * tile + tile / 2, tileX: x, tileY: y });
      }
    }
  }
  if (!map.survivorSpawns.length) map.survivorSpawns.push({ x: tile * 2, y: tile * 2 });
  if (!map.killerSpawns.length) map.killerSpawns.push({ x: map.width - tile * 3, y: map.height - tile * 3 });
  return map;
}

function publicMapState(map, actors = []) {
  const actorList = Array.from(actors || []);
  const channelActors = actorList.filter((actor) => actor.channel);
  return {
    id: map.id,
    name: map.name,
    tile: map.tile,
    cols: map.cols,
    rows: map.rows,
    width: map.width,
    height: map.height,
    walls: map.walls,
    windows: map.windows,
    pallets: map.pallets.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, orientation: p.orientation, state: p.state, broken: p.broken })),
    generators: map.generators.map((g) => {
      const repairers = channelActors.filter((actor) => actor.channel.type === "repair" && actor.channel.targetId === g.id);
      const kicker = channelActors.find((actor) => actor.channel.type === "kickGen" && actor.channel.targetId === g.id);
      return {
        id: g.id,
        x: g.x,
        y: g.y,
        progress: g.progress,
        done: g.done,
        repairingCount: repairers.length,
        beingRepaired: repairers.length > 0,
        beingKicked: !!kicker,
        kickProgress: kicker ? Math.min(1, kicker.channel.t / kicker.channel.duration) : 0
      };
    }),
    gates: map.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, open: g.open })),
    hooks: map.hooks.map((h) => ({ id: h.id, x: h.x, y: h.y, survivorId: h.survivorId }))
  };
}

module.exports = { parseMap, publicMapState };
