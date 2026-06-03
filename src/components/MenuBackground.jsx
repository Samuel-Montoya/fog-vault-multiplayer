import { useEffect } from "react"

import "../styles/menu_background.css"

export default function MenuBackground() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined

    const root = document.documentElement
    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const finePointerQuery = window.matchMedia("(pointer: fine)")
    const state = {
      currentX: 0,
      currentY: 0,
      targetX: 0,
      targetY: 0,
      frame: 0
    }

    const canMove = () => finePointerQuery.matches && !reduceQuery.matches
    const isGameScreen = () => document.body.classList.contains("is-game-screen")

    const writeVars = (x, y) => {
      root.style.setProperty("--menu-parallax-bg-x", `${(-x * 7).toFixed(2)}px`)
      root.style.setProperty("--menu-parallax-bg-y", `${(-y * 5).toFixed(2)}px`)
    }

    const settleAtCenter = () => {
      state.targetX = 0
      state.targetY = 0
      scheduleFrame()
    }

    const tick = () => {
      state.frame = 0

      if (!canMove() || isGameScreen()) {
        state.targetX = 0
        state.targetY = 0
      }

      state.currentX += (state.targetX - state.currentX) * 0.075
      state.currentY += (state.targetY - state.currentY) * 0.075

      const doneX = Math.abs(state.targetX - state.currentX) < 0.001
      const doneY = Math.abs(state.targetY - state.currentY) < 0.001

      if (doneX) state.currentX = state.targetX
      if (doneY) state.currentY = state.targetY

      writeVars(state.currentX, state.currentY)

      if (!doneX || !doneY) scheduleFrame()
    }

    function scheduleFrame() {
      if (!state.frame) state.frame = window.requestAnimationFrame(tick)
    }

    const handlePointerMove = (event) => {
      if (!canMove() || isGameScreen()) return

      const width = Math.max(window.innerWidth, 1)
      const height = Math.max(window.innerHeight, 1)
      state.targetX = (event.clientX / width - 0.5) * 2
      state.targetY = (event.clientY / height - 0.5) * 2
      scheduleFrame()
    }

    const handleMotionPreferenceChange = () => {
      if (!canMove()) {
        state.currentX = 0
        state.currentY = 0
        state.targetX = 0
        state.targetY = 0
        writeVars(0, 0)
      }
    }

    const handleScreenChange = () => {
      if (isGameScreen()) settleAtCenter()
    }

    const addMediaChangeListener = (query) => {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", handleMotionPreferenceChange)
        return () => query.removeEventListener("change", handleMotionPreferenceChange)
      }

      query.addListener?.(handleMotionPreferenceChange)
      return () => query.removeListener?.(handleMotionPreferenceChange)
    }

    writeVars(0, 0)

    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("blur", settleAtCenter)
    window.addEventListener("riftrunner:screen-change", handleScreenChange)
    document.addEventListener("mouseleave", settleAtCenter)
    const removeReduceListener = addMediaChangeListener(reduceQuery)
    const removePointerListener = addMediaChangeListener(finePointerQuery)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("blur", settleAtCenter)
      window.removeEventListener("riftrunner:screen-change", handleScreenChange)
      document.removeEventListener("mouseleave", settleAtCenter)
      removeReduceListener()
      removePointerListener()
      if (state.frame) window.cancelAnimationFrame(state.frame)
      root.style.removeProperty("--menu-parallax-bg-x")
      root.style.removeProperty("--menu-parallax-bg-y")
    }
  }, [])

  return (
    <div className="menu-bg rift-page-background" aria-hidden="true">
      <span className="menu-bg-image-layer" />
      <span className="menu-bg-energy" />
      <span className="menu-bg-scanlines" />
    </div>
  )
}
