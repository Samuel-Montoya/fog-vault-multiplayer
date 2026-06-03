import { useEffect } from "react"

const LEGACY_SCRIPT_CHAIN = [
  "/socket.io/socket.io.js",
  "/vendor/phaser.min.js",
  "/maps.js",
  "/audioConfig.js",
  "/gameplayConfig.js",
  "/chats.js",
  "/perkConfig.js",
  "/runnerClassConfig.js",
  "/abilities.js",
  "/levelConfig.js",
  "/client.js"
]

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-voidrift-src="${src}"]`)
    if (existing?.dataset.loaded === "true") {
      resolve()
      return
    }

    const script = existing || document.createElement("script")
    script.src = src
    script.async = false
    script.dataset.voidriftSrc = src

    script.addEventListener("load", () => {
      script.dataset.loaded = "true"
      resolve()
    }, { once: true })

    script.addEventListener("error", () => {
      reject(new Error(`Failed to load ${src}`))
    }, { once: true })

    if (!existing) document.body.appendChild(script)
  })
}

export function useVoidriftClient(disabled = false) {
  useEffect(() => {
    if (disabled) return
    if (window.__VOIDRIFT_CLIENT_BOOTED__) return
    window.__VOIDRIFT_CLIENT_BOOTED__ = true

    LEGACY_SCRIPT_CHAIN
      .reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve())
      .catch((error) => {
        console.error(error)
        const toast = document.getElementById("toast")
        if (toast) {
          toast.textContent = "riftrunner failed to load. Check the console for details."
          toast.classList.remove("hidden")
        }
      })
  }, [disabled])
}
