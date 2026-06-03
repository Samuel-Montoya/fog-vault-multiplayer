import { Fragment } from "react"
import { showMenuScreen } from "../utils/screenNavigation"
import "../styles/how_to_play.css"
import "../styles/screen_header.css"

const MATCH_RULES = [
  "4 Runners vs 1 Void",
  "Complete Rifts or consume the team",
  "Bank your orbs after the match"
]

const ROLE_GUIDES = [
  {
    role: "runner",
    iconSrc: "/images/runner.png",
    title: "Runners",
    subtitle: "Survive • Rescue • Escape",
    summary: "Collect orbs, power the Rifts, help your teammates, and escape back into space before The Void consumes the team. Use your vision cone to track danger and stay one step ahead.",
    controls: [
      "WASD — Move",
      "Mouse — Look around",
      "Shift — Sprint",
      "Space — Vault",
      "Hold Q — Use your unlocked abilities",
      "Hold R — Open the speed chat wheel"
    ],
    objectives: [
      "Collect orbs around the map",
      "Deposit orbs into Rifts",
      "Stand near other Runners to heal or rescue them",
      "Watch your vision cone for The Void",
      "Each orb you deposit goes into your bank after the match",
      "Once all Rifts are complete, find your escape Rift and exit back into space"
    ],
    tips: [
      "Stay close enough to support teammates, but spread out enough to keep pressure on multiple Rifts",
      "Use sprint, vaults, pallets, and abilities to break line of sight and survive chases"
    ]
  },
  {
    role: "void",
    iconSrc: "/images/void.png",
    title: "The Void",
    subtitle: "Hunt • Bind • Consume",
    summary: "Track down the Runners, steal the orbs they are carrying, and stop the escape. The Void wins by consuming as many Runners as possible before the final Rifts are finished.",
    controls: [
      "WASD — Move",
      "Mouse — Look around",
      "Space — Vault",
      "Press or Hold M1 — Attack",
      "Hold E — Bind / consume Runners",
      "Hold Q — Use your unlocked abilities",
      "Hold R — Open the speed chat wheel"
    ],
    objectives: [
      "Hit Runners to consume the orbs they are carrying",
      "Consumed orbs go into your bank and are awarded after the match",
      "Bind and consume Runners before they complete all Rifts",
      "Pressure active Rifts and force Runners out of safe routes",
      "Stop as many Runners as possible from escaping"
    ],
    tips: [
      "Control high-traffic areas and punish Runners carrying lots of orbs",
      "Use attacks, vaults, and abilities to keep the chase relentless"
    ]
  }
]

function BackButton() {
  return (
    <button className="how-back-btn rr-back-btn" data-screen="menu" data-screen-nav="menu" type="button" onClick={() => showMenuScreen("menu")}>
      <span aria-hidden="true">←</span>
      Back
    </button>
  )
}

function BulletList({ title, items }) {
  return (
    <section className="how-list-panel" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  )
}

function RoleGuide({ guide }) {
  const { role, iconSrc, title, subtitle, summary, controls, objectives, tips } = guide

  return (
    <article className={`how-role-card how-role-card-${role}`}>
      <header className="how-role-head">
        <img className="how-role-icon" src={iconSrc} alt="" aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <p className="how-role-subtitle">{subtitle}</p>
        </div>
      </header>

      <section className="how-summary-block" aria-label={`${title} summary`}>
        <h3>Role Summary</h3>
        <p>{summary}</p>
      </section>

      <div className="how-two-col">
        <BulletList title="Controls" items={controls} />
        <BulletList title="Core Objectives" items={objectives} />
      </div>

      <section className="how-tips-panel" aria-label={`${title} tips`}>
        <h3>Tips</h3>
        <ul>
          {tips.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      </section>
    </article>
  )
}

function RuleStrip() {
  return (
    <div className="how-rule-strip" aria-label="Match rules">
      {MATCH_RULES.map((rule, index) => (
        <Fragment key={rule}>
          <span>{rule}</span>
          {index < MATCH_RULES.length - 1 ? <i aria-hidden="true" /> : null}
        </Fragment>
      ))}
    </div>
  )
}

export default function HowScreen() {
  return (
    <div id="howScreen" className="screen io-screen how-page-screen">
      <div className="how-page-stage">
        <BackButton />

        <header className="how-title-block">
          <h1>How To Play</h1>
          <p>Master both sides of the chase before you enter the Rift.</p>
        </header>

        <RuleStrip />

        <main className="how-role-grid" aria-label="How to play RiftRunner">
          {ROLE_GUIDES.map((guide) => (
            <RoleGuide guide={guide} key={guide.role} />
          ))}
        </main>

        <footer className="how-footer-strip" aria-label="Final tip">
          <img src="/images/void.png" alt="" aria-hidden="true" />
          <p><b>Tip:</b> Runners win by completing all Rifts and escaping. The Void wins by consuming the team.</p>
        </footer>
      </div>
    </div>
  )
}
