import Headings from "../shared/Headings"
import { ActionButton } from "../shared/Buttons"
import { LobbySkinPicker } from "./LobbySkin"

const CLASS_ACCENTS = {
  orbCollector: "#ffd36a",
  nebulizer: "#a78bfa",
  escapist: "#ff9f43",
  healer: "#4de283"
}

const ACTION_TONES = {
  beKillerBtn: "purple",
  beSurvivorBtn: "blue",
  beFfaBtn: "purple",
  readyBtn: "green",
  startBtn: "green"
}

function RoleActionButton({ action }) {
  const icon = action.image ? <img className="button-role-img" src={action.image} alt="" aria-hidden="true" /> : null

  return (
    <ActionButton
      id={action.id}
      className={action.className}
      tone={ACTION_TONES[action.id] || "neutral"}
      selected={action.className?.includes("selected")}
      icon={icon}
      iconClassName="rr-action-image-icon"
      label={action.label}
    />
  )
}

function BotActionButton({ action }) {
  return (
    <ActionButton
      id={action.id}
      tone={action.id?.includes("Killer") ? "purple" : "blue"}
      icon={<img className="button-role-img" src={action.image} alt="" aria-hidden="true" />}
      iconClassName="rr-action-image-icon"
      label={action.label}
    />
  )
}

function LobbyActionButton({ action }) {
  const tone = ACTION_TONES[action.id] || (action.className === "primary" ? "yellow" : "neutral")
  return <ActionButton id={action.id} className={action.className} tone={tone} label={action.label} />
}

function RunnerClassName({ name }) {
  return (
    <span className="runner-class-name">
      {String(name || "Runner").split(" ").map((part) => <span key={part}>{part}</span>)}
    </span>
  )
}

export function RunnerClassOption({ runnerClass, selected = false }) {
  const accent = CLASS_ACCENTS[runnerClass.id] || "#a78bfa"
  const buttonStyle = {
    "--class-accent": accent
  }

  return (
    <button
      type="button"
      className={`runner-class-btn runner-class-${runnerClass.id}${selected ? " selected" : ""}`}
      data-runner-class={runnerClass.id}
      aria-label={runnerClass.aria}
      aria-pressed={selected ? "true" : "false"}
      style={buttonStyle}
    >
      <span className="runner-class-check" aria-hidden="true">✓</span>
      <b className={`runner-class-icon runner-class-icon-${runnerClass.id}`} aria-hidden="true">
        <span className={`runner-class-icon-glyph runner-class-icon-glyph-${runnerClass.id}`}>{runnerClass.icon}</span>
      </b>
      <RunnerClassName name={runnerClass.name} />
    </button>
  )
}

export function RunnerClassPicker({ classes, selectedClassId = "orbCollector" }) {
  return (
    <section id="runnerClassPanel" className="runner-class-panel hidden" aria-label="Runner class selector" aria-hidden="true">
      <div className="runner-class-heading">
        <span>Runner Class</span>
        <small>Pick your playstyle.</small>
      </div>
      <div className="runner-class-grid">
        {classes.map((runnerClass) => (
          <RunnerClassOption
            runnerClass={runnerClass}
            selected={runnerClass.id === selectedClassId}
            key={runnerClass.id}
          />
        ))}
      </div>
    </section>
  )
}

export function LobbyHeader({ title, subtitle }) {
  return <Headings title={title} subtitle={subtitle} titleId="lobbyTitle" subtitleId="lobbySubtitle" />
}

export function LobbyControls({
  roleActions,
  runnerClasses,
  selectedClassId,
  botActions,
  skinPickers,
  lobbyActions
}) {
  return (
    <aside className="lobby-control-column rr-glass-panel" aria-label="Lobby controls">
      <div className="lobby-column-heading">
        <span>Setup</span>
      </div>

      <div className="role-row lobby-role-actions">
        {roleActions.map((action) => <RoleActionButton action={action} key={action.id} />)}
      </div>

      <div className="lobby-column-heading lobby-subheading">
        <span>Bots</span>
      </div>
      <div className="lobby-bot-actions" aria-label="Add lobby bots">
        {botActions.map((action) => <BotActionButton action={action} key={action.id} />)}
      </div>

      <RunnerClassPicker classes={runnerClasses} selectedClassId={selectedClassId} />

      {skinPickers.map((picker) => <LobbySkinPicker picker={picker} key={picker.role} />)}

      <div className="button-row lobby-actions">
        {lobbyActions.map((action) => <LobbyActionButton action={action} key={action.id} />)}
      </div>
    </aside>
  )
}

export function LobbyRoster({ title = "Players" }) {
  return (
    <section className="lobby-roster-column rr-glass-panel" aria-label="Lobby players">
      <div className="lobby-column-heading">
        <span>{title}</span>
      </div>
      <button id="beSpectatorBtn" type="button" className="lobby-spectator-join-btn">Join as Spectator</button>
      <div id="playersList" className="players-list" />
    </section>
  )
}
