import { SKINS, VOID_SKINS } from "../data/menuData"

const DEFAULT_RUNNER_SKIN = SKINS[0]
const DEFAULT_VOID_SKIN = VOID_SKINS[0]
const END_SCREEN_SKIN_CACHE = new Map()

function normalizeSkinKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function skinPoolForHudRole(role) {
  return role === "void" || role === "killer" ? VOID_SKINS : SKINS
}

function defaultHudSkinForRole(role) {
  return role === "void" || role === "killer" ? DEFAULT_VOID_SKIN : DEFAULT_RUNNER_SKIN
}

function actorSkinSearchText(actor) {
  const values = [
    actor?.skin,
    actor?.skinId,
    actor?.skinName,
    actor?.selectedSkin,
    actor?.selectedSkinId,
    actor?.selectedSkinName,
    actor?.skinLabel,
    actor?.skinClass,
    actor?.skinClassName,
    actor?.cosmeticSkin,
    actor?.cosmeticSkinId,
    actor?.playerSkin,
    actor?.playerSkinId,
    actor?.loadout?.skin,
    actor?.loadout?.skinId,
    actor?.cosmetics?.skin,
    actor?.cosmetics?.skinId,
    actor?.profile?.skin,
    actor?.profile?.skinId,
    actor?.appearance?.skin,
    actor?.appearance?.skinId
  ]

  return values.filter(Boolean).join(" ")
}

export function findHudSkin(actor, role = "runner") {
  const skins = skinPoolForHudRole(role)
  const fallback = defaultHudSkinForRole(role)
  const raw = actorSkinSearchText(actor)
  const normalized = normalizeSkinKey(raw)
  if (!normalized) return fallback

  return skins.find((skin) => [skin.id, skin.label, skin.className].some((value) => normalizeSkinKey(value) === normalized))
    || skins.find((skin) => [skin.id, skin.label, skin.className].some((value) => normalized.includes(normalizeSkinKey(value))))
    || fallback
}

function endScreenSkinKey(role, value) {
  const normalized = normalizeSkinKey(value)
  return normalized ? `${role}:${normalized}` : ""
}

export function cacheEndScreenSkin(actor, role = "runner", skin = null) {
  if (!actor) return
  const resolvedSkin = skin || findHudSkin(actor, role)
  const keys = [
    actor.id,
    actor.playerId,
    actor.socketId,
    actor.clientId,
    actor.userId,
    actor.name,
    actor.displayName,
    actor.username,
    actor.label
  ]

  keys.filter(Boolean).forEach((key) => {
    const cacheKey = endScreenSkinKey(role, key)
    if (cacheKey) END_SCREEN_SKIN_CACHE.set(cacheKey, resolvedSkin)
  })
}

export function findCachedEndScreenSkin(card, role = "runner") {
  const dataset = card?.dataset || {}
  const directSkinText = actorSkinSearchText(dataset)
  if (directSkinText) return findHudSkin(dataset, role)

  const name = card?.querySelector(".end-stat-head strong")?.textContent?.trim()
  const candidates = [
    dataset.actorId,
    dataset.playerId,
    dataset.socketId,
    dataset.clientId,
    dataset.userId,
    dataset.id,
    dataset.name,
    dataset.playerName,
    dataset.actorName,
    name
  ]

  for (const candidate of candidates) {
    const cacheKey = endScreenSkinKey(role, candidate)
    if (cacheKey && END_SCREEN_SKIN_CACHE.has(cacheKey)) return END_SCREEN_SKIN_CACHE.get(cacheKey)
  }

  return defaultHudSkinForRole(role)
}
