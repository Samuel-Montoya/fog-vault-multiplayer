import { useEffect, useRef, useState } from "react"
import "./styles/voidrift.css"

const LEGACY_SCRIPT_CHAIN = [
  "/socket.io/socket.io.js",
  "/vendor/phaser.min.js",
  "/maps.js",
  "/audioConfig.js",
  "/gameplayConfig.js",
  "/chats.js",
  "/abilities.js",
  "/client.js"
]

const MENU_ACTIONS = [
  { id: "menuPlayBtn", label: "Play", className: "menu-action primary" },
  { id: "menuSkinsBtn", label: "Runner Skins", className: "menu-action" },
  { id: "menuOptionsBtn", label: "Settings", className: "menu-action" },
  { id: "menuHowBtn", label: "How To Play", className: "menu-action" }
]

const SKINS = [
  { id: "blueSquare", label: "Azure Orbit", className: "skin-square" },
  { id: "yellowStar", label: "Solar Sprite", className: "skin-star" },
  { id: "purplePentagon", label: "Prism Ghost", className: "skin-pentagon" },
  { id: "nebulaBloom", label: "Nebula Bloom", className: "skin-nebula" },
  { id: "eclipseWisp", label: "Eclipse Wisp", className: "skin-eclipse" },
  { id: "riftMoth", label: "Night Moth", className: "skin-moth" },
  { id: "signalDrone", label: "Signal Drone", className: "skin-drone" }
]

const HOW_TO_PLAY = [
  {
    title: "Runners",
    text: "Collect orbs, feed active Rifts, rescue teammates, use pallets and windows, then reach the exit once the objective is complete."
  },
  {
    title: "The Void",
    text: "Track the Runners, charge lunges with M1, break pallets, and hold E to hook downed Runners, execute, or kick active Rifts."
  },
  {
    title: "Controls",
    text: "WASD move, mouse aim, Shift sprint, Space vault/drop/break, R quick chat. Stand still near injured or hooked teammates to heal or rescue them."
  }
]


const VERSION_FALLBACK = {
  version: "0.1.0",
  title: "Version Tracking",
  summary: "Main menu version log online"
}

function resolveLatestVersion(payload) {
  if (!payload || typeof payload !== "object") return VERSION_FALLBACK

  const latest = payload.latest && typeof payload.latest === "object"
    ? payload.latest
    : Array.isArray(payload.history)
      ? payload.history[0]
      : null

  if (!latest || typeof latest !== "object") return VERSION_FALLBACK

  return {
    version: String(latest.version || VERSION_FALLBACK.version),
    title: String(latest.title || latest.shortTitle || VERSION_FALLBACK.title),
    summary: String(latest.summary || latest.description || VERSION_FALLBACK.summary)
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-voidrift-src="${src}"]`)
    if (existing?.dataset.loaded === "true") {
      resolve()
      return
    }

    const script = existing || document.createElement("script")
    script.src = src
    script.async = false
    script.dataset.voidriftSrc = src

    script.addEventListener("load", () => {
      script.dataset.loaded = "true"
      resolve()
    }, { once: true })

    script.addEventListener("error", () => {
      reject(new Error(`Failed to load ${src}`))
    }, { once: true })

    if (!existing) document.body.appendChild(script)
  })
}

function useVoidriftClient(disabled = false) {
  useEffect(() => {
    if (disabled) return
    if (window.__VOIDRIFT_CLIENT_BOOTED__) return
    window.__VOIDRIFT_CLIENT_BOOTED__ = true

    LEGACY_SCRIPT_CHAIN
      .reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve())
      .catch((error) => {
        console.error(error)
        const toast = document.getElementById("toast")
        if (toast) {
          toast.textContent = "riftrunner failed to load. Check the console for details."
          toast.classList.remove("hidden")
        }
      })
  }, [disabled])
}

function SkinButton({ skin, compact = false }) {
  return (
    <button className="skin-btn" data-skin={skin.id} type="button">
      <span className={`skin-preview ${skin.className}`} aria-hidden="true" />
      <span>{compact ? skin.label.replace(" ", "\u00A0") : skin.label}</span>
    </button>
  )
}

function ScreenHeader({ eyebrow, title, description, backTo = "menu" }) {
  return (
    <>
      <div className="screen-topline">
        <button className="text-btn menu-back-btn" data-screen={backTo} type="button">← Back</button>
        <div className="eyebrow">{eyebrow}</div>
      </div>
      <h1>{title}</h1>
      {description && <p className="screen-copy">{description}</p>}
    </>
  )
}

function MenuBackground() {
  return (
    <div className="menu-bg" aria-hidden="true">
      <div className="void-grid" />
      <div className="rift-halo halo-a" />
      <div className="rift-halo halo-b" />
      <div className="rift-halo halo-c" />
      <div className="rift-sigil sigil-a" />
      <div className="rift-sigil sigil-b" />
      <div className="fog-layer fog-low" />
      <div className="fog-layer fog-high" />
    </div>
  )
}

function VersionBadge() {
  const [versionInfo, setVersionInfo] = useState(VERSION_FALLBACK)

  useEffect(() => {
    let active = true

    fetch("/version.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Version file returned ${response.status}`)
        return response.json()
      })
      .then((payload) => {
        if (active) setVersionInfo(resolveLatestVersion(payload))
      })
      .catch((error) => {
        console.warn("[version] Could not load /version.json", error)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <aside className="version-badge" aria-label={`Version ${versionInfo.version}: ${versionInfo.title}`}>
      <span className="version-badge-number">v{versionInfo.version}</span>
      <span className="version-badge-title">{versionInfo.title}</span>
    </aside>
  )
}

function MainMenu() {
  return (
    <div id="menu" className="screen screen-open io-screen menu-screen">
      <div className="main-menu-stage">
        <div className="main-title-block">
          <div className="brand-lockup portal-brand-lockup">
            <div className="brand-rift" aria-hidden="true">
              <span />
            </div>
            <div>
              <div className="eyebrow">asymmetric void chase</div>
              <h1>riftrunner</h1>
            </div>
          </div>
          <p className="hero-copy">
            Collect Orbs. Feed the Rifts. Keep your team moving and Escape before The Void consumes you.
          </p>
        </div>

        <nav className="main-menu-actions floating-menu-actions" aria-label="Main menu">
          {MENU_ACTIONS.map((action) => (
            <button id={action.id} className={action.className} type="button" key={action.id}>{action.label}</button>
          ))}
          <a
            className="coffee-link"
            href="https://buymeacoffee.com/riftrunner"
            target="_blank"
            rel="noreferrer"
          >
            Buy me a Coffee
          </a>
        </nav>

        <div className="menu-footer-strip">
          <span className="enrichment-mark" aria-hidden="true" />
          <span>rift signal stable</span>
          <button id="menuMusicToggleBtn" className="menu-music-toggle" type="button" aria-pressed="false">
            Menu music on
          </button>
        </div>

        <VersionBadge />
		 <SeoIntroBadge />
      </div>
    </div>
  )
}

function PlayScreen() {
  return (
    <div id="playScreen" className="screen io-screen">
      <div className="void-card wide-menu-card play-card">
        <ScreenHeader
          eyebrow="join a run"
          title="Choose your side"
          description="Set your name and role, then join an open lobby or start a fresh run."
        />

        <div className="form-grid">
          <label className="field-label" htmlFor="playerName">Player name</label>
          <input id="playerName" maxLength="18" placeholder="Player" autoComplete="off" />
        </div>

        <div className="role-select" aria-label="Role selector">
          <button className="role-btn selected" data-role="survivor" type="button">
            <span className="role-icon survivor-role-icon" aria-hidden="true" />
            <span><strong>Runner</strong><small>Feed, rescue, escape</small></span>
          </button>
          <button className="role-btn" data-role="killer" type="button">
            <span className="role-icon void-role-icon" aria-hidden="true" />
            <span><strong>The Void</strong><small>Hunt, hook, consume</small></span>
          </button>
        </div>

        <div className="button-row play-actions">
          <button id="quickJoinBtn" className="primary" type="button">Quick Join</button>
          <button id="createLobbyBtn" type="button">Create Lobby</button>
        </div>

        <div className="section-heading">
          <h2>Open Lobbies</h2>
          <span>Live runs</span>
        </div>
        <div id="lobbyList" className="lobby-list empty">No open lobbies yet.</div>
      </div>
    </div>
  )
}

function SkinScreen() {
  return (
    <div id="skinScreen" className="screen io-screen">
      <div className="void-card wide-menu-card">
        <ScreenHeader
          eyebrow="runner forms"
          title="Runner Skins"
        />
        <div className="skin-picker big-skin-picker" aria-label="Runner skin selector">
          {SKINS.map((skin) => <SkinButton skin={skin} key={skin.id} />)}
        </div>
      </div>
    </div>
  )
}

function OptionsScreen() {
  return (
    <div id="optionsScreen" className="screen io-screen">
      <div className="void-card wide-menu-card">
        <ScreenHeader
          eyebrow="calibration"
          title="Settings"
        />
        <div className="option-list">
          <div className="option-card audio-option-card featured-option">
            <div className="option-icon audio-icon" aria-hidden="true" />
            <div>
              <strong>Audio</strong>
              <span>Set the menu music level before the next run.</span>
            </div>
            <div className="volume-control">
              <label htmlFor="menuMusicVolumeSlider">
                <span>Main menu volume</span>
                <b id="menuMusicVolumeValue">14%</b>
              </label>
              <input id="menuMusicVolumeSlider" type="range" min="0" max="100" step="1" defaultValue="14" aria-label="Main menu music volume" />
            </div>
            <button id="menuMusicToggleBtnOptions" className="menu-music-toggle" type="button" aria-pressed="false">Menu music on</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HowScreen() {
  return (
    <div id="howScreen" className="screen io-screen">
      <div className="void-card wide-menu-card">
        <ScreenHeader eyebrow="how to play" title="How to Run" />
        <div className="how-grid">
          {HOW_TO_PLAY.map((item) => (
            <div className="option-card how-card" key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LobbyScreen() {
  return (
    <div id="lobbyScreen" className="screen io-screen">
      <div className="void-card wide-menu-card lobby-panel">
        <div className="screen-topline">
          <button id="leaveBtn" className="text-btn" type="button">← Leave</button>
          <div className="eyebrow">run lobby</div>
        </div>

        <div className="lobby-title-row">
          <div>
            <h1 id="lobbyTitle">Lobby</h1>
            <p id="lobbySubtitle" className="screen-copy">Choose a side, ready up, then start the run.</p>
          </div>
          <div id="lobbyRoleMark" className="lobby-role-mark survivor" aria-hidden="true">
            <span />
          </div>
        </div>

        <div className="lobby-workspace">
          <aside className="lobby-control-column" aria-label="Lobby controls">
            <div className="lobby-column-heading">
              <span>Setup</span>
            </div>

            <div className="role-row lobby-role-actions">
              <button id="beKillerBtn" className="void-choice-btn" type="button">Play as The Void</button>
              <button id="beSurvivorBtn" className="runner-choice-btn" type="button">Play as a Runner</button>
            </div>

            <div className="lobby-column-heading lobby-subheading">
              <span>Bots</span>
            </div>
            <div className="lobby-bot-actions" aria-label="Add lobby bots">
              <button id="addBotKillerBtn" type="button">Add Void Bot</button>
              <button id="addBotSurvivorBtn" type="button">Add Runner Bot</button>
            </div>

            <div className="skin-picker compact lobby-skin-picker" aria-label="Runner skin selector">
              <div className="skin-title">Runner skin</div>
              {SKINS.map((skin) => <SkinButton skin={skin} compact key={skin.id} />)}
            </div>

            <div className="button-row lobby-actions">
              <button id="readyBtn" className="ready-action" type="button">Ready</button>
              <button id="startBtn" className="primary" type="button">Start Run</button>
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

function GameHud() {
  return (
    <>
      <div id="hud" className="hud hidden" data-role="survivor">
        <div id="roleHudCard" className="hud-card compact-card role-hud-card">
          <div id="roleHudIcon" className="role-hud-icon" aria-hidden="true">
            <span className="role-hud-core" />
          </div>
          <div className="role-hud-copy">
            <span>Playing as</span>
            <h2 id="roleLabel">Runner</h2>
            <p id="controlsLabel">Controls</p>
            <div id="fpsCounterRow" className="fps-counter-row">
              <span>FPS</span>
              <b id="fpsText">--</b>
            </div>
          </div>
        </div>
        <div className="hud-data-bucket" aria-hidden="true">
          <span id="genText">0 / 0</span>
          <span id="gateText">Closed</span>
          <span id="healthText">Healthy</span>
          <span id="audioText">Press any key</span>
        </div>
      </div>

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

      <div id="matchAnnouncements" className="match-announcements" aria-live="polite" />

      <div id="horrorFx" className="horror-fx hidden" aria-hidden="true">
        <div className="fx-vignette" />
        <div className="fx-blood" />
        <div className="fx-hit" />
        <div className="fx-terror" />
        <div className="fx-focus" />
        <div className="fx-grain" />
      </div>
    </>
  )
}


const ABILITY_WHEEL_FALLBACK = [
  { id: "nullRush", name: "Null Rush", shortName: "Rush", cost: 15, summary: "Move faster.", accent: "gray" },
  { id: "redshiftOrbs", name: "Redshift Bloom", shortName: "Redshift", cost: 25, summary: "Corrupts orbs.", accent: "red" },
  { id: "cancel", name: "Cancel", shortName: "Cancel", cost: 0, summary: "Close the wheel.", accent: "muted", cancel: true },
  { id: "voidReveal", name: "Void Sight", shortName: "Sight", cost: 15, summary: "Reveals all Runners.", accent: "purple", cooldown: 20 }
]

function normalizeAbilities(abilities) {
  const safe = Array.isArray(abilities) ? abilities.slice(0, 4) : []
  while (safe.length < 4) safe.push(ABILITY_WHEEL_FALLBACK[safe.length])
  return safe.map((ability, index) => ({
    id: String(ability?.id || ABILITY_WHEEL_FALLBACK[index]?.id || `ability-${index}`),
    name: String(ability?.name || ABILITY_WHEEL_FALLBACK[index]?.name || "Void Ability"),
    shortName: String(ability?.shortName || ability?.name || ABILITY_WHEEL_FALLBACK[index]?.shortName || "Ability"),
    cost: Number.isFinite(Number(ability?.cost)) ? Number(ability.cost) : Number(ABILITY_WHEEL_FALLBACK[index]?.cost || 0),
    summary: String(ability?.summary || ABILITY_WHEEL_FALLBACK[index]?.summary || "The Void bends the run."),
    accent: String(ability?.accent || "purple"),
    cancel: !!ability?.cancel || String(ability?.id || "") === "cancel",
    available: ability?.available !== false,
    active: !!ability?.active,
    cooldown: Number.isFinite(Number(ability?.cooldown)) ? Number(ability.cooldown) : 20,
    cooldownRemaining: Math.max(0, Number.isFinite(Number(ability?.cooldownRemaining)) ? Number(ability.cooldownRemaining) : 0)
  }))
}

function AbilityWheel() {
  const [wheel, setWheel] = useState({
    open: false,
    orbs: 0,
    abilities: ABILITY_WHEEL_FALLBACK,
    selected: -1
  })

  const openRef = useRef(false)
  const selectedRef = useRef(-1)
  const lastPointerRef = useRef(null)
  const abilitiesRef = useRef(ABILITY_WHEEL_FALLBACK)

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
      const abilities = normalizeAbilities(detail.abilities)
      abilitiesRef.current = abilities
      openRef.current = true
      selectedRef.current = selected
      setWheel({
        open: true,
        orbs: Number(detail.orbs || 0),
        abilities,
        selected
      })
    }

    const handleUpdate = (event) => {
      const detail = event.detail || {}
      setWheel((current) => {
        const abilities = detail.abilities ? normalizeAbilities(detail.abilities) : current.abilities
        abilitiesRef.current = abilities
        return {
          ...current,
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
        window.dispatchEvent(new CustomEvent("riftrunner:void-ability-submit", { detail: { index: selected } }))
      }

      openRef.current = false
      selectedRef.current = -1
      setWheel((current) => ({ ...current, open: false, selected: -1 }))
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("riftrunner:void-ability-open", handleOpen)
    window.addEventListener("riftrunner:void-ability-update", handleUpdate)
    window.addEventListener("riftrunner:void-ability-close", handleClose)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("riftrunner:void-ability-open", handleOpen)
      window.removeEventListener("riftrunner:void-ability-update", handleUpdate)
      window.removeEventListener("riftrunner:void-ability-close", handleClose)
    }
  }, [])

  return (
    <div className={`ability-wheel-overlay ${wheel.open ? "is-open" : ""}`} aria-hidden={!wheel.open}>
      <div className="ability-wheel-backdrop" />
      <div className="ability-wheel" role="menu" aria-label="Void ability wheel">
        <div className="ability-wheel-center" aria-hidden="true">
          <strong>{wheel.orbs}</strong>
          <span>orbs</span>
        </div>
        {CHAT_WHEEL_SEGMENTS.map((segment) => {
          const ability = wheel.abilities[segment.index] || ABILITY_WHEEL_FALLBACK[segment.index]
          const selected = wheel.selected === segment.index
          const cancel = !!ability.cancel
          const ready = cancel || ability.available !== false
          const cooldownRemaining = Math.max(0, Number(ability.cooldownRemaining || 0))
          const costLabel = cooldownRemaining > 0 ? `${Math.ceil(cooldownRemaining)}s CD` : `${ability.cost} orbs`
          return (
            <div
              className={`ability-wheel-segment ability-wheel-${segment.className} ${selected ? "selected" : ""} ${ready ? "can-use" : "locked"} ${ability.active ? "is-active" : ""} ${cancel ? "is-cancel" : ""} accent-${ability.accent || "purple"}`}
              role="menuitem"
              aria-label={cancel ? "Cancel ability wheel" : `${ability.name}, ${costLabel}`}
              key={ability.id}
            >
              <span className="ability-name">{ability.shortName || ability.name}</span>
              {!cancel && <span className="ability-cost">{costLabel}</span>}
              <small>{ability.summary}</small>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VoidAbilityHud() {
  const [hud, setHud] = useState({ visible: false, orbs: 0, effects: [] })

  useEffect(() => {
    const handleHud = (event) => {
      const detail = event.detail || {}
      setHud({
        visible: !!detail.visible,
        orbs: Number(detail.orbs || 0),
        effects: Array.isArray(detail.effects) ? detail.effects : []
      })
    }

    window.addEventListener("riftrunner:void-ability-hud", handleHud)
    return () => window.removeEventListener("riftrunner:void-ability-hud", handleHud)
  }, [])

  if (!hud.visible) return null

  return (
    <div className="void-ability-hud" aria-live="polite">
      <div className="void-orb-bank">
        <span className="void-orb-icon" aria-hidden="true" />
        <div>
          <span>Void Orbs</span>
          <strong>{hud.orbs}</strong>
        </div>
      </div>
      {!!hud.effects.length && (
        <div className="void-active-effects">
          {hud.effects.map((effect) => (
            <span key={effect.id}>{effect.label} {Math.ceil(effect.time)}s</span>
          ))}
        </div>
      )}
      <p>Hold <b>Q</b> for abilities</p>
    </div>
  )
}

const CHAT_WHEEL_FALLBACK_MESSAGES = ["Let's feed a rift.", "I'm so scared...", "Here he comes!", "What was that?!"]

const SURVIVOR_DOT_MAX = Number(window.GAMEPLAY_CONFIG?.orbs?.survivorMax) || 10

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
  if (actor.hooked) return actor.unhookProgress > 0 ? "Being Rescued" : `Hooked ${actor.hookCount || 1}/2`
  if (actor.downed) {
    if (actor.healProgress > 0) return "Being Healed"
    return actor.hookProgress > 0 ? ((actor.hookCount || 0) >= 2 ? "Being Executed" : "Being Hooked") : "Downed"
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
  if (actor.hooked) return actor.unhookProgress > 0 ? "rescue" : "hook"
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

function ChatWheel() {
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
        <div className="chat-wheel-center" aria-hidden="true" />
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

function SurvivorStatusHud() {
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
      const killer = actors.find((actor) => actor.role === "killer" && visibleChatTextForActor(actor))
      const livingSpectateTargets = actors.filter((actor) => (
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
        .map((actor) => ({
          id: actor.id,
          name: actor.name || "Runner",
          state: survivorStateLabel(actor),
          className: survivorCardClass(actor, myId, spectateTargetId, spectating),
          chat: visibleChatTextForActor(actor),
          action: actionLabel(actor),
          dotsHeld: Math.min(SURVIVOR_DOT_MAX, actor.dots || 0),
          depositText: actor.dotDepositTargetId
            ? ` • feeding ${Math.round((actor.dotDepositProgress || 0) * 100)}%`
            : ""
        }))

      setHud({
        myId,
        survivors,
        spectating,
        canCycleSpectate: livingSpectateTargets.length > 0,
        killerChat: killer
          ? {
              name: killer.name || "The Void",
              chat: visibleChatTextForActor(killer)
            }
          : null
      })
    }

    window.addEventListener("voidrift:survivor-status-hud", handleHud)
    return () => window.removeEventListener("voidrift:survivor-status-hud", handleHud)
  }, [])

  return (
    <div id="survivorStatusHud" className="survivor-status-list hidden" aria-live="polite">
      {hud.spectating && hud.canCycleSpectate && (
        <div className="spectate-hint-card" role="status">
          <span>Tab</span> change runner
          <i aria-hidden="true" />
          <span>Esc</span> exit
        </div>
      )}
      {hud.killerChat && (
        <div className="survivor-status-card killer-chat-card has-chat">
          <div className="survivor-portrait killer-portrait" aria-hidden="true" />
          <div className="survivor-meta">
            <div className="survivor-name-row">
              <span className="survivor-name">{hud.killerChat.name}</span>
              <span className="survivor-you">VOID</span>
            </div>
            {hud.killerChat.chat && (
              <div className="survivor-chat" role="status">&quot;{hud.killerChat.chat}&quot;</div>
            )}
          </div>
          <div className="survivor-action">chat</div>
        </div>
      )}
      {hud.survivors.map((actor) => (
        <div className={`${actor.className}${actor.chat ? " has-chat" : ""}`} key={actor.id}>
          <div className="survivor-portrait" aria-hidden="true" />
          <div className="survivor-meta">
            <div className="survivor-name-row">
              <span className="survivor-name">{actor.name}</span>
              {actor.id === hud.myId && <span className="survivor-you">You</span>}
            </div>
            <div className="survivor-state">{actor.state}</div>
            {actor.chat && (
              <div className="survivor-chat" role="status">&quot;{actor.chat}&quot;</div>
            )}
            <div className="survivor-dots" aria-label="Collectible dots">
              {actor.dotsHeld} / {SURVIVOR_DOT_MAX}{actor.depositText}
            </div>
          </div>
          <div className="survivor-action">{actor.action}</div>
        </div>
      ))}
      {!hud.survivors.length && !hud.killerChat && (
        <div className="survivor-status-card dead">
          <div className="survivor-portrait" />
          <div className="survivor-meta">
            <div className="survivor-name">No runners</div>
            <div className="survivor-state">The void is quiet</div>
          </div>
          <div className="survivor-action">void</div>
        </div>
      )}
    </div>
  )
}

function PointFeed() {
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
          <span>{item.label}</span>
          <strong>+{item.amount}</strong>
        </div>
      ))}
    </div>
  )
}

function HookEdgeIndicators() {
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
          title={`${indicator.name || "Runner"} is hooked`}
          key={indicator.id}
        >
          <span className="hook-edge-arrow" aria-hidden="true" />
          <span className="hook-edge-mark">!</span>
        </div>
      ))}
    </div>
  )
}

function EndScreen() {
  return (
    <div id="endScreen" className="screen io-screen">
      <div className="void-card end-panel">
        <div className="eyebrow">run ended</div>
        <h1 id="winnerText">Runners Escape</h1>
        <p id="reasonText" className="screen-copy">The route is open.</p>
        <div id="endStats" className="end-stats" aria-live="polite" />
        <div className="button-row center">
          <button id="backToLobbyBtn" className="primary" type="button">Back to Lobby</button>
          <button id="spectateBtn" type="button" className="hidden">Spectate Match</button>
          <button id="mainMenuBtn" type="button">Main Menu</button>
        </div>
      </div>
    </div>
  )
}

function SeoIntroBadge() {
  return (
    <section
      aria-label="RiftRunner game description"
      style={{
        position: "fixed",
        top: "18px",
        right: "18px",
        zIndex: 20,
        width: "300px",
        padding: "10px 12px",
        borderRadius: "14px",
        border: "1px solid rgba(160, 130, 255, 0.22)",
        background: "rgba(6, 8, 18, 0.58)",
        backdropFilter: "blur(10px)",
        boxShadow: "0 12px 34px rgba(0, 0, 0, 0.28)",
        color: "rgba(255, 255, 255, 0.72)",
        fontSize: "11px",
        lineHeight: 1.45,
        textAlign: "right",
        pointerEvents: "none"
      }}
    >
      <h2
        style={{
          margin: "0 0 5px",
          color: "#fff",
          fontSize: "12px",
          lineHeight: 1.2,
          fontWeight: 800,
          letterSpacing: "0.02em"
        }}
      >
        Free Online Multiplayer Chase Game
      </h2>

      <p style={{ margin: 0 }}>
        RiftRunner is a fast browser chase game where Runners collect orbs,
        open rifts, dodge The Void, and escape with their team.
      </p>
    </section>
  )
}

export default function App() {
  useVoidriftClient()

  return (
    <>
      <div id="gameWrap" />
      <MenuBackground />
      <MainMenu />
      <PlayScreen />
      <SkinScreen />
      <OptionsScreen />
      <HowScreen />
      <LobbyScreen />
      <GameHud />
      <SurvivorStatusHud />
      <VoidAbilityHud />
      <ChatWheel />
      <AbilityWheel />
      <HookEdgeIndicators />
      <PointFeed />
      <div id="toast" className="toast hidden" />
      <div id="screenFadeOverlay" className="screen-fade-overlay" aria-hidden="true" />
      <EndScreen />
    </>
  )
}
