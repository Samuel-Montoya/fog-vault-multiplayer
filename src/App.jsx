import { useEffect, useRef, useState } from "react"
import "./styles/voidrift.css"

const LEGACY_SCRIPT_CHAIN = [
  "/socket.io/socket.io.js",
  "/vendor/phaser.min.js",
  "/maps.js",
  "/audioConfig.js",
  "/gameplayConfig.js",
  "/client.js"
]

const MENU_ACTIONS = [
  { id: "menuPlayBtn", label: "Enter the Fog", className: "menu-action primary" },
  { id: "menuSkinsBtn", label: "Signal Skins", className: "menu-action" },
  { id: "menuOptionsBtn", label: "Options", className: "menu-action" },
  { id: "menuHowBtn", label: "How to Survive", className: "menu-action" }
]

const SKINS = [
  { id: "blueSquare", label: "Azure Orbit", className: "skin-square" },
  { id: "yellowStar", label: "Solar Sprite", className: "skin-star" },
  { id: "purplePentagon", label: "Prism Ghost", className: "skin-pentagon" },
  { id: "nebulaBloom", label: "Nebula Bloom", className: "skin-nebula" },
  { id: "eclipseWisp", label: "Eclipse Wisp", className: "skin-eclipse" },
  { id: "riftMoth", label: "Rift Moth", className: "skin-moth" },
  { id: "signalDrone", label: "Signal Drone", className: "skin-drone" }
]

const HOW_TO_PLAY = [
  {
    title: "Survivors",
    text: "Gather orbs, seal rifts, heal teammates, drop pallets, vault windows, open the exit, and leave before The Void turns you into background lore."
  },
  {
    title: "The Void",
    text: "Track survivors, charge lunges with M1, kick rifts, break pallets, hook downed players, and control the map."
  },
  {
    title: "Objectives",
    text: "Only the active rifts count. Maps can spawn extra rifts, but survivors only need the required amount to open the escape."
  },
  {
    title: "Controls",
    text: "WASD move, mouse aim, Shift sprint, Space vault/drop/break, E interact, R quick chat. Mobile controls appear on touch screens."
  }
]

const MOBILE_BUTTONS = [
  { action: "chat", label: "R", className: "mobile-btn small" },
  { action: "interact", label: "E", className: "mobile-btn" },
  { action: "action", label: "SPACE", className: "mobile-btn primary" },
  { action: "attack", label: "M1", className: "mobile-btn killer" },
  { action: "sprint", label: "RUN", className: "mobile-btn small" }
]

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

function useVoidriftClient() {
  useEffect(() => {
    if (window.__VOIDRIFT_CLIENT_BOOTED__) return
    window.__VOIDRIFT_CLIENT_BOOTED__ = true

    LEGACY_SCRIPT_CHAIN
      .reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve())
      .catch((error) => {
        console.error(error)
        const toast = document.getElementById("toast")
        if (toast) {
          toast.textContent = "Voidrift failed to load. Check the console before the browser starts writing poetry about it."
          toast.classList.remove("hidden")
        }
      })
  }, [])
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

function MainMenu() {
  return (
    <div id="menu" className="screen screen-open io-screen menu-screen">
      <div className="void-card main-menu-card">
        <div className="brand-lockup">
          <div className="brand-rift" aria-hidden="true">
            <span />
          </div>
          <div>
            <div className="eyebrow">asymmetric void survival</div>
            <h1>Voidrift</h1>
          </div>
        </div>

        <p className="hero-copy">
          Seal unstable rifts while a living anomaly hunts the board. Clean arena readability, horror pressure,
          and just enough cosmic nonsense to make OSHA give up.
        </p>

        <div className="menu-stats" aria-label="Game highlights">
          <div><strong>4v1</strong><span>Survivors vs Void</span></div>
          <div><strong>Rifts</strong><span>Random map objectives</span></div>
          <div><strong>Escape</strong><span>Open the way out</span></div>
        </div>

        <nav className="main-menu-actions" aria-label="Main menu">
          {MENU_ACTIONS.map((action) => (
            <button id={action.id} className={action.className} type="button" key={action.id}>{action.label}</button>
          ))}
          <a id="buyCoffeeBtn" className="menu-action coffee-link" href="https://www.buymeacoffee.com/replace-this" target="_blank" rel="noopener">
            Buy me a Coffee
          </a>
        </nav>

        <button id="menuMusicToggleBtn" className="menu-music-toggle" type="button" aria-pressed="false">
          Menu music on
        </button>
      </div>
    </div>
  )
}

function PlayScreen() {
  return (
    <div id="playScreen" className="screen io-screen">
      <div className="void-card wide-menu-card play-card">
        <ScreenHeader
          eyebrow="join a trial"
          title="Choose your signal"
          description="Set your name and role, then jump into an open lobby or start a fresh one."
        />

        <div className="form-grid">
          <label className="field-label" htmlFor="playerName">Player name</label>
          <input id="playerName" maxLength="18" placeholder="Player" autoComplete="off" />
        </div>

        <div className="role-select" aria-label="Role selector">
          <button className="role-btn selected" data-role="survivor" type="button">
            <span className="role-icon survivor-role-icon" aria-hidden="true" />
            <span><strong>Survivor</strong><small>Repair, rescue, escape</small></span>
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
          <span>Live trials</span>
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
          eyebrow="survivor signals"
          title="Signal Skins"
          description="Pick a readable survivor style. The Void still gets to be a nightmare blob because fairness apparently has limits."
        />
        <div className="skin-picker big-skin-picker" aria-label="Survivor skin selector">
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
          title="Options"
          description="Fast toggles for the stuff humans immediately blame when they miss a pallet."
        />
        <div className="option-list">
          <div className="option-card audio-option-card featured-option">
            <div className="option-icon audio-icon" aria-hidden="true" />
            <div>
              <strong>Audio</strong>
              <span>All music and effects load from <code>/sfx/</code>.</span>
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
          <div className="option-card">
            <div className="option-icon visual-icon" aria-hidden="true" />
            <div><strong>Visual Style</strong><span>Dark glass panels, rift glow, readable match HUD, minimal clutter.</span></div>
          </div>
          <div className="option-card">
            <div className="option-icon performance-icon" aria-hidden="true" />
            <div><strong>Performance</strong><span>React handles UI. Phaser handles real-time rendering. Civilization briefly functions.</span></div>
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
        <ScreenHeader eyebrow="field manual" title="How to Survive" />
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
          <div className="eyebrow">trial lobby</div>
        </div>

        <div className="lobby-title-row">
          <div>
            <h1 id="lobbyTitle">Lobby</h1>
            <p id="lobbySubtitle" className="screen-copy">Choose a role, ready up, then start the match.</p>
          </div>
          <div className="lobby-rift-mark" aria-hidden="true" />
        </div>

        <div id="playersList" className="players-list" />

        <div className="role-row lobby-role-actions">
          <button id="beSurvivorBtn" type="button">Choose Survivor</button>
          <button id="beKillerBtn" type="button">Choose The Void</button>
        </div>

        <div className="skin-picker compact" aria-label="Survivor skin selector">
          <div className="skin-title">Survivor skin</div>
          {SKINS.map((skin) => <SkinButton skin={skin} compact key={skin.id} />)}
        </div>

        <div className="button-row lobby-actions">
          <button id="readyBtn" type="button">Ready</button>
          <button id="addBotSurvivorBtn" type="button">Add Bot Survivor</button>
          <button id="addBotKillerBtn" type="button">Add Bot Void</button>
          <button id="startBtn" className="primary" type="button">Start Match</button>
        </div>

        <p className="hint">Start requires exactly <b>1 Void</b> and at least <b>1 Survivor</b>.</p>
      </div>
    </div>
  )
}

function GameHud() {
  return (
    <>
      <div id="hud" className="hud hidden">
        <div className="hud-card compact-card hud-help-card">
          <h2 id="roleLabel">Role</h2>
          <p id="controlsLabel">Controls</p>
        </div>
        <div className="hud-card objective-card compact-card">
          <div><span>Rifts</span><b id="genText">0 / 0</b></div>
          <div><span>Gate</span><b id="gateText">Closed</b></div>
          <div><span>Status</span><b id="healthText">Healthy</b></div>
          <div><span>Audio</span><b id="audioText">Press any key</b></div>
        </div>
      </div>

      <div id="survivorStatusHud" className="survivor-status-list hidden" aria-live="polite" />

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
        <div className="fx-terror" />
        <div className="fx-focus" />
        <div className="fx-grain" />
      </div>
    </>
  )
}

const CHAT_WHEEL_FALLBACK_MESSAGES = ["Let's feed a rift.", "I'm so scared...", "Here he comes!", "What was that?!"]

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
          title={`${indicator.name || "Survivor"} is hooked`}
          key={indicator.id}
        >
          <span className="hook-edge-arrow" aria-hidden="true" />
          <span className="hook-edge-mark">!</span>
        </div>
      ))}
    </div>
  )
}

function MobileControls() {
  return (
    <div id="mobileControls" className="mobile-controls hidden" aria-label="Touch controls">
      <div className="mobile-stick-base" aria-label="Move">
        <div className="mobile-stick-knob" />
      </div>
      <div className="mobile-button-cluster">
        {MOBILE_BUTTONS.map((button) => (
          <button className={button.className} data-mobile-action={button.action} type="button" key={button.action}>{button.label}</button>
        ))}
      </div>
    </div>
  )
}

function EndScreen() {
  return (
    <div id="endScreen" className="screen io-screen">
      <div className="void-card end-panel">
        <div className="eyebrow">match ended</div>
        <h1 id="winnerText">Survivors Win</h1>
        <p id="reasonText" className="screen-copy">All rifts are sealed.</p>
        <div className="button-row center">
          <button id="backToLobbyBtn" className="primary" type="button">Back To Lobby</button>
          <button id="spectateBtn" type="button" className="hidden">Spectate Match</button>
          <button id="mainMenuBtn" type="button">Main Menu</button>
        </div>
      </div>
    </div>
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
      <ChatWheel />
      <HookEdgeIndicators />
      <div id="toast" className="toast hidden" />
      <MobileControls />
      <EndScreen />
    </>
  )
}
