import "../styles/account_badge.css"

function accountBadgeClassName({ showOrbs, className }) {
  return [
    "rr-account-panel",
    "rr-account-panel-slim",
    "account-badge",
    showOrbs ? "account-badge-with-orbs" : "",
    className
  ].filter(Boolean).join(" ")
}

function OrbBalance({ prefix }) {
  return (
    <div className="account-badge-orbs rr-account-slim-orbs" title="Deposited orbs available to spend">
      <img src="/images/orb.png" alt="" aria-hidden="true" />
      <b id={`${prefix}AuthOrbBalance`} data-auth-orb-balance>0</b>
      <span>orbs</span>
    </div>
  )
}

export default function AccountBadge({ panelId = "page", showOrbs = true, className = "" }) {
  const prefix = `${panelId}Badge`

  return (
    <section className={accountBadgeClassName({ showOrbs, className })} aria-label="Account summary" data-account-badge data-account-panel>
      <div className="account-badge-name-row rr-account-slim-name">
        <span className="account-badge-label rr-account-slim-label">Account</span>
        <strong id={`${prefix}AuthStatusName`} data-auth-status-name>Playing as guest</strong>
      </div>
      {showOrbs ? <OrbBalance prefix={prefix} /> : null}
    </section>
  )
}
