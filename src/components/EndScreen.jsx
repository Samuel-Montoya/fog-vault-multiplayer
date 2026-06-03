import { useEffect, useMemo, useState } from "react"
import { findCachedEndScreenSkin } from "../utils/endScreenSkinCache"
import "../styles/end_screen.css"

const DEFAULT_END_STATE = {
  resultTone: "neutral",
  winnerTitle: "Runners Escape",
  reasonText: "The route is open.",
  rows: []
}

const FALLBACK_VOID_STATS = [
  "Runners Consumed",
  "Binds",
  "Downs",
  "Injures",
  "Rifts Kicked",
  "Orbs Stolen",
  "Orbs Collected",
  "Rift XP",
  "Void XP"
]

const FALLBACK_RUNNER_STATS = [
  "Rift XP",
  "Runner XP",
  "Orbs Collected",
  "Orbs Deposited",
  "Void Stuns",
  "Heals",
  "Rescues",
  "Escaped",
  "Chase Total",
  "Longest Chase"
]


function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

const HIDDEN_END_STATS = new Set(["echo score"])
const HIDDEN_VOID_STATS = new Set(["abilities used"])
const VOID_STAT_ORDER = FALLBACK_VOID_STATS.map(normalizeKey)

function valueLooksTrue(value) {
  const normalized = normalizeKey(value)
  return ["yes", "true", "escaped", "alive", "1"].includes(normalized)
}

function getResultTone(title = "") {
  const normalized = normalizeKey(title)

  return /perish|claimed|consum|void/.test(normalized)
    ? "perished"
    : /escape|surviv/.test(normalized)
      ? "escaped"
      : "neutral"
}

function getTextFromSelector(root, selector, fallback = "") {
  return normalizeText(root?.querySelector(selector)?.textContent) || fallback
}

function readLegacyStatItems(card) {
  const stats = Array.from(card.querySelectorAll(".end-stat"))
    .map((stat, index) => ({
      id: stat.dataset.statId || stat.dataset.key || `stat-${index}`,
      label: getTextFromSelector(stat, "span", "Stat"),
      value: getTextFromSelector(stat, "strong", "0")
    }))
    .filter((stat) => stat.label || stat.value)

  if (stats.length) return stats

  const isVoid = card.classList.contains("is-void")
  const labels = isVoid ? FALLBACK_VOID_STATS : FALLBACK_RUNNER_STATS
  return labels.map((label, index) => ({ id: `fallback-${index}`, label, value: "0" }))
}

function findStatValue(stats, labelCandidates) {
  const wanted = labelCandidates.map(normalizeKey)
  const match = stats.find((stat) => {
    const label = normalizeKey(stat.label)
    return wanted.some((candidate) => label === candidate || label.includes(candidate))
  })

  return match?.value || ""
}

function voidStatSortIndex(stat) {
  const label = normalizeKey(stat?.label)
  const index = VOID_STAT_ORDER.findIndex((wanted) => label === wanted || label.includes(wanted))
  return index >= 0 ? index : VOID_STAT_ORDER.length + 1
}

function normalizeEndStatsForRole(role, stats) {
  const filtered = (Array.isArray(stats) ? stats : []).filter((stat) => {
    const label = normalizeKey(stat?.label)
    if (HIDDEN_END_STATS.has(label)) return false
    if (role === "void" && HIDDEN_VOID_STATS.has(label)) return false
    return true
  })

  if (role !== "void") return filtered

  return [...filtered].sort((a, b) => {
    const orderDiff = voidStatSortIndex(a) - voidStatSortIndex(b)
    if (orderDiff !== 0) return orderDiff
    return normalizeText(a.label).localeCompare(normalizeText(b.label))
  })
}

function readLegacyName(card, role) {
  const rawName = getTextFromSelector(card, ".end-stat-head strong", role === "void" ? "The Void" : "Runner")
  const normalized = normalizeKey(rawName)

  if (role === "void" && /performance/.test(normalized)) return "The Void"
  if (normalized === "your results") return "Player You"

  return rawName
}

function readLegacyMeta(card) {
  return Array.from(card.querySelectorAll(".end-stat-head span"))
    .map((node) => normalizeText(node.textContent))
    .find(Boolean) || ""
}

function getRunnerStatus(card, stats) {
  const legacyBadge = getTextFromSelector(card, ".end-stat-head i", "")
  const escapedValue = findStatValue(stats, ["escaped"])

  if (escapedValue) return valueLooksTrue(escapedValue) ? "Escaped" : "Consumed"
  if (/escaped|consumed|downed|perished|dead/i.test(legacyBadge)) return legacyBadge

  return card.classList.contains("is-you") ? "Your Results" : "Runner"
}

function getRowStatus(card, role, stats) {
  return role === "void" ? "Performance" : getRunnerStatus(card, stats)
}

function getRowEscaped(row) {
  if (row.role === "void") return false
  return normalizeKey(row.status) === "escaped"
}

function parseLegacyEndRow(card, index) {
  const role = card.classList.contains("is-void") ? "void" : "runner"
  const stats = normalizeEndStatsForRole(role, readLegacyStatItems(card))
  const status = getRowStatus(card, role, stats)
  const skin = findCachedEndScreenSkin(card, role)

  return {
    id: card.dataset.actorId
      || card.dataset.playerId
      || card.dataset.socketId
      || card.dataset.id
      || `${role}-${index}`,
    role,
    name: readLegacyName(card, role),
    status,
    meta: readLegacyMeta(card),
    isYou: card.classList.contains("is-you"),
    isVoid: role === "void",
    escaped: normalizeKey(status) === "escaped",
    skin,
    stats
  }
}

function readEndStateFromDom(screen) {
  if (!screen) return DEFAULT_END_STATE

  const winnerTitle = getTextFromSelector(screen, "#winnerText", DEFAULT_END_STATE.winnerTitle)
  const reasonText = getTextFromSelector(screen, "#reasonText", DEFAULT_END_STATE.reasonText)
  const legacyStatsRoot = screen.querySelector("#endStats")
  const rows = Array.from(legacyStatsRoot?.querySelectorAll(".end-stat-card") || [])
    .map(parseLegacyEndRow)

  return {
    resultTone: getResultTone(winnerTitle),
    winnerTitle,
    reasonText,
    rows
  }
}

function rowSignature(row) {
  return [
    row.id,
    row.role,
    row.name,
    row.status,
    row.isYou ? "you" : "other",
    row.skin?.id || row.skin?.label || row.skin?.className || "skin",
    row.stats.map((stat) => `${stat.label}:${stat.value}`).join("|")
  ].join("::")
}

function endStatesMatch(a, b) {
  return a.resultTone === b.resultTone
    && a.winnerTitle === b.winnerTitle
    && a.reasonText === b.reasonText
    && a.rows.length === b.rows.length
    && a.rows.every((row, index) => rowSignature(row) === rowSignature(b.rows[index]))
}

function useEndScreenState() {
  const [endState, setEndState] = useState(DEFAULT_END_STATE)

  useEffect(() => {
    if (typeof document === "undefined") return undefined

    const screen = document.getElementById("endScreen")
    if (!screen) return undefined

    let frame = 0
    const syncEndState = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const nextState = readEndStateFromDom(screen)
        screen.dataset.resultTone = nextState.resultTone
        setEndState((currentState) => endStatesMatch(currentState, nextState) ? currentState : nextState)
      })
    }

    const observer = new MutationObserver(syncEndState)
    observer.observe(screen, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "data-skin", "data-skin-id", "data-skin-name"]
    })

    window.addEventListener("riftrunner:screen-change", syncEndState)
    const poll = window.setInterval(syncEndState, 900)
    syncEndState()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("riftrunner:screen-change", syncEndState)
      window.clearInterval(poll)
    }
  }, [])

  return endState
}

function useEndSummary(rows) {
  return useMemo(() => {
    const runnerRows = rows.filter((row) => row.role !== "void")
    const escapedCount = runnerRows.filter(getRowEscaped).length
    const consumedCount = Math.max(0, runnerRows.length - escapedCount)

    return [
      { id: "escaped", tone: "escaped", label: "Escaped", value: escapedCount },
      { id: "consumed", tone: "downed", label: "Consumed", value: consumedCount }
    ]
  }, [rows])
}

function EndOverviewCard({ item }) {
  const icon = item.tone === "escaped" ? "↗" : "✕"

  return (
    <div className={`end-overview-card summary-${item.tone}`}>
      <span className="end-overview-icon" aria-hidden="true">{icon}</span>
      <div className="end-overview-copy">
        <strong>{item.value}</strong>
        <span>{item.label}</span>
      </div>
    </div>
  )
}

function EndOverview({ rows }) {
  const summary = useEndSummary(rows)

  return rows.length ? (
    <div className="end-overview" aria-live="polite">
      {summary.map((item) => <EndOverviewCard key={item.id} item={item} />)}
    </div>
  ) : null
}

function EndSkinIcon({ row }) {
  const skinClassName = row.skin?.className || ""
  const skinLabel = row.skin?.label || (row.role === "void" ? "Void Core" : "Azure Orbit")

  return (
    <span
      className={[
        "end-row-avatar",
        "end-row-skin-avatar",
        "skin-preview",
        row.role === "void" ? "avatar-void" : "avatar-runner",
        row.role === "void" ? "void-skin-portrait" : "survivor-skin-portrait",
        skinClassName
      ].filter(Boolean).join(" ")}
      aria-hidden="true"
      title={skinLabel}
    />
  )
}

function EndRowIdentity({ row }) {
  return (
    <div className="end-stat-head">
      <EndSkinIcon row={row} />
      <div className="end-head-copy">
        <strong title={row.name}>{row.name}</strong>
        <i className="end-status-chip">{row.status}</i>
        {row.meta ? <span title={row.meta}>{row.meta}</span> : null}
      </div>
    </div>
  )
}

function EndStatCell({ stat }) {
  return (
    <div className="end-stat">
      <span>{stat.label}</span>
      <strong>{stat.value}</strong>
    </div>
  )
}

function EndStatRow({ row }) {
  const rowClassName = [
    "end-stat-card",
    row.isVoid ? "result-row-void is-void" : "result-row-runner",
    row.isYou ? "result-row-you is-you" : ""
  ].filter(Boolean).join(" ")

  return (
    <article className={rowClassName} data-escaped={row.escaped ? "yes" : "no"} data-role={row.role}>
      <EndRowIdentity row={row} />
      <div className="end-stat-grid">
        {row.stats.map((stat) => <EndStatCell key={`${row.id}-${stat.id}-${stat.label}`} stat={stat} />)}
      </div>
    </article>
  )
}

function EndStatsList({ rows }) {
  return rows.length ? (
    <section className="end-stats" aria-label="End game statistics">
      {rows.map((row) => <EndStatRow key={row.id} row={row} />)}
    </section>
  ) : (
    <section className="end-stats end-stats-empty" aria-label="End game statistics">
      <p>Waiting for match results...</p>
    </section>
  )
}

function EndActionRow() {
  return (
    <div className="button-row center end-action-row">
      <button id="backToLobbyBtn" className="primary" type="button">Back to Lobby</button>
      <button id="spectateBtn" type="button" className="hidden">Spectate Match</button>
      <button id="mainMenuBtn" type="button">Main Menu</button>
    </div>
  )
}

function EndTipBar({ resultTone }) {
  const tip = resultTone === "perished"
    ? "The Void claimed the run. Bank what you earned, reset the lobby, and make the next chase uglier."
    : resultTone === "escaped"
      ? "Runners escape by sealing all Rifts. The Void wins by consuming the team."
      : "Match results appear here when the run ends. Try not to let the scoreboard become a crime scene."

  return (
    <div className="end-tip-bar" aria-label="Match outcome tip">
      <span className="end-tip-icon" aria-hidden="true">i</span>
      <p>{tip}</p>
    </div>
  )
}

export default function EndScreen() {
  const { resultTone, winnerTitle, reasonText, rows } = useEndScreenState()

  const screenClassName = [
    "screen",
    "io-screen",
    "end-screen-shell",
    resultTone === "perished" ? "is-perished" : resultTone === "escaped" ? "is-escaped" : "is-neutral"
  ].join(" ")

  return (
    <div id="endScreen" className={screenClassName} data-result-tone={resultTone}>
      <div className="end-panel">
        <header className="end-hero-block">
          <div className="eyebrow">Run ended</div>
          <h1 id="winnerText">{winnerTitle}</h1>
          <p id="reasonText" className="screen-copy">{reasonText}</p>
          <EndOverview rows={rows} />
        </header>

        <div id="endStats" className="end-stats-legacy" aria-hidden="true" />
        <EndStatsList rows={rows} />

        <EndActionRow />
        <EndTipBar resultTone={resultTone} />
      </div>
    </div>
  )
}
