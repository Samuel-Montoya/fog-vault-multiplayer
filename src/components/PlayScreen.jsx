import AccountBadge from "./AccountBadge"
import { showMenuScreen } from "../utils/screenNavigation"
import "../styles/play_screen.css"
import "../styles/screen_header.css"

const ROLE_OPTIONS = [
  {
    role: "survivor",
    className: "runner-choice selected",
    iconClassName: "survivor-role-icon",
    icon: "/images/runner.png",
    title: "Runner",
    summary: "Collect, rescue, escape."
  },
  {
    role: "killer",
    className: "void-choice",
    iconClassName: "void-role-icon",
    icon: "/images/void.png",
    title: "The Void",
    summary: "Hunt, bind, consume."
  }
]

const PLAY_ACTIONS = [
  { id: "quickJoinBtn", label: "Quick Join", icon: "↯", primary: true },
  { id: "createLobbyBtn", label: "Create Lobby", icon: "＋" },
  { id: "playSpectateBtn", label: "Spectate", icon: "◉", onClick: triggerSpectateFromPlay }
]

const LOBBY_COLUMNS = ["Lobby Name", "Map / Status", "Players", "Action"]
const FOOTER_PARTS = ["Bank orbs by playing matches", "Spend orbs wisely. The rift rewards the prepared."]

function triggerSpectateFromPlay() {
  const firstLobbySpectate = document.querySelector("#lobbyList .spectate-lobby-btn")
  if (firstLobbySpectate) {
    firstLobbySpectate.click()
    return
  }

  document.getElementById("spectateBtn")?.click()
}

function BackButton() {
  return (
    <button
      className="play-back-btn rr-back-btn"
      data-screen="menu"
      data-screen-nav="menu"
      type="button"
      onClick={() => showMenuScreen("menu")}
    >
      <span aria-hidden="true">←</span>
      Back
    </button>
  )
}

function RoleButton({ option }) {
  return (
    <button className={`role-btn ${option.className}`} data-role={option.role} type="button">
      <span className={`role-icon ${option.iconClassName}`} aria-hidden="true">
        <img src={option.icon} alt="" />
      </span>
      <span className="role-copy">
        <strong>{option.title}</strong>
        <small>{option.summary}</small>
      </span>
      <span className="role-selected-mark" aria-hidden="true">✓</span>
    </button>
  )
}

function PlayActionButton({ action }) {
  return (
    <button
      id={action.id}
      className={action.primary ? "primary" : undefined}
      type="button"
      onClick={action.onClick}
    >
      <span aria-hidden="true">{action.icon}</span>
      {action.label}
    </button>
  )
}

function PlayFooterStrip() {
  return (
    <div className="play-bottom-strip" aria-hidden="true">
      <span className="strip-orb"><img src="/images/orb.png" alt="" /></span>
      <strong>{FOOTER_PARTS[0]}</strong>
      <i />
      <span>{FOOTER_PARTS[1]}</span>
    </div>
  )
}

export default function PlayScreen() {
  return (
    <div id="playScreen" className="screen io-screen play-screen">
      <BackButton />

      <div className="play-account-wrap">
        <AccountBadge panelId="play" showOrbs />
      </div>

      <div className="play-page-frame">
        <header className="play-hero-panel">
          <h1>Choose your side</h1>
          <p>Select a role, then join an open lobby, create a live run, or spectate a match.</p>
          <div className="play-title-line" aria-hidden="true" />
        </header>

        <section className="play-step-panel play-role-panel" aria-labelledby="chooseRoleTitle">
          <div className="play-step-label" id="chooseRoleTitle">1. Choose your role</div>
          <div className="role-select play-role-select" aria-label="Role selector">
            {ROLE_OPTIONS.map((option) => (
              <RoleButton option={option} key={option.role} />
            ))}
          </div>
        </section>

        <section className="play-step-panel play-join-panel" aria-labelledby="joinLobbyTitle">
          <div className="play-step-label" id="joinLobbyTitle">2. Join lobby or spectate</div>
          <div className="play-join-grid">
            <div className="play-name-field">
              <label htmlFor="playerName">Callsign</label>
              <input id="playerName" maxLength="18" placeholder="Player" autoComplete="off" />
            </div>
            <div className="button-row play-actions">
              {PLAY_ACTIONS.map((action) => (
                <PlayActionButton action={action} key={action.id} />
              ))}
            </div>
          </div>
        </section>

        <section className="play-lobbies-panel" aria-labelledby="openLobbiesTitle">
          <div className="play-lobbies-heading">
            <h2 id="openLobbiesTitle">Open Lobbies</h2>
            <span>Join or spectate live runs</span>
          </div>
          <div className="play-lobby-table-head" aria-hidden="true">
            {LOBBY_COLUMNS.map((column) => <span key={column}>{column}</span>)}
          </div>
          <div id="lobbyList" className="lobby-list empty">No open lobbies yet.</div>
        </section>
      </div>

      <PlayFooterStrip />
    </div>
  )
}
