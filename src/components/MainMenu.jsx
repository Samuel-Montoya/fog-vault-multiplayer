import { MENU_ACTIONS } from "../data/menuData"
import AuthPanel from "./AuthPanel"
import VersionBadge from "./VersionBadge"
import SeoIntroBadge from "./SeoIntroBadge"
import "../styles/main_menu.css"

const QUICK_MENU_ACTIONS = [
  { screen: "skins", icon: "◇", label: "Skins" },
  { screen: "perks", icon: "✦", label: "Perks" },
  { screen: "options", icon: "⚙", label: "Settings" }
]

const SIDE_OPTIONS = [
  {
    key: "runner",
    className: "side-option-runner",
    image: "/images/runner.png",
    title: "Runners",
    copy: "Collect orbs. Charge rifts. Escape alive."
  },
  {
    key: "void",
    className: "side-option-void",
    image: "/images/void.png",
    title: "The Void",
    copy: "Hunt runners. Control the map. Stop the escape."
  }
]

const FOOTER_HINTS = ["Shift sprint · Q abilities · Space interact"]

function QuickMenuAction({ action }) {
  return (
    <button type="button" data-screen-nav={action.screen}>
      <span aria-hidden="true">{action.icon}</span>
      <b>{action.label}</b>
    </button>
  )
}

function MainMenuAction({ action }) {
  return (
    <button id={action.id} className={action.className} data-screen-nav={action.screen} type="button">
      <span>{action.label}</span>
    </button>
  )
}

function CoffeeLink() {
  return (
    <a
      className="coffee-link"
      href="https://buymeacoffee.com/riftrunner"
      target="_blank"
      rel="noreferrer"
    >
      <span aria-hidden="true">▱</span>
      Buy me a Coffee
    </a>
  )
}

function SideOption({ option }) {
  return (
    <div className={`side-option ${option.className}`}>
      <div className="side-option-icon" aria-hidden="true">
        <img src={option.image} alt="" />
      </div>
      <div>
        <strong>{option.title}</strong>
        <p>{option.copy}</p>
      </div>
    </div>
  )
}

function SideSelectPanel() {
  return (
    <aside className="side-select-panel" aria-label="Game mode summary">
      <div className="side-select-heading">
        <span />
        <b>Choose your side.</b>
        <span />
      </div>

      {SIDE_OPTIONS.map((option) => (
        <SideOption option={option} key={option.key} />
      ))}

      <div className="match-tagline">1 Void. 4 Runners. Can you escape?</div>
    </aside>
  )
}

function MenuFooter() {
  return (
    <div className="menu-footer-strip">
      <span className="enrichment-mark" aria-hidden="true" />
      {FOOTER_HINTS.map((hint) => <span key={hint}>{hint}</span>)}
      <i aria-hidden="true" />
      <button id="menuMusicToggleBtn" className="menu-music-toggle" type="button" aria-pressed="false">
        Menu music on
      </button>
    </div>
  )
}

export default function MainMenu() {
  return (
    <div id="menu" className="screen screen-open io-screen menu-screen rift-main-menu">
      <div className="main-menu-stage">
        <section className="main-menu-account" aria-label="Account">
          <AuthPanel />
        </section>

        <div className="main-menu-quickbar" aria-label="Quick menu">
          {QUICK_MENU_ACTIONS.map((action) => (
            <QuickMenuAction action={action} key={action.screen} />
          ))}
        </div>

        <nav className="main-menu-actions angled-menu-actions" aria-label="Main menu">
          {MENU_ACTIONS.map((action) => (
            <MainMenuAction action={action} key={action.id} />
          ))}
          <CoffeeLink />
        </nav>

        <header className="main-menu-title" aria-label="RiftRunner">
          <h1>RiftRunner</h1>
          <p>Escape<br/>The Void</p>
        </header>

        <SideSelectPanel />
        <MenuFooter />
        <VersionBadge />
        <SeoIntroBadge />
      </div>
    </div>
  )
}
