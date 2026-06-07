import { SKINS, VOID_SKINS } from "../../data/menuData"

export const DEFAULT_RUNNER_SKIN = SKINS[0]
export const DEFAULT_VOID_SKIN = VOID_SKINS[0]

export const LOBBY_TITLE = "Match Setup"
export const LOBBY_SUBTITLE = "4/4 Runners - 1 Void Player - Players ready up to start."

export const LOBBY_ROLE_ACTIONS = [
  { id: "beKillerBtn", className: "void-choice-btn selected", image: "/images/void.png", label: "Play as The Void" },
  { id: "beSurvivorBtn", className: "runner-choice-btn", image: "/images/runner.png", label: "Play as a Runner" },
  { id: "beSpectatorBtn", className: "spectator-choice-btn", label: "Join as Spectator" }
]

export const RUNNER_CLASSES = [
  { id: "orbCollector", icon: "\u2726", name: "Collector", aria: "Collector class" },
  { id: "nebulizer", icon: "\u2601", name: "Nebulizer", aria: "Nebulizer class" },
  { id: "escapist", icon: "\u279F", name: "Escapist", aria: "Escapist class" },
  { id: "healer", icon: "+", name: "Healer", aria: "Healer class" }
]

export const LOBBY_BOT_ACTIONS = [
  { id: "addBotKillerBtn", image: "/images/void.png", label: "Add Void Bot" },
  { id: "addBotSurvivorBtn", image: "/images/runner.png", label: "Add Runner Bot" }
]

export const LOBBY_SKIN_PICKERS = [
  { role: "runner", title: "Runner skins", skins: SKINS, className: "runner-lobby-skin-picker hidden", hidden: true },
  { role: "void", title: "Void skins", skins: VOID_SKINS, className: "void-lobby-skin-picker", hidden: false }
]

export const LOBBY_ACTIONS = [
  { id: "readyBtn", className: "ready-action", label: "Ready" },
  { id: "startBtn", className: "primary", label: "Start Run" }
]
