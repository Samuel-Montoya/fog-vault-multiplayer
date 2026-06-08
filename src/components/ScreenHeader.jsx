import BackButton from "./shared/BackButton"
import "../styles/screen_header.css"

export default function ScreenHeader({ eyebrow, title, description, backTo = "menu" }) {
  return (
    <>
      <div className="screen-topline">
        <BackButton to={backTo} className="menu-back-btn" />
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      </div>
      <h1>{title}</h1>
      {description ? <p className="screen-copy">{description}</p> : null}
    </>
  )
}
