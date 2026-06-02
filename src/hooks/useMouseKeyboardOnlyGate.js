import { useEffect, useState } from "react"

function isMobileBlockedDevice() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false

  const userAgent = navigator.userAgent || ""
  const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(userAgent)
  const ipadDesktopMode = /Macintosh/i.test(userAgent) && Number(navigator.maxTouchPoints || 0) > 1
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches === true
  const noHover = window.matchMedia?.("(hover: none)")?.matches === true
  const shortestSide = Math.min(window.innerWidth || 0, window.innerHeight || 0)

  return mobileUserAgent || ipadDesktopMode || ((coarsePointer || noHover) && shortestSide > 0 && shortestSide < 920)
}

export function useMouseKeyboardOnlyGate() {
  const [blocked, setBlocked] = useState(() => isMobileBlockedDevice())

  useEffect(() => {
    const updateBlocked = () => setBlocked(isMobileBlockedDevice())
    const pointerQuery = window.matchMedia?.("(pointer: coarse)")
    const hoverQuery = window.matchMedia?.("(hover: none)")

    updateBlocked()
    window.addEventListener("resize", updateBlocked, { passive: true })
    window.addEventListener("orientationchange", updateBlocked, { passive: true })
    pointerQuery?.addEventListener?.("change", updateBlocked)
    hoverQuery?.addEventListener?.("change", updateBlocked)

    return () => {
      window.removeEventListener("resize", updateBlocked)
      window.removeEventListener("orientationchange", updateBlocked)
      pointerQuery?.removeEventListener?.("change", updateBlocked)
      hoverQuery?.removeEventListener?.("change", updateBlocked)
    }
  }, [])

  return blocked
}
