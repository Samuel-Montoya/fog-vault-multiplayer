import { showMenuScreen } from "../../utils/screenNavigation"
import "../../styles/shared_ui.css"

export default function BackButton({
  id,
  to = "menu",
  label = "Back",
  className = "",
  leaveLobby = false,
  style,
  children
}) {
  const isLobbyLeave = leaveLobby || id === "leaveBtn"
  const navProps = isLobbyLeave
    ? {}
    : {
        "data-screen": to,
        "data-screen-nav": to,
        onClick: () => showMenuScreen(to)
      }
  const buttonStyle = {
    ...(isLobbyLeave ? { position: "absolute", top: 0, left: 0, zIndex: 14 } : {}),
    width: "fit-content",
    inlineSize: "fit-content",
    maxWidth: "fit-content",
    maxInlineSize: "fit-content",
    minWidth: 0,
    minInlineSize: 0,
    flex: "0 0 auto",
    flexShrink: 0,
    alignSelf: "flex-start",
    justifySelf: "start",
    whiteSpace: "nowrap",
    ...style
  }

  return (
    <button
      id={id}
      className={["rr-ui-btn", "rr-back-btn", className].filter(Boolean).join(" ")}
      type="button"
      style={buttonStyle}
      {...navProps}
    >
      <span className="rr-back-arrow" aria-hidden="true">←</span>
      <span className="rr-back-label">{children || label}</span>
    </button>
  )
}
