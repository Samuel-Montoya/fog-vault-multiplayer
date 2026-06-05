import { useEffect, useState } from "react"
import { showMenuScreen } from "../utils/screenNavigation"
import AccountBadge from "./AccountBadge"
import { getPerkIconCandidates } from "../utils/perkIconPaths"
import "../styles/perks.css"
import "../styles/screen_header.css"

const RUNNER_CLASS_SECTIONS = [
  {
    id: "collectorPerks",
    role: "survivor",
    classId: "orbCollector",
    accent: "yellow",
    icon: "✦",
    title: "Collector",
    subtitle: "Orb control • economy • objective pressure",
    summary: "Pickup-focused perks for vacuuming loose orbs, snowballing your carry, and feeding rifts faster."
  },
  {
    id: "nebulizerPerks",
    role: "survivor",
    classId: "nebulizer",
    accent: "purple",
    icon: "☁",
    title: "Nebulizer",
    subtitle: "Vision denial • space control • cover",
    summary: "Smoke-based perks for blocking sightlines, creating safe pockets, and turning fog into a tactical weapon."
  },
  {
    id: "escapistPerks",
    role: "survivor",
    classId: "escapist",
    accent: "orange",
    icon: "➟",
    title: "Escapist",
    subtitle: "Chase tools • speed • vault routes",
    summary: "Mobility perks for extending chase, rescuing teammates with movement bursts, and escaping ugly pressure."
  },
  {
    id: "healerPerks",
    role: "survivor",
    classId: "healer",
    accent: "green",
    icon: "✚",
    title: "Healer",
    subtitle: "Support • rescue • recovery",
    summary: "Recovery perks for ranged healing, faster saves, and stabilizing teammates before The Void cashes in."
  }
]

const VOID_SECTION = {
  id: "voidPerks",
  role: "killer",
  accent: "red",
  icon: "◈",
  title: "The Void",
  subtitle: "Hunt • pressure • consume",
  summary: "Aggressive pressure perks for chase control, map denial, and locking down greedy Runners."
}

const PERK_CONFIG_GLOBALS = [
  "PERK_CONFIG",
  "PERK_CONFIGS",
  "PERKS",
  "RIFTRUNNER_PERKS",
  "RIFTRUNNER_PERK_CONFIG",
  "RIFT_RUNNER_PERKS",
  "VOIDRIFT_PERKS",
  "RUNNER_PERKS",
  "SURVIVOR_PERKS",
  "VOID_PERKS",
  "KILLER_PERKS",
  "PERK_DEFINITIONS",
  "RUNNER_PERK_CONFIG",
  "VOID_PERK_CONFIG",
  "KILLER_PERK_CONFIG",
  "SURVIVOR_PERK_CONFIG"
]

const STAT_LABELS = {
  duration: "duration",
  durationMs: "duration",
  speed: "speed",
  speedMultiplier: "speed",
  sprintMultiplier: "speed",
  coneLength: "cone length",
  visionConeLength: "cone length",
  coneWidth: "cone width",
  visionConeWidth: "cone width",
  revealDuration: "reveal duration",
  slowDuration: "slow",
  slowAmount: "slow",
  slowPct: "slow",
  mineDuration: "mine duration",
  radius: "radius",
  revealRadius: "reveal radius",
  projectileSpeed: "dart speed",
  range: "range",
  cost: "ability cost",
  cooldown: "cooldown",
  boostDuration: "boost time",
  chance: "proc chance",
  minBonus: "min bonus",
  maxBonus: "max bonus",
  healProgress: "heal progress",
  unhookProgress: "unbind progress",
  canUnhook: "can unbind",
  canPickupDowned: "can pick up downed",
  aimWindow: "aim window",
  hidesScratchMarks: "special"
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function readGlobalBinding(name) {
  if (typeof window === "undefined") return undefined
  if (window[name]) return window[name]

  try {
    return Function(`return typeof ${name} !== "undefined" ? ${name} : undefined`)()
  } catch {
    return undefined
  }
}

function collectConfigCandidates(root, candidates = []) {
  if (!root || typeof root !== "object") return candidates

  if (Array.isArray(root)) {
    for (const item of root) collectConfigCandidates(item, candidates)
    return candidates
  }

  const looksLikePerk = root.id || root.key || root.name || root.title || root.label
  const hasLevels = root.levels || root.upgrades || root.tiers || root.values || root.statsByLevel
  if (looksLikePerk && hasLevels) candidates.push(root)

  for (const value of Object.values(root)) {
    if (value && typeof value === "object") collectConfigCandidates(value, candidates)
  }

  return candidates
}

function findPerkConfig(card) {
  if (typeof window === "undefined" || !card) return null

  const idCandidates = [
    card.dataset.perkId,
    card.dataset.perk,
    card.dataset.id,
    card.querySelector("[data-perk-id]")?.dataset.perkId,
    card.querySelector("[data-perk]")?.dataset.perk,
    card.querySelector("button")?.dataset.perkId,
    card.querySelector("button")?.dataset.perk
  ].filter(Boolean)

  const title = card.querySelector(".perk-card-top strong, .perk-title, h3, strong")?.textContent?.trim()
  if (title) idCandidates.push(title)

  const wanted = idCandidates.map(normalizeKey).filter(Boolean)
  if (!wanted.length) return null

  const candidates = []
  for (const key of PERK_CONFIG_GLOBALS) collectConfigCandidates(readGlobalBinding(key), candidates)

  return candidates.find((perk) => {
    const values = [perk.id, perk.key, perk.slug, perk.name, perk.title, perk.label].map(normalizeKey).filter(Boolean)
    return values.some((value) => wanted.includes(value))
  }) || null
}

function getPerkLevels(perk) {
  if (!perk || typeof perk !== "object") return []
  const levels = perk.levels || perk.upgrades || perk.tiers || perk.values || perk.statsByLevel || []
  if (Array.isArray(levels)) return levels
  if (typeof levels === "object") return Object.keys(levels).sort((a, b) => Number(a) - Number(b)).map((key) => levels[key])
  return []
}

function getCurrentLevel(card) {
  const datasetLevel = Number(card.dataset.level || card.dataset.perkLevel || card.dataset.currentLevel || "")
  if (Number.isFinite(datasetLevel) && datasetLevel > 0) return datasetLevel

  const levelText = card.textContent?.match(/level\s*(\d+)\s*\/\s*\d+/i)
  if (levelText) return Number(levelText[1]) || 0

  const filledPips = card.querySelectorAll(".perk-level-pips .filled, .perk-level-pips [aria-current='true'], .perk-level-pips .active").length
  return filledPips || 0
}

function getMaxLevel(card) {
  const datasetMax = Number(card.dataset.maxLevel || card.dataset.perkMaxLevel || "")
  if (Number.isFinite(datasetMax) && datasetMax > 0) return datasetMax

  const levelText = card.textContent?.match(/level\s*\d+\s*\/\s*(\d+)/i)
  if (levelText) return Number(levelText[1]) || 0

  const pips = card.querySelectorAll(".perk-level-pips span, .perk-level-pips i").length
  return pips || 4
}

function updatePerkCardMeter(card) {
  const level = Math.max(0, Math.floor(Number(getCurrentLevel(card) || 0)))
  const maxLevel = Math.max(1, Math.floor(Number(getMaxLevel(card) || 4)))
  const signature = `${level}:${maxLevel}`
  const existing = card.querySelector(".perk-effect-meter")

  if (existing?.dataset.meterSignature === signature) return

  const meter = existing || document.createElement("div")
  meter.className = "perk-effect-meter"
  meter.dataset.meterSignature = signature
  meter.style.setProperty("--perk-level-count", String(maxLevel))
  meter.setAttribute("aria-label", `Level ${Math.min(level, maxLevel)} of ${maxLevel}`)
  meter.replaceChildren()

  for (let i = 1; i <= maxLevel; i += 1) {
    const segment = document.createElement("span")
    segment.className = [
      i <= level ? "filled" : "",
      i === level && level > 0 ? "current" : "",
      i === level + 1 && level > 0 && level < maxLevel ? "next" : ""
    ].filter(Boolean).join(" ")
    segment.setAttribute("aria-hidden", "true")
    meter.appendChild(segment)
  }

  if (!existing) {
    const anchor = card.querySelector(".perk-effect") || card.querySelector(".perk-summary") || card.querySelector(".perk-card-top")
    if (anchor?.parentElement) anchor.insertAdjacentElement("afterend", meter)
    else card.appendChild(meter)
  }
}

function valueToText(key, value) {
  if (value === null || value === undefined || value === "") return ""
  const numeric = Number(value)
  const label = STAT_LABELS[key] || String(key).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  if (key === "hidesScratchMarks" && value) return "hides scratch marks"
  if ((key === "canUnhook" || key === "canPickupDowned") && value) return label

  if (Number.isFinite(numeric)) {
    if (/ms$/i.test(key)) return `${label} ${(numeric / 1000).toFixed(numeric % 1000 === 0 ? 0 : 1)}s`
    if (/duration|cooldown|aimWindow/i.test(key)) return `${label} ${numeric}s`
    if (/speedMultiplier|multiplier/i.test(key)) return `${label} ${numeric}x`
    if (/projectileSpeed/i.test(key)) return `${label} ${Math.round(numeric)}`
    if (/cost/i.test(key)) return numeric > 0 ? `${label} ${numeric} orbs` : `${label} free`
    if (/chance|healProgress|unhookProgress|pct|percent|slow|width|length/i.test(key) && numeric > 0 && numeric <= 1) return `${label} ${Math.round(numeric * 100)}%`
    return `${label} ${numeric}`
  }

  return `${label} ${value}`
}

function levelToText(level, previousLevel = null) {
  if (!level) return ""
  if (typeof level === "string") return level
  if (typeof level !== "object") return String(level)

  const directText = level.nextText || level.effectText || level.effect || level.description || level.summary || level.text || level.label
  if (typeof directText === "string" && directText.trim()) return directText.trim()

  const ignored = new Set(["cost", "price", "orbCost", "unlockCost", "upgradeCost", "id", "key", "name", "title", "label", "description", "summary", "icon", "className", "accent"])
  const keys = Object.keys(level).filter((key) => {
    if (ignored.has(key)) return false
    const value = level[key]
    if (key === "hidesScratchMarks") return !!value
    if (Array.isArray(value) || (value && typeof value === "object")) return false
    return previousLevel ? String(previousLevel[key]) !== String(value) : true
  })

  return keys.map((key) => valueToText(key, level[key])).filter(Boolean).slice(0, 4).join(" · ")
}

function perkIconSourcesForCard(card) {
  if (!card) return []

  const title = card.querySelector(".perk-card-top strong, .perk-title, h3, strong")?.textContent?.trim()
  const values = [
    card.dataset.perkIcon,
    card.dataset.perkId,
    card.dataset.perk,
    card.dataset.id,
    card.querySelector("[data-perk-icon]")?.dataset.perkIcon,
    card.querySelector("[data-perk-id]")?.dataset.perkId,
    card.querySelector("[data-perk]")?.dataset.perk,
    card.querySelector("button")?.dataset.perkIcon,
    card.querySelector("button")?.dataset.perkId,
    card.querySelector("button")?.dataset.perk,
    title
  ].filter(Boolean)

  return getPerkIconCandidates(...values)
}

function setImageFallbackChain(img, sources) {
  img.dataset.perkIconSources = JSON.stringify(sources)
  img.dataset.perkIconIndex = "0"

  img.onerror = () => {
    const allSources = JSON.parse(img.dataset.perkIconSources || "[]")
    const nextIndex = Number(img.dataset.perkIconIndex || 0) + 1
    if (nextIndex < allSources.length) {
      img.dataset.perkIconIndex = String(nextIndex)
      img.src = allSources[nextIndex]
      return
    }

    const icon = img.parentElement
    const fallback = icon?.dataset?.perkFallback || "✦"
    img.classList.add("perk-icon-image-missing")
    icon?.classList?.add("icon-image-failed")
    if (icon && !icon.querySelector(".perk-icon-fallback")) {
      const fallbackNode = document.createElement("span")
      fallbackNode.className = "perk-icon-fallback"
      fallbackNode.setAttribute("aria-hidden", "true")
      fallbackNode.textContent = fallback
      icon.appendChild(fallbackNode)
    }
  }
}

function updatePerkCardIcon(card) {
  const icon = card?.querySelector?.(".perk-icon")
  if (!icon) return

  const sources = perkIconSourcesForCard(card)
  if (!sources.length) return

  let fallbackNode = icon.querySelector(".perk-icon-fallback")
  if (!fallbackNode) {
    fallbackNode = document.createElement("span")
    fallbackNode.className = "perk-icon-fallback"
    fallbackNode.setAttribute("aria-hidden", "true")
    fallbackNode.textContent = icon.dataset.perkFallback || "✦"
    icon.appendChild(fallbackNode)
  }

  const current = icon.querySelector("img.perk-icon-image")
  const currentSrc = current?.getAttribute("src")
  if (current && currentSrc === sources[0]) return

  const img = current || document.createElement("img")
  img.className = "perk-icon-image"
  img.alt = ""
  img.setAttribute("aria-hidden", "true")
  setImageFallbackChain(img, sources)
  img.src = sources[0]

  icon.prepend(img)
  icon.classList.add("uses-perk-image", "perk-active-emblem")
  icon.classList.remove("icon-image-failed")
}

function existingNextText(card) {
  return card.dataset.nextLevelText
    || card.querySelector("[data-next-level-text]")?.textContent?.trim()
    || card.querySelector("[data-next-level]")?.getAttribute("data-next-level")
    || ""
}

function restorePerkEffect(effect) {
  if (!effect?.classList?.contains("has-next-upgrade")) return

  const original = effect.dataset.baseEffectText || effect.textContent?.trim() || ""
  effect.textContent = original
  effect.classList.remove("has-next-upgrade")
  delete effect.dataset.baseEffectText
}

function updatePerkCardPreview(card) {
  if (card.querySelector(".perk-card-upgrades")) return
  const actionButton = card.querySelector("button")
  const actionText = actionButton?.textContent?.trim() || ""
  const isUpgrade = /upgrade/i.test(actionText) || card.classList.contains("upgradeable") || card.dataset.action === "upgrade"
  const preview = card.querySelector(".perk-next-preview")
  const effect = card.querySelector(".perk-effect")

  if (!isUpgrade || card.classList.contains("maxed")) {
    preview?.remove()
    restorePerkEffect(effect)
    card.removeAttribute("data-next-preview-signature")
    return
  }

  const currentLevel = getCurrentLevel(card)
  if (!currentLevel) {
    preview?.remove()
    restorePerkEffect(effect)
    return
  }

  let text = existingNextText(card)
  if (!text) {
    const config = findPerkConfig(card)
    const levels = getPerkLevels(config)
    const nextLevel = levels[currentLevel] || levels[currentLevel + 1]
    const previousLevel = levels[Math.max(0, currentLevel - 1)]
    text = levelToText(nextLevel, previousLevel)
  }

  if (!text) {
    preview?.remove()
    restorePerkEffect(effect)
    card.removeAttribute("data-next-preview-signature")
    return
  }

  const currentText = effect?.dataset.baseEffectText || effect?.textContent?.trim() || ""
  const signature = `${currentLevel}:${currentText}:${text}`
  if (card.dataset.nextPreviewSignature === signature) return

  preview?.remove()

  if (effect && currentText) {
    effect.dataset.baseEffectText = currentText
    effect.classList.add("has-next-upgrade")
    effect.replaceChildren(
      Object.assign(document.createElement("span"), {
        className: "perk-effect-current",
        textContent: currentText
      }),
      Object.assign(document.createElement("span"), {
        className: "perk-effect-arrow",
        textContent: "→"
      }),
      Object.assign(document.createElement("span"), {
        className: "perk-effect-next",
        textContent: text
      })
    )
  } else {
    const nextPreview = document.createElement("p")
    nextPreview.className = "perk-next-preview"
    nextPreview.replaceChildren(
      Object.assign(document.createElement("span"), { textContent: "Next level" }),
      Object.assign(document.createElement("b"), { textContent: text })
    )

    const anchor = card.querySelector(".perk-summary") || card.querySelector(".perk-card-top")
    if (anchor?.parentElement) anchor.insertAdjacentElement("afterend", nextPreview)
    else card.appendChild(nextPreview)
  }

  card.dataset.nextPreviewSignature = signature
}

function usePerkUpgradePreviews() {
  useEffect(() => {
    if (typeof document === "undefined") return undefined

    const screen = document.getElementById("perksScreen")
    if (!screen) return undefined

    let frame = 0
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        screen.querySelectorAll(".perk-card").forEach((card) => {
          updatePerkCardIcon(card)
          updatePerkCardPreview(card)
          updatePerkCardMeter(card)
        })
      })
    }

    const observer = new MutationObserver(scheduleUpdate)
    observer.observe(screen, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ["class", "data-level", "data-perk-level", "data-current-level", "data-max-level", "data-perk-max-level", "data-next-level-text", "data-perk-icon"]
    })

    window.addEventListener("riftrunner:screen-change", scheduleUpdate)
    const poll = window.setInterval(scheduleUpdate, 850)
    scheduleUpdate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("riftrunner:screen-change", scheduleUpdate)
      window.clearInterval(poll)
    }
  }, [])
}

function BackButton() {
  return (
    <button className="perks-back-btn rr-back-btn" data-screen="menu" data-screen-nav="menu" type="button" onClick={() => showMenuScreen("menu")}>
      <span aria-hidden="true">←</span>
      Back
    </button>
  )
}

const CATEGORY_NAV = [
  ...RUNNER_CLASS_SECTIONS.map((section) => ({
    ...section,
    type: "runner",
    shopRole: "survivor"
  })),
  {
    ...VOID_SECTION,
    type: "void",
    classId: "",
    shopRole: "killer"
  }
]

function ClassTab({ category, active, onSelect }) {
  return (
    <button
      className={`perks-class-tab accent-${category.accent} ${active ? "is-active" : ""}`}
      type="button"
      onClick={() => onSelect(category.id)}
      aria-pressed={active}
    >
      <span className="perks-tab-icon" aria-hidden="true">{category.icon}</span>
      <span className="perks-tab-copy">
        <b>{category.title}</b>
        <small>{category.type === "void" ? "Void perks" : "Runner class"}</small>
      </span>
    </button>
  )
}

function ActivePerkPanel({ category }) {
  const isVoid = category.type === "void"
  return (
    <section className={`perks-active-panel accent-${category.accent}`} aria-labelledby="activePerksTitle">
      <header className="perks-active-header">
        <div className="perks-active-emblem" aria-hidden="true">{category.icon}</div>
        <div className="perks-active-copy">
          <span>{isVoid ? "Killer upgrades" : "Runner class upgrades"}</span>
          <h2 id="activePerksTitle">{category.title}</h2>
          <strong>{category.subtitle}</strong>
          <p>{category.summary}</p>
        </div>
      </header>
      <div
        className="perk-shop-grid perks-active-grid"
        data-perk-shop={category.shopRole}
        data-perk-class={category.classId || undefined}
        aria-live="polite"
      />
    </section>
  )
}

export default function PerkScreen() {
  usePerkUpgradePreviews()
  const [selectedCategoryId, setSelectedCategoryId] = useState(CATEGORY_NAV[0].id)
  const activeCategory = CATEGORY_NAV.find((category) => category.id === selectedCategoryId) || CATEGORY_NAV[0]

  useEffect(() => {
    if (typeof window === "undefined") return undefined
    const frame = window.requestAnimationFrame(() => {
      window.RiftRunnerRenderPerkShop?.()
      window.dispatchEvent(new CustomEvent("riftrunner:perk-tab-change", { detail: { categoryId: selectedCategoryId } }))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedCategoryId])

  return (
    <div id="perksScreen" className="screen io-screen perks-page-screen">
      <div className="perks-page-stage">
        <header className="perks-topbar">
          <BackButton />
          <AccountBadge panelId="perks" showOrbs className="perks-slim-account" />
        </header>

        <section className="perks-page-hero" aria-labelledby="perksPageTitle">
          <div className="perks-title-block">
            <span className="perks-title-kicker">Class upgrades</span>
            <h1 id="perksPageTitle">Perks</h1>
            <p>Pick a class, read the upgrades, and buy what you need. Same RiftRunner theme, less visual tax filing.</p>
          </div>
        </section>

        <main className="perks-content" aria-label="Perk upgrades">
          <nav className="perks-class-tabs" aria-label="Perk category tabs">
            {CATEGORY_NAV.map((category) => (
              <ClassTab
                category={category}
                active={category.id === activeCategory.id}
                onSelect={setSelectedCategoryId}
                key={category.id}
              />
            ))}
          </nav>

          <ActivePerkPanel category={activeCategory} key={activeCategory.id} />
        </main>
      </div>
    </div>
  )
}
