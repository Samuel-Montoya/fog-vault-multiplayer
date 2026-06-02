import "../styles/seo_intro.css"

export default function SeoIntroBadge() {
  return (
    <section
      aria-label="RiftRunner game description"
      className="seo-intro-badge"
    >
      <h2
        style={{
          margin: "0 0 5px",
          color: "#fff",
          fontSize: "12px",
          lineHeight: 1.2,
          fontWeight: 800,
          letterSpacing: "0.02em"
        }}
      >
        Free Online Multiplayer Chase Game
      </h2>

      <p style={{ margin: 0 }}>
        RiftRunner is a fast browser chase game where Runners collect orbs,
        open rifts, dodge The Void, and escape with their team.
      </p>
    </section>
  )
}
