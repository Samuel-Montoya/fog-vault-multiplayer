import SkinButton from "../SkinButton"
import SkinPreview from "../SkinPreview"

export function LobbySkinMark({
  skin,
  role = "void",
  className = "",
  previewId = "lobbySelectedSkinPreview",
  markId = "lobbyRoleMark"
}) {
  const roleClasses = role === "void" ? "killer void" : "survivor runner"

  return (
    <div id={markId} className={`lobby-role-mark ${roleClasses} ${className}`.trim()} aria-hidden="true">
      <SkinPreview
        id={previewId}
        skin={skin}
        role={role}
        variant="lobby"
        className="lobby-selected-skin-preview"
        title={skin?.label}
      />
    </div>
  )
}

export function LobbySkinPicker({ picker }) {
  return (
    <div
      className={`skin-picker compact lobby-skin-picker ${picker.className || ""}`.trim()}
      aria-label={`${picker.title} selector`}
      aria-hidden={picker.hidden ? "true" : undefined}
    >
      <div className="skin-title">{picker.title}</div>
      {picker.skins.map((skin) => (
        <SkinButton skin={skin} compact role={picker.role} lobbyOnlyOwned key={skin.id} />
      ))}
    </div>
  )
}
