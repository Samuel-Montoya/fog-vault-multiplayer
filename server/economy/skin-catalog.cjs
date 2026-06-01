const RUNNER_SKINS = [
  { id: "blueSquare", role: "runner", label: "Azure Orbit", price: 0, defaultOwned: true },
  { id: "yellowStar", role: "runner", label: "Solar Sprite", price: 120 },
  { id: "purplePentagon", role: "runner", label: "Prism Ghost", price: 160 },
  { id: "nebulaBloom", role: "runner", label: "Nebula Bloom", price: 220 },
  { id: "eclipseWisp", role: "runner", label: "Eclipse Wisp", price: 260 },
  { id: "riftMoth", role: "runner", label: "Night Moth", price: 300 },
  { id: "signalDrone", role: "runner", label: "Signal Drone", price: 340 }
];

const VOID_SKINS = [
  { id: "voidCore", role: "void", label: "Void Core", price: 0, defaultOwned: true },
  { id: "solarMaw", role: "void", label: "Solar Maw", price: 180 },
  { id: "azureRift", role: "void", label: "Azure Rift", price: 180 },
  { id: "bloodEclipse", role: "void", label: "Blood Eclipse", price: 240 },
  { id: "starlessWyrm", role: "void", label: "Starless Wyrm", price: 280 },
  { id: "lanternHusk", role: "void", label: "Lantern Husk", price: 420 },
  { id: "abyssSiren", role: "void", label: "Abyss Siren", price: 420 },
  { id: "crownedHollow", role: "void", label: "Crowned Hollow", price: 520 },
  { id: "staticNull", role: "void", label: "Static Null", price: 520 },
  { id: "riftSeraph", role: "void", label: "Rift Seraph", price: 650 }
];

const SKINS = [...RUNNER_SKINS, ...VOID_SKINS];
const SKIN_BY_ID = new Map(SKINS.map((skin) => [skin.id, skin]));
const DEFAULT_SKINS = SKINS.filter((skin) => skin.defaultOwned).map((skin) => skin.id);

function normalizeSkinRole(role) {
  return role === "killer" || role === "void" ? "void" : role === "survivor" || role === "runner" ? "runner" : "runner";
}

function getSkin(skinId) {
  return SKIN_BY_ID.get(String(skinId || "")) || null;
}

function hasSkin(skinId) {
  return SKIN_BY_ID.has(String(skinId || ""));
}

function skinBelongsToRole(skinId, role) {
  const skin = getSkin(skinId);
  return !!skin && skin.role === normalizeSkinRole(role);
}

function isDefaultSkin(skinId) {
  const skin = getSkin(skinId);
  return !!skin?.defaultOwned || Number(skin?.price || 0) <= 0;
}

function createOwnedSkinSet(extraOwned = []) {
  return new Set([...DEFAULT_SKINS, ...(Array.isArray(extraOwned) ? extraOwned : [])].filter(hasSkin));
}

function publicCatalog() {
  return SKINS.map((skin) => ({
    id: skin.id,
    role: skin.role,
    label: skin.label,
    price: Math.max(0, Math.floor(Number(skin.price) || 0)),
    defaultOwned: !!skin.defaultOwned
  }));
}

module.exports = {
  RUNNER_SKINS,
  VOID_SKINS,
  SKINS,
  DEFAULT_SKINS,
  normalizeSkinRole,
  getSkin,
  hasSkin,
  skinBelongsToRole,
  isDefaultSkin,
  createOwnedSkinSet,
  publicCatalog
};
