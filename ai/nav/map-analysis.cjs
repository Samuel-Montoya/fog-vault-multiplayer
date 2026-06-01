"use strict";

const HARD_BLOCKERS = new Set(["X"]);
const FLOOR_SYMBOLS = new Set([".", "G", "P", "K", "E", "-", "|"]);
const CHASE_RESOURCE_SYMBOLS = new Set(["+", "-", "|"]);
const CARDINALS = [
  { dx: 1, dy: 0, id: "E" },
  { dx: -1, dy: 0, id: "W" },
  { dx: 0, dy: 1, id: "S" },
  { dx: 0, dy: -1, id: "N" }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function keyOf(x, y) {
  return `${x},${y}`;
}

function safeRows(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const width = source.reduce((max, row) => Math.max(max, String(row || "").length), 0);
  return source.map((row) => String(row || "").padEnd(width, "."));
}

function normalizeMap(mapId, map) {
  if (!map || typeof map !== "object") throw new Error(`Map ${mapId || "unknown"} is missing or invalid.`);
  const rows = safeRows(map.rows);
  const width = rows[0]?.length || 0;
  const height = rows.length;
  if (!width || !height) throw new Error(`Map ${mapId || map.name || "unknown"} has no rows.`);
  const tile = Number.isFinite(Number(map.tile)) ? Number(map.tile) : 72;
  return {
    id: String(mapId || map.id || map.name || "map"),
    name: String(map.name || mapId || "Unnamed Map"),
    tile,
    requiredGenerators: map.requiredGenerators,
    spawnedGenerators: map.spawnedGenerators,
    rows,
    width,
    height,
    widthPx: width * tile,
    heightPx: height * tile
  };
}

function inBounds(normalized, x, y) {
  return x >= 0 && y >= 0 && x < normalized.width && y < normalized.height;
}

function symbolAt(normalized, x, y) {
  if (!inBounds(normalized, x, y)) return "X";
  return normalized.rows[y][x] || ".";
}

function isWall(normalized, x, y) {
  return HARD_BLOCKERS.has(symbolAt(normalized, x, y));
}

function isWindow(normalized, x, y) {
  return symbolAt(normalized, x, y) === "+";
}

function isPallet(normalized, x, y) {
  const s = symbolAt(normalized, x, y);
  return s === "-" || s === "|";
}

function isNormalWalkable(normalized, x, y) {
  const s = symbolAt(normalized, x, y);
  // Windows are deliberately not normal-walkable. They are traversal resources.
  // Pallets are treated as walkable chase resources so runners can pass the line and drop.
  return FLOOR_SYMBOLS.has(s);
}

function isTraversalWalkable(normalized, x, y) {
  return !HARD_BLOCKERS.has(symbolAt(normalized, x, y));
}

function centerOfTile(normalized, x, y) {
  return {
    x: (x + 0.5) * normalized.tile,
    y: (y + 0.5) * normalized.tile,
    tileX: x,
    tileY: y
  };
}

function makeTile(normalized, x, y) {
  const symbol = symbolAt(normalized, x, y);
  const center = centerOfTile(normalized, x, y);
  return {
    x,
    y,
    key: keyOf(x, y),
    symbol,
    worldX: center.x,
    worldY: center.y,
    hardBlock: HARD_BLOCKERS.has(symbol),
    normalWalkable: isNormalWalkable(normalized, x, y),
    traversalWalkable: isTraversalWalkable(normalized, x, y),
    isWindow: symbol === "+",
    isPallet: symbol === "-" || symbol === "|",
    isRift: symbol === "G",
    isExit: symbol === "E",
    isSurvivorSpawn: symbol === "P",
    isKillerSpawn: symbol === "K"
  };
}

function buildGrid(normalized) {
  const tiles = [];
  const byKey = new Map();
  const matrix = [];
  for (let y = 0; y < normalized.height; y += 1) {
    const row = [];
    for (let x = 0; x < normalized.width; x += 1) {
      const tile = makeTile(normalized, x, y);
      row.push(tile);
      tiles.push(tile);
      byKey.set(tile.key, tile);
    }
    matrix.push(row);
  }
  return { tiles, byKey, matrix };
}

function neighborTiles(normalized, x, y, predicate = isNormalWalkable) {
  const out = [];
  for (const dir of CARDINALS) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (!inBounds(normalized, nx, ny)) continue;
    if (!predicate(normalized, nx, ny)) continue;
    out.push({ x: nx, y: ny, dir: dir.id });
  }
  return out;
}

function buildDistanceField(normalized, isSource, predicate = isNormalWalkable) {
  const distances = Array.from({ length: normalized.height }, () => Array(normalized.width).fill(Infinity));
  const queue = [];
  let head = 0;

  for (let y = 0; y < normalized.height; y += 1) {
    for (let x = 0; x < normalized.width; x += 1) {
      if (isSource(normalized, x, y)) {
        distances[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }

  while (head < queue.length) {
    const node = queue[head++];
    const base = distances[node.y][node.x];
    for (const dir of CARDINALS) {
      const nx = node.x + dir.dx;
      const ny = node.y + dir.dy;
      if (!inBounds(normalized, nx, ny)) continue;
      // We let distance spill through blockers so walkable cells next to walls receive distance 1.
      if (!predicate(normalized, nx, ny) && !isSource(normalized, nx, ny)) continue;
      if (distances[ny][nx] <= base + 1) continue;
      distances[ny][nx] = base + 1;
      queue.push({ x: nx, y: ny });
    }
  }

  return distances;
}

function analyzeClearance(normalized) {
  const wallDistance = buildDistanceField(normalized, (map, x, y) => isWall(map, x, y), () => true);
  const edgeDistance = Array.from({ length: normalized.height }, (_, y) => (
    Array.from({ length: normalized.width }, (_, x) => Math.min(x, y, normalized.width - 1 - x, normalized.height - 1 - y))
  ));

  const clearance = [];
  const edgeDanger = [];
  for (let y = 0; y < normalized.height; y += 1) {
    clearance[y] = [];
    edgeDanger[y] = [];
    for (let x = 0; x < normalized.width; x += 1) {
      const wall = wallDistance[y][x];
      const edge = edgeDistance[y][x];
      clearance[y][x] = isNormalWalkable(normalized, x, y) ? Math.max(0, Math.min(wall, 9)) : 0;
      edgeDanger[y][x] = isNormalWalkable(normalized, x, y)
        ? clamp(6 - Math.min(edge, 6), 0, 6)
        : 0;
    }
  }

  return { clearance, edgeDanger, wallDistance, edgeDistance };
}

function analyzeTopology(normalized, clearanceData) {
  const deadEnds = [];
  const junctions = [];
  const corners = [];
  const tileMeta = new Map();

  for (let y = 0; y < normalized.height; y += 1) {
    for (let x = 0; x < normalized.width; x += 1) {
      if (!isNormalWalkable(normalized, x, y)) continue;
      const neighbors = neighborTiles(normalized, x, y, isNormalWalkable);
      const degree = neighbors.length;
      const clearance = clearanceData.clearance[y][x] || 0;
      const edgeDanger = clearanceData.edgeDanger[y][x] || 0;
      const nearCorner = edgeDanger >= 4 && degree <= 2;
      const tightCorner = clearance <= 1 && degree <= 2;
      const meta = {
        x,
        y,
        key: keyOf(x, y),
        degree,
        clearance,
        edgeDanger,
        deadEndRisk: degree <= 1 ? 100 : degree === 2 && clearance <= 1 ? 45 : 0,
        cornerRisk: nearCorner ? 70 : tightCorner ? 45 : 0,
        openScore: degree * 12 + clearance * 8 - edgeDanger * 5
      };
      tileMeta.set(meta.key, meta);
      if (degree <= 1) deadEnds.push(meta);
      if (degree >= 3) junctions.push(meta);
      if (nearCorner || tightCorner) corners.push(meta);
    }
  }

  return { deadEnds, junctions, corners, tileMeta };
}

function collectResources(normalized, topology) {
  const windows = [];
  const pallets = [];
  const rifts = [];
  const exits = [];
  const survivorSpawns = [];
  const killerSpawns = [];

  for (let y = 0; y < normalized.height; y += 1) {
    for (let x = 0; x < normalized.width; x += 1) {
      const symbol = symbolAt(normalized, x, y);
      const center = centerOfTile(normalized, x, y);
      if (symbol === "+") windows.push(makeWindow(normalized, x, y, windows.length, topology));
      else if (symbol === "-" || symbol === "|") pallets.push(makePallet(normalized, x, y, pallets.length, topology));
      else if (symbol === "G") rifts.push({ id: `riftSpawn_${rifts.length + 1}`, type: "rift", ...center, key: keyOf(x, y), tileX: x, tileY: y, approach: bestNearbyStandable(normalized, x, y, topology) });
      else if (symbol === "E") exits.push({ id: `exit_${exits.length + 1}`, type: "exit", ...center, key: keyOf(x, y), tileX: x, tileY: y, approach: bestNearbyStandable(normalized, x, y, topology) });
      else if (symbol === "P") survivorSpawns.push({ id: `survivorSpawn_${survivorSpawns.length + 1}`, type: "survivorSpawn", ...center, key: keyOf(x, y), tileX: x, tileY: y });
      else if (symbol === "K") killerSpawns.push({ id: `killerSpawn_${killerSpawns.length + 1}`, type: "killerSpawn", ...center, key: keyOf(x, y), tileX: x, tileY: y });
    }
  }

  return { windows, pallets, rifts, exits, survivorSpawns, killerSpawns };
}

function walkablePoint(normalized, x, y, label) {
  if (!inBounds(normalized, x, y) || !isNormalWalkable(normalized, x, y)) return null;
  const center = centerOfTile(normalized, x, y);
  return { label, x: center.x, y: center.y, tileX: x, tileY: y, key: keyOf(x, y) };
}

function endpointFor(normalized, x, y, dx, dy, label) {
  const direct = walkablePoint(normalized, x + dx, y + dy, label);
  if (direct) return direct;
  // Some map resources sit in cramped wall runs. Probe a tiny fan around the expected side.
  const probes = [
    { x: x + dx * 2, y: y + dy },
    { x: x + dx, y: y + dy * 2 },
    { x: x + dx + (dy ? 1 : 0), y: y + dy + (dx ? 1 : 0) },
    { x: x + dx - (dy ? 1 : 0), y: y + dy - (dx ? 1 : 0) }
  ];
  for (const p of probes) {
    const candidate = walkablePoint(normalized, p.x, p.y, label);
    if (candidate) return candidate;
  }
  return null;
}

function detectWindowOrientation(normalized, x, y) {
  const leftRightWalls = isWall(normalized, x - 1, y) || isWall(normalized, x + 1, y);
  const upDownWalls = isWall(normalized, x, y - 1) || isWall(normalized, x, y + 1);
  if (leftRightWalls && !upDownWalls) return "horizontalWall";
  if (upDownWalls && !leftRightWalls) return "verticalWall";
  // Ambiguous windows default to whichever pair has usable floor sides.
  const northSouthUsable = isNormalWalkable(normalized, x, y - 1) || isNormalWalkable(normalized, x, y + 1);
  const eastWestUsable = isNormalWalkable(normalized, x - 1, y) || isNormalWalkable(normalized, x + 1, y);
  return northSouthUsable && !eastWestUsable ? "horizontalWall" : "verticalWall";
}

function resourceEndpointScore(endpoint, topology) {
  if (!endpoint) return 0;
  const meta = topology.tileMeta.get(endpoint.key);
  if (!meta) return 0;
  return meta.openScore - meta.deadEndRisk * 0.6 - meta.cornerRisk * 0.6;
}

function makeWindow(normalized, x, y, index, topology) {
  const orientation = detectWindowOrientation(normalized, x, y);
  const center = centerOfTile(normalized, x, y);
  const sideA = orientation === "horizontalWall"
    ? endpointFor(normalized, x, y, 0, -1, "north")
    : endpointFor(normalized, x, y, -1, 0, "west");
  const sideB = orientation === "horizontalWall"
    ? endpointFor(normalized, x, y, 0, 1, "south")
    : endpointFor(normalized, x, y, 1, 0, "east");
  const endpoints = [sideA, sideB].filter(Boolean);
  const scoreA = resourceEndpointScore(sideA, topology);
  const scoreB = resourceEndpointScore(sideB, topology);
  return {
    id: `window_${index + 1}`,
    type: "window",
    tileX: x,
    tileY: y,
    key: keyOf(x, y),
    x: center.x,
    y: center.y,
    orientation,
    traversalAxis: orientation === "horizontalWall" ? "vertical" : "horizontal",
    sideA,
    sideB,
    endpoints,
    loopScore: Math.max(scoreA, scoreB) + (endpoints.length === 2 ? 24 : -30),
    deadEndRisk: Math.max(0, 60 - Math.max(scoreA, scoreB))
  };
}

function makePallet(normalized, x, y, index, topology) {
  const symbol = symbolAt(normalized, x, y);
  const center = centerOfTile(normalized, x, y);
  const orientation = symbol === "-" ? "horizontal" : "vertical";
  const sideA = orientation === "horizontal"
    ? endpointFor(normalized, x, y, 0, -1, "north")
    : endpointFor(normalized, x, y, -1, 0, "west");
  const sideB = orientation === "horizontal"
    ? endpointFor(normalized, x, y, 0, 1, "south")
    : endpointFor(normalized, x, y, 1, 0, "east");
  const endpoints = [sideA, sideB].filter(Boolean);
  const scoreA = resourceEndpointScore(sideA, topology);
  const scoreB = resourceEndpointScore(sideB, topology);
  return {
    id: `pallet_${index + 1}`,
    type: "pallet",
    symbol,
    tileX: x,
    tileY: y,
    key: keyOf(x, y),
    x: center.x,
    y: center.y,
    orientation,
    traversalAxis: orientation === "horizontal" ? "vertical" : "horizontal",
    sideA,
    sideB,
    endpoints,
    stunLine: orientation === "horizontal"
      ? { x1: center.x - normalized.tile * 0.58, y1: center.y, x2: center.x + normalized.tile * 0.58, y2: center.y }
      : { x1: center.x, y1: center.y - normalized.tile * 0.58, x2: center.x, y2: center.y + normalized.tile * 0.58 },
    loopScore: Math.max(scoreA, scoreB) + (endpoints.length === 2 ? 18 : -20),
    deadEndRisk: Math.max(0, 55 - Math.max(scoreA, scoreB))
  };
}

function bestNearbyStandable(normalized, x, y, topology, radius = 3) {
  let best = null;
  let bestScore = -Infinity;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const tx = x + dx;
      const ty = y + dy;
      if (!inBounds(normalized, tx, ty) || !isNormalWalkable(normalized, tx, ty)) continue;
      const dist = Math.abs(dx) + Math.abs(dy);
      const meta = topology.tileMeta.get(keyOf(tx, ty));
      const score = (meta?.openScore || 0) - dist * 12 - (meta?.deadEndRisk || 0) * 0.5 - (meta?.cornerRisk || 0) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = walkablePoint(normalized, tx, ty, "approach");
      }
    }
  }
  return best;
}

class TinyPriorityQueue {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }
  push(value) {
    this.items.push(value);
    this._up(this.items.length - 1);
  }
  pop() {
    if (!this.items.length) return undefined;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last !== undefined) {
      this.items[0] = last;
      this._down(0);
    }
    return top;
  }
  get length() {
    return this.items.length;
  }
  _up(index) {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.items[parent], this.items[index]) <= 0) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }
  _down(index) {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.items.length && this.compare(this.items[left], this.items[best]) < 0) best = left;
      if (right < this.items.length && this.compare(this.items[right], this.items[best]) < 0) best = right;
      if (best === index) break;
      [this.items[index], this.items[best]] = [this.items[best], this.items[index]];
      index = best;
    }
  }
}

function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstruct(cameFrom, currentKey) {
  const out = [];
  let key = currentKey;
  while (key) {
    const [x, y] = key.split(",").map(Number);
    out.push({ x, y, key });
    key = cameFrom.get(key);
  }
  out.reverse();
  return out;
}

function findTilePath(normalized, start, goal, analysis, options = {}) {
  if (!start || !goal) return null;
  const sx = Number(start.tileX ?? start.x);
  const sy = Number(start.tileY ?? start.y);
  const gx = Number(goal.tileX ?? goal.x);
  const gy = Number(goal.tileY ?? goal.y);
  if (!inBounds(normalized, sx, sy) || !inBounds(normalized, gx, gy)) return null;
  if (!isNormalWalkable(normalized, sx, sy) || !isNormalWalkable(normalized, gx, gy)) return null;

  const maxIterations = Math.max(100, Number(options.maxIterations) || 5000);
  const open = new TinyPriorityQueue((a, b) => a.f - b.f);
  const startKey = keyOf(sx, sy);
  const goalKey = keyOf(gx, gy);
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const closed = new Set();
  open.push({ x: sx, y: sy, key: startKey, g: 0, f: heuristic({ x: sx, y: sy }, { x: gx, y: gy }) });

  let iterations = 0;
  while (open.length && iterations < maxIterations) {
    iterations += 1;
    const current = open.pop();
    if (!current || closed.has(current.key)) continue;
    if (current.key === goalKey) {
      const path = reconstruct(cameFrom, current.key);
      return scorePath(normalized, path, analysis);
    }
    closed.add(current.key);

    for (const next of neighborTiles(normalized, current.x, current.y, isNormalWalkable)) {
      const nKey = keyOf(next.x, next.y);
      if (closed.has(nKey)) continue;
      const meta = analysis?.grid?.tileMeta?.get(nKey);
      const clearance = meta?.clearance || 0;
      const dangerPenalty = (meta?.deadEndRisk || 0) * 0.04 + (meta?.cornerRisk || 0) * 0.03 + Math.max(0, 2 - clearance) * 0.7;
      const tentative = (gScore.get(current.key) ?? Infinity) + 1 + dangerPenalty;
      if (tentative >= (gScore.get(nKey) ?? Infinity)) continue;
      cameFrom.set(nKey, current.key);
      gScore.set(nKey, tentative);
      open.push({ x: next.x, y: next.y, key: nKey, g: tentative, f: tentative + heuristic(next, { x: gx, y: gy }) });
    }
  }
  return null;
}

function scorePath(normalized, tilePath, analysis) {
  let clearanceTotal = 0;
  let deadEndRisk = 0;
  let cornerRisk = 0;
  let minClearance = Infinity;
  for (const p of tilePath) {
    const meta = analysis?.grid?.tileMeta?.get(p.key);
    if (!meta) continue;
    clearanceTotal += meta.clearance || 0;
    deadEndRisk = Math.max(deadEndRisk, meta.deadEndRisk || 0);
    cornerRisk = Math.max(cornerRisk, meta.cornerRisk || 0);
    minClearance = Math.min(minClearance, meta.clearance || 0);
  }
  const lengthTiles = Math.max(0, tilePath.length - 1);
  return {
    tiles: tilePath,
    lengthTiles,
    lengthPx: lengthTiles * normalized.tile,
    avgClearance: tilePath.length ? clearanceTotal / tilePath.length : 0,
    minClearance: Number.isFinite(minClearance) ? minClearance : 0,
    deadEndRisk,
    cornerRisk,
    score: lengthTiles * -1 + clearanceTotal * 0.4 - deadEndRisk * 0.6 - cornerRisk * 0.5
  };
}

function endpointNodesForResource(resource) {
  const endpoints = Array.isArray(resource.endpoints) && resource.endpoints.length
    ? resource.endpoints
    : [resource.approach].filter(Boolean);
  return endpoints.map((point, index) => ({
    id: `${resource.id}:${point.label || index}`,
    resourceId: resource.id,
    resourceType: resource.type,
    side: point.label || String(index),
    point
  }));
}

function buildResourceGraph(normalized, resources, analysis) {
  const chaseResources = [
    ...resources.windows,
    ...resources.pallets,
    ...resources.exits
  ];
  const nodes = chaseResources.flatMap(endpointNodesForResource);
  const edges = [];
  const maxConnectTiles = Math.max(8, Math.round(Math.max(normalized.width, normalized.height) * 0.42));

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.resourceId === b.resourceId) continue;
      const estimate = Math.abs(a.point.tileX - b.point.tileX) + Math.abs(a.point.tileY - b.point.tileY);
      if (estimate > maxConnectTiles) continue;
      const path = findTilePath(normalized, a.point, b.point, analysis, { maxIterations: 2400 });
      if (!path || path.lengthTiles > maxConnectTiles) continue;
      const edge = {
        from: a.id,
        to: b.id,
        fromResource: a.resourceId,
        toResource: b.resourceId,
        lengthTiles: path.lengthTiles,
        avgClearance: Number(path.avgClearance.toFixed(2)),
        minClearance: path.minClearance,
        deadEndRisk: path.deadEndRisk,
        cornerRisk: path.cornerRisk,
        routeScore: Number(path.score.toFixed(2)),
        tilePath: path.tiles.map((p) => ({ x: p.x, y: p.y }))
      };
      edges.push(edge);
    }
  }

  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge);
    adjacency.get(edge.to).push({ ...edge, from: edge.to, to: edge.from, fromResource: edge.toResource, toResource: edge.fromResource, tilePath: edge.tilePath.slice().reverse() });
  }
  for (const list of adjacency.values()) list.sort((a, b) => b.routeScore - a.routeScore);

  return {
    nodes,
    edges,
    adjacency,
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      averageDegree: nodes.length ? Number((edges.length * 2 / nodes.length).toFixed(2)) : 0
    }
  };
}

function buildSafeZones(normalized, analysis) {
  const zones = [];
  for (const meta of analysis.grid.tileMeta.values()) {
    if (meta.clearance < 2 || meta.degree < 2 || meta.cornerRisk > 0 || meta.deadEndRisk > 0) continue;
    zones.push({
      id: `safe_${zones.length + 1}`,
      tileX: meta.x,
      tileY: meta.y,
      ...centerOfTile(normalized, meta.x, meta.y),
      clearance: meta.clearance,
      degree: meta.degree,
      openScore: meta.openScore
    });
  }
  zones.sort((a, b) => b.openScore - a.openScore);
  return zones.slice(0, 80);
}

function buildDangerZones(normalized, analysis) {
  const zones = [];
  for (const meta of analysis.grid.tileMeta.values()) {
    const risk = Math.max(meta.deadEndRisk, meta.cornerRisk);
    if (risk <= 0) continue;
    zones.push({
      id: `danger_${zones.length + 1}`,
      tileX: meta.x,
      tileY: meta.y,
      ...centerOfTile(normalized, meta.x, meta.y),
      risk,
      deadEndRisk: meta.deadEndRisk,
      cornerRisk: meta.cornerRisk,
      clearance: meta.clearance,
      degree: meta.degree
    });
  }
  zones.sort((a, b) => b.risk - a.risk);
  return zones;
}

function analyzeMap(mapId, map, options = {}) {
  const normalized = normalizeMap(mapId, map);
  const rawGrid = buildGrid(normalized);
  const clearanceData = analyzeClearance(normalized);
  const topology = analyzeTopology(normalized, clearanceData);

  const analysis = {
    id: normalized.id,
    name: normalized.name,
    tile: normalized.tile,
    requiredGenerators: normalized.requiredGenerators,
    spawnedGenerators: normalized.spawnedGenerators,
    dimensions: {
      widthTiles: normalized.width,
      heightTiles: normalized.height,
      widthPx: normalized.widthPx,
      heightPx: normalized.heightPx
    },
    grid: {
      width: normalized.width,
      height: normalized.height,
      tile: normalized.tile,
      rows: normalized.rows,
      tiles: rawGrid.tiles,
      matrix: rawGrid.matrix,
      byKey: rawGrid.byKey,
      clearance: clearanceData.clearance,
      edgeDanger: clearanceData.edgeDanger,
      wallDistance: clearanceData.wallDistance,
      edgeDistance: clearanceData.edgeDistance,
      deadEnds: topology.deadEnds,
      junctions: topology.junctions,
      corners: topology.corners,
      tileMeta: topology.tileMeta
    },
    resources: null,
    chase: null,
    helpers: {
      keyOf,
      centerOfTile: (x, y) => centerOfTile(normalized, x, y),
      findTilePath: (start, goal, pathOptions = {}) => findTilePath(normalized, start, goal, analysis, pathOptions),
      isNormalWalkable: (x, y) => isNormalWalkable(normalized, x, y),
      isTraversalWalkable: (x, y) => isTraversalWalkable(normalized, x, y),
      symbolAt: (x, y) => symbolAt(normalized, x, y)
    }
  };

  const resources = collectResources(normalized, topology);
  analysis.resources = resources;
  const safeZones = buildSafeZones(normalized, analysis);
  const dangerZones = buildDangerZones(normalized, analysis);
  const resourceGraph = buildResourceGraph(normalized, resources, analysis);
  analysis.chase = {
    safeZones,
    dangerZones,
    resourceGraph,
    routeHints: buildRouteHints(resourceGraph, resources)
  };
  analysis.summary = summarizeAnalysis(analysis);

  if (options.freeze !== false) deepFreezeLight(analysis);
  return analysis;
}

function buildRouteHints(resourceGraph, resources) {
  const byResource = new Map();
  for (const node of resourceGraph.nodes) {
    const edges = resourceGraph.adjacency.get(node.id) || [];
    const goodEdges = edges
      .filter((edge) => edge.deadEndRisk < 70 && edge.cornerRisk < 70)
      .slice(0, 4)
      .map((edge) => ({
        fromSide: node.side,
        to: edge.toResource,
        toSide: edge.to.split(":")[1] || "",
        lengthTiles: edge.lengthTiles,
        avgClearance: edge.avgClearance,
        routeScore: edge.routeScore
      }));
    if (!byResource.has(node.resourceId)) byResource.set(node.resourceId, []);
    byResource.get(node.resourceId).push(...goodEdges);
  }
  const allResources = [...resources.windows, ...resources.pallets, ...resources.exits];
  return allResources.map((resource) => ({
    id: resource.id,
    type: resource.type,
    loopScore: Number((resource.loopScore || 0).toFixed(2)),
    deadEndRisk: Number((resource.deadEndRisk || 0).toFixed(2)),
    bestNext: (byResource.get(resource.id) || [])
      .sort((a, b) => b.routeScore - a.routeScore)
      .slice(0, 4)
  }));
}

function summarizeAnalysis(analysis) {
  const walkableTiles = analysis.grid.tiles.filter((t) => t.normalWalkable).length;
  const hardBlocks = analysis.grid.tiles.filter((t) => t.hardBlock).length;
  const resourceCount = analysis.resources.windows.length + analysis.resources.pallets.length;
  return {
    id: analysis.id,
    name: analysis.name,
    size: `${analysis.dimensions.widthTiles}x${analysis.dimensions.heightTiles}`,
    walkableTiles,
    hardBlocks,
    windows: analysis.resources.windows.length,
    pallets: analysis.resources.pallets.length,
    riftSpawns: analysis.resources.rifts.length,
    exits: analysis.resources.exits.length,
    survivorSpawns: analysis.resources.survivorSpawns.length,
    killerSpawns: analysis.resources.killerSpawns.length,
    deadEnds: analysis.grid.deadEnds.length,
    junctions: analysis.grid.junctions.length,
    cornerRiskTiles: analysis.grid.corners.length,
    safeZones: analysis.chase?.safeZones?.length || 0,
    dangerZones: analysis.chase?.dangerZones?.length || 0,
    chaseResources: resourceCount,
    graphNodes: analysis.chase?.resourceGraph?.summary?.nodes || 0,
    graphEdges: analysis.chase?.resourceGraph?.summary?.edges || 0,
    graphAverageDegree: analysis.chase?.resourceGraph?.summary?.averageDegree || 0
  };
}

function formatAnalysisSummary(analysis) {
  const s = analysis.summary || summarizeAnalysis(analysis);
  const lines = [
    `Map: ${s.name} (${s.id})`,
    `Size: ${s.size} tiles`,
    `Walkable tiles: ${s.walkableTiles}`,
    `Walls: ${s.hardBlocks}`,
    `Windows: ${s.windows}`,
    `Pallets: ${s.pallets}`,
    `Rift spawns: ${s.riftSpawns}`,
    `Exits: ${s.exits}`,
    `Survivor spawns: ${s.survivorSpawns}`,
    `Killer spawns: ${s.killerSpawns}`,
    `Dead ends: ${s.deadEnds}`,
    `Junctions: ${s.junctions}`,
    `Corner-risk tiles: ${s.cornerRiskTiles}`,
    `Safe zones: ${s.safeZones}`,
    `Danger zones: ${s.dangerZones}`,
    `Chase resources: ${s.chaseResources}`,
    `Resource graph: ${s.graphNodes} nodes, ${s.graphEdges} edges, avg degree ${s.graphAverageDegree}`
  ];

  const routeLines = (analysis.chase?.routeHints || [])
    .filter((hint) => hint.bestNext.length)
    .slice(0, 12)
    .map((hint) => {
      const next = hint.bestNext.slice(0, 3).map((entry) => `${entry.to}(${entry.lengthTiles}t)`).join(", ");
      return `  ${hint.id} -> ${next}`;
    });

  if (routeLines.length) {
    lines.push("Route hints:");
    lines.push(...routeLines);
  }

  return lines.join("\n");
}

function analyzeGameMaps(gameMaps, options = {}) {
  const source = gameMaps && typeof gameMaps === "object" ? gameMaps : {};
  const out = {};
  for (const [id, map] of Object.entries(source)) {
    if (id === "active") continue;
    if (!map || !Array.isArray(map.rows)) continue;
    out[id] = analyzeMap(id, map, options);
  }
  return out;
}

function getActiveMapId(gameMaps) {
  if (!gameMaps || typeof gameMaps !== "object") return null;
  return typeof gameMaps.active === "string" ? gameMaps.active : Object.keys(gameMaps).find((id) => id !== "active");
}

function analyzeActiveMap(gameMaps, options = {}) {
  const id = options.mapId || getActiveMapId(gameMaps);
  if (!id || !gameMaps?.[id]) throw new Error(`Could not find active map ${id || "<none>"}.`);
  return analyzeMap(id, gameMaps[id], options);
}

function lightSerializableAnalysis(analysis) {
  return {
    id: analysis.id,
    name: analysis.name,
    tile: analysis.tile,
    requiredGenerators: analysis.requiredGenerators,
    spawnedGenerators: analysis.spawnedGenerators,
    dimensions: analysis.dimensions,
    summary: analysis.summary,
    resources: analysis.resources,
    chase: {
      safeZones: analysis.chase.safeZones,
      dangerZones: analysis.chase.dangerZones,
      routeHints: analysis.chase.routeHints,
      resourceGraph: {
        nodes: analysis.chase.resourceGraph.nodes,
        edges: analysis.chase.resourceGraph.edges.map((edge) => ({
          ...edge,
          tilePath: edge.tilePath.slice(0, 80)
        })),
        summary: analysis.chase.resourceGraph.summary
      }
    }
  };
}

function deepFreezeLight(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  // Do not freeze Maps too deeply. They are read-only by convention here, but freezing Map internals is fake comfort.
  if (value instanceof Map) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreezeLight(value[key], seen);
  return value;
}

module.exports = {
  analyzeMap,
  analyzeGameMaps,
  analyzeActiveMap,
  formatAnalysisSummary,
  lightSerializableAnalysis,
  getActiveMapId,
  // Exported for tests and future runner AI integration.
  keyOf
};
