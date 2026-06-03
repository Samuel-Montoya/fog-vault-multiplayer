import "../styles/skins.css"

function skinButtonClassName({ lobbyOnlyOwned }) {
  return ["skin-btn", lobbyOnlyOwned ? "lobby-owned-only-skin" : ""].filter(Boolean).join(" ")
}

function skinPriceLabel(price) {
  return price > 0 ? `BUY - ${price.toLocaleString()}` : "OWNED"
}

export default function SkinButton({ skin, compact = false, role = "runner", lobbyOnlyOwned = false }) {
  const price = Number(skin.price || 0)
  const label = compact ? skin.label.replace(" ", " ") : skin.label

  return (
    <button
      className={skinButtonClassName({ lobbyOnlyOwned })}
      data-skin={skin.id}
      data-skin-role={role}
      data-skin-price={price}
      data-skin-label={skin.label}
      data-lobby-owned-only={lobbyOnlyOwned ? "true" : undefined}
      type="button"
    >
      <span className={`skin-preview ${skin.className}`} aria-hidden="true" />
      <span className="skin-copy">
        <span>{label}</span>
        <small className="skin-price" data-skin-price-label title={price > 0 ? `${price} orbs` : "Owned"}>
          {skinPriceLabel(price)}
        </small>
      </span>
    </button>
  )
}
