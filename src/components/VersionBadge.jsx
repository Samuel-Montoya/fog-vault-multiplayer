import { useEffect, useState } from "react"
import "../styles/version_badge.css"

const VERSION_FALLBACK = {
  version: "0.1.0",
  title: "Version Tracking",
  summary: "Main menu version log online"
}

function resolveLatestVersion(payload) {
  if (!payload || typeof payload !== "object") return VERSION_FALLBACK

  const latest = payload.latest && typeof payload.latest === "object"
    ? payload.latest
    : Array.isArray(payload.history)
      ? payload.history[0]
      : null

  if (!latest || typeof latest !== "object") return VERSION_FALLBACK

  return {
    version: String(latest.version || VERSION_FALLBACK.version),
    title: String(latest.title || latest.shortTitle || VERSION_FALLBACK.title),
    summary: String(latest.summary || latest.description || VERSION_FALLBACK.summary)
  }
}

export default function VersionBadge() {
  const [versionInfo, setVersionInfo] = useState(VERSION_FALLBACK)

  useEffect(() => {
    let active = true

    fetch("/version.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Version file returned ${response.status}`)
        return response.json()
      })
      .then((payload) => {
        if (active) setVersionInfo(resolveLatestVersion(payload))
      })
      .catch((error) => {
        console.warn("[version] Could not load /version.json", error)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <aside className="version-badge" aria-label={`Version ${versionInfo.version}: ${versionInfo.title}`}>
      <span className="version-badge-number">v{versionInfo.version}</span>
      <span className="version-badge-title">{versionInfo.title}</span>
    </aside>
  )
}
