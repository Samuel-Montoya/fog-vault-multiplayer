import BackButton from "./BackButton"
import "../../styles/shared_ui.css"

export { BackButton }
export default BackButton

export function ActionButton({
  id,
  className = "",
  tone = "neutral",
  selected = false,
  icon,
  iconClassName = "",
  label,
  labelClassName = "",
  children,
  style,
  ...props
}) {
  return (
    <button
      id={id}
      className={["rr-ui-btn", "rr-action-btn", `rr-action-${tone}`, selected ? "is-selected" : "", className]
        .filter(Boolean)
        .join(" ")}
      type="button"
      style={style}
      aria-pressed={selected || props["aria-pressed"]}
      {...props}
    >
      {icon ? <span className={["rr-action-icon", iconClassName].filter(Boolean).join(" ")} aria-hidden="true">{icon}</span> : null}
      <span className={["rr-action-label", labelClassName].filter(Boolean).join(" ")}>{children || label}</span>
    </button>
  )
}
