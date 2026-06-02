import { SKINS, VOID_SKINS } from "../data/menuData"
import AccountBadge from "./AccountBadge"
import SkinButton from "./SkinButton"
import { showMenuScreen } from "../utils/screenNavigation"
import "../styles/skins.css"

function SkinSection({ iconSrc, kicker, title, subtitle, skins, role }) {
  return (
    <section className={`skin-store-section skin-store-section-${role}`} aria-labelledby={`${role}SkinsHeading`}>
      <div className="skin-store-section-head">
        <div className="skin-store-title-wrap">
          <span className="skin-store-icon" aria-hidden="true"><img src={iconSrc} alt="" /></span>
          <div>
            <h2 id={`${role}SkinsHeading`}>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <span className="skin-store-kicker">{kicker}</span>
      </div>
      <div className={`skin-picker skin-store-grid ${role === "void" ? "void-shop-skin-picker" : "runner-shop-skin-picker"}`} aria-label={`${title} selector`}>
        {skins.map((skin) => <SkinButton skin={skin} role={role} key={skin.id} />)}
      </div>
    </section>
  )
}

export default function SkinScreen() {
  return (
    <div id="skinScreen" className="screen io-screen skin-page-screen">
      <div className="skins-page-stage">
        <button className="skins-back-btn" data-screen="menu" data-screen-nav="menu" type="button" onClick={() => showMenuScreen("menu")}>
          <span aria-hidden="true">←</span>
          Back
        </button>

        <header className="skins-page-hero">
          <div className="skins-title-block">
            <h1>Skins</h1>
            <p>Deposit orbs after runs, then spend them here. The default skins are always free.</p>
          </div>
          <AccountBadge panelId="shop" showOrbs />
        </header>

        <div className="skins-store-stack">
          <SkinSection
            iconSrc="/images/runner.png"
            kicker="Spend deposited orbs"
            title="Runner skins"
            subtitle="Fast, bright cosmetics for orb-chasing chaos."
            skins={SKINS}
            role="runner"
          />
          <SkinSection
            iconSrc="/images/void.png"
            kicker="Nightmare cosmetics"
            title="Void skins"
            subtitle="Darker forms for hunting runners through the rift."
            skins={VOID_SKINS}
            role="void"
          />
        </div>

        <footer className="skins-footer-strip" aria-label="Skin shop hint">
          <span aria-hidden="true">ⓘ</span>
          <b>Bank orbs by playing matches</b>
          <i aria-hidden="true" />
          <em>Spend orbs wisely. The rift rewards the prepared.</em>
        </footer>
      </div>
    </div>
  )
}
