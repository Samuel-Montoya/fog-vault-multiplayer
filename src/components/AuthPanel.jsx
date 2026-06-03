import "../styles/auth_panel.css"

export default function AuthPanel({ compact = false, panelId = "menu" }) {
  const prefix = compact ? `${panelId}Compact` : panelId

  return (
    <section
      id={compact ? `${prefix}AccountPanel` : "accountPanel"}
      className={compact ? "rr-account-panel rr-account-panel-slim account-panel compact-account-panel" : "rr-account-panel rr-account-panel-full account-panel"}
      aria-label="RiftRunner account"
      data-account-panel
    >
      <div className="account-panel-top">
        <div>
          <span className="account-eyebrow">Account</span>
          <strong id={compact ? `${prefix}AuthStatusName` : "authStatusName"} data-auth-status-name>Playing as guest</strong>
        </div>
        <div className="orb-wallet" title="Deposited orbs available to spend">
          <img className="orb-wallet-icon" src="/images/orb.png" alt="" aria-hidden="true" />
          <span>orbs</span>
          <b id={compact ? `${prefix}AuthOrbBalance` : "authOrbBalance"} data-auth-orb-balance>0</b>
        </div>
      </div>
      <div id={compact ? `${prefix}AuthForm` : "authForm"} className="auth-form" data-auth-form>
        <input id={compact ? `${prefix}AuthUsername` : "authUsername"} data-auth-username maxLength="24" placeholder="Username" autoComplete="username" />
        <input id={compact ? `${prefix}AuthPassword` : "authPassword"} data-auth-password maxLength="72" placeholder="Password" type="password" autoComplete="current-password" />
        <div className="auth-actions">
          <button id={compact ? `${prefix}AuthLoginBtn` : "authLoginBtn"} data-auth-action="login" type="button">Login</button>
          <button id={compact ? `${prefix}AuthRegisterBtn` : "authRegisterBtn"} data-auth-action="register" type="button">Register</button>
          <button id={compact ? `${prefix}AuthGuestBtn` : "authGuestBtn"} data-auth-action="guest" type="button">Play as Guest</button>
        </div>
      </div>
      <div id={compact ? `${prefix}AccountActions` : "accountActions"} className="account-actions hidden" data-account-actions>
        <span id={compact ? `${prefix}AccountHint` : "accountHint"} data-account-hint>Deposited orbs save after every run.</span>
        <button id={compact ? `${prefix}AuthLogoutBtn` : "authLogoutBtn"} data-auth-logout type="button">Logout</button>
      </div>
    </section>
  )
}
