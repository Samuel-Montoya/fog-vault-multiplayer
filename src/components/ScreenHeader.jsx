import { showMenuScreen } from "../utils/screenNavigation"
import "../styles/screen_header.css"

export default function ScreenHeader({ eyebrow, title, description, backTo = "menu" }) {
  return (
    <>
      <div className="screen-topline">
        <button className="text-btn menu-back-btn" data-screen={backTo} data-screen-nav={backTo} type="button" onClick={() => showMenuScreen(backTo)}>← Back</button>
        <div className="eyebrow">{eyebrow}</div>
      </div>
      <h1>{title}</h1>
      {description && <p className="screen-copy">{description}</p>}
    </>
  )
}
