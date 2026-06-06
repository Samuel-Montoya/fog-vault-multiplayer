import "../styles/skin_preview.css"

const DEFAULT_RUNNER_SKIN = {
  id: "blueSquare",
  label: "Azure Orbit",
  className: "skin-square"
}

const DEFAULT_VOID_SKIN = {
  id: "voidCore",
  label: "Void Core",
  className: "skin-void-core"
}

const DEFAULT_SPECTATOR_SKIN = {
  id: "spectator",
  label: "Spectator",
  className: "skin-spectator"
}

function defaultSkinForPreview(role = "runner") {
  if (role === "void" || role === "killer") return DEFAULT_VOID_SKIN
  if (role === "spectator") return DEFAULT_SPECTATOR_SKIN
  return DEFAULT_RUNNER_SKIN
}

function skinPreviewClassName({ skin, role = "runner", variant = "default", className = "" } = {}) {
  const fallback = defaultSkinForPreview(role)
  const resolvedSkin = skin || fallback
  const skinClass = resolvedSkin.className || fallback.className
  return [
    "rr-skin-preview",
    "skin-preview",
    `rr-skin-preview--${variant}`,
    role ? `rr-skin-preview--${role}` : "",
    skinClass,
    className
  ].filter(Boolean).join(" ")
}

export default function SkinPreview({
  skin,
  role = "runner",
  variant = "default",
  className = "",
  id,
  title,
  ariaHidden = true
}) {
  const fallback = defaultSkinForPreview(role)
  const resolvedSkin = skin || fallback

  return (
    <span
      id={id}
      className={skinPreviewClassName({ skin: resolvedSkin, role, variant, className })}
      data-skin-id={resolvedSkin.id || fallback.id}
      data-skin-role={role}
      title={title || resolvedSkin.label || fallback.label}
      aria-hidden={ariaHidden ? "true" : undefined}
    />
  )
}
