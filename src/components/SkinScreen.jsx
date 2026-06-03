import { useEffect } from "react"
import { SKINS, VOID_SKINS } from "../data/menuData"
import AccountBadge from "./AccountBadge"
import SkinButton from "./SkinButton"
import { showMenuScreen } from "../utils/screenNavigation"
import "../styles/skins.css"
import "../styles/screen_header.css"


function readOrbBalance(screen) {
  if (typeof document === "undefined") return 0

  const candidates = [
    screen?.querySelector?.("[data-auth-orb-balance]"),
    document.querySelector("[data-auth-orb-balance]"),
    document.querySelector("#bankedOrbs, #orbBalance, .orb-balance [data-value]")
  ].filter(Boolean)

  for (const element of candidates) {
    const text = element.dataset?.value || element.textContent || ""
    const number = Number(String(text).replace(/[^0-9.-]+/g, ""))
    if (Number.isFinite(number)) return number
  }

  return 0
}

function isSkinOwned(button) {
  const price = Number(button.dataset.skinPrice || 0)
  const text = button.textContent || ""
  return price <= 0
    || button.classList.contains("owned")
    || button.classList.contains("selected")
    || button.getAttribute("aria-pressed") === "true"
    || button.dataset.owned === "true"
    || button.dataset.unlocked === "true"
    || /\b(owned|equipped|selected)\b/i.test(text)
}

function updateSkinShopLabels(screen) {
  if (!screen) return

  const balance = readOrbBalance(screen)

  screen.querySelectorAll(".skin-store-grid .skin-btn[data-skin]").forEach((button) => {
    const price = Number(button.dataset.skinPrice || 0)
    const label = button.querySelector("[data-skin-price-label], .skin-price")
    if (!label) return

    const selected = button.classList.contains("selected") || button.getAttribute("aria-pressed") === "true"
    const owned = isSkinOwned(button)
    const affordable = price > 0 && balance >= price

    let nextText = "OWNED"
    let state = "owned"

    if (selected) {
      nextText = "EQUIPPED"
      state = "equipped"
    } else if (owned) {
      nextText = "OWNED"
      state = "owned"
    } else if (affordable) {
      nextText = `BUY - ${price.toLocaleString()}`
      state = "buy"
    } else {
      nextText = `BUY - ${price.toLocaleString()}`
      state = "not-enough"
    }

    button.dataset.shopState = state
    button.dataset.skinAffordable = affordable ? "true" : "false"
    button.classList.toggle("shop-can-buy", state === "buy")
    button.classList.toggle("shop-not-enough", state === "not-enough")
    button.setAttribute("aria-disabled", state === "not-enough" ? "true" : "false")
    label.title = price > 0 ? `${price.toLocaleString()} orbs` : "Owned"

    if (label.textContent !== nextText) label.textContent = nextText
  })
}

function useSkinShopLabels() {
  useEffect(() => {
    if (typeof document === "undefined") return undefined

    const screen = document.getElementById("skinScreen")
    if (!screen) return undefined

    let frame = 0
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => updateSkinShopLabels(screen))
    }

    const blockNotEnoughClicks = (event) => {
      const button = event.target?.closest?.("#skinScreen .skin-btn[data-skin][data-shop-state='not-enough']")
      if (!button) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
    }

    const observer = new MutationObserver(scheduleUpdate)
    observer.observe(screen, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ["class", "aria-pressed", "data-owned", "data-unlocked", "data-skin-price"]
    })

    document.addEventListener("click", blockNotEnoughClicks, true)
    window.addEventListener("storage", scheduleUpdate)
    window.addEventListener("riftrunner:auth-updated", scheduleUpdate)
    window.addEventListener("riftrunner:screen-change", scheduleUpdate)

    const poll = window.setInterval(scheduleUpdate, 900)
    scheduleUpdate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener("click", blockNotEnoughClicks, true)
      window.removeEventListener("storage", scheduleUpdate)
      window.removeEventListener("riftrunner:auth-updated", scheduleUpdate)
      window.removeEventListener("riftrunner:screen-change", scheduleUpdate)
      window.clearInterval(poll)
    }
  }, [])
}

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
  useSkinShopLabels()

  return (
    <div id="skinScreen" className="screen io-screen skin-page-screen">
      <div className="skins-page-stage">
        <button className="skins-back-btn rr-back-btn" data-screen="menu" data-screen-nav="menu" type="button" onClick={() => showMenuScreen("menu")}>
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
            kicker="Escape With Style"
            title="Runner skins"
            subtitle="Fast, bright cosmetics for orb-chasing chaos."
            skins={SKINS}
            role="runner"
          />
          <SkinSection
            iconSrc="/images/void.png"
            kicker="Consume With Style"
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
