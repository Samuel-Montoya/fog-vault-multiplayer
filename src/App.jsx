import "./styles/base.css"
import { useVoidriftClient } from "./hooks/useVoidriftClient"
import { useMouseKeyboardOnlyGate } from "./hooks/useMouseKeyboardOnlyGate"
import { useScreenNavigationBridge } from "./hooks/useScreenNavigationBridge"
import MenuBackground from "./components/MenuBackground"
import MainMenu from "./components/MainMenu"
import PlayScreen from "./components/PlayScreen"
import SkinScreen from "./components/SkinScreen"
import PerkScreen from "./components/PerkScreen"
import SettingsScreen from "./components/SettingsScreen"
import HowScreen from "./components/HowScreen"
import LobbyScreen from "./components/LobbyScreen"
import ShopConfirmDialog from "./components/ShopConfirmDialog"
import EndScreen from "./components/EndScreen"
import MobileKeyboardOnlyScreen from "./components/MobileKeyboardOnlyScreen"
import {
  AbilityWheel,
  BotDebugOverlay,
  ChatWheel,
  GameHud,
  HookEdgeIndicators,
  PointFeed,
  RunnerAbilityHud,
  SurvivorStatusHud,
  VoidAbilityHud
} from "./components/GameHud"
import "./styles/background_image_only.css"
import "./styles/icon_assets.css"
import "./styles/responsive_layout.css"
import "./styles/lobby_game_ui_update.css"

export default function App() {
  const mobileBlocked = useMouseKeyboardOnlyGate()
  useVoidriftClient(mobileBlocked)
  useScreenNavigationBridge(mobileBlocked)

  if (mobileBlocked) return <MobileKeyboardOnlyScreen />

  return (
    <div className="rift-app-shell">
      <div id="gameWrap" />
      <MenuBackground />
      <main className="rift-ui-shell" aria-label="RiftRunner interface">
        <MainMenu />
        <PlayScreen />
        <SkinScreen />
        <PerkScreen />
        <SettingsScreen />
        <HowScreen />
        <LobbyScreen />
      </main>
      <GameHud />
      <SurvivorStatusHud />
      <VoidAbilityHud />
      <RunnerAbilityHud />
      <ChatWheel />
      <AbilityWheel />
      <HookEdgeIndicators />
      <BotDebugOverlay />
      <PointFeed />
      <div id="toast" className="toast hidden" />
      <div id="screenFadeOverlay" className="screen-fade-overlay" aria-hidden="true" />
      <ShopConfirmDialog />
      <EndScreen />
    </div>
  )
}
