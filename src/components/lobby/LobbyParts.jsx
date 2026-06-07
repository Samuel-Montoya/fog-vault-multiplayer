import Headings from "../shared/Headings"
import { LobbySkinMark, LobbySkinPicker } from "./LobbySkin"

function RoleActionButton({ action }) {
  return (
    <button id={action.id} className={action.className} type="button">
      {action.image ? <img className="button-role-img" src={action.image} alt="" aria-hidden="true" /> : null}
      {action.label}
    </button>
  )
}

function BotActionButton({ action }) {
  return (
    <button id={action.id} type="button">
      <img className="button-role-img" src={action.image} alt="" aria-hidden="true" />
      {action.label}
    </button>
  )
}

function LobbyActionButton({ action }) {
  return (
    <button id={action.id} className={action.className} type="button">
      {action.label}
    </button>
  )
}

function RunnerClassName({ name }) {
  return (
    <span className="runner-class-name">
      {String(name || "Runner").split(" ").map((part) => (
        <span key={part}>{part}</span>
      ))}
    </span>
  )
}

export function RunnerClassOption({ runnerClass, selected = false }) {
  return (
    <button
      type="button"
      className={`runner-class-btn runner-class-${runnerClass.id}${selected ? " selected" : ""}`}
      data-runner-class={runnerClass.id}
      aria-label={runnerClass.aria}
      aria-pressed={selected ? "true" : "false"}
    >
      <span className="runner-class-check" aria-hidden="true">{"\u2713"}</span>
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
        <small>Choose a class. It affects your abilities and playstyle.</small>
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

export function LobbyHeader({
  title,
  subtitle,
  selectedSkin,
  selectedRole = "void",
  selectedClassLabel = "Orb Collector"
}) {
  return (
    <Headings title={title} />
    // <header className="lobby-hero">
    //   <div className="lobby-title-copy">
    //     <h1 id="lobbyTitle">{title}</h1>
    //     <p id="lobbySubtitle" className="screen-copy">{subtitle}</p>
    //   </div>

    //   <aside className="lobby-run-card" aria-label="Selected run skin">
    //     <span>Run Lobby</span>
    //     <LobbySkinMark skin={selectedSkin} role={selectedRole} />
    //     <strong id="lobbySelectedSkinLabel">{selectedSkin?.label || "Selected Skin"}</strong>
    //     <small id="lobbySelectedClassLabel" className="lobby-selected-class-label">{selectedClassLabel}</small>
    //   </aside>
    // </header>
  )
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
    <aside className="lobby-control-column" aria-label="Lobby controls">
      <div className="lobby-column-heading">
        <span>Setup</span>
      </div>

      <div className="role-row lobby-role-actions">
        {roleActions.map((action) => (
          <RoleActionButton action={action} key={action.id} />
        ))}
      </div>

      
      <div className="lobby-column-heading lobby-subheading">
        <span>Bots</span>
      </div>
      <div className="lobby-bot-actions" aria-label="Add lobby bots">
        {botActions.map((action) => (
          <BotActionButton action={action} key={action.id} />
        ))}
      </div>

      <RunnerClassPicker classes={runnerClasses} selectedClassId={selectedClassId} />


      {skinPickers.map((picker) => (
        <LobbySkinPicker picker={picker} key={picker.role} />
      ))}

      <div className="button-row lobby-actions">
        {lobbyActions.map((action) => (
          <LobbyActionButton action={action} key={action.id} />
        ))}
      </div>
    </aside>
  )
}

export function LobbyRoster({ title = "Players" }) {
  return (
    <section className="lobby-roster-column" aria-label="Lobby players">
      <div className="lobby-column-heading">
        <span>{title}</span>
      </div>
      <div id="playersList" className="players-list" />
    </section>
  )
}
