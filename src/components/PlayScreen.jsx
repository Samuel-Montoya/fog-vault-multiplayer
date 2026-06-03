import AccountBadge from "./AccountBadge"
import { showMenuScreen } from "../utils/screenNavigation"
import "../styles/play_screen.css"
import "../styles/screen_header.css"

function triggerSpectateFromPlay() {
  const firstLobbySpectate = document.querySelector("#lobbyList .spectate-lobby-btn")
  if (firstLobbySpectate) {
    firstLobbySpectate.click()
    return
  }

  const matchSpectate = document.getElementById("spectateBtn")
  if (matchSpectate) matchSpectate.click()
}

export default function PlayScreen() {
  return (
    <div id="playScreen" className="screen io-screen play-screen">
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
            <button className="role-btn selected runner-choice" data-role="survivor" type="button">
              <span className="role-icon survivor-role-icon" aria-hidden="true">
                <img src="/images/runner.png" alt="" />
              </span>
              <span className="role-copy">
                <strong>Runner</strong>
                <small>Collect, rescue, escape.</small>
              </span>
              <span className="role-selected-mark" aria-hidden="true">✓</span>
            </button>
            <button className="role-btn void-choice" data-role="killer" type="button">
              <span className="role-icon void-role-icon" aria-hidden="true">
                <img src="/images/void.png" alt="" />
              </span>
              <span className="role-copy">
                <strong>The Void</strong>
                <small>Hunt, hook, consume.</small>
              </span>
              <span className="role-selected-mark" aria-hidden="true">✓</span>
            </button>
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
              <button id="quickJoinBtn" className="primary" type="button">
                <span aria-hidden="true">↯</span>
                Quick Join
              </button>
              <button id="createLobbyBtn" type="button">
                <span aria-hidden="true">＋</span>
                Create Lobby
              </button>
              <button id="playSpectateBtn" type="button" onClick={triggerSpectateFromPlay}>
                <span aria-hidden="true">◉</span>
                Spectate
              </button>
            </div>
          </div>
        </section>

        <section className="play-lobbies-panel" aria-labelledby="openLobbiesTitle">
          <div className="play-lobbies-heading">
            <h2 id="openLobbiesTitle">Open Lobbies</h2>
            <span>Join or spectate live runs</span>
          </div>
          <div className="play-lobby-table-head" aria-hidden="true">
            <span>Lobby Name</span>
            <span>Map / Status</span>
            <span>Players</span>
            <span>Action</span>
          </div>
          <div id="lobbyList" className="lobby-list empty">No open lobbies yet.</div>
        </section>
      </div>

      <div className="play-bottom-strip" aria-hidden="true">
        <span className="strip-orb"><img src="/images/orb.png" alt="" /></span>
        <strong>Bank orbs by playing matches</strong>
        <i />
        <span>Spend orbs wisely. The rift rewards the prepared.</span>
      </div>
    </div>
  )
}
