import "../styles/auth_panel.css"

const AUTH_FIELDS = [
  { key: "Username", type: "text", placeholder: "Username", autoComplete: "username", maxLength: 24, dataAttr: "data-auth-username" },
  { key: "Password", type: "password", placeholder: "Password", autoComplete: "current-password", maxLength: 72, dataAttr: "data-auth-password" }
]

const AUTH_ACTIONS = [
  { key: "LoginBtn", action: "login", label: "Login" },
  { key: "RegisterBtn", action: "register", label: "Register" },
  { key: "GuestBtn", action: "guest", label: "Play as Guest" }
]

function panelIdFor(compact, prefix, suffix, fullId) {
  return compact ? `${prefix}${suffix}` : fullId
}

function AuthField({ field, compact, prefix }) {
  const dataProps = { [field.dataAttr]: true }

  return (
    <input
      id={panelIdFor(compact, prefix, `Auth${field.key}`, `auth${field.key}`)}
      type={field.type === "password" ? "password" : undefined}
      maxLength={field.maxLength}
      placeholder={field.placeholder}
      autoComplete={field.autoComplete}
      {...dataProps}
    />
  )
}

function AuthActions({ compact, prefix }) {
  return (
    <div className="auth-actions">
      {AUTH_ACTIONS.map((item) => (
        <button
          id={panelIdFor(compact, prefix, `Auth${item.key}`, `auth${item.key}`)}
          data-auth-action={item.action}
          type="button"
          key={item.action}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default function AuthPanel({ compact = false, panelId = "menu" }) {
  const prefix = compact ? `${panelId}Compact` : panelId
  const panelClassName = compact
    ? "rr-account-panel rr-account-panel-slim account-panel compact-account-panel"
    : "rr-account-panel rr-account-panel-full account-panel"

  return (
    <section
      id={compact ? `${prefix}AccountPanel` : "accountPanel"}
      className={panelClassName}
      aria-label="RiftRunner account"
      data-account-panel
    >
      <div className="account-panel-top">
        <div>
          <span className="account-eyebrow">Account</span>
          <strong id={panelIdFor(compact, prefix, "AuthStatusName", "authStatusName")} data-auth-status-name>Playing as guest</strong>
        </div>
        <div className="orb-wallet" title="Deposited orbs available to spend">
          <img className="orb-wallet-icon" src="/images/orb.png" alt="" aria-hidden="true" />
          <span>orbs</span>
          <b id={panelIdFor(compact, prefix, "AuthOrbBalance", "authOrbBalance")} data-auth-orb-balance>0</b>
        </div>
      </div>

      <div id={panelIdFor(compact, prefix, "AuthForm", "authForm")} className="auth-form" data-auth-form>
        {AUTH_FIELDS.map((field) => (
          <AuthField field={field} compact={compact} prefix={prefix} key={field.key} />
        ))}
        <AuthActions compact={compact} prefix={prefix} />
      </div>

      <div id={panelIdFor(compact, prefix, "AccountActions", "accountActions")} className="account-actions hidden" data-account-actions>
        <span id={panelIdFor(compact, prefix, "AccountHint", "accountHint")} data-account-hint>Deposited orbs save after every run.</span>
        <button id={panelIdFor(compact, prefix, "AuthLogoutBtn", "authLogoutBtn")} data-auth-logout type="button">Logout</button>
      </div>
    </section>
  )
}
