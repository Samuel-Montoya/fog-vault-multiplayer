import { useEffect, useMemo, useState } from "react"
import AccountBadge from "./AccountBadge"
import { showMenuScreen } from "../utils/screenNavigation"
import "../styles/classes.css"

const PLACEHOLDER_PERK_ICON = "/images/speed_burst.png"

const FALLBACK_RUNNER_CLASS_CONFIG = {
  defaultClass: "orbCollector",
  classes: {
    orbCollector: {
      id: "orbCollector",
      name: "Collector",
      shortName: "Collector",
      accent: "yellow",
      icon: "✦",
      summary: "Objective Runner built around orb control, fast collection bursts, and safe economy.",
      detail: "Collector vacuums nearby orbs, fires rapid pickup bolts, and multiplies pickups for aggressive rift progress.",
      wheelOrder: ["collectionBolt", "doubleOrb", "cancel", "orbMagnet"],
      passive: { label: "Orb Magnet", detail: "Larger orb pickup radius.", levels: [{ level: 1, label: "50% larger pickup radius" }] }
    },
    nebulizer: {
      id: "nebulizer",
      name: "Nebulizer",
      shortName: "Nebula",
      accent: "purple",
      icon: "☁",
      summary: "Control Runner that creates void-smoke cover and team safety.",
      detail: "Smoke hides everything inside from outsiders. Runners inside the cloud can see through it.",
      wheelOrder: ["smokeDart", "voidTrace", "cancel", "moreSoon"],
      passive: { label: "Void Trace", detail: "While inside smoke, reveal The Void through the haze.", levels: [{ level: 1, label: "Reveal The Void inside smoke within 440px" }] }
    },
    escapist: {
      id: "escapist",
      aliases: ["chase"],
      name: "Escapist",
      shortName: "Escapist",
      accent: "orange",
      icon: "➟",
      summary: "Chase Runner built for distance, fast vaults, and team speed saves.",
      detail: "Escapist vaults faster, boosts teammates with Dash Dart, and primes Swift Vault bursts.",
      wheelOrder: ["dashDart", "swiftVault", "cancel", "flowState"],
      passive: { label: "Flow State", detail: "Faster window and pallet vaults.", levels: [{ level: 1, label: "5% faster vaults" }] }
    },
    healer: {
      id: "healer",
      name: "Healer",
      shortName: "Healer",
      accent: "green",
      icon: "+",
      summary: "Support Runner that heals, unbinds, and saves teammates through pressure.",
      detail: "Healer works faster on normal heals and rescues, then uses Healing Dart for ranged saves.",
      wheelOrder: ["healingDart", "fieldMedic", "cancel", "moreSoon"],
      passive: { label: "Field Medic", detail: "Faster heals and unbinds.", levels: [{ level: 1, label: "5% faster heals and unbinds" }] }
    }
  },
  abilities: {}
}

const CLASS_ORDER = ["orbCollector", "nebulizer", "escapist", "healer"]

const CLASS_COPY = {
  orbCollector: {
    tags: ["Orb Economy", "Rapid Bolts", "Objective Speed"],
    footer: "Best for players who want to carry rift progress and keep the team supplied."
  },
  nebulizer: {
    tags: ["Smoke Cover", "Void Tracking", "Rescue Control"],
    footer: "Best for cutting sightlines, hiding saves, and forcing The Void to guess."
  },
  escapist: {
    tags: ["Mobility", "Fast Vaults", "Team Boosts"],
    footer: "Best for chase players who create distance and give teammates exits."
  },
  healer: {
    tags: ["Recovery", "Unbind Saves", "Ranged Support"],
    footer: "Best for keeping wounded, hooked, and downed teammates in the run."
  }
}

function readRunnerClassConfig() {
  if (typeof window === "undefined") return FALLBACK_RUNNER_CLASS_CONFIG
  return window.RIFTRUNNER_RUNNER_CLASS_CONFIG || FALLBACK_RUNNER_CLASS_CONFIG
}

function orderedRunnerClasses(config) {
  const classMap = config?.classes || {}
  const baseClasses = CLASS_ORDER.map((classId) => classMap[classId]).filter(Boolean)
  const extraClasses = Object.values(classMap).filter((runnerClass) => runnerClass?.id && !CLASS_ORDER.includes(runnerClass.id))
  return [...baseClasses, ...extraClasses]
}

function classAccent(runnerClass) {
  return runnerClass?.accent || (runnerClass?.id === "orbCollector" ? "gold" : runnerClass?.id === "healer" ? "cyan" : "purple")
}

function classCopy(runnerClass) {
  return CLASS_COPY[runnerClass?.id] || {
    tags: ["Team Utility"],
    footer: runnerClass?.detail || "Each class changes how your ability wheel supports the team."
  }
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatSeconds(value) {
  const number = formatNumber(value)
  return number && number > 0 ? `${number}s` : null
}

function abilityMeta(entry) {
  const cost = formatNumber(entry?.cost)
  const cooldown = formatSeconds(entry?.cooldown)
  const duration = formatSeconds(entry?.duration ?? entry?.boostDuration)
  const radius = formatNumber(entry?.radius)

  return [
    cost && cost > 0 ? `${cost} orbs` : cost === 0 ? "No cost" : null,
    cooldown ? `${cooldown} cooldown` : null,
    duration ? `${duration} duration` : null,
    radius && radius > 0 ? `${Math.round(radius)}px radius` : null,
    entry?.inputType === "m1" || entry?.shootAbility ? "M1" : null
  ].filter(Boolean)
}

function levelLine(level) {
  if (!level) return null
  if (level.label) return `Lv ${level.level}: ${level.label}`
  const bits = [
    level.chance ? `${Math.round(Number(level.chance) * 100)}% chance` : null,
    level.speedMultiplier ? `${Number(level.speedMultiplier).toFixed(1)}x speed` : null,
    level.healProgress ? `${Math.round(Number(level.healProgress) * 100)}% heal` : null,
    level.radius ? `${Math.round(Number(level.radius))}px radius` : null,
    level.cooldown ? `${level.cooldown}s cooldown` : null
  ].filter(Boolean)
  return bits.length ? `Lv ${level.level}: ${bits.join(" · ")}` : null
}

function passiveFeatureForClass(runnerClass) {
  const passive = runnerClass?.passive || {}
  const levels = Array.isArray(passive.levels) ? passive.levels.map(levelLine).filter(Boolean) : []

  return {
    id: `${runnerClass?.id || "runner"}-passive`,
    type: "passive",
    label: "Passive",
    name: passive.label || "Class Passive",
    summary: passive.detail || "Passive class bonus.",
    meta: ["Passive", ...levels.slice(0, 3)]
  }
}

function classAbilityFeature(ability) {
  return ability ? {
    id: ability.id,
    type: "classAbility",
    label: ability.inputType === "m1" || ability.shootAbility ? "M1 Ability" : "Q Ability",
    name: ability.name,
    summary: ability.summary || ability.detail || "Class ability.",
    meta: [...abilityMeta(ability), ...(Array.isArray(ability.levels) ? ability.levels.map(levelLine).filter(Boolean).slice(0, 3) : [])],
    ability
  } : null
}

function featuresForClass(runnerClass, config) {
  const abilityIds = Array.isArray(runnerClass?.wheelOrder)
    ? runnerClass.wheelOrder.filter((id) => id && id !== "cancel" && id !== "moreSoon")
    : []
  const abilities = abilityIds
    .map((id) => config?.abilities?.[id])
    .filter((ability) => ability && !ability.disabled && !ability.passive)
    .map(classAbilityFeature)
  return [passiveFeatureForClass(runnerClass), ...abilities].filter(Boolean)
}

function PageBackButton() {
  return (
    <button
      className="text-btn menu-back-btn rr-back-btn classes-back-button"
      data-screen="menu"
      data-screen-nav="menu"
      type="button"
      onClick={() => showMenuScreen("menu")}
    >
      ← Back
    </button>
  )
}

function ClassesTopBar() {
  return (
    <div className="classes-top-bar">
      <PageBackButton />
      <AccountBadge panelId="classes" className="classes-account-badge" />
    </div>
  )
}

function ClassesHero() {
  return (
    <header className="classes-hero" aria-labelledby="classesTitle">
      <h1 id="classesTitle">Runner Classes</h1>
      <p>Choose how you support the team before entering the Rift.</p>
    </header>
  )
}

function ClassSigil({ runnerClass }) {
  return (
    <div className="runner-class-sigil" aria-hidden="true">
      <span>{runnerClass?.icon || "✦"}</span>
    </div>
  )
}

function TagList({ tags, label }) {
  return (
    <div className="class-tag-row" aria-label={label}>
      {tags.map((tag) => <span key={tag}>{tag}</span>)}
    </div>
  )
}

function MetaPills({ items }) {
  return items?.length ? (
    <div className="class-feature-meta">
      {items.map((item) => <span key={item}>{item}</span>)}
    </div>
  ) : null
}

function FeatureIcon() {
  return (
    <span className="class-feature-icon" aria-hidden="true">
      <img src={PLACEHOLDER_PERK_ICON} alt="" draggable="false" />
    </span>
  )
}

function ClassFeature({ feature }) {
  return (
    <article className={`class-feature-row is-${feature.type || "perk"}`}>
      <FeatureIcon />
      <div className="class-feature-copy">
        <div className="class-feature-label">{feature.label}</div>
        <h3>{feature.name}</h3>
        <p>{feature.summary}</p>
        <MetaPills items={feature.meta} />
      </div>
    </article>
  )
}

function RunnerClassCard({ runnerClass, config }) {
  const copy = classCopy(runnerClass)
  const features = featuresForClass(runnerClass, config)
  const accent = classAccent(runnerClass)

  return (
    <article className={`runner-class-card class-accent-${accent}`}>
      <header className="runner-class-card-head">
        <ClassSigil runnerClass={runnerClass} />
        <div className="runner-class-title-copy">
          <h2>{runnerClass.name}</h2>
          <p>{runnerClass.summary}</p>
        </div>
      </header>

      <TagList tags={copy.tags} label={`${runnerClass.name} strengths`} />

      <section className="class-feature-list" aria-label={`${runnerClass.name} abilities and passives`}>
        {features.map((feature) => <ClassFeature feature={feature} key={feature.id} />)}
      </section>

      <p className="runner-class-footer">{copy.footer || runnerClass.detail}</p>
    </article>
  )
}

function ClassesHint() {
  return (
    <footer className="classes-bottom-hint">
      <span aria-hidden="true">✦</span>
      <b>Class abilities scale at Runner levels 1, 6, and 14.</b>
      <i />
      <span>M1 abilities fire toward your cursor.</span>
    </footer>
  )
}

export default function ClassesScreen() {
  const [config, setConfig] = useState(() => readRunnerClassConfig())

  useEffect(() => {
    const updateConfig = (event) => setConfig(event.detail?.config || readRunnerClassConfig())

    window.addEventListener("riftrunner:runner-class-config-ready", updateConfig)
    return () => window.removeEventListener("riftrunner:runner-class-config-ready", updateConfig)
  }, [])

  const classes = useMemo(() => orderedRunnerClasses(config), [config])

  return (
    <div id="classesScreen" className="screen io-screen classes-screen">
      <div className="classes-page-shell">
        <ClassesTopBar />
        <ClassesHero />

        <main className="runner-class-grid" aria-label="Runner class list">
          {classes.map((runnerClass) => (
            <RunnerClassCard
              runnerClass={runnerClass}
              config={config}
              key={runnerClass.id}
            />
          ))}
        </main>

        <ClassesHint />
      </div>
    </div>
  )
}
