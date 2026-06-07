import { useEffect } from "react"
import { SKINS, VOID_SKINS } from "../../data/menuData"
import { DEFAULT_RUNNER_SKIN, DEFAULT_VOID_SKIN } from "./lobbyData"

const ROLE_CLASS_NAMES = ["killer", "void", "survivor", "runner"]
const skinStyleCache = new Map()

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

function paintSkinPreview(element, skin, role) {
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
  element.dataset.skinRole = role
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

  if (preview && preview.dataset.skinId !== skin.id) paintSkinPreview(preview, skin, role)
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
      paintSkinPreview(emblem, skin, skinRole)
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

export function useLobbySkinSync() {
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
