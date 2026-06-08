import {
  DEFAULT_VOID_SKIN,
  LOBBY_ACTIONS,
  LOBBY_BOT_ACTIONS,
  LOBBY_ROLE_ACTIONS,
  LOBBY_SKIN_PICKERS,
  LOBBY_SUBTITLE,
  LOBBY_TITLE,
  RUNNER_CLASSES
} from "./lobby/lobbyData"
import { LobbyControls, LobbyHeader, LobbyRoster } from "./lobby/LobbyParts"
import { useLobbySkinSync } from "./lobby/useLobbySkinSync"
import "../styles/lobby.css"
import BackButton from "./shared/BackButton"

export default function LobbyScreen({
  title = LOBBY_TITLE,
  subtitle = LOBBY_SUBTITLE,
  selectedRole = "void",
  selectedSkin = DEFAULT_VOID_SKIN,
  selectedClassId = "orbCollector",
  selectedClassLabel = "Orb Collector",
  roleActions = LOBBY_ROLE_ACTIONS,
  runnerClasses = RUNNER_CLASSES,
  botActions = LOBBY_BOT_ACTIONS,
  skinPickers = LOBBY_SKIN_PICKERS,
  lobbyActions = LOBBY_ACTIONS
}) {
  useLobbySkinSync()

  return (
    <div id="lobbyScreen" className="screen io-screen lobby-screen-redesign">
      <div className="lobby-stage">
        <BackButton id="leaveBtn" className="back_button" leaveLobby />

        <LobbyHeader
          title={title}
          subtitle={subtitle}
          selectedSkin={selectedSkin}
          selectedRole={selectedRole}
          selectedClassLabel={selectedClassLabel}
        />

        <div className="lobby-workspace">
          <LobbyControls
            roleActions={roleActions}
            runnerClasses={runnerClasses}
            selectedClassId={selectedClassId}
            botActions={botActions}
            skinPickers={skinPickers}
            lobbyActions={lobbyActions}
          />

          <LobbyRoster />
        </div>
      </div>
    </div>
  )
}
