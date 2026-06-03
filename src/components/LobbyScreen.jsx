import { useEffect } from "react"
import { SKINS, VOID_SKINS } from "../data/menuData"
import SkinButton from "./SkinButton"
import "../styles/lobby.css"

const DEFAULT_RUNNER_SKIN = SKINS[0]
const DEFAULT_VOID_SKIN = VOID_SKINS[0]
const ROLE_CLASS_NAMES = ["killer", "void", "survivor", "runner"]
const skinStyleCache = new Map()


const LOBBY_ROLE_ACTIONS = [
  { id: "beKillerBtn", className: "void-choice-btn selected", image: "/images/void.png", label: "Play as The Void" },
  { id: "beSurvivorBtn", className: "runner-choice-btn", image: "/images/runner.png", label: "Play as a Runner" },
  { id: "beSpectatorBtn", className: "spectator-choice-btn", label: "Join as Spectator" }
]

const LOBBY_BOT_ACTIONS = [
  { id: "addBotKillerBtn", image: "/images/void.png", label: "Add Void Bot" },
  { id: "addBotSurvivorBtn", image: "/images/runner.png", label: "Add Runner Bot" }
]

const LOBBY_SKIN_PICKERS = [
  { role: "runner", title: "Runner skins", skins: SKINS, className: "runner-lobby-skin-picker hidden", hidden: true },
  { role: "void", title: "Void skins", skins: VOID_SKINS, className: "void-lobby-skin-picker", hidden: false }
]

const LOBBY_ACTIONS = [
  { id: "readyBtn", className: "ready-action", label: "Ready" },
  { id: "startBtn", className: "primary", label: "Start Run" }
]

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function skinPoolForRole(role) {
  return role === "void" ? VOID_SKINS : SKINS
}

function defaultSkinForRole(role) {
  return role === "void" ? DEFAULT_VOID_SKIN : DEFAULT_RUNNER_SKIN
}

function findSkinByLabel(value, role) {
  const normalized = normalizeLabel(value)
  const skins = skinPoolForRole(role)
  if (!normalized) return defaultSkinForRole(role)

  return skins.find((skin) => normalizeLabel(skin.label) === normalized || normalizeLabel(skin.id) === normalized)
    || skins.find((skin) => normalized.includes(normalizeLabel(skin.label)) || normalized.includes(normalizeLabel(skin.id)))
    || defaultSkinForRole(role)
}

function clearSkinClasses(element) {
  if (!element) return
  ;[...element.classList].forEach((className) => {
    if (className.startsWith("skin-") && className !== "skin-preview") element.classList.remove(className)
  })
}

function getSelectedLobbyRole() {
  const survivorButton = document.getElementById("beSurvivorBtn")
  const voidButton = document.getElementById("beKillerBtn")
  const runnerPicker = document.querySelector(".runner-lobby-skin-picker")
  const voidPicker = document.querySelector(".void-lobby-skin-picker")

  if (survivorButton?.classList.contains("selected") || survivorButton?.getAttribute("aria-pressed") === "true") return "runner"
  if (voidButton?.classList.contains("selected") || voidButton?.getAttribute("aria-pressed") === "true") return "void"
  if (runnerPicker && !runnerPicker.classList.contains("hidden") && runnerPicker.getAttribute("aria-hidden") !== "true") return "runner"
  if (voidPicker && !voidPicker.classList.contains("hidden") && voidPicker.getAttribute("aria-hidden") !== "true") return "void"
  return "void"
}

function getSelectedSkinButton(role) {
  const pickerClass = role === "void" ? "void-lobby-skin-picker" : "runner-lobby-skin-picker"
  const fallback = defaultSkinForRole(role)
  return document.querySelector(`.${pickerClass} .skin-btn.selected`)
    || document.querySelector(`.${pickerClass} .skin-btn[data-skin="${fallback.id}"]`)
}

function getSkinPaint(skin) {
  if (!skin || typeof document === "undefined") return null
  if (skinStyleCache.has(skin.id)) return skinStyleCache.get(skin.id)

  const probe = document.createElement("span")
  probe.className = `skin-preview ${skin.className}`
  probe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:40px;height:40px;opacity:0;pointer-events:none;"
  document.body.appendChild(probe)

  const computed = window.getComputedStyle(probe)
  const paint = {
    background: computed.background,
    boxShadow: computed.boxShadow,
    borderColor: computed.borderColor
  }
  probe.remove()
  skinStyleCache.set(skin.id, paint)
  return paint
}

function paintSkinPreview(element, skin) {
  if (!element || !skin) return
  clearSkinClasses(element)
  ROLE_CLASS_NAMES.forEach((className) => element.classList.remove(className))
  element.classList.add("skin-preview", skin.className)

  const paint = getSkinPaint(skin)
  if (paint) {
    element.style.background = paint.background
    element.style.boxShadow = paint.boxShadow
    element.style.borderColor = paint.borderColor
  }

  element.dataset.skinId = skin.id
  element.title = skin.label
}

function syncSelectedSkinCard() {
  const role = getSelectedLobbyRole()
  const selectedButton = getSelectedSkinButton(role)
  const skin = selectedButton
    ? findSkinByLabel(selectedButton.querySelector(".skin-copy > span")?.textContent || selectedButton.dataset.skin, role)
    : defaultSkinForRole(role)
  const preview = document.getElementById("lobbySelectedSkinPreview")
  const label = document.getElementById("lobbySelectedSkinLabel")
  const roleMark = document.getElementById("lobbyRoleMark")

  if (preview && preview.dataset.skinId !== skin.id) paintSkinPreview(preview, skin)
  if (label) label.textContent = skin.label
  if (roleMark) {
    roleMark.classList.toggle("killer", role === "void")
    roleMark.classList.toggle("void", role === "void")
    roleMark.classList.toggle("survivor", role !== "void")
    roleMark.classList.toggle("runner", role !== "void")
  }
}

function skinTextForPlayerItem(item) {
  return [
    item.dataset.skin,
    item.dataset.skinId,
    item.dataset.skinName,
    item.getAttribute("data-selected-skin"),
    item.getAttribute("aria-label"),
    item.querySelector(".player-skin-name")?.textContent,
    item.querySelector(".player-summary small")?.textContent,
    item.textContent
  ].filter(Boolean).join(" ")
}

function syncLobbyPlayerSkins() {
  const list = document.getElementById("playersList")
  if (!list) return

  list.querySelectorAll(".player-item").forEach((item) => {
    const emblem = item.querySelector(".player-role-emblem")
    if (!emblem) return

    const roleText = item.querySelector(".player-role-name")?.textContent || ""
    const inVoidGroup = !!item.closest(".void-group")
    const wasVoid = emblem.dataset.skinRole === "void" || emblem.classList.contains("killer") || emblem.classList.contains("void")
    const isVoid = inVoidGroup || wasVoid || /void/i.test(roleText)
    const skinRole = isVoid ? "void" : "runner"
    const skin = findSkinByLabel(skinTextForPlayerItem(item), skinRole)

    if (emblem.dataset.skinId !== skin.id || emblem.dataset.skinRole !== skinRole || !emblem.classList.contains("lobby-player-skin-preview")) {
      emblem.innerHTML = ""
      emblem.classList.add("lobby-player-skin-preview")
      paintSkinPreview(emblem, skin)
      emblem.dataset.skinRole = skinRole
    }
  })
}


function isSkinOwnedInLobby(button) {
  if (!button) return false
  const price = Number(button.dataset.skinPrice || 0) || 0
  const text = button.textContent || ""
  return price <= 0
    || button.classList.contains("owned")
    || button.classList.contains("equipped")
    || button.classList.contains("selected")
    || button.getAttribute("aria-pressed") === "true"
    || button.dataset.owned === "true"
    || button.dataset.unlocked === "true"
    || /\b(owned|equipped|selected)\b/i.test(text)
}

function setAttributeIfChanged(element, name, value) {
  const nextValue = String(value)
  if (element.getAttribute(name) !== nextValue) element.setAttribute(name, nextValue)
}

function setDatasetIfChanged(element, name, value) {
  const nextValue = String(value)
  if (element.dataset[name] !== nextValue) element.dataset[name] = nextValue
}

function setTextIfChanged(element, value) {
  const nextValue = String(value)
  if (element.textContent !== nextValue) element.textContent = nextValue
}

function syncLobbyOwnedSkinVisibility() {
  const lobby = document.getElementById("lobbyScreen")
  if (!lobby || !lobby.classList.contains("screen-open")) return

  lobby.querySelectorAll(".lobby-skin-picker .skin-btn[data-skin]").forEach((button) => {
    const owned = isSkinOwnedInLobby(button)
    button.classList.toggle("lobby-skin-owned", owned)
    button.classList.toggle("lobby-skin-unowned", !owned)
    button.toggleAttribute("hidden", !owned)
    setAttributeIfChanged(button, "aria-hidden", owned ? "false" : "true")
    setAttributeIfChanged(button, "aria-disabled", owned ? "false" : "true")
    setDatasetIfChanged(button, "lobbyBuyDisabled", owned ? "false" : "true")

    const priceLabel = button.querySelector("[data-skin-price-label], .skin-price")
    if (priceLabel && owned) {
      setTextIfChanged(priceLabel, button.classList.contains("selected") || button.getAttribute("aria-pressed") === "true" ? "Equipped" : "Owned")
    }
  })
}

function stopLobbySkinPurchase(event) {
  const button = event.target?.closest?.("#lobbyScreen .lobby-skin-picker .skin-btn[data-skin]")
  if (!button) return

  syncLobbyOwnedSkinVisibility()
  if (button.classList.contains("lobby-skin-unowned") || !isSkinOwnedInLobby(button)) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation?.()
  }
}

function useLobbySkinSync() {
  useEffect(() => {
    if (typeof document === "undefined") return undefined

    const lobby = document.getElementById("lobbyScreen")
    let rafId = 0
    let contentObserver = null

    const isLobbyOpen = () => !!lobby?.classList.contains("screen-open")

    const syncNow = () => {
      rafId = 0
      if (!isLobbyOpen()) return
      syncLobbyOwnedSkinVisibility()
      syncSelectedSkinCard()
      syncLobbyPlayerSkins()
    }

    const requestSync = () => {
      if (!isLobbyOpen() || rafId) return
      rafId = window.requestAnimationFrame(syncNow)
    }

    const disconnectContentObserver = () => {
      if (contentObserver) {
        contentObserver.disconnect()
        contentObserver = null
      }
      if (rafId) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
    }

    const connectContentObserver = () => {
      if (!isLobbyOpen()) {
        disconnectContentObserver()
        return
      }

      if (!contentObserver && typeof MutationObserver !== "undefined") {
        const playersList = document.getElementById("playersList")
        const lobbySkinArea = document.querySelector(".lobby-control-column")
        contentObserver = new MutationObserver(requestSync)
        if (playersList) {
          contentObserver.observe(playersList, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
            attributeFilter: ["class", "data-skin", "data-skin-id", "data-skin-name", "data-selected-skin", "data-selected-skin-id"]
          })
        }
        if (lobbySkinArea) {
          contentObserver.observe(lobbySkinArea, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "aria-hidden", "aria-pressed", "data-owned", "data-unlocked", "data-skin-price"]
          })
        }
      }

      requestSync()
    }

    const handleScreenChange = (event) => {
      if (event.detail?.screen === "lobby") connectContentObserver()
      else disconnectContentObserver()
    }

    const handleClick = () => requestSync()
    const handleSkinSync = () => connectContentObserver()

    const screenObserver = typeof MutationObserver !== "undefined" && lobby
      ? new MutationObserver(() => (isLobbyOpen() ? connectContentObserver() : disconnectContentObserver()))
      : null

    if (screenObserver) screenObserver.observe(lobby, { attributes: true, attributeFilter: ["class"] })
    if (isLobbyOpen()) connectContentObserver()

    document.addEventListener("click", stopLobbySkinPurchase, true)
    document.addEventListener("click", handleClick, true)
    window.addEventListener("riftrunner:skin-sync", handleSkinSync)
    window.addEventListener("riftrunner:screen-change", handleScreenChange)

    return () => {
      disconnectContentObserver()
      screenObserver?.disconnect()
      document.removeEventListener("click", stopLobbySkinPurchase, true)
      document.removeEventListener("click", handleClick, true)
      window.removeEventListener("riftrunner:skin-sync", handleSkinSync)
      window.removeEventListener("riftrunner:screen-change", handleScreenChange)
    }
  }, [])
}

function RoleActionButton({ action }) {
  return (
    <button id={action.id} className={action.className} type="button">
      {action.image ? <img className="button-role-img" src={action.image} alt="" aria-hidden="true" /> : null}
      {action.label}
    </button>
  )
}

function BotActionButton({ action }) {
  return (
    <button id={action.id} type="button">
      <img className="button-role-img" src={action.image} alt="" aria-hidden="true" />
      {action.label}
    </button>
  )
}

function LobbySkinPicker({ picker }) {
  return (
    <div
      className={`skin-picker compact lobby-skin-picker ${picker.className}`}
      aria-label={`${picker.title} selector`}
      aria-hidden={picker.hidden ? "true" : undefined}
    >
      <div className="skin-title">{picker.title}</div>
      {picker.skins.map((skin) => (
        <SkinButton skin={skin} compact role={picker.role} lobbyOnlyOwned key={skin.id} />
      ))}
    </div>
  )
}

function LobbyActionButton({ action }) {
  return (
    <button id={action.id} className={action.className} type="button">
      {action.label}
    </button>
  )
}

export default function LobbyScreen() {
  useLobbySkinSync()

  return (
    <div id="lobbyScreen" className="screen io-screen lobby-screen-redesign">
      <div className="lobby-stage lobby-panel">
        <button id="leaveBtn" className="text-btn lobby-leave-btn" type="button">← Leave</button>

        <header className="lobby-hero">
          <div className="lobby-title-copy">
            <h1 id="lobbyTitle">Open Lobby 1</h1>
            <p id="lobbySubtitle" className="screen-copy">4/4 Runners • 1 Void Player • Players ready up to start. Spectators are optional.</p>
          </div>

          <aside className="lobby-run-card" aria-label="Selected run skin">
            <span>Run Lobby</span>
            <div id="lobbyRoleMark" className="lobby-role-mark killer void" aria-hidden="true">
              <img className="lobby-role-img lobby-role-runner-img" src="/images/runner.png" alt="" />
              <img className="lobby-role-img lobby-role-void-img" src="/images/void.png" alt="" />
              <i id="lobbySelectedSkinPreview" className="skin-preview lobby-selected-skin-preview skin-void-core" />
            </div>
            <strong id="lobbySelectedSkinLabel">Void Core</strong>
          </aside>
        </header>

        <div className="lobby-workspace">
          <aside className="lobby-control-column" aria-label="Lobby controls">
            <div className="lobby-column-heading">
              <span>Setup</span>
            </div>

            <div className="role-row lobby-role-actions">
              {LOBBY_ROLE_ACTIONS.map((action) => (
                <RoleActionButton action={action} key={action.id} />
              ))}
            </div>

            <div className="lobby-column-heading lobby-subheading">
              <span>Bots</span>
            </div>
            <div className="lobby-bot-actions" aria-label="Add lobby bots">
              {LOBBY_BOT_ACTIONS.map((action) => (
                <BotActionButton action={action} key={action.id} />
              ))}
            </div>

            {LOBBY_SKIN_PICKERS.map((picker) => (
              <LobbySkinPicker picker={picker} key={picker.role} />
            ))}

            <div className="button-row lobby-actions">
              {LOBBY_ACTIONS.map((action) => (
                <LobbyActionButton action={action} key={action.id} />
              ))}
            </div>

            <p className="hint lobby-hint">Multiple players can queue as <b>The Void</b>, but the run starts with exactly <b>1 Void</b> and at least <b>1 Runner</b>.</p>
          </aside>

          <section className="lobby-roster-column" aria-label="Lobby players">
            <div className="lobby-column-heading">
              <span>Players</span>
            </div>
            <div id="playersList" className="players-list" />
          </section>
        </div>
      </div>
    </div>
  )
}
