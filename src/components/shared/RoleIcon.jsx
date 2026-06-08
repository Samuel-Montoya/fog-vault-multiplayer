import "../../styles/shared_ui.css"

const ROLE_META = {
  survivor: { className: "survivor-role-icon", src: "/images/runner.png", alt: "Runner" },
  runner: { className: "survivor-role-icon", src: "/images/runner.png", alt: "Runner" },
  killer: { className: "void-role-icon", src: "/images/void.png", alt: "The Void" },
  void: { className: "void-role-icon", src: "/images/void.png", alt: "The Void" },
  ffa: { className: "ffa-role-icon", src: "/images/void.png", alt: "Free-For-All" }
}

export default function RoleIcon({ role = "runner", src, alt = "", className = "", ...props }) {
  const meta = ROLE_META[role] || ROLE_META.runner
  const imageSrc = src || meta.src

  return (
    <span
      className={["rr-role-icon", "role-icon", meta.className, className].filter(Boolean).join(" ")}
      aria-hidden={alt ? undefined : true}
      {...props}
    >
      <img src={imageSrc} alt={alt || ""} />
    </span>
  )
}
