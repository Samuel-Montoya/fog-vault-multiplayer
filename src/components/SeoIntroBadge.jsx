import "../styles/seo_intro.css"

const TITLE_STYLE = {
  margin: "0 0 5px",
  color: "#fff",
  fontSize: "12px",
  lineHeight: 1.2,
  fontWeight: 800,
  letterSpacing: "0.02em"
}

const COPY_STYLE = { margin: 0 }

export default function SeoIntroBadge() {
  return (
    <section aria-label="RiftRunner game description" className="seo-intro-badge">
      <h2 style={TITLE_STYLE}>Free Online Multiplayer Chase Game</h2>
      <p style={COPY_STYLE}>
        RiftRunner is a fast browser chase game where Runners collect orbs,
        open rifts, dodge The Void, and escape with their team.
      </p>
    </section>
  )
}
