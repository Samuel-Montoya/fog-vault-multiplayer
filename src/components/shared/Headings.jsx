import "../../styles/shared_ui.css"

export default function Headings({ title, subtitle, className = "", titleId, subtitleId }) {
  return (
    <header className={["rr-title-heading", className].filter(Boolean).join(" ")}>
      <h1 id={titleId}>{title}</h1>
      {subtitle ? <p id={subtitleId}>{subtitle}</p> : null}
      <div className="rr-title-underline" aria-hidden="true" />
    </header>
  )
}
