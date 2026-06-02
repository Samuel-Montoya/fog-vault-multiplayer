import { useEffect } from "react"
import { showMenuScreen } from "../utils/screenNavigation"
import "../styles/perks.css"

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

function existingNextText(card) {
  return card.dataset.nextLevelText
    || card.querySelector("[data-next-level-text]")?.textContent?.trim()
    || card.querySelector("[data-next-level]")?.getAttribute("data-next-level")
    || ""
}

function updatePerkCardPreview(card) {
  const actionButton = card.querySelector("button")
  const actionText = actionButton?.textContent?.trim() || ""
  const isUpgrade = /upgrade/i.test(actionText) || card.classList.contains("upgradeable") || card.dataset.action === "upgrade"
  const preview = card.querySelector(".perk-next-preview")

  if (!isUpgrade || card.classList.contains("maxed")) {
    preview?.remove()
    card.removeAttribute("data-next-preview-signature")
    return
  }

  const currentLevel = getCurrentLevel(card)
  if (!currentLevel) {
    preview?.remove()
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
    card.removeAttribute("data-next-preview-signature")
    return
  }

  const signature = `${currentLevel}:${text}`
  if (card.dataset.nextPreviewSignature === signature) return

  const nextPreview = preview || document.createElement("p")
  nextPreview.className = "perk-next-preview"
  nextPreview.innerHTML = `<span>Next level</span><b>${text}</b>`

  const anchor = card.querySelector(".perk-effect") || card.querySelector(".perk-summary") || card.querySelector(".perk-card-top")
  if (anchor?.parentElement) anchor.insertAdjacentElement("afterend", nextPreview)
  else card.appendChild(nextPreview)

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
        screen.querySelectorAll(".perk-card").forEach(updatePerkCardPreview)
      })
    }

    const observer = new MutationObserver(scheduleUpdate)
    observer.observe(screen, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ["class", "data-level", "data-perk-level", "data-current-level", "data-next-level-text"]
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

function PerksAccountSummary() {
  return (
    <section className="perks-account-panel" aria-label="Account summary" data-account-panel>
      <span className="perks-account-tab">Account</span>
      <div className="perks-account-core">
        <span className="perks-account-avatar" aria-hidden="true"><i>R</i></span>
        <div className="perks-account-copy">
          <strong id="perksAuthStatusName" data-auth-status-name>Playing as guest</strong>
          <span><b data-account-hint>Lifetime deposited orbs</b></span>
        </div>
      </div>
      <div className="perks-wallet" title="Deposited orbs available to spend">
        <img src="/images/orb.png" alt="" aria-hidden="true" />
        <b id="perksAuthOrbBalance" data-auth-orb-balance>0</b>
        <span>Orbs</span>
      </div>
      <div className="perks-account-actions hidden" data-account-actions>
        <button className="perks-logout-btn" type="button" data-auth-logout aria-label="Logout">
          <span aria-hidden="true">↪</span>
          Logout
        </button>
      </div>
    </section>
  )
}

export default function PerkScreen() {
  usePerkUpgradePreviews()

  return (
    <div id="perksScreen" className="screen io-screen perks-page-screen">
      <div className="perks-page-stage">
        <header className="perks-topbar">
          <button className="perks-back-btn" data-screen="menu" data-screen-nav="menu" type="button" onClick={() => showMenuScreen("menu")}>
            <span aria-hidden="true">←</span>
            Back
          </button>
          <PerksAccountSummary />
        </header>

        <section className="perks-page-hero" aria-labelledby="perksPageTitle">
          <div className="perks-title-block">
            <h1 id="perksPageTitle">Perks</h1>
            <p>Spend banked orbs to unlock and upgrade abilities for Runners and The Void.</p>
          </div>
        </section>

        <div className="perk-shop-layout perks-shop-panels" aria-label="Perk upgrades">
          <section className="perk-shop-section runner-perk-section" aria-labelledby="runnerPerksTitle">
            <div className="section-heading skin-shop-heading perks-section-heading">
              <div className="perks-section-title-wrap">
                <span className="section-title-emblem runner-title-emblem" aria-hidden="true">
                  <img className="section-title-icon" src="/images/runner.png" alt="" />
                </span>
                <div>
                  <h2 id="runnerPerksTitle">Runner perks</h2>
                  <small>Survive • Rescue • Escape</small>
                </div>
              </div>
              <span className="perks-section-kicker">Escape tools</span>
            </div>
            <div id="runnerPerkShop" className="perk-shop-grid" data-perk-shop="survivor" aria-live="polite" />
          </section>

          <section className="perk-shop-section void-perk-section" aria-labelledby="voidPerksTitle">
            <div className="section-heading skin-shop-heading perks-section-heading">
              <div className="perks-section-title-wrap">
                <span className="section-title-emblem void-title-emblem" aria-hidden="true">
                  <img className="section-title-icon" src="/images/void.png" alt="" />
                </span>
                <div>
                  <h2 id="voidPerksTitle">Void perks</h2>
                  <small>Hunt • Hook • Consume</small>
                </div>
              </div>
              <span className="perks-section-kicker">Hunting tools</span>
            </div>
            <div id="voidPerkShop" className="perk-shop-grid" data-perk-shop="killer" aria-live="polite" />
          </section>
        </div>

        <footer className="perks-footer-strip" aria-label="Perks shop hint">
          <span aria-hidden="true">✦</span>
          <b>Bank orbs by playing matches</b>
          <i aria-hidden="true" />
          <em>Spend orbs wisely. The rift rewards the prepared.</em>
        </footer>
      </div>
    </div>
  )
}
