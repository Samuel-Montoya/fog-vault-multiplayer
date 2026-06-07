import SkinPreview from "./SkinPreview"
import "../styles/skins.css"

function skinButtonClassName({ lobbyOnlyOwned }) {
  return ["skin-btn", lobbyOnlyOwned ? "lobby-owned-only-skin" : ""].filter(Boolean).join(" ")
}

function skinPriceLabel(price) {
  return price > 0 ? `BUY - ${price.toLocaleString()}` : "OWNED"
}

export default function SkinButton({ skin, role = "runner", lobbyOnlyOwned = false }) {
  const price = Number(skin.price || 0)

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
      <SkinPreview skin={skin} role={role} variant={lobbyOnlyOwned ? "lobby" : "store"} />
      <span className="skin-copy">
        <span>{skin.label}</span>
        <small className="skin-price" data-skin-price-label title={price > 0 ? `${price} orbs` : "Owned"}>
          {skinPriceLabel(price)}
        </small>
      </span>
    </button>
  )
}
