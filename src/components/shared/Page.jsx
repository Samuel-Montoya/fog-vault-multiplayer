import "../../styles/shared_ui.css"

export function PageFrame({ className = "", children, style }) {
  return (
    <div className={["rr-page-frame", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  )
}

export function PageTopBar({ className = "", children, style }) {
  return (
    <div className={["rr-page-topbar", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  )
}

export function PageHero({ eyebrow, title, copy, className = "", children, style }) {
  return (
    <header className={["rr-page-hero", className].filter(Boolean).join(" ")} style={style}>
      {eyebrow ? <span className="rr-page-eyebrow">{eyebrow}</span> : null}
      {title ? <h1>{title}</h1> : null}
      {copy ? <p>{copy}</p> : null}
      {children}
    </header>
  )
}

export function GlassPanel({ as: Tag = "section", className = "", children, style, ...props }) {
  return (
    <Tag className={["rr-glass-panel", className].filter(Boolean).join(" ")} style={style} {...props}>
      {children}
    </Tag>
  )
}

export function SectionHeading({ title, kicker, action, className = "" }) {
  return (
    <div className={["rr-section-heading", className].filter(Boolean).join(" ")}>
      <div>
        {kicker ? <span>{kicker}</span> : null}
        <h2>{title}</h2>
      </div>
      {action || null}
    </div>
  )
}
