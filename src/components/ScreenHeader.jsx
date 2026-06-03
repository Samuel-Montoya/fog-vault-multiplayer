import { showMenuScreen } from "../utils/screenNavigation"
import "../styles/screen_header.css"

function BackButton({ backTo }) {
  return (
    <button
      className="text-btn menu-back-btn rr-back-btn"
      data-screen={backTo}
      data-screen-nav={backTo}
      type="button"
      onClick={() => showMenuScreen(backTo)}
    >
      ← Back
    </button>
  )
}

export default function ScreenHeader({ eyebrow, title, description, backTo = "menu" }) {
  return (
    <>
      <div className="screen-topline">
        <BackButton backTo={backTo} />
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      </div>
      <h1>{title}</h1>
      {description ? <p className="screen-copy">{description}</p> : null}
    </>
  )
}
