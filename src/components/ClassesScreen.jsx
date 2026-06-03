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
      name: "Orb Collector",
      shortName: "Orb",
      accent: "gold",
      icon: "✦",
      summary: "Objective-focused Runner that controls routing, vision, and orb economy.",
      detail: "Built for banking orbs safely, scouting routes, and keeping rift progress moving.",
      grantedPerks: { riftLens: 1, hourglass: 1 },
      passive: {
        label: "Orb Magnet",
        orbPickupRadiusMultiplier: 2,
        pickupRadiusRing: { color: 0xff9f1c }
      }
    },
    healer: {
      id: "healer",
      name: "Healer",
      shortName: "Healer",
      accent: "cyan",
      icon: "+",
      summary: "Support Runner that keeps teammates alive and moving through pressure.",
      detail: "Built around recovery, rescue momentum, and quick healing windows during danger.",
      grantedPerks: {},
      passive: { label: "Medic Aura", healActionSpeedMultiplier: 1.08 }
    },
    chase: {
      id: "chase",
      name: "Chase",
      shortName: "Chase",
      accent: "purple",
      icon: "➟",
      summary: "Distraction Runner built to create space, absorb pressure, and escape.",
      detail: "Built for stretching chase, pulling attention, and creating breathing room for the team.",
      grantedPerks: { rallyDart: 1, speedBurst: 1 },
      passive: { label: "Clean Footing", injuredVaultSpeedMultiplier: 1.08, detail: "While injured, window and pallet vaults are 8% faster." }
    }
  },
  abilities: {
    rallyDart: {
      id: "rallyDart",
      name: "Rally Dart",
      shortName: "Dart",
      accent: "orange",
      cost: 15,
      cooldown: 55,
      radius: 112,
      duration: 1.25,
      summary: "Arm an orange dart, then click M1 to burst at your cursor or on yourself.",
      detail: "Travels toward your cursor, passes through windows and pallets, explodes on walls, and boosts any Runner inside the orange ring."
    },
    healingPulse: {
      id: "healingPulse",
      classAbility: true,
      classId: "healer",
      name: "Healing Pulse",
      shortName: "Pulse",
      accent: "cyan",
      cost: 12,
      cooldown: 50,
      radius: 140,
      summary: "Pulse nearby wounded Runners with quick healing progress.",
      detail: "Can be used while moving and during chase. Higher Runner levels make the pulse stronger.",
      levels: [
        { level: 1, minRunnerLevel: 1, healProgress: 0.15, radius: 130, cost: 12, cooldown: 52 },
        { level: 2, minRunnerLevel: 6, healProgress: 0.20, radius: 140, cost: 12, cooldown: 50 },
        { level: 3, minRunnerLevel: 14, healProgress: 0.30, radius: 150, cost: 14, cooldown: 48 },
        { level: 4, minRunnerLevel: 25, healProgress: 0.50, radius: 160, cost: 16, cooldown: 45 }
      ]
    }
  }
}

const CLASS_ORDER = ["orbCollector", "healer", "chase"]

const CLASS_COPY = {
  orbCollector: {
    tags: ["Objective Control", "Safe Routing", "Orb Banking"],
    footer: "Starts with Rift Lens and Hourglass for map control and safer orb banking."
  },
  healer: {
    tags: ["Team Sustain", "Rescue Momentum", "Chase Healing"],
    footer: "Built around recovery, rescue momentum, and keeping the team active."
  },
  chase: {
    tags: ["Mobility", "Escape Routes", "Pressure Relief"],
    footer: "For stretching chase, creating distance, and pulling attention off the team."
  }
}

const PERK_FALLBACKS = {
  riftLens: {
    id: "riftLens",
    name: "Rift Lens",
    summary: "Widen your cone and read the map before becoming floor decoration.",
    abilityCost: 10,
    cooldown: 30
  },
  hourglass: {
    id: "hourglass",
    name: "Hourglass",
    summary: "Adds rear vision and hides scratch marks while active.",
    abilityCost: 10,
    cooldown: 30
  },
  speedBurst: {
    id: "speedBurst",
    name: "Speed Burst",
    summary: "Panic sprint when The Void is breathing down your neck.",
    abilityCost: 10,
    cooldown: 60
  },
  rallyDart: {
    id: "rallyDart",
    name: "Rally Dart",
    summary: "Fire a fast fast orange support dart that bursts into a Runner speed-boost ring.",
    abilityCost: 15,
    cooldown: 55,
    radius: 112
  }
}

function readRunnerClassConfig() {
  if (typeof window === "undefined") return FALLBACK_RUNNER_CLASS_CONFIG
  return window.RIFTRUNNER_RUNNER_CLASS_CONFIG || FALLBACK_RUNNER_CLASS_CONFIG
}

function readPerkConfig() {
  if (typeof window === "undefined") return null
  return window.RIFTRUNNER_PERK_CONFIG || window.PERK_CONFIG || null
}

function orderedRunnerClasses(config) {
  const classMap = config?.classes || {}
  const baseClasses = CLASS_ORDER.map((classId) => classMap[classId]).filter(Boolean)
  const extraClasses = Object.values(classMap).filter((runnerClass) => runnerClass?.id && !CLASS_ORDER.includes(runnerClass.id))
  return [...baseClasses, ...extraClasses]
}

function classAccent(runnerClass) {
  return runnerClass?.id === "orbCollector"
    ? "gold"
    : runnerClass?.id === "healer"
      ? "cyan"
      : runnerClass?.id === "chase"
        ? "purple"
        : runnerClass?.accent || "purple"
}

function classCopy(runnerClass) {
  return CLASS_COPY[runnerClass?.id] || {
    tags: ["Team Utility"],
    footer: runnerClass?.detail || "Each class changes how your ability wheel supports the team."
  }
}

function percent(value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : ""
}

function bonusPercentFromMultiplier(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round((number - 1) * 100)) : 0
}

function getPerk(perkId) {
  const perkConfig = readPerkConfig()
  return perkConfig?.roles?.survivor?.perks?.[perkId]
    || perkConfig?.roles?.runner?.perks?.[perkId]
    || PERK_FALLBACKS[perkId]
    || null
}

function abilityMeta(entry) {
  const cost = Number(entry?.abilityCost ?? entry?.cost)
  const cooldown = Number(entry?.cooldown)
  const radius = Number(entry?.radius)

  return [
    Number.isFinite(cost) && cost > 0 ? `${cost} orbs` : null,
    Number.isFinite(cooldown) && cooldown > 0 ? `${cooldown}s cooldown` : null,
    Number.isFinite(radius) && radius > 0 ? `${radius}px radius` : null
  ].filter(Boolean)
}

function passiveFeatureForClass(runnerClass) {
  const passive = runnerClass?.passive || {}

  return runnerClass?.id === "orbCollector"
    ? {
        id: "orbMagnet",
        type: "passive",
        label: "Passive",
        name: passive.label || "Orb Magnet",
        summary: `${bonusPercentFromMultiplier(passive.orbPickupRadiusMultiplier || 1)}% larger orb pickup radius. The orange ring shows your upgraded pickup range.`,
        meta: ["Passive"]
      }
    : runnerClass?.id === "healer"
      ? {
          id: "medicAura",
          type: "passive",
          label: "Passive",
          name: passive.label || "Medic Aura",
          summary: `${bonusPercentFromMultiplier(passive.healActionSpeedMultiplier || 1)}% faster normal heals and rescues.`,
          meta: ["Passive"]
        }
      : {
          id: "cleanFooting",
          type: "passive",
          label: "Passive",
          name: passive.label || "Clean Footing",
          summary: passive.detail || `${bonusPercentFromMultiplier(passive.injuredVaultSpeedMultiplier || 1)}% faster window and pallet vaults while injured.`,
          meta: ["Passive"]
        }
}

function classAbilityFeature(ability) {
  return ability ? {
    id: ability.id,
    type: "classAbility",
    label: "Class Ability",
    name: ability.name,
    summary: ability.summary || ability.detail || "Class ability.",
    meta: abilityMeta(ability),
    ability
  } : null
}

function startingPerkFeature(perkId, runnerClass) {
  const perk = getPerk(perkId)
  const grantedLevel = Number(runnerClass?.grantedPerks?.[perkId] || 0)

  return perk ? {
    id: perkId,
    type: "startingPerk",
    label: "Starting Perk",
    name: perk.name || PERK_FALLBACKS[perkId]?.name || "Starting Perk",
    summary: perk.summary || perk.detail || "Starts equipped for this class.",
    meta: [grantedLevel > 0 ? `Lv ${grantedLevel}` : "Equipped", ...abilityMeta(perk)]
  } : null
}

function featuresForClass(runnerClass, config) {
  return runnerClass?.id === "orbCollector"
    ? [passiveFeatureForClass(runnerClass), startingPerkFeature("riftLens", runnerClass), startingPerkFeature("hourglass", runnerClass)].filter(Boolean)
    : runnerClass?.id === "healer"
      ? [classAbilityFeature(config?.abilities?.healingPulse), passiveFeatureForClass(runnerClass)].filter(Boolean)
      : runnerClass?.id === "chase"
        ? [startingPerkFeature("rallyDart", runnerClass), startingPerkFeature("speedBurst", runnerClass), passiveFeatureForClass(runnerClass)].filter(Boolean)
        : [passiveFeatureForClass(runnerClass)].filter(Boolean)
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

function HealingPulseScaling({ ability }) {
  const levels = Array.isArray(ability?.levels) ? ability.levels : []

  return levels.length ? (
    <div className="class-heal-scaling" aria-label="Healing Pulse scaling">
      {levels.map((level) => <span key={level.level}>Lv {level.level}: {percent(level.healProgress)}</span>)}
    </div>
  ) : null
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
        {feature.id === "healingPulse" ? <HealingPulseScaling ability={feature.ability} /> : null}
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
      <b>Choose wisely.</b>
      <i />
      <span>Each Runner class changes your ability wheel.</span>
    </footer>
  )
}

export default function ClassesScreen() {
  const [config, setConfig] = useState(() => readRunnerClassConfig())

  useEffect(() => {
    const updateConfig = (event) => setConfig(event.detail?.config || readRunnerClassConfig())

    setConfig(readRunnerClassConfig())
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
