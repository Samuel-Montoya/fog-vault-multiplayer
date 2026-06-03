const PERK_ICON_ALIASES = new Map([
  ["speed", "speed_burst"],
  ["speed_burst", "speed_burst"],
  ["speedburst", "speed_burst"],

  ["rift_lens", "rift_lens"],
  ["riftlens", "rift_lens"],
  ["vision_expand", "rift_lens"],
  ["visionexpand", "rift_lens"],
  ["wide_vision", "rift_lens"],
  ["widevision", "rift_lens"],

  ["hourglass", "hourglass"],

  ["null_rush", "null_rush"],
  ["nullrush", "null_rush"],

  ["redshift_bloom", "redshift_bloom"],
  ["redshiftbloom", "redshift_bloom"],
  ["redshift_orbs", "redshift_bloom"],
  ["redshiftorbs", "redshift_bloom"],
  ["red_orbs", "redshift_bloom"],
  ["redorbs", "redshift_bloom"],

  ["void_sight", "void_sight"],
  ["voidsight", "void_sight"],
  ["void_reveal", "void_sight"],
  ["voidreveal", "void_sight"],
  ["reveal_all", "void_sight"],
  ["revealall", "void_sight"]
])

export function toPerkIconName(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""

  const snake = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()

  const compact = snake.replace(/_/g, "")
  return PERK_ICON_ALIASES.get(snake) || PERK_ICON_ALIASES.get(compact) || snake
}

export function getPerkIconSrc(value) {
  const name = toPerkIconName(value)
  return name ? `/images/${name}.png` : ""
}

export function getPerkIconCandidates(...values) {
  const seen = new Set()
  return values
    .map(toPerkIconName)
    .filter(Boolean)
    .filter((name) => {
      if (seen.has(name)) return false
      seen.add(name)
      return true
    })
    .map((name) => `/images/${name}.png`)
}
