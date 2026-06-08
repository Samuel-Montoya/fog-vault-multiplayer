export const MENU_ACTIONS = [
  { id: "menuPlayBtn", label: "Start Playing", screen: "play", className: "menu-action primary" },
  { id: "menuTankAssaultBtn", label: "Tank Assault", screen: "tankAssault", className: "menu-action tank-assault" },
  { id: "menuSkinsBtn", label: "Skins", screen: "skins", className: "menu-action" },
  { id: "menuPerksBtn", label: "Perks", screen: "perks", className: "menu-action" },
  { id: "menuClassesBtn", label: "Classes", screen: "classes", className: "menu-action" },
  { id: "menuOptionsBtn", label: "Options", screen: "options", className: "menu-action" },
  { id: "menuHowBtn", label: "How To Play", screen: "how", className: "menu-action" }
]

export const SKINS = [
  { id: "blueSquare", price: 0, label: "Azure Orbit", className: "skin-square" },
  { id: "yellowStar", price: 120, label: "Solar Sprite", className: "skin-star" },
  { id: "purplePentagon", price: 160, label: "Prism Ghost", className: "skin-pentagon" },
  { id: "nebulaBloom", price: 220, label: "Nebula Bloom", className: "skin-nebula" },
  { id: "eclipseWisp", price: 260, label: "Eclipse Wisp", className: "skin-eclipse" },
  { id: "riftMoth", price: 300, label: "Night Moth", className: "skin-moth" },
  { id: "signalDrone", price: 340, label: "Signal Drone", className: "skin-drone" }
]

export const VOID_SKINS = [
  { id: "voidCore", price: 0, label: "Void Core", className: "skin-void-core" },
  { id: "solarMaw", price: 180, label: "Solar Maw", className: "skin-void-solar" },
  { id: "azureRift", price: 180, label: "Azure Rift", className: "skin-void-azure" },
  { id: "bloodEclipse", price: 240, label: "Blood Eclipse", className: "skin-void-eclipse" },
  { id: "starlessWyrm", price: 280, label: "Starless Wyrm", className: "skin-void-wyrm" },
  { id: "lanternHusk", price: 420, label: "Lantern Husk", className: "skin-void-lantern" },
  { id: "abyssSiren", price: 420, label: "Abyss Siren", className: "skin-void-siren" },
  { id: "crownedHollow", price: 520, label: "Crowned Hollow", className: "skin-void-crowned" },
  { id: "staticNull", price: 520, label: "Static Null", className: "skin-void-static" },
  { id: "riftSeraph", price: 650, label: "Rift Seraph", className: "skin-void-seraph" }
]

export const HOW_TO_PLAY = [
  {
    title: "Runners",
    text: "Collect orbs, feed active Rifts, rescue teammates, use pallets and windows, then reach the exit once the objective is complete."
  },
  {
    title: "The Void",
    text: "Track the Runners, charge lunges with M1, break pallets, and hold E to bind downed Runners, execute, or kick active Rifts."
  },
  {
    title: "Controls",
    text: "WASD move, mouse aim, Shift sprint, Space vault/drop/break, hold Q for abilities, R quick chat. Stand still near injured or bound teammates to heal or rescue them."
  }
]
