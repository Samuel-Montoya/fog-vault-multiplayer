import { useEffect } from "react"
import { resetMatchUiState, showMenuScreen } from "../utils/screenNavigation"

export function useScreenNavigationBridge(disabled = false) {
  useEffect(() => {
    if (disabled || typeof document === "undefined") return undefined

    window.RiftRunnerNavigation = {
      showScreen: showMenuScreen,
      resetMatchUiState
    }

    window.showRiftRunnerScreen = showMenuScreen
    window.resetRiftRunnerMatchUi = resetMatchUiState

    const handleNavigationClick = (event) => {
      const target = event.target?.closest?.("[data-screen-nav], .menu-back-btn[data-screen]")
      if (!target || target.disabled || target.getAttribute("aria-disabled") === "true") return

      const screen = target.dataset.screenNav || target.dataset.screen || "menu"
      if (target.tagName === "A") event.preventDefault()
      window.setTimeout(() => showMenuScreen(screen), 0)
    }

    const handleMatchStartClick = (event) => {
      const target = event.target?.closest?.("#startBtn, #quickJoinBtn, #createLobbyBtn")
      if (!target || target.disabled || target.getAttribute("aria-disabled") === "true") return
      resetMatchUiState("match-start-click")
    }

    document.addEventListener("click", handleNavigationClick, true)
    document.addEventListener("click", handleMatchStartClick, true)

    return () => {
      document.removeEventListener("click", handleNavigationClick, true)
      document.removeEventListener("click", handleMatchStartClick, true)
    }
  }, [disabled])
}
