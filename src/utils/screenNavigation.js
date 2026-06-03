const SCREEN_IDS = {
  menu: "menu",
  play: "playScreen",
  skins: "skinScreen",
  perks: "perksScreen",
  options: "optionsScreen",
  how: "howScreen",
  lobby: "lobbyScreen",
  end: "endScreen"
}

const SCREEN_ALIASES = {
  main: "menu",
  mainMenu: "menu",
  mainMenuScreen: "menu",
  playScreen: "play",
  skinScreen: "skins",
  skinsScreen: "skins",
  perkScreen: "perks",
  perksScreen: "perks",
  optionsScreen: "options",
  settings: "options",
  settingsScreen: "options",
  howScreen: "how",
  howToPlay: "how",
  howToPlayScreen: "how",
  lobbyScreen: "lobby",
  openLobby: "lobby",
  endScreen: "end",
  results: "end",
  result: "end",
  matchEnd: "end",
  gameOver: "end"
}

const GAME_ONLY_IDS = [
  "hud",
  "survivorStatusHud",
  "bigGenCounter",
  "horrorFx"
]

const MATCH_RESET_BODY_CLASSES = [
  "in-chase",
  "is-injured",
  "is-downed",
  "is-hooked",
  "is-dead",
  "is-escaped",
  "is-spectating",
  "survivor-hit-impact",
  "void-stunned",
  "rift-complete",
  "rifts-complete",
  "rifts-completed",
  "all-rifts-complete",
  "all-rifts-completed",
  "exits-open",
  "gates-open",
  "match-ended",
  "match-complete",
  "game-over"
]

function normalizeScreenName(screenName = "menu") {
  if (screenName && typeof screenName === "object" && screenName.id) {
    return normalizeScreenName(screenName.id)
  }

  const raw = String(screenName || "menu").trim()
  const withoutHash = raw.replace(/^#/, "")
  const relaxed = withoutHash
    .replace(/[-_\s]+(.)?/g, (_, character = "") => character.toUpperCase())
    .replace(/^(.)/, (character) => character.toLowerCase())

  if (raw === "game" || relaxed === "game" || relaxed === "gameScreen") return "game"
  if (SCREEN_IDS[raw]) return raw
  if (SCREEN_IDS[relaxed]) return relaxed
  if (SCREEN_ALIASES[raw]) return SCREEN_ALIASES[raw]
  if (SCREEN_ALIASES[withoutHash]) return SCREEN_ALIASES[withoutHash]
  if (SCREEN_ALIASES[relaxed]) return SCREEN_ALIASES[relaxed]

  const matchingId = Object.entries(SCREEN_IDS).find(([, id]) => id === withoutHash || id === relaxed)
  if (matchingId) return matchingId[0]

  return "menu"
}

function asArray(collection) {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (collection instanceof Map || collection instanceof Set) return Array.from(collection.values())
  if (typeof collection === "object") return Object.values(collection)
  return []
}

function resetDisplayObjectVisuals(object) {
  if (!object || typeof object !== "object") return

  const visualTargets = [
    object,
    object.sprite,
    object.body,
    object.base,
    object.image,
    object.icon,
    object.core,
    object.ring,
    object.glow,
    object.halo,
    object.progress,
    object.progressBar,
    object.completedSprite,
    object.completeSprite
  ].filter(Boolean)

  for (const target of visualTargets) {
    try {
      if (typeof target.clearTint === "function") target.clearTint()
      if (typeof target.setAlpha === "function") target.setAlpha(1)
      if (typeof target.setBlendMode === "function" && window.Phaser?.BlendModes?.NORMAL !== undefined) {
        target.setBlendMode(window.Phaser.BlendModes.NORMAL)
      }
      target.tintFill = false
      if (typeof target.tintTopLeft === "number") {
        target.tintTopLeft = 0xffffff
        target.tintTopRight = 0xffffff
        target.tintBottomLeft = 0xffffff
        target.tintBottomRight = 0xffffff
      }
    } catch {
      // Some Phaser objects use read-only internals. Skip those safely.
    }
  }

  for (const flag of ["complete", "completed", "isComplete", "sealed", "isSealed", "powered", "isPowered", "opened", "isOpen"]) {
    if (flag in object) object[flag] = false
  }

  for (const valueKey of ["progress", "sealProgress", "completeProgress", "completion", "amount", "filled"]) {
    if (valueKey in object && typeof object[valueKey] === "number") object[valueKey] = 0
  }
}

function resetPhaserMapVisuals() {
  if (typeof window === "undefined") return

  const games = [
    window.game,
    window.phaserGame,
    window.voidriftGame,
    window.riftRunnerGame,
    window.__VOIDRIFT_GAME__,
    window.__VOIDRIFT_PHASER_GAME__,
    window.__RIFTRUNNER_GAME__,
    window.__RIFTRUNNER_PHASER_GAME__
  ].filter(Boolean)

  const objectKeys = [
    "rifts",
    "riftSprites",
    "riftGraphics",
    "riftObjects",
    "riftNodes",
    "gens",
    "generators",
    "objectives",
    "objectiveSprites",
    "exits",
    "exitRifts"
  ]

  for (const game of games) {
    const scenes = game?.scene?.scenes || game?.scene?.getScenes?.() || []
    for (const scene of scenes) {
      for (const key of objectKeys) {
        for (const object of asArray(scene?.[key])) resetDisplayObjectVisuals(object)
      }
    }
  }
}

function resetMatchUiState(trigger = "navigation") {
  if (typeof document === "undefined") return

  document.body.classList.remove(...MATCH_RESET_BODY_CLASSES)

  const horrorFx = document.getElementById("horrorFx")
  if (horrorFx) {
    horrorFx.classList.add("hidden")
    horrorFx.style.setProperty("--chase", "0")
    horrorFx.style.setProperty("--terror", "0")
    horrorFx.style.setProperty("--red-chase", "0")
    horrorFx.style.setProperty("--void-stun", "0")
    horrorFx.style.setProperty("--focus", "0")
  }

  const bigGenCounter = document.getElementById("bigGenCounter")
  if (bigGenCounter) {
    bigGenCounter.classList.remove("is-complete", "complete", "rifts-complete", "rifts-completed")
  }

  const bigGenText = document.getElementById("bigGenText")
  if (bigGenText) bigGenText.textContent = "0 / 5"

  const genText = document.getElementById("genText")
  if (genText) genText.textContent = "0 / 0"

  const gateText = document.getElementById("gateText")
  if (gateText) gateText.textContent = "Closed"

  const healthText = document.getElementById("healthText")
  if (healthText) healthText.textContent = "Healthy"

  const matchAnnouncements = document.getElementById("matchAnnouncements")
  if (matchAnnouncements) matchAnnouncements.textContent = ""

  const gameWrap = document.getElementById("gameWrap")
  if (gameWrap) {
    gameWrap.querySelectorAll(".is-complete, .complete, .rift-complete, .gen-complete, .rifts-complete, .rift-red, .rift-sealed").forEach((element) => {
      element.classList.remove("is-complete", "complete", "rift-complete", "gen-complete", "rifts-complete", "rift-red", "rift-sealed")
    })
  }

  resetPhaserMapVisuals()

  const resetHooks = [
    "resetMatchVisualState",
    "resetMapVisualState",
    "resetRiftVisuals",
    "clearRiftCompletionState",
    "resetRiftRunnerMapVisuals",
    "resetVoidriftMapVisuals",
    "__RIFTRUNNER_RESET_MATCH_VISUALS__",
    "__VOIDRIFT_RESET_MATCH_VISUALS__"
  ]

  for (const hookName of resetHooks) {
    const hook = window[hookName]
    if (typeof hook === "function") {
      try {
        hook()
      } catch (error) {
        console.warn(`[RiftRunner] ${hookName} failed during UI reset`, error)
      }
    }
  }

  window.dispatchEvent(new CustomEvent("riftrunner:match-ui-reset", { detail: { trigger } }))
  window.dispatchEvent(new CustomEvent("voidrift:match-ui-reset", { detail: { trigger } }))
}

export function getScreenNameFromMenuButton(id) {
  switch (id) {
    case "menuPlayBtn":
      return "play"
    case "menuSkinsBtn":
      return "skins"
    case "menuPerksBtn":
      return "perks"
    case "menuOptionsBtn":
      return "options"
    case "menuHowBtn":
      return "how"
    default:
      return "menu"
  }
}

let screenTransitionTimer = 0

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function clearScreenTransitions() {
  if (screenTransitionTimer && typeof window !== "undefined") {
    window.clearTimeout(screenTransitionTimer)
    screenTransitionTimer = 0
  }

  for (const id of Object.values(SCREEN_IDS)) {
    const screen = document.getElementById(id)
    screen?.classList.remove("screen-transition-in", "screen-transition-out")
  }
}

function applyScreenVisibility(nextScreen, isGameScreen) {
  const nextId = SCREEN_IDS[nextScreen]
  const nextElement = nextId ? document.getElementById(nextId) : null
  const openScreens = Array.from(document.querySelectorAll(".rift-ui-shell > .screen.screen-open"))
  const shouldTransition = !isGameScreen
    && !prefersReducedMotion()
    && nextElement
    && openScreens.some((screen) => screen !== nextElement)

  clearScreenTransitions()

  for (const id of Object.values(SCREEN_IDS)) {
    const screen = document.getElementById(id)
    if (!screen || screen === nextElement) continue

    if (shouldTransition && screen.classList.contains("screen-open")) {
      screen.classList.remove("screen-open", "screen-transition-in")
      screen.classList.add("screen-transition-out")
    } else {
      screen.classList.remove("screen-open", "screen-transition-in", "screen-transition-out")
    }
  }

  if (nextElement) {
    nextElement.classList.remove("screen-transition-out")
    if (shouldTransition) nextElement.classList.add("screen-transition-in")
    nextElement.classList.add("screen-open")

    if (shouldTransition && typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        nextElement.classList.remove("screen-transition-in")
      })
    }
  }

  if (shouldTransition && typeof window !== "undefined") {
    screenTransitionTimer = window.setTimeout(() => {
      for (const screen of document.querySelectorAll(".rift-ui-shell > .screen.screen-transition-out")) {
        screen.classList.remove("screen-transition-out")
      }
      screenTransitionTimer = 0
    }, 260)
  }
}

export function showMenuScreen(screenName = "menu") {
  if (typeof document === "undefined") return

  const nextScreen = normalizeScreenName(screenName)
  const isGameScreen = nextScreen === "game"

  if (["menu", "play", "lobby", "game"].includes(nextScreen)) {
    resetMatchUiState(`show:${nextScreen}`)
  }

  document.body.classList.toggle("is-game-screen", isGameScreen)
  document.body.classList.toggle("is-menu-screen", !isGameScreen)

  applyScreenVisibility(nextScreen, isGameScreen)

  for (const id of GAME_ONLY_IDS) {
    const element = document.getElementById(id)
    if (element) element.classList.toggle("hidden", !isGameScreen)
  }

  window.dispatchEvent(new CustomEvent("riftrunner:screen-change", {
    detail: { screen: nextScreen }
  }))
}

export { resetMatchUiState }
