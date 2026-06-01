const fs = require("fs");
const path = require("path");

let loaded = false;
let loadedPath = "";

function stripInlineComment(value) {
  let quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if ((ch === '"' || ch === "'") && value[i - 1] !== "\\") {
      quote = quote === ch ? "" : quote || ch;
      continue;
    }
    if (ch === "#" && !quote) {
      const before = value[i - 1];
      if (!before || /\s/.test(before)) return value.slice(0, i).trimEnd();
    }
  }
  return value;
}

function parseEnvValue(rawValue) {
  let value = stripInlineComment(String(rawValue || "").trim());
  if (!value) return "";

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    value = value.slice(1, -1);
    if (first === '"') {
      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  }
  return value;
}

function findProjectRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir || process.cwd());
    dir = parent;
  }
}

function envSearchPaths(rootDir) {
  const root = findProjectRoot(rootDir || process.cwd());
  const paths = [
    path.join(root, ".env.local"),
    path.join(root, ".env")
  ];

  const cwdRoot = findProjectRoot(process.cwd());
  for (const candidate of [path.join(cwdRoot, ".env.local"), path.join(cwdRoot, ".env")]) {
    if (!paths.includes(candidate)) paths.push(candidate);
  }

  return paths;
}

function loadEnv(rootDir = process.cwd()) {
  if (loaded) return { loaded: !!loadedPath, path: loadedPath };

  for (const filePath of envSearchPaths(rootDir)) {
    if (!fs.existsSync(filePath)) continue;

    const text = fs.readFileSync(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
      const equalsAt = normalized.indexOf("=");
      if (equalsAt <= 0) continue;

      const key = normalized.slice(0, equalsAt).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;

      process.env[key] = parseEnvValue(normalized.slice(equalsAt + 1));
    }

    loadedPath = filePath;
    break;
  }

  loaded = true;
  return { loaded: !!loadedPath, path: loadedPath };
}

module.exports = { loadEnv };
