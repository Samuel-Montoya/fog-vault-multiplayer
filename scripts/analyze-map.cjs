#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  analyzeActiveMap,
  analyzeMap,
  formatAnalysisSummary,
  lightSerializableAnalysis,
  getActiveMapId
} = require("../ai/nav/map-analysis.cjs");

function resolveProjectPath(input, fallback) {
  const value = input || fallback;
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

function loadMaps(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Map file not found: ${filePath}`);
  }
  delete require.cache[require.resolve(filePath)];
  const maps = require(filePath);
  if (!maps || typeof maps !== "object") throw new Error(`Map file did not export an object: ${filePath}`);
  return maps;
}

function main() {
  const mapFile = resolveProjectPath(process.argv[2], "public/maps.js");
  const requestedMapId = process.argv[3];
  const shouldWriteJson = process.argv.includes("--json");
  const jsonIndex = process.argv.indexOf("--json-file");
  const jsonFile = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : null;

  const maps = loadMaps(mapFile);
  const mapId = requestedMapId || getActiveMapId(maps);
  const analysis = mapId && maps[mapId]
    ? analyzeMap(mapId, maps[mapId], { freeze: false })
    : analyzeActiveMap(maps, { freeze: false });

  console.log(formatAnalysisSummary(analysis));

  if (shouldWriteJson || jsonFile) {
    const outFile = resolveProjectPath(jsonFile, `ai/nav/${analysis.id}.analysis.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(lightSerializableAnalysis(analysis), null, 2)}\n`);
    console.log(`\nWrote ${outFile}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
}
