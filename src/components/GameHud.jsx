import { useEffect, useRef, useState } from "react"
import { cacheEndScreenSkin, findHudSkin } from "../utils/endScreenSkinCache"
import { getPerkIconSrc } from "../utils/perkIconPaths"
import SkinPreview from "./SkinPreview"
import "../styles/game_hud.css"

const VOID_ABILITY_WHEEL_FALLBACK = [
  { id: "nullRush", name: "Null Rush", shortName: "Rush", cost: 15, summary: "Move faster.", accent: "gray" },
  { id: "redshiftOrbs", name: "Redshift Bloom", shortName: "Redshift", cost: 25, summary: "Corrupts orbs.", accent: "red" },
  { id: "cancel", name: "Cancel", shortName: "Cancel", cost: 0, summary: "Close the wheel.", accent: "muted", cancel: true },
  { id: "voidReveal", name: "Void Sight", shortName: "Sight", cost: 15, summary: "Reveals all Runners.", accent: "purple", cooldown: 20 }
]

const RUNNER_ABILITY_WHEEL_FALLBACK = [
  { id: "collectionBolt", name: "Collection Bolt", shortName: "Collect", cost: 0, summary: "Collect orbs with dart ammo.", accent: "yellow", cooldown: 3, inputType: "m1", shootAbility: true },
  { id: "doubleOrb", name: "Double Orb", shortName: "Double", cost: 10, summary: "Briefly multiply orb pickups.", accent: "yellow", cooldown: 30 },
  { id: "cancel", name: "Cancel", shortName: "Cancel", cost: 0, summary: "Close the wheel.", accent: "muted", cancel: true },
  { id: "moreSoon", name: "More Soon", shortName: "Soon", cost: 0, summary: "More class tools later.", accent: "muted", cancel: true, disabled: true }
]

function abilityFallbackForRole(role) {
  return role === "survivor" ? RUNNER_ABILITY_WHEEL_FALLBACK : VOID_ABILITY_WHEEL_FALLBACK
}

function normalizeAbilities(abilities, role = "killer") {
  const fallback = abilityFallbackForRole(role)
  const safe = Array.isArray(abilities) ? abilities.slice(0, 4) : []
  while (safe.length < 4) safe.push(fallback[safe.length])
  return safe.map((ability, index) => {
    const id = String(ability?.id || fallback[index]?.id || `ability-${index}`)
    const isCancel = !!ability?.cancel || id === "cancel" || id === "moreSoon"
    const disabled = !!ability?.disabled || !!ability?.passive
    return {
      id,
      classId: String(ability?.classId || fallback[index]?.classId || ""),
      name: String(ability?.name || fallback[index]?.name || "Ability"),
      shortName: String(ability?.shortName || ability?.name || fallback[index]?.shortName || "Ability"),
      cost: Number.isFinite(Number(ability?.cost)) ? Number(ability.cost) : Number(fallback[index]?.cost || 0),
      summary: String(ability?.summary || fallback[index]?.summary || "Spend orbs to bend the run."),
      accent: String(ability?.accent || (role === "survivor" ? "cyan" : "purple")),
      cancel: isCancel,
      disabled,
      passive: !!ability?.passive,
      available: isCancel || (ability?.available !== false && !disabled),
      active: !!ability?.active,
      cooldown: Number.isFinite(Number(ability?.cooldown)) ? Number(ability.cooldown) : Number(fallback[index]?.cooldown || (role === "survivor" ? 30 : 20)),
      cooldownRemaining: Math.max(0, Number.isFinite(Number(ability?.cooldownRemaining)) ? Number(ability.cooldownRemaining) : 0),
      inputType: ability?.inputType || (ability?.shootAbility ? "m1" : "q"),
      shootAbility: !!ability?.shootAbility,
      ammo: ability?.ammo == null ? null : Math.max(0, Math.floor(Number(ability.ammo || 0))),
      maxAmmo: ability?.maxAmmo == null ? null : Math.max(1, Math.floor(Number(ability.maxAmmo || 1))),
      reloadRemaining: Math.max(0, Number(ability?.reloadRemaining || 0)),
      fireLockoutRemaining: Math.max(0, Number(ability?.fireLockoutRemaining || ability?.cooldownRemaining || 0)),
      locked: !!ability?.locked,
      testMode: !!ability?.testMode,
      testLevel: Math.max(0, Number.isFinite(Number(ability?.testLevel)) ? Number(ability.testLevel) : 0),
      level: Math.max(0, Number.isFinite(Number(ability?.level)) ? Number(ability.level) : 0),
      maxLevel: Math.max(1, Number.isFinite(Number(ability?.maxLevel)) ? Number(ability.maxLevel) : 4)
    }
  })
}


function abilityIconSrc(ability) {
  const id = String(ability?.id || ability?.key || "")
  if (["healingPulse", "medicAura", "orbMagnet", "cleanFooting"].includes(id)) return ""
  return getPerkIconSrc(ability?.id)
    || getPerkIconSrc(ability?.key)
    || getPerkIconSrc(ability?.name)
    || getPerkIconSrc(ability?.shortName)
}

const ABILITY_CLASS_GLYPHS = {
  orbcollector: "✦",
  nebulizer: "☁",
  escapist: "➟",
  healer: "✚"
}

const ABILITY_GLYPHS = {
  collectionbolt: "✦",
  doubleorb: "◎",
  orbmagnet: "✦",
  smokedart: "☁",
  voidtrace: "☁",
  voidswirl: "🌀",
  dashdart: "➟",
  swiftvault: "➟",
  flowstate: "➟",
  healingdart: "✚",
  fieldmedic: "✚",
  healingpulse: "✚",
  medicaura: "✚",
  cleanfooting: "➤",
  nullrush: "◈",
  redshiftorbs: "✹",
  voidreveal: "◉",
  voidsight: "◉",
  moresoon: "…"
}

function abilityFallbackGlyph(ability) {
  const id = String(ability?.id || ability?.key || "").replace(/[^a-z0-9]/gi, "").toLowerCase()
  const classId = String(ability?.classId || "").replace(/[^a-z0-9]/gi, "").toLowerCase()
  if (ABILITY_GLYPHS[id]) return ABILITY_GLYPHS[id]
  if (ABILITY_CLASS_GLYPHS[classId]) return ABILITY_CLASS_GLYPHS[classId]
  if (/heal|medic/.test(id)) return "✚"
  if (/smoke|nebul|cloud|vapor/.test(id)) return "☁"
  if (/dash|vault|flow|escape|swift/.test(id)) return "➟"
  if (/orb|collect|magnet/.test(id)) return "✦"
  if (/void|swirl|rush|reveal|redshift/.test(id)) return "◈"
  return "✦"
}

function abilityDisplayName(ability) {
  if (!ability) return "Ability"
  const id = String(ability.id || ability.key || "")
  const isShoot = ability.inputType === "m1" || ability.shootAbility
  if (!isShoot) return ability.shortName || ability.name || "Ability"
  if (id === "healingDart") return "Heal Bolt"
  if (id === "dashDart") return "Dash Bolt"
  if (id === "smokeDart") return "Smoke Bolt"
  if (id === "collectionBolt") return "Collect Bolt"
  return `${String(ability.shortName || ability.name || "Bolt").replace(/\s*Dart$/i, "")} Bolt`
}

function abilityTierLabel(ability) {
  if (!ability || ability.cancel || ability.passive || ability.disabled) return ""
  if (ability.locked) return "Locked"
  const rawLevel = ability.testMode ? (ability.testLevel || ability.level) : ability.level
  const level = Math.max(0, Math.floor(Number(rawLevel || 0)))
  const maxLevel = Math.max(1, Math.floor(Number(ability.maxLevel || 3)))
  if (level <= 0) return "Locked"
  if (level >= Math.min(3, maxLevel) || level >= maxLevel) return "Max Level"
  return `Tier ${level}`
}

function abilityWheelHintText(ability, meta) {
  if (!ability || ability.cancel) return ""
  if (ability.locked) return "Unlock this perk from the Perks screen."
  const summary = String(ability.summary || "").replace(/^TEST LV \d+\s*·\s*/i, "").trim()
  const detail = String(meta?.detail || "").trim()
  return summary || detail || "Release Q to use this ability."
}

function abilityStatusMeta(ability) {
  if (!ability) return { label: "", tone: "muted", detail: "" }
  if (ability.cancel) return { label: "Close", tone: "muted", detail: "Release Q to close the wheel." }
  if (ability.passive || ability.disabled) return { label: "Passive", tone: "active", detail: ability.summary || "Passive class bonus." }
  if (ability.locked) return { label: "Locked", tone: "locked", detail: "Unlock this perk in the Perks screen before using it in a match." }
  if (ability.testMode) {
    const level = Math.max(1, Math.floor(Number(ability.testLevel || ability.level || 1)))
    return { label: `Test Lv ${level}`, tone: "ready", detail: `Ability testing is forcing this perk to level ${level}; cost and cooldown are zero.` }
  }

  const isShoot = ability.inputType === "m1" || ability.shootAbility
  if (isShoot) {
    const ammo = Math.max(0, Math.floor(Number(ability.ammo ?? 0)))
    const maxAmmo = Math.max(1, Math.floor(Number(ability.maxAmmo ?? 3)))
    const fireLockout = Math.max(0, Number(ability.fireLockoutRemaining || ability.cooldownRemaining || 0))
    if (ammo <= 0) {
      return {
        label: "No darts",
        tone: "cooldown",
        detail: "Find a Dart Box to refill your bolts."
      }
    }
    if (fireLockout > 0) {
      return {
        label: `${Math.ceil(fireLockout * 10) / 10}s`,
        tone: "cooldown",
        detail: "Bolt chambering. Give the launcher half a second to stop being dramatic."
      }
    }
    return {
      label: `${ammo}/${maxAmmo}`,
      tone: "ready",
      detail: `Ready. ${ammo} of ${maxAmmo} bolts loaded.`
    }
  }

  const cooldownRemaining = Math.max(0, Number(ability.cooldownRemaining || 0))
  if (cooldownRemaining > 0) {
    const seconds = Math.ceil(cooldownRemaining)
    return {
      label: `${seconds}s`,
      tone: "cooldown",
      detail: `Cooling down for ${seconds}s.`
    }
  }

  if (ability.active) {
    return {
      label: "Active",
      tone: "active",
      detail: ability.duration > 0 ? `Active for about ${Math.ceil(ability.duration)}s.` : "Already active."
    }
  }

  if (ability.available === false) {
    return {
      label: `Need ${ability.cost}`,
      tone: "warning",
      detail: `Needs ${ability.cost} orbs to use.`
    }
  }

  return {
    label: `${ability.cost} orbs`,
    tone: "ready",
    detail: `Ready to use for ${ability.cost} orbs.`
  }
}

export function AbilityWheel() {
  const [wheel, setWheel] = useState({
    open: false,
    role: "killer",
    title: "Void abilities",
    orbs: 0,
    abilities: VOID_ABILITY_WHEEL_FALLBACK,
    selected: -1
  })

  const openRef = useRef(false)
  const selectedRef = useRef(-1)
  const lastPointerRef = useRef(null)
  const abilitiesRef = useRef(VOID_ABILITY_WHEEL_FALLBACK)
  const roleRef = useRef("killer")

  useEffect(() => {
    const setSelected = (selected) => {
      selectedRef.current = selected
      setWheel((current) => current.selected === selected ? current : { ...current, selected })
    }

    const handlePointerMove = (event) => {
      const point = { x: event.clientX, y: event.clientY }
      lastPointerRef.current = point
      if (openRef.current) setSelected(getChatWheelSelectionFromPoint(point))
    }

    const handleOpen = (event) => {
      const detail = event.detail || {}
      const role = detail.role === "survivor" ? "survivor" : "killer"
      const point = detail.pointer || lastPointerRef.current
      const selected = getChatWheelSelectionFromPoint(point)
      const abilities = normalizeAbilities(detail.abilities, role)
      abilitiesRef.current = abilities
      roleRef.current = role
      openRef.current = true
      selectedRef.current = selected
      setWheel({
        open: true,
        role,
        title: String(detail.title || (role === "survivor" ? "Runner abilities" : "Void abilities")),
        orbs: Number(detail.orbs || 0),
        abilities,
        selected
      })
    }

    const handleUpdate = (event) => {
      const detail = event.detail || {}
      setWheel((current) => {
        const role = detail.role === "survivor" ? "survivor" : current.role
        const abilities = detail.abilities ? normalizeAbilities(detail.abilities, role) : current.abilities
        abilitiesRef.current = abilities
        roleRef.current = role
        return {
          ...current,
          role,
          title: String(detail.title || current.title),
          orbs: Number(detail.orbs ?? current.orbs ?? 0),
          abilities
        }
      })
    }

    const handleClose = (event) => {
      const shouldSubmit = event.detail?.submit !== false
      const selected = selectedRef.current
      const ability = abilitiesRef.current[selected]

      if (shouldSubmit && selected >= 0 && !ability?.cancel && ability?.available !== false) {
        window.dispatchEvent(new CustomEvent("riftrunner:ability-submit", { detail: { index: selected, role: roleRef.current } }))
      }

      openRef.current = false
      selectedRef.current = -1
      setWheel((current) => ({ ...current, open: false, selected: -1 }))
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("riftrunner:ability-open", handleOpen)
    window.addEventListener("riftrunner:ability-update", handleUpdate)
    window.addEventListener("riftrunner:ability-close", handleClose)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("riftrunner:ability-open", handleOpen)
      window.removeEventListener("riftrunner:ability-update", handleUpdate)
      window.removeEventListener("riftrunner:ability-close", handleClose)
    }
  }, [])

  return (
    <div className={`ability-wheel-overlay ${wheel.open ? "is-open" : ""} is-${wheel.role === "survivor" ? "runner" : "void"}`} aria-hidden={!wheel.open}>
      <div className="ability-wheel-backdrop" />
      <div className="ability-wheel" role="menu" aria-label={wheel.title}>
        <div className="ability-wheel-center" aria-hidden="true">
          <img className="ability-wheel-orb-icon" src="/images/orb.png" alt="" />
          <strong>{wheel.orbs}</strong>
          <span>orbs</span>
        </div>
        {CHAT_WHEEL_SEGMENTS.map((segment) => {
          const fallback = abilityFallbackForRole(wheel.role)[segment.index]
          const ability = wheel.abilities[segment.index] || fallback
          const selected = wheel.selected === segment.index
          const cancel = !!ability.cancel
          const ready = cancel || ability.passive || ability.available !== false
          const meta = abilityStatusMeta(ability)
          const iconSrc = cancel ? "" : abilityIconSrc(ability)
          const hint = selected ? abilityWheelHintText(ability, meta) : ""
          return (
            <div
              className={`ability-wheel-segment ability-wheel-${segment.className} ${selected ? "selected" : ""} ${ready ? "can-use" : "locked"} ${ability.active ? "is-active" : ""} ${cancel ? "is-cancel" : ""} accent-${ability.accent || "purple"}`}
              role="menuitem"
              aria-label={cancel ? "Cancel ability wheel" : `${ability.name}, ${meta.label}`}
              key={`${wheel.role}-${ability.id}-${segment.index}`}
            >
              {hint ? <div className={`ability-wheel-hint ability-wheel-hint-${segment.className}`}>{hint}</div> : null}
              <div className="ability-wheel-segment-main">
                {iconSrc ? (
                  <img
                    className="ability-icon-image"
                    src={iconSrc}
                    alt=""
                    aria-hidden="true"
                    draggable="false"
                  />
                ) : (
                  <div className={`ability-icon-fallback accent-${ability.accent || "purple"}`} aria-hidden="true">{abilityFallbackGlyph(ability)}</div>
                )}
                <span className="ability-name">{abilityDisplayName(ability)}</span>
              </div>
              <span className={`ability-status-pill tone-${meta.tone}`}>{meta.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ABILITY_HUD_CONFIG = {
  void: {
    eventName: "riftrunner:void-ability-hud",
    wrapperClassName: "void-ability-hud",
    bankClassName: "void-orb-bank",
    iconClassName: "void-orb-icon",
    effectsClassName: "void-active-effects",
    label: "Void Orbs"
  },
  runner: {
    eventName: "riftrunner:runner-ability-hud",
    wrapperClassName: "void-ability-hud runner-ability-hud",
    bankClassName: "void-orb-bank runner-orb-bank",
    iconClassName: "void-orb-icon runner-orb-icon",
    effectsClassName: "void-active-effects runner-active-effects",
    label: "Runner Orbs"
  }
}

function useAbilityHud(eventName) {
  const [hud, setHud] = useState({ visible: false, orbs: 0, effects: [], abilities: [] })

  useEffect(() => {
    const handleHud = (event) => {
      const detail = event.detail || {}
      setHud({
        visible: !!detail.visible,
        orbs: Number(detail.orbs || 0),
        effects: Array.isArray(detail.effects) ? detail.effects : [],
        abilities: Array.isArray(detail.abilities) ? detail.abilities : []
      })
    }

    window.addEventListener(eventName, handleHud)
    return () => window.removeEventListener(eventName, handleHud)
  }, [eventName])

  return hud
}

function ActiveAbilityEffects({ effects, className }) {
  return effects.length ? (
    <div className={className}>
      {effects.map((effect) => (
        <span key={effect.id}>{effect.label} {Math.ceil(effect.time)}s</span>
      ))}
    </div>
  ) : null
}

function AbilityHoldHint() {
  return (
    <div className="ability-hold-hint" aria-label="Hold Q for abilities">
      <span>Hold</span>
      <kbd className="ability-hold-key">Q</kbd>
      <span>for abilities</span>
    </div>
  )
}

function abilityReadinessLabel(ability) {
  if (!ability) return ""
  if (ability.locked) return "Locked"
  const isShoot = ability.inputType === "m1" || ability.shootAbility
  if (isShoot && !ability.testMode) {
    const ammo = Math.max(0, Math.floor(Number(ability.ammo ?? 0)))
    const maxAmmo = Math.max(1, Math.floor(Number(ability.maxAmmo ?? 3)))
    const fireLockout = Math.max(0, Number(ability.fireLockoutRemaining || ability.cooldownRemaining || 0))
    if (ammo <= 0) return "No darts"
    if (fireLockout > 0) return `${Math.ceil(fireLockout * 10) / 10}s`
    return `${ammo}/${maxAmmo}`
  }
  const cooldown = Math.max(0, Number(ability.cooldownRemaining || 0))
  if (cooldown > 0) return `${Math.ceil(cooldown)}s`
  if (ability.available === false) return `Need ${Math.max(0, Number(ability.cost || 0))}`
  if (ability.active) return "Active"
  if (ability.testMode) return "Test"
  return "Ready"
}

function AbilityReadyIcon({ ability, iconSrc }) {
  const [failed, setFailed] = useState(false)
  const accent = ability?.accent || "purple"
  const hasImage = !!iconSrc && !failed

  return (
    <div className={`ability-ready-icon-wrap accent-${accent} ${hasImage ? "has-image" : "has-fallback"}`}>
      {hasImage ? (
        <img
          className="ability-ready-icon"
          src={iconSrc}
          alt=""
          aria-hidden="true"
          draggable="false"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={`ability-ready-glyph accent-${accent}`} aria-hidden="true">{abilityFallbackGlyph(ability)}</span>
      )}
    </div>
  )
}

const QUICK_Q_ABILITY_SLOTS = 4

function AbilityReadinessStrip({ abilities = [], role = "runner" }) {
  const visibleAbilities = abilities.filter((ability) => ability && !ability.cancel && !ability.passive && !ability.disabled)
  const qAbilityIds = visibleAbilities
    .filter((ability) => !(ability.inputType === "m1" || ability.shootAbility))
    .slice(0, QUICK_Q_ABILITY_SLOTS)
    .map((ability) => ability.id)
  if (!visibleAbilities.length) return null

  return (
    <div className={`ability-ready-strip is-${role}`} aria-label="Ability readiness">
      {visibleAbilities.map((ability) => {
        const ready = ability.available !== false && !ability.locked && Math.max(0, Number(ability.cooldownRemaining || 0)) <= 0
        const iconSrc = abilityIconSrc(ability)
        const isShoot = ability.inputType === "m1" || ability.shootAbility
        const qSlot = isShoot ? -1 : qAbilityIds.indexOf(ability.id)
        const tierLabel = abilityTierLabel(ability)
        return (
          <div
            className={`ability-ready-entry ${isShoot || qSlot >= 0 ? "has-input" : ""} ${ready ? "is-ready" : "is-unavailable"}`}
            key={ability.id}
          >
            {isShoot ? (
              <img className="ability-ready-input-icon" src="/images/mouse_click.png" alt="M1" draggable="false" />
            ) : qSlot >= 0 ? (
              <kbd className={`ability-ready-input-key accent-${ability.accent || "cyan"}`} aria-label={`Press ${qSlot + 1}`}>{qSlot + 1}</kbd>
            ) : null}
            <div
              className={`ability-ready-item ${ready ? "is-ready" : "is-unavailable"} ${ability.active ? "is-active" : ""} accent-${ability.accent || "cyan"}`}
            >
              <AbilityReadyIcon ability={ability} iconSrc={iconSrc} />
              <div className="ability-ready-copy">
                <strong>{abilityDisplayName(ability)}</strong>
                {tierLabel ? <small>{tierLabel}</small> : null}
                <span>{abilityReadinessLabel(ability)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AbilityHudShell({ type }) {
  const config = ABILITY_HUD_CONFIG[type]
  const hud = useAbilityHud(config.eventName)

  return hud.visible ? (
    <>
      <div className={config.wrapperClassName} aria-live="polite">
        <div className={config.bankClassName}>
          <img className={config.iconClassName} src="/images/orb.png" alt="" aria-hidden="true" />
          <div>
            <span>{config.label}</span>
            <strong>{hud.orbs}</strong>
          </div>
        </div>
        <ActiveAbilityEffects effects={hud.effects} className={config.effectsClassName} />
      </div>
      <div className={`ability-controls-corner is-${type === "void" ? "void" : "runner"}`} aria-label="Ability controls">
        <AbilityReadinessStrip abilities={hud.abilities} role={type === "void" ? "void" : "runner"} />
        <AbilityHoldHint />
      </div>
    </>
  ) : null
}

export function VoidAbilityHud() {
  return <AbilityHudShell type="void" />
}

export function RunnerAbilityHud() {
  return <AbilityHudShell type="runner" />
}

const CHAT_WHEEL_FALLBACK_MESSAGES = ["Let's feed a rift.", "I'm so scared...", "Here he comes!", "What was that?!"]

const SURVIVOR_DOT_MAX = Number(window.GAMEPLAY_CONFIG?.orbs?.survivorMax) || 30

const ORB_FULL_CHAT_MESSAGES = new Set([
  "I have too many orbs...",
  "I should deposit these",
  "I can't pick any more up.",
  "I'm getting full..."
])

function visibleChatTextForActor(actor) {
  const text = actor?.chatText || ""
  if (!text) return ""
  if ((actor.downed || actor.hooked || actor.dead || actor.escaped) && ORB_FULL_CHAT_MESSAGES.has(text)) return ""
  return text
}

function survivorStateLabel(actor) {
  if (actor.dead) return "Dead"
  if (actor.escaped) return "Escaped"
  if (actor.escapeProgress > 0) return `Escaping ${Math.round((actor.escapeProgress || 0) * 100)}%`
  if (actor.hooked) return actor.unhookProgress > 0 ? "Being Rescued" : `Bound ${actor.hookCount || 1}/2`
  if (actor.downed) {
    if (actor.healProgress > 0) return "Being Healed"
    return actor.hookProgress > 0 ? ((actor.hookCount || 0) >= 2 ? "Being Executed" : "Being Bound") : "Downed"
  }
  if (actor.dotDepositTargetId) return `Depositing ${Math.round((actor.dotDepositProgress || 0) * 100)}%`
  if (actor.health <= 1 || actor.injured) return actor.healProgress > 0 ? "Being Healed" : "Injured"
  return "Healthy"
}

function survivorCardClass(actor, myId, spectateTargetId, spectating) {
  const classes = ["survivor-status-card"]
  if (actor.id === myId) classes.push("self")
  if (spectating && actor.id === spectateTargetId) classes.push("spectating")
  if (actor.dead) classes.push("dead")
  else if (actor.escaped) classes.push("escaped")
  else if (actor.hooked) classes.push("hooked")
  else if (actor.downed) classes.push("downed")
  else if (actor.health <= 1 || actor.injured) classes.push("injured")
  else classes.push("healthy")
  if (actor.chase && !actor.dead && !actor.escaped && !actor.hooked && !actor.downed) classes.push("chased")
  return classes.join(" ")
}

function actionLabel(actor) {
  if (actor.dead) return "skull"
  if (actor.escaped) return "out"
  if (actor.hooked) return actor.unhookProgress > 0 ? "rescue" : "bound"
  if (actor.downed) {
    if (actor.healProgress > 0) return "heal"
    return actor.hookProgress > 0 ? ((actor.hookCount || 0) >= 2 ? "execute" : "capture") : "down"
  }
  if (actor.chase) return "chase"
  if (actor.dotDepositTargetId) return "feed"
  if (actor.healProgress > 0) return "heal"
  if (actor.health <= 1 || actor.injured) return "hurt"
  return "safe"
}

function SpectateHintCard({ show }) {
  return show ? (
    <div className="spectate-hint-card" role="status">
      <span>Tab</span> switch view
      <i aria-hidden="true" />
      <span>Esc</span> exit
    </div>
  ) : null
}

function KillerChatCard({ killerChat }) {
  return killerChat ? (
    <div className="survivor-status-card killer-chat-card has-chat">
      <SkinPreview skin={killerChat.skin} role={killerChat.skinRole || "void"} variant="hud-status" className="survivor-portrait killer-portrait survivor-skin-portrait" />
      <div className="survivor-meta">
        <div className="survivor-name-row">
          <span className="survivor-name">{killerChat.name}</span>
          <span className="survivor-you">VOID</span>
        </div>
      </div>
      <div className="survivor-action">chat</div>
      {killerChat.chat ? (
        <div className="survivor-chat survivor-chat-bubble" role="status">&quot;{killerChat.chat}&quot;</div>
      ) : null}
    </div>
  ) : null
}

function SurvivorStatusCard({ actor, myId }) {
  return (
    <div className={`${actor.className}${actor.chat ? " has-chat" : ""}`}>
      <SkinPreview skin={actor.skin} role={actor.skinRole || "runner"} variant="hud-status" className="survivor-portrait survivor-skin-portrait" />
      <div className="survivor-meta">
        <div className="survivor-name-row">
          <span className="survivor-name">{actor.name}</span>
          {actor.id === myId ? <span className="survivor-you">You</span> : null}
        </div>
        <div className="survivor-state">{actor.state}</div>
        <div className="survivor-dots" aria-label="Collectible dots">
          {actor.dotsHeld} / {SURVIVOR_DOT_MAX}{actor.depositText}
        </div>
      </div>
      <div className="survivor-action">{actor.action}</div>
      {actor.chat ? (
        <div className="survivor-chat survivor-chat-bubble" role="status">&quot;{actor.chat}&quot;</div>
      ) : null}
    </div>
  )
}

function EmptySurvivorState({ show }) {
  return show ? (
    <div className="survivor-status-card dead">
      <div className="survivor-portrait" />
      <div className="survivor-meta">
        <div className="survivor-name">No runners</div>
        <div className="survivor-state">The void is quiet</div>
      </div>
      <div className="survivor-action">void</div>
    </div>
  ) : null
}

function RiftCounterCard() {
  return (
    <div id="bigGenCounter" className="big-gen-counter hidden" aria-live="polite">
      <div className="big-gen-icon rift-counter-icon" aria-hidden="true">
        <span className="rift-counter-core" />
        <span className="rift-counter-orbit orbit-a" />
        <span className="rift-counter-orbit orbit-b" />
        <span className="rift-counter-orbit orbit-c" />
      </div>
      <div className="big-gen-copy">
        <span>Rifts sealed</span>
        <strong id="bigGenText">0 / 5</strong>
      </div>
    </div>
  )
}

function MatchStatusCluster({ hud }) {
  const showEmpty = !hud.survivors.length && !hud.killerChat

  return (
    <section className="match-status-cluster" aria-label="Match status">
      <div id="survivorStatusHud" className="survivor-status-list hidden" aria-live="polite">
        <SpectateHintCard show={hud.spectating && hud.canCycleSpectate} />
        <KillerChatCard killerChat={hud.killerChat} />
        {hud.survivors.map((actor) => (
          <SurvivorStatusCard actor={actor} myId={hud.myId} key={actor.id} />
        ))}
        <EmptySurvivorState show={showEmpty} />
      </div>
      <RiftCounterCard />
    </section>
  )
}

const CHAT_WHEEL_SEGMENTS = [
  { index: 0, className: "top" },
  { index: 1, className: "right" },
  { index: 2, className: "bottom" },
  { index: 3, className: "left" }
]

function getChatWheelSelectionFromPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return -1

  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2
  const dx = point.x - cx
  const dy = point.y - cy
  const distance = Math.hypot(dx, dy)

  if (distance < 44) return -1

  const angle = Math.atan2(dy, dx)
  if (angle >= -Math.PI * 0.25 && angle < Math.PI * 0.25) return 1
  if (angle >= Math.PI * 0.25 && angle < Math.PI * 0.75) return 2
  if (angle <= -Math.PI * 0.25 && angle > -Math.PI * 0.75) return 0
  return 3
}

function normalizeChatMessages(messages) {
  const safe = Array.isArray(messages) ? messages.slice(0, 4) : []
  while (safe.length < 4) safe.push(CHAT_WHEEL_FALLBACK_MESSAGES[safe.length] || "...")
  return safe.map((message) => String(message || "..."))
}

export function ChatWheel() {
  const [wheel, setWheel] = useState({
    open: false,
    role: "survivor",
    state: "normal",
    messages: CHAT_WHEEL_FALLBACK_MESSAGES,
    selected: -1
  })

  const openRef = useRef(false)
  const selectedRef = useRef(-1)
  const lastPointerRef = useRef(null)

  useEffect(() => {
    const setSelected = (selected) => {
      selectedRef.current = selected
      setWheel((current) => current.selected === selected ? current : { ...current, selected })
    }

    const handlePointerMove = (event) => {
      const point = { x: event.clientX, y: event.clientY }
      lastPointerRef.current = point
      if (openRef.current) setSelected(getChatWheelSelectionFromPoint(point))
    }

    const handleOpen = (event) => {
      const detail = event.detail || {}
      const point = detail.pointer || lastPointerRef.current
      const selected = getChatWheelSelectionFromPoint(point)
      openRef.current = true
      selectedRef.current = selected
      setWheel({
        open: true,
        role: detail.role === "killer" ? "killer" : "survivor",
        state: String(detail.state || "normal"),
        messages: normalizeChatMessages(detail.messages),
        selected
      })
    }

    const handleClose = (event) => {
      const shouldSubmit = event.detail?.submit !== false
      const selected = selectedRef.current

      if (shouldSubmit && selected >= 0) {
        window.dispatchEvent(new CustomEvent("voidrift:chat-wheel-submit", { detail: { index: selected } }))
      }

      openRef.current = false
      selectedRef.current = -1
      setWheel((current) => ({ ...current, open: false, selected: -1 }))
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("voidrift:chat-wheel-open", handleOpen)
    window.addEventListener("voidrift:chat-wheel-close", handleClose)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("voidrift:chat-wheel-open", handleOpen)
      window.removeEventListener("voidrift:chat-wheel-close", handleClose)
    }
  }, [])

  return (
    <div className={`chat-wheel-overlay ${wheel.open ? "is-open" : ""} ${wheel.role === "killer" ? "is-killer" : "is-survivor"}`} aria-hidden={!wheel.open}>
      <div className="chat-wheel-backdrop" />
      <div className="chat-wheel" role="menu" aria-label="Quick chat wheel">
        <div className="chat-wheel-center" aria-hidden="true"><span>Chat</span></div>
        {CHAT_WHEEL_SEGMENTS.map((segment) => {
          const selected = wheel.selected === segment.index
          return (
            <div
              className={`chat-wheel-segment chat-wheel-${segment.className} ${selected ? "selected" : ""}`}
              role="menuitem"
              aria-label={wheel.messages[segment.index]}
              key={segment.index}
            >
              <span>{wheel.messages[segment.index]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SurvivorStatusHud() {
  const [hud, setHud] = useState({
    survivors: [],
    killerChat: null,
    myId: null,
    spectating: false,
    canCycleSpectate: false
  })

  useEffect(() => {
    const handleHud = (event) => {
      const detail = event.detail || {}
      const snapshot = detail.snapshot || {}
      const myId = detail.myId || null
      const spectateTargetId = detail.spectateTargetId || null
      const spectating = !!detail.spectating
      const actors = snapshot.actors || []
      const dedicatedSpectator = snapshot.viewer?.id === myId && snapshot.viewer?.role === "spectator"
      const killer = actors.find((actor) => actor.role === "killer" && visibleChatTextForActor(actor))
      const livingSpectateTargets = actors.filter((actor) => dedicatedSpectator
        ? ((actor.role === "killer" && !actor.dead) || (actor.role === "survivor" && !actor.dead && !actor.escaped))
        : (
          actor.role === "survivor"
          && actor.id !== myId
          && !actor.dead
          && !actor.escaped
        ))
      const survivors = actors
        .filter((actor) => actor.role === "survivor")
        .sort((a, b) => {
          if (a.id === myId) return -1
          if (b.id === myId) return 1
          return String(a.name || "").localeCompare(String(b.name || ""))
        })
        .map((actor) => {
          const skin = findHudSkin(actor, "runner")
          cacheEndScreenSkin(actor, "runner", skin)
          return {
            id: actor.id,
            name: actor.name || "Runner",
            state: survivorStateLabel(actor),
            className: survivorCardClass(actor, myId, spectateTargetId, spectating),
            chat: visibleChatTextForActor(actor),
            action: actionLabel(actor),
            dotsHeld: Math.min(SURVIVOR_DOT_MAX, actor.dots || 0),
            skin,
            skinRole: "runner",
            depositText: actor.dotDepositTargetId
              ? ` • feeding ${Math.round((actor.dotDepositProgress || 0) * 100)}%`
              : ""
          }
        })

      setHud({
        myId,
        survivors,
        spectating,
        canCycleSpectate: livingSpectateTargets.length > 0,
        killerChat: killer
          ? (() => {
              const skin = findHudSkin(killer, "void")
              cacheEndScreenSkin(killer, "void", skin)
              return {
                name: killer.name || "The Void",
                chat: visibleChatTextForActor(killer),
                skin,
                skinRole: "void"
              }
            })()
          : null
      })
    }

    window.addEventListener("voidrift:survivor-status-hud", handleHud)
    return () => window.removeEventListener("voidrift:survivor-status-hud", handleHud)
  }, [])

  return <MatchStatusCluster hud={hud} />
}

export function PointFeed() {
  const [items, setItems] = useState([])
  const nextId = useRef(1)

  useEffect(() => {
    const timers = new Set()

    const handleScoreGain = (event) => {
      const label = String(event.detail?.label || "Point gained").trim().slice(0, 42)
      const amount = Math.max(1, Math.floor(Number(event.detail?.amount) || 1))
      const kind = String(event.detail?.kind || "point").trim().slice(0, 18)
      const id = nextId.current++

      setItems((current) => [
        { id, label, amount, kind },
        ...current
      ].slice(0, 3))

      const timer = window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id))
        timers.delete(timer)
      }, 1850)
      timers.add(timer)
    }

    window.addEventListener("voidrift:score-gain", handleScoreGain)
    return () => {
      window.removeEventListener("voidrift:score-gain", handleScoreGain)
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  return (
    <div className={`point-feed ${items.length ? "is-active" : ""}`} aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <div className={`point-feed-item is-${item.kind}`} key={item.id}>
          {String(item.kind).includes("orb") && <img className="point-feed-orb-icon" src="/images/orb.png" alt="" aria-hidden="true" />}
          <span>{item.label}</span>
          <strong>+{item.amount}</strong>
        </div>
      ))}
    </div>
  )
}

export function HookEdgeIndicators() {
  const [indicators, setIndicators] = useState([])

  useEffect(() => {
    const handleIndicators = (event) => {
      const items = Array.isArray(event.detail?.items) ? event.detail.items : []
      setIndicators(items)
    }

    window.addEventListener("voidrift:hook-indicators", handleIndicators)
    return () => window.removeEventListener("voidrift:hook-indicators", handleIndicators)
  }, [])

  return (
    <div className={`hook-edge-indicators ${indicators.length ? "is-active" : ""}`} aria-hidden={!indicators.length}>
      {indicators.map((indicator) => (
        <div
          className={`hook-edge-indicator ${indicator.danger ? "danger" : ""}`}
          style={{
            left: `${Number(indicator.x) || 0}px`,
            top: `${Number(indicator.y) || 0}px`,
            "--hook-angle": `${Number(indicator.angle) || 0}rad`
          }}
          title={`${indicator.name || "Runner"} is bound`}
          key={indicator.id}
        >
          <span className="hook-edge-arrow" aria-hidden="true" />
          <span className="hook-edge-mark">!</span>
        </div>
      ))}
    </div>
  )
}

function isTextEntryElement(element) {
  if (!element) return false
  const tag = String(element.tagName || "").toLowerCase()
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable
}

function getPossiblePhaserCamera() {
  if (typeof window === "undefined") return null
  const candidates = [
    window.__RIFTRUNNER_GAME__,
    window.__VOIDRIFT_GAME__,
    window.__VOIDRIFT_CLIENT__?.game,
    window.__RIFTRUNNER_CLIENT__?.game,
    window.phaserGame,
    window.game
  ].filter(Boolean)

  for (const candidate of candidates) {
    const scenes = candidate.scene?.scenes || candidate.scenes || []
    for (const scene of scenes) {
      const camera = scene?.cameras?.main
      if (camera && Number.isFinite(camera.scrollX) && Number.isFinite(camera.scrollY)) return camera
    }
    const camera = candidate.cameras?.main
    if (camera && Number.isFinite(camera.scrollX) && Number.isFinite(camera.scrollY)) return camera
  }

  return null
}

function projectBotDebugPoint(actor, snapshot, detail) {
  if (typeof window === "undefined") return { x: -9999, y: -9999, hidden: true }
  const wrap = document.getElementById("gameWrap")
  const canvas = wrap?.querySelector?.("canvas") || wrap
  const rect = canvas?.getBoundingClientRect?.()
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: -9999, y: -9999, hidden: true }

  const cameraFromEvent = detail?.camera || snapshot?.camera || window.__RIFTRUNNER_DEBUG_CAMERA__ || window.__VOIDRIFT_DEBUG_CAMERA__
  const camera = cameraFromEvent || getPossiblePhaserCamera()
  if (camera) {
    const zoom = Number(camera.zoom || camera.scale || 1) || 1
    const cameraWidth = Number(camera.width || rect.width) || rect.width
    const cameraHeight = Number(camera.height || rect.height) || rect.height
    const scaleX = rect.width / cameraWidth
    const scaleY = rect.height / cameraHeight
    const worldView = camera.worldView || null
    const scrollX = Number(worldView?.x ?? camera.scrollX ?? 0)
    const scrollY = Number(worldView?.y ?? camera.scrollY ?? 0)
    const x = rect.left + ((actor.x || 0) - scrollX) * zoom * scaleX
    const y = rect.top + ((actor.y || 0) - scrollY) * zoom * scaleY
    return {
      x: Math.max(8, Math.min(window.innerWidth - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - 8, y - 58)),
      hidden: x < rect.left - 120 || x > rect.right + 120 || y < rect.top - 140 || y > rect.bottom + 120
    }
  }

  const actors = Array.isArray(snapshot?.actors) ? snapshot.actors : []
  const viewer = snapshot?.viewer || {}
  const focusId = viewer.spectateTargetId && viewer.spectateTargetId !== "__overview__" ? viewer.spectateTargetId : (detail?.myId || snapshot?.viewerId)
  const focusActor = actors.find((item) => item.id === focusId)
    || actors.find((item) => item.id === snapshot?.viewerId)
    || actors.find((item) => item.role === "killer")
    || actors[0]

  const map = snapshot?.map || {}
  const overview = viewer.spectateTargetId === "__overview__"
  const zoom = overview && map.width && map.height
    ? Math.min(rect.width / map.width, rect.height / map.height)
    : document.body.classList.contains("in-chase") ? 0.68 : 1
  const centerX = overview && map.width ? map.width / 2 : (focusActor?.x || actor.x || 0)
  const centerY = overview && map.height ? map.height / 2 : (focusActor?.y || actor.y || 0)
  const x = rect.left + rect.width / 2 + ((actor.x || 0) - centerX) * zoom
  const y = rect.top + rect.height / 2 + ((actor.y || 0) - centerY) * zoom

  return {
    x: Math.max(8, Math.min(window.innerWidth - 8, x)),
    y: Math.max(8, Math.min(window.innerHeight - 8, y - 58)),
    hidden: x < rect.left - 120 || x > rect.right + 120 || y < rect.top - 140 || y > rect.bottom + 120
  }
}

function botDebugLines(actor) {
  const debug = actor.aiDebug || {}
  const target = debug.targetId || debug.nextTargetId || "none"
  const actionBits = [
    debug.move && `move:${debug.move}`,
    debug.sprint ? "sprint" : "",
    debug.action ? "action" : "",
    debug.repair ? "repair" : "",
    debug.attackHeld ? "M1-hold" : ""
  ].filter(Boolean).join(" ")

  const pausedBadge = debug.pausedSnapshot ? " [last live]" : ""
  const lines = [
    `${actor.name || "Bot"} • ${debug.mode || "AI"}${pausedBadge}`,
    `${debug.reason || debug.taskKind || "thinking"} → ${target}`,
    `path:${debug.pathLength ?? 0} stuck:${debug.stuckFor ?? 0}s repath:${debug.repathIn ?? 0}s`,
    actionBits || "input:none"
  ]

  if (debug.pausedSnapshot) {
    lines.splice(1, 0, `PAUSED live:${debug.liveAge ?? 0}s ago paused:${debug.pausedFor ?? 0}s`)
    if (debug.frozenMove && debug.frozenMove !== debug.move) {
      lines.push(`frozen input:${debug.frozenMove} live input:${debug.move || "none"}`)
    }
  }
  if (debug.survivalKind) lines.splice(debug.pausedSnapshot ? 3 : 2, 0, `survival:${debug.survivalKind} lock:${debug.survivalLock ?? 0}s`)
  if (debug.nextKind) lines.splice(debug.pausedSnapshot ? 3 : 2, 0, `next:${debug.nextKind}`)
  if (debug.moveIntent) lines.push(`intent:${debug.moveIntent.x},${debug.moveIntent.y} ttl:${debug.moveIntent.ttl}s`)
  if (debug.obstacleCommit) lines.push(`obstacle:${debug.obstacleCommit.type || "?"} ${debug.obstacleCommit.targetId || "?"}`)
  return lines.slice(0, debug.pausedSnapshot ? 8 : 6)
}

export function BotDebugOverlay() {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return false
    return window.localStorage?.getItem("riftrunnerBotDebug") === "1"
  })
  const [frame, setFrame] = useState({ snapshot: null, detail: null })

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.code !== "BracketLeft" && event.key !== "[") return
      if (isTextEntryElement(event.target)) return
      event.preventDefault()
      setEnabled((current) => {
        const next = !current
        try {
          window.localStorage?.setItem("riftrunnerBotDebug", next ? "1" : "0")
        } catch {
          // localStorage can be blocked. Humanity continues its gentle decline.
        }
        window.dispatchEvent(new CustomEvent("riftrunner:bot-debug-toggle", { detail: { enabled: next } }))
        return next
      })
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  useEffect(() => {
    const handleSnapshotEvent = (event) => {
      const detail = event.detail || {}
      const snapshot = detail.snapshot || detail
      if (!snapshot?.actors) return
      setFrame({ snapshot, detail })
    }

    window.addEventListener("voidrift:survivor-status-hud", handleSnapshotEvent)
    window.addEventListener("riftrunner:snapshot", handleSnapshotEvent)
    window.addEventListener("voidrift:snapshot", handleSnapshotEvent)
    return () => {
      window.removeEventListener("voidrift:survivor-status-hud", handleSnapshotEvent)
      window.removeEventListener("riftrunner:snapshot", handleSnapshotEvent)
      window.removeEventListener("voidrift:snapshot", handleSnapshotEvent)
    }
  }, [])

  const snapshot = frame.snapshot
  const actors = Array.isArray(snapshot?.actors) ? snapshot.actors : []
  const bots = enabled
    ? actors.filter((actor) => actor?.aiDebug && !actor.dead && !actor.escaped)
    : []

  return (
    <div className={`bot-debug-overlay ${enabled ? "is-enabled" : ""}`} aria-hidden={!enabled}>
      {bots.map((actor) => {
        const point = projectBotDebugPoint(actor, snapshot, frame.detail)
        if (point.hidden) return null
        return (
          <div
            className={`bot-debug-label ${actor.role === "killer" ? "is-void" : "is-runner"} ${actor.aiDebug?.stuckFor >= 0.8 ? "is-stuck" : ""} ${actor.aiDebug?.pausedSnapshot ? "is-paused-live" : ""}`}
            style={{ left: `${point.x}px`, top: `${point.y}px` }}
            key={actor.id}
          >
            {botDebugLines(actor).map((line, index) => (
              <span key={`${actor.id}-${index}`}>{line}</span>
            ))}
          </div>
        )
      })}
    </div>
  )
}


function RoleHudSkinPreview() {
  return <SkinPreview id="roleHudSkin" role="runner" variant="role-hud" className="role-hud-skin" />
}

function RoleHudCard() {
  return (
    <div id="roleHudCard" className="hud-card compact-card role-hud-card">
      <div id="roleHudIcon" className="role-hud-icon" aria-hidden="true">
        <RoleHudSkinPreview />
      </div>
      <div className="role-hud-copy">
        <span>Playing as</span>
        <h2 id="roleLabel">Runner</h2>
        <div id="fpsCounterRow" className="fps-counter-row">
          <span>FPS</span>
          <b id="fpsText">--</b>
        </div>
      </div>
    </div>
  )
}


function MatchAnnouncementRegion() {
  return <div id="matchAnnouncements" className="match-announcements" aria-live="polite" />
}

function HorrorFxOverlay() {
  return (
    <div id="horrorFx" className="horror-fx hidden" aria-hidden="true">
      <div className="fx-vignette" />
      <div className="fx-blood" />
      <div className="fx-hit" />
      <div className="fx-terror" />
      <div className="fx-focus" />
      <div className="fx-speed-boost" />
      <div className="fx-grain" />
    </div>
  )
}

export function GameHud() {
  return (
    <>
      <div id="hud" className="hud hidden" data-role="survivor">
        <RoleHudCard />
      </div>
      <MatchAnnouncementRegion />
      <HorrorFxOverlay />
    </>
  )
}
