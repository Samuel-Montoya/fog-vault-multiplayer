import "./styles/base.css"
import { useVoidriftClient } from "./hooks/useVoidriftClient"
import { useMouseKeyboardOnlyGate } from "./hooks/useMouseKeyboardOnlyGate"
import { useScreenNavigationBridge } from "./hooks/useScreenNavigationBridge"
import MenuBackground from "./components/MenuBackground"
import MainMenu from "./components/MainMenu"
import PlayScreen from "./components/PlayScreen"
import SkinScreen from "./components/SkinScreen"
import PerkScreen from "./components/PerkScreen"
import ClassesScreen from "./components/ClassesScreen"
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
// import "./styles/background_image_only.css"
import "./styles/icon_assets.css"
// import "./styles/responsive_layout.css"

const MENU_SCREENS = [
  { key: "menu", Component: MainMenu },
  { key: "play", Component: PlayScreen },
  { key: "skins", Component: SkinScreen },
  { key: "perks", Component: PerkScreen },
  { key: "classes", Component: ClassesScreen },
  { key: "settings", Component: SettingsScreen },
  { key: "how", Component: HowScreen },
  { key: "lobby", Component: LobbyScreen }
]

const GAME_OVERLAYS = [
  { key: "hud", Component: GameHud },
  { key: "survivors", Component: SurvivorStatusHud },
  { key: "voidAbilities", Component: VoidAbilityHud },
  { key: "runnerAbilities", Component: RunnerAbilityHud },
  { key: "chatWheel", Component: ChatWheel },
  { key: "abilityWheel", Component: AbilityWheel },
  { key: "hookIndicators", Component: HookEdgeIndicators },
  { key: "botDebug", Component: BotDebugOverlay },
  { key: "pointFeed", Component: PointFeed }
]

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
        {MENU_SCREENS.map(({ key, Component }) => (
          <Component key={key} />
        ))}
      </main>
      {GAME_OVERLAYS.map(({ key, Component }) => (
        <Component key={key} />
      ))}
      <div id="toast" className="toast hidden" />
      <div id="screenFadeOverlay" className="screen-fade-overlay" aria-hidden="true" />
      <ShopConfirmDialog />
      <EndScreen />
    </div>
  )
}
