import { MENU_ACTIONS } from "../data/menuData"
import AuthPanel from "./AuthPanel"
import VersionBadge from "./VersionBadge"
import SeoIntroBadge from "./SeoIntroBadge"
import "../styles/main_menu.css"

export default function MainMenu() {
  return (
    <div id="menu" className="screen screen-open io-screen menu-screen rift-main-menu">
      <div className="main-menu-stage">
        <section className="main-menu-account" aria-label="Account">
          <AuthPanel />
        </section>

        <div className="main-menu-quickbar" aria-label="Quick menu">
          <button type="button" data-screen-nav="skins">
            <span aria-hidden="true">◇</span>
            <b>Skins</b>
          </button>
          <button type="button" data-screen-nav="perks">
            <span aria-hidden="true">✦</span>
            <b>Perks</b>
          </button>
          <button type="button" data-screen-nav="options">
            <span aria-hidden="true">⚙</span>
            <b>Settings</b>
          </button>
        </div>

        <nav className="main-menu-actions angled-menu-actions" aria-label="Main menu">
          {MENU_ACTIONS.map((action) => (
            <button id={action.id} className={action.className} data-screen-nav={action.screen} type="button" key={action.id}>
              <span>{action.label}</span>
            </button>
          ))}
          <a
            className="coffee-link"
            href="https://buymeacoffee.com/riftrunner"
            target="_blank"
            rel="noreferrer"
          >
            <span aria-hidden="true">▱</span>
            Buy me a Coffee
          </a>
        </nav>

        <header className="main-menu-title" aria-label="RiftRunner">
          <h1>RiftRunner</h1>
          <p>Escape The Void</p>
        </header>

        <aside className="side-select-panel" aria-label="Game mode summary">
          <div className="side-select-heading">
            <span />
            <b>Choose your side.</b>
            <span />
          </div>

          <div className="side-option side-option-runner">
            <div className="side-option-icon" aria-hidden="true">
              <img src="/images/runner.png" alt="" />
            </div>
            <div>
              <strong>Runners</strong>
              <p>Collect orbs. Charge rifts. Escape alive.</p>
            </div>
          </div>

          <div className="side-option side-option-void">
            <div className="side-option-icon" aria-hidden="true">
              <img src="/images/void.png" alt="" />
            </div>
            <div>
              <strong>The Void</strong>
              <p>Hunt runners. Control the map. Stop the escape.</p>
            </div>
          </div>

          <div className="match-tagline">1 Void. 4 Runners. One brutal chase.</div>
        </aside>

        <div className="menu-footer-strip">
          <span className="enrichment-mark" aria-hidden="true" />
          <span>Shift sprint · Q abilities · Space interact</span>
          <i aria-hidden="true" />
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
