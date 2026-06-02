import "../styles/account_badge.css"

export default function AccountBadge({ panelId = "page", showOrbs = false, className = "" }) {
  const prefix = `${panelId}Badge`
  const classes = ["account-badge", showOrbs ? "account-badge-with-orbs" : "", className].filter(Boolean).join(" ")

  return (
    <section className={classes} aria-label="Account summary" data-account-badge data-account-panel>
      <div className="account-badge-name-row">
        <span className="account-badge-label">Account</span>
        <strong id={`${prefix}AuthStatusName`} data-auth-status-name>Playing as guest</strong>
      </div>
      {showOrbs && (
        <div className="account-badge-orbs" title="Deposited orbs available to spend">
          <img src="/images/orb.png" alt="" aria-hidden="true" />
          <b id={`${prefix}AuthOrbBalance`} data-auth-orb-balance>0</b>
          <span>orbs</span>
        </div>
      )}
    </section>
  )
}
