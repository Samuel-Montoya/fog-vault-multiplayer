import { useEffect } from "react"
import "./styles/voidrift.css"

const LEGACY_SCRIPT_CHAIN = [
  "/socket.io/socket.io.js",
  "/vendor/phaser.min.js",
  "/maps.js",
  "/audioConfig.js",
  "/gameplayConfig.js",
  "/client.js"
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

export default function App() {
  useEffect(() => {
    if (window.__VOIDRIFT_CLIENT_BOOTED__) return
    window.__VOIDRIFT_CLIENT_BOOTED__ = true

    LEGACY_SCRIPT_CHAIN
      .reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve())
      .catch((error) => {
        console.error(error)
        const toast = document.getElementById("toast")
        if (toast) {
          toast.textContent = "Voidrift failed to load. Check the console, because naturally the browser chose drama."
          toast.classList.remove("hidden")
        }
      })
  }, [])

  return (
    <>
<div id="gameWrap"></div>

  <div className="menu-bg" aria-hidden="true">
    <div className="menu-grid"></div>
    <div className="menu-blob blob-a"></div>
    <div className="menu-blob blob-b"></div>
    <div className="menu-blob blob-c"></div>
  </div>

  <div id="menu" className="screen screen-open io-screen">
    <div className="io-menu-card main-menu-card">
      <div className="io-logo-row">
        <div className="io-logo-dot killer-dot"></div>
        <div>
          <div className="eyebrow">minimal multiplayer void horror</div>
          <h1>voidrift</h1>
        </div>
      </div>
      <p className="menu-subtitle">A clean arena version of rifts, hooks, pallets, Survivors, and The Void stalking the grid.</p>
      <nav className="main-menu-actions" aria-label="Main menu">
        <button id="menuPlayBtn" className="menu-action primary" type="button">Play</button>
        <button id="menuSkinsBtn" className="menu-action" type="button">Change Skins</button>
        <button id="menuOptionsBtn" className="menu-action" type="button">Options</button>
        <button id="menuHowBtn" className="menu-action" type="button">How to Play</button>
        <a id="buyCoffeeBtn" className="menu-action coffee-link" href="https://www.buymeacoffee.com/replace-this" target="_blank" rel="noopener">Buy me a Coffee</a>
      </nav>
      <p className="replace-note">Replace the menu background in <code>src/styles/voidrift.css</code>: <code>--menu-bg-image: url('/your-image.jpg')</code>. Put <code>menu.mp3</code> in <code>public/</code>.</p>
    </div>
  </div>

  <div id="playScreen" className="screen io-screen">
    <div className="io-menu-card wide-menu-card">
      <div className="screen-topline">
        <button className="text-btn menu-back-btn" data-screen="menu" type="button">← Menu</button>
        <div className="eyebrow">join a trial</div>
      </div>
      <h1>Play</h1>
      <p>Pick your name and role, then join an open lobby or make a new one.</p>

      <label className="field-label" htmlFor="playerName">Name</label>
      <input id="playerName" maxLength="18" placeholder="Player" />

      <div className="role-row pill-row">
        <button className="role-btn selected" data-role="survivor" type="button">Survivor</button>
        <button className="role-btn" data-role="killer" type="button">The Void</button>
      </div>

      <div className="button-row play-actions">
        <button id="quickJoinBtn" className="primary" type="button">Quick Join</button>
        <button id="createLobbyBtn" type="button">Create Lobby</button>
      </div>

      <h2>Open Lobbies</h2>
      <div id="lobbyList" className="lobby-list empty">No open lobbies yet.</div>
    </div>
  </div>

  <div id="skinScreen" className="screen io-screen">
    <div className="io-menu-card wide-menu-card">
      <div className="screen-topline">
        <button className="text-btn menu-back-btn" data-screen="menu" type="button">← Menu</button>
        <div className="eyebrow">cosmetic chaos</div>
      </div>
      <h1>Skins</h1>
      <p>Choose a Survivor signal style. The Void remains a purple-black anomaly because subtlety has limits.</p>
      <div className="skin-picker big-skin-picker" aria-label="Survivor skin selector">
        <button className="skin-btn selected" data-skin="blueSquare" type="button">
          <span className="skin-preview skin-square"></span>
          <span>Azure Orbit</span>
        </button>
        <button className="skin-btn" data-skin="yellowStar" type="button">
          <span className="skin-preview skin-star"></span>
          <span>Solar Sprite</span>
        </button>
        <button className="skin-btn" data-skin="purplePentagon" type="button">
          <span className="skin-preview skin-pentagon"></span>
          <span>Prism Ghost</span>
        </button>
        <button className="skin-btn" data-skin="nebulaBloom" type="button">
          <span className="skin-preview skin-nebula"></span>
          <span>Nebula Bloom</span>
        </button>
        <button className="skin-btn" data-skin="eclipseWisp" type="button">
          <span className="skin-preview skin-eclipse"></span>
          <span>Eclipse Wisp</span>
        </button>
        <button className="skin-btn" data-skin="riftMoth" type="button">
          <span className="skin-preview skin-moth"></span>
          <span>Rift Moth</span>
        </button>
        <button className="skin-btn" data-skin="signalDrone" type="button">
          <span className="skin-preview skin-drone"></span>
          <span>Signal Drone</span>
        </button>
      </div>
    </div>
  </div>

  <div id="optionsScreen" className="screen io-screen">
    <div className="io-menu-card wide-menu-card">
      <div className="screen-topline">
        <button className="text-btn menu-back-btn" data-screen="menu" type="button">← Menu</button>
        <div className="eyebrow">settings</div>
      </div>
      <h1>Options</h1>
      <div className="option-list">
        <div className="option-card audio-option-card">
          <strong>Audio</strong>
          <span>Menu music: <code>/menu.mp3</code>. Match music still uses your layered chase audio.</span>
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
          <strong>Visual Style</strong>
          <span>Minimal grid arena, clean circles, thin outlines, readable objectives.</span>
        </div>
        <div className="option-card">
          <strong>Performance</strong>
          <span>Vector-first graphics, fewer decorative strokes, and no campfire screen melting the GPU for no reason.</span>
        </div>
      </div>
    </div>
  </div>

  <div id="howScreen" className="screen io-screen">
    <div className="io-menu-card wide-menu-card">
      <div className="screen-topline">
        <button className="text-btn menu-back-btn" data-screen="menu" type="button">← Menu</button>
        <div className="eyebrow">how to play</div>
      </div>
      <h1>How to Play</h1>
      <div className="how-grid">
        <div className="option-card"><strong>Survivors</strong><span>Collect orbs, stand near rifts to deposit them, heal teammates, drop pallets, vault windows, open the gate, and leave.</span></div>
        <div className="option-card"><strong>The Void</strong><span>Track Survivors, hold M1 for a lunge, kick generators, break pallets, hook or execute downed Survivors.</span></div>
        <div className="option-card"><strong>Controls</strong><span>WASD move, mouse aim, Space vault/drop/break, E heal/unhook/escape, stand near rifts to auto-deposit orbs, Shift sprint, R chat wheel.</span></div>
        <div className="option-card"><strong>Win</strong><span>Survivors win by escaping. The Void wins by removing everyone from the board, because apparently circles can have consequences.</span></div>
      </div>
    </div>
  </div>

  <div id="lobbyScreen" className="screen io-screen">
    <div className="io-menu-card wide-menu-card lobby-panel">
      <div className="screen-topline">
        <button id="leaveBtn" className="text-btn" type="button">← Leave</button>
        <div className="eyebrow">trial lobby</div>
      </div>
      <h1 id="lobbyTitle">Lobby</h1>
      <p id="lobbySubtitle">Choose a role, ready up, then start the match.</p>
      <div id="playersList" className="players-list"></div>
      <div className="role-row pill-row">
        <button id="beSurvivorBtn" type="button">Choose Survivor</button>
        <button id="beKillerBtn" type="button">Choose The Void</button>
      </div>
      <div className="skin-picker compact" aria-label="Survivor skin selector">
        <div className="skin-title">Survivor skin</div>
        <button className="skin-btn selected" data-skin="blueSquare" type="button">
          <span className="skin-preview skin-square"></span>
          <span>Azure Orbit</span>
        </button>
        <button className="skin-btn" data-skin="yellowStar" type="button">
          <span className="skin-preview skin-star"></span>
          <span>Solar Sprite</span>
        </button>
        <button className="skin-btn" data-skin="purplePentagon" type="button">
          <span className="skin-preview skin-pentagon"></span>
          <span>Prism Ghost</span>
        </button>
        <button className="skin-btn" data-skin="nebulaBloom" type="button">
          <span className="skin-preview skin-nebula"></span>
          <span>Nebula Bloom</span>
        </button>
        <button className="skin-btn" data-skin="eclipseWisp" type="button">
          <span className="skin-preview skin-eclipse"></span>
          <span>Eclipse Wisp</span>
        </button>
        <button className="skin-btn" data-skin="riftMoth" type="button">
          <span className="skin-preview skin-moth"></span>
          <span>Rift Moth</span>
        </button>
        <button className="skin-btn" data-skin="signalDrone" type="button">
          <span className="skin-preview skin-drone"></span>
          <span>Signal Drone</span>
        </button>
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

  <div id="survivorStatusHud" className="survivor-status-list hidden" aria-live="polite"></div>

  <div id="bigGenCounter" className="big-gen-counter hidden" aria-live="polite">
    <div className="big-gen-icon rift-counter-icon" aria-hidden="true">
      <span className="rift-counter-core"></span>
      <span className="rift-counter-orbit orbit-a"></span>
      <span className="rift-counter-orbit orbit-b"></span>
      <span className="rift-counter-orbit orbit-c"></span>
    </div>
    <div className="big-gen-copy">
      <span>Rifts</span>
      <strong id="bigGenText">0 / 5</strong>
    </div>
  </div>

  <div id="horrorFx" className="horror-fx hidden" aria-hidden="true">
    <div className="fx-vignette"></div>
    <div className="fx-blood"></div>
    <div className="fx-terror"></div>
    <div className="fx-grain"></div>
  </div>

  <div id="toast" className="toast hidden"></div>

  <div id="mobileControls" className="mobile-controls hidden" aria-label="Touch controls">
    <div className="mobile-stick-base" aria-label="Move">
      <div className="mobile-stick-knob"></div>
    </div>
    <div className="mobile-button-cluster">
      <button className="mobile-btn small" data-mobile-action="chat" type="button">R</button>
      <button className="mobile-btn" data-mobile-action="interact" type="button">E</button>
      <button className="mobile-btn primary" data-mobile-action="action" type="button">SPACE</button>
      <button className="mobile-btn killer" data-mobile-action="attack" type="button">M1</button>
      <button className="mobile-btn small" data-mobile-action="sprint" type="button">RUN</button>
    </div>
  </div>

  <div id="endScreen" className="screen io-screen">
    <div className="io-menu-card end-panel">
      <div className="eyebrow">match ended</div>
      <h1 id="winnerText">Survivors Win</h1>
      <p id="reasonText">All generators are complete.</p>
      <div className="button-row center">
        <button id="backToLobbyBtn" className="primary" type="button">Back To Lobby</button>
        <button id="spectateBtn" type="button" className="hidden">Spectate Match</button>
        <button id="mainMenuBtn" type="button">Main Menu</button>
      </div>
    </div>
  </div>
<script src="/vendor/phaser.min.js"></script>
<script src="/audioConfig.js"></script>
<script src="/client.js"></script>
    </>
  )
}
