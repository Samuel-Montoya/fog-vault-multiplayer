import "../styles/skins.css"

export default function SkinButton({ skin, compact = false, role = "runner", lobbyOnlyOwned = false }) {
  const price = Number(skin.price || 0)
  const initialPriceLabel = price > 0 ? `BUY - ${price.toLocaleString()}` : "OWNED"
  return (
    <button
      className={`skin-btn${lobbyOnlyOwned ? " lobby-owned-only-skin" : ""}`}
      data-skin={skin.id}
      data-skin-role={role}
      data-skin-price={price}
      data-skin-label={skin.label}
      data-lobby-owned-only={lobbyOnlyOwned ? "true" : undefined}
      type="button"
    >
      <span className={`skin-preview ${skin.className}`} aria-hidden="true" />
      <span className="skin-copy">
        <span>{compact ? skin.label.replace(" ", "\u00A0") : skin.label}</span>
        <small className="skin-price" data-skin-price-label title={price > 0 ? `${price} orbs` : "Owned"}>{initialPriceLabel}</small>
      </span>
    </button>
  )
}
