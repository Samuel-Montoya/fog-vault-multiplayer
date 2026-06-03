import { useEffect, useRef, useState } from "react"
import "../styles/shop_confirm.css"

function getText(element, selector, fallback = "") {
  return element?.querySelector(selector)?.textContent?.trim() || fallback
}

function getOrbCost(text = "") {
  const clean = String(text).replace(/,/g, "")
  const orbMatch = clean.match(/(\d+)\s*orbs?/i)
  if (orbMatch) return Number(orbMatch[1]) || 0
  const anyNumber = clean.match(/\b(\d+)\b/)
  return anyNumber ? Number(anyNumber[1]) || 0 : 0
}

function isOwnedSkin(button) {
  const text = button.textContent || ""
  return button.classList.contains("owned")
    || button.classList.contains("selected")
    || /\b(owned|equipped|selected)\b/i.test(text)
}

function buildSkinPurchase(button) {
  const price = Number(button.dataset.skinPrice || getOrbCost(getText(button, "[data-skin-price-label], .skin-price"))) || 0
  if (price <= 0 || isOwnedSkin(button)) return null

  return {
    element: button,
    action: "Buy skin",
    title: getText(button, ".skin-copy > span:first-child", "Skin"),
    cost: price,
    details: "This spends banked orbs and unlocks the cosmetic on your account. Humanity has invented shopping for polygons. Naturally.",
    typeLabel: button.dataset.skinRole === "void" ? "Void cosmetic" : "Runner cosmetic"
  }
}

function buildPerkPurchase(actionButton) {
  const card = actionButton.closest(".perk-card")
  if (!card || actionButton.disabled || card.classList.contains("maxed")) return null

  const actionText = actionButton.textContent?.trim() || ""
  if (!/\b(unlock|upgrade|buy|purchase)\b/i.test(actionText)) return null

  const cost = Number(actionButton.dataset.cost || actionButton.dataset.orbCost || card.dataset.cost || card.dataset.orbCost || getOrbCost(actionText) || getOrbCost(card.textContent)) || 0
  if (cost <= 0) return null

  const isUpgrade = /upgrade/i.test(actionText) || card.classList.contains("upgradeable") || card.dataset.action === "upgrade"
  const current = getText(card, ".perk-effect", "")
  const next = getText(card, ".perk-next-preview b", "")

  return {
    element: actionButton,
    action: isUpgrade ? "Upgrade perk" : "Unlock perk",
    title: getText(card, ".perk-card-top strong, .perk-title, h3, strong", "Perk"),
    cost,
    details: isUpgrade
      ? "This spends banked orbs and permanently improves the perk. Numbers go up, civilization limps forward."
      : "This spends banked orbs and permanently unlocks the perk.",
    typeLabel: card.closest("[data-perk-shop='killer']") ? "Void perk" : "Runner perk",
    current,
    next
  }
}

function findPurchaseFromClick(target) {
  if (!target?.closest) return null

  const skinButton = target.closest(".skin-btn[data-skin]")
  if (skinButton?.closest("#lobbyScreen")) return null
  if (skinButton) return buildSkinPurchase(skinButton)

  const perkButton = target.closest(".perk-card button, [data-perk-action], [data-shop-purchase]")
  if (perkButton?.closest(".perk-card")) return buildPerkPurchase(perkButton)

  return null
}

function PurchaseStats({ current, next }) {
  const rows = [
    current ? { label: "Current", value: current } : null,
    next ? { label: "After upgrade", value: next } : null
  ].filter(Boolean)

  return rows.length ? (
    <div className="shop-confirm-stats">
      {rows.map((row) => (
        <p key={row.label}><span>{row.label}</span><b>{row.value}</b></p>
      ))}
    </div>
  ) : null
}

function ConfirmPrice({ cost }) {
  return (
    <div className="shop-confirm-price">
      <img src="/images/orb.png" alt="" aria-hidden="true" />
      <span>Cost</span>
      <b>{cost.toLocaleString()} orbs</b>
    </div>
  )
}

function ConfirmActions({ onCancel, onConfirm }) {
  const actions = [
    { className: "shop-confirm-cancel", label: "Cancel", onClick: onCancel },
    { className: "shop-confirm-buy", label: "Confirm", onClick: onConfirm }
  ]

  return (
    <div className="shop-confirm-actions">
      {actions.map((action) => (
        <button type="button" className={action.className} onClick={action.onClick} key={action.label}>
          {action.label}
        </button>
      ))}
    </div>
  )
}

export default function ShopConfirmDialog() {
  const [purchase, setPurchase] = useState(null)
  const confirmedClicks = useRef(new WeakSet())

  useEffect(() => {
    if (typeof document === "undefined") return undefined

    const handleClickCapture = (event) => {
      const purchaseInfo = findPurchaseFromClick(event.target)
      if (!purchaseInfo?.element) return

      if (confirmedClicks.current.has(purchaseInfo.element)) {
        confirmedClicks.current.delete(purchaseInfo.element)
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      setPurchase(purchaseInfo)
    }

    document.addEventListener("click", handleClickCapture, true)
    return () => document.removeEventListener("click", handleClickCapture, true)
  }, [])

  useEffect(() => {
    if (!purchase) return undefined

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setPurchase(null)
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [purchase])

  if (!purchase) return null

  const closeDialog = () => setPurchase(null)

  const confirmPurchase = () => {
    const element = purchase.element
    setPurchase(null)
    window.requestAnimationFrame(() => {
      if (!element?.isConnected) return
      confirmedClicks.current.add(element)
      element.click()
    })
  }

  return (
    <div
      className="shop-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDialog()
      }}
    >
      <section className="shop-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="shopConfirmTitle">
        <span className="shop-confirm-kicker">Confirm purchase</span>
        <h2 id="shopConfirmTitle">{purchase.action}</h2>
        <div className="shop-confirm-item">
          <span>{purchase.typeLabel}</span>
          <strong>{purchase.title}</strong>
        </div>
        <PurchaseStats current={purchase.current} next={purchase.next} />
        <p className="shop-confirm-copy">{purchase.details}</p>
        <ConfirmPrice cost={purchase.cost} />
        <ConfirmActions onCancel={closeDialog} onConfirm={confirmPurchase} />
      </section>
    </div>
  )
}
