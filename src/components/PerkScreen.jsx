import { useEffect } from "react"
import { showMenuScreen } from "../utils/screenNavigation"
import AccountBadge from "./AccountBadge"
import { getPerkIconCandidates } from "../utils/perkIconPaths"
import "../styles/perks.css"
import "../styles/screen_header.css"


const PERK_SECTIONS = [
  {
    id: "runnerPerksTitle",
    role: "runner",
    shopRole: "survivor",
    shopId: "runnerPerkShop",
    iconSrc: "/images/runner.png",
    title: "Runner perks",
    subtitle: "Survive • Rescue • Escape",
    kicker: "Escape tools"
  },
  {
    id: "voidPerksTitle",
    role: "void",
    shopRole: "killer",
    shopId: "voidPerkShop",
    iconSrc: "/images/void.png",
    title: "Void perks",
    subtitle: "Hunt • Bind • Consume",
    kicker: "Hunting tools"
  }
]

const PERK_CONFIG_GLOBALS = [
  "PERK_CONFIG",
  "PERK_CONFIGS",
  "PERKS",
  "RIFTRUNNER_PERKS",
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
  cooldown: "cooldown",
  radius: "radius",
  revealRadius: "reveal radius"
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

  if (Number.isFinite(numeric)) {
    if (/ms$/i.test(key)) return `${label} ${(numeric / 1000).toFixed(numeric % 1000 === 0 ? 0 : 1)}s`
    if (/duration|cooldown/i.test(key)) return `${label} ${numeric}s`
    if (/speed|multiplier/i.test(key)) return `${label} ${numeric}x`
    if (/pct|percent|slow|width|length/i.test(key) && numeric > 0 && numeric < 1) return `${label} ${Math.round(numeric * 100)}%`
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

    img.classList.add("perk-icon-image-missing")
  }
}

function updatePerkCardIcon(card) {
  const icon = card?.querySelector?.(".perk-icon")
  if (!icon) return

  const sources = perkIconSourcesForCard(card)
  if (!sources.length) return

  const current = icon.querySelector("img.perk-icon-image")
  const currentSrc = current?.getAttribute("src")
  if (current && currentSrc === sources[0]) return

  const img = current || document.createElement("img")
  img.className = "perk-icon-image"
  img.alt = ""
  img.setAttribute("aria-hidden", "true")
  setImageFallbackChain(img, sources)
  img.src = sources[0]

  icon.replaceChildren(img)
  icon.classList.add("uses-perk-image")
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
        textContent: "->"
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

function PerkShopSection({ section }) {
  const { id, role, shopRole, shopId, iconSrc, title, subtitle, kicker } = section

  return (
    <section className={`perk-shop-section ${role}-perk-section`} aria-labelledby={id}>
      <div className="section-heading skin-shop-heading perks-section-heading">
        <div className="perks-section-title-wrap">
          <span className={`${role}-title-emblem section-title-emblem`} aria-hidden="true">
            <img className="section-title-icon" src={iconSrc} alt="" />
          </span>
          <div>
            <h2 id={id}>{title}</h2>
            <small>{subtitle}</small>
          </div>
        </div>
        <span className="perks-section-kicker">{kicker}</span>
      </div>
      <div id={shopId} className="perk-shop-grid" data-perk-shop={shopRole} aria-live="polite" />
    </section>
  )
}

export default function PerkScreen() {
  usePerkUpgradePreviews()

  return (
    <div id="perksScreen" className="screen io-screen perks-page-screen">
      <div className="perks-page-stage">
        <header className="perks-topbar">
          <BackButton />
          <AccountBadge panelId="perks" showOrbs className="perks-slim-account" />
        </header>

        <section className="perks-page-hero" aria-labelledby="perksPageTitle">
          <div className="perks-title-block">
            <h1 id="perksPageTitle">Perks</h1>
            <p>Spend banked orbs to unlock and upgrade abilities for Runners and The Void.</p>
          </div>
        </section>

        <div className="perk-shop-layout perks-shop-panels" aria-label="Perk upgrades">
          {PERK_SECTIONS.map((section) => (
            <PerkShopSection section={section} key={section.role} />
          ))}
        </div>
      </div>
    </div>
  )
}
