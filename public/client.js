/* global io, Phaser */
(() => {
  "use strict";

  const GAMEPLAY_CONFIG = window.GAMEPLAY_CONFIG || {};
  function cfgNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function cameraNumber(key, lowPowerKey, fallback) {
    const cameraCfg = GAMEPLAY_CONFIG.camera || {};
    const value = LOW_POWER_MODE && lowPowerKey ? cameraCfg[lowPowerKey] : cameraCfg[key];
    return cfgNumber(value, fallback);
  }

  const IS_TOUCH_DEVICE = Boolean(
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0)
    || window.matchMedia?.("(pointer: coarse)")?.matches
  );
  const LOW_POWER_MODE = Boolean(
    IS_TOUCH_DEVICE
    || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
    || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  );
  const RENDER_RESOLUTION = Math.max(1, Math.min(window.devicePixelRatio || 1, LOW_POWER_MODE ? 1 : 1.5));

  document.documentElement.classList.toggle("touch-device", IS_TOUCH_DEVICE);
  document.documentElement.classList.toggle("low-power", LOW_POWER_MODE);

  // Minimal vision knobs. The map itself is dark; there is no simulated fog RenderTexture.
  // Instead, gameplay objects fade in when they are inside the local POV cone / near bubble,
  // and a tiny additive cone graphic gives the player readable direction without GPU soup.
  const LIGHTING = {
    MAP_DARKNESS: cfgNumber(GAMEPLAY_CONFIG.lighting?.mapDarkness, 0.38),          // 0 = no fog, 0.85 = very dark outside vision
    // Use the same cone values as gameplay visibility by default.
    // The old clientCone values were wider/longer, which made the guide show more than the player could actually see.
    SURVIVOR_LENGTH: cfgNumber(GAMEPLAY_CONFIG.survivor?.coneLength, cfgNumber(GAMEPLAY_CONFIG.survivor?.clientConeLength, 620)),
    SURVIVOR_ANGLE: cfgNumber(GAMEPLAY_CONFIG.survivor?.coneAngle, cfgNumber(GAMEPLAY_CONFIG.survivor?.clientConeAngle, Math.PI / 2.6)),
    KILLER_LENGTH: cfgNumber(GAMEPLAY_CONFIG.void?.coneLength, cfgNumber(GAMEPLAY_CONFIG.void?.clientConeLength, 920)),
    KILLER_ANGLE: cfgNumber(GAMEPLAY_CONFIG.void?.coneAngle, cfgNumber(GAMEPLAY_CONFIG.void?.clientConeAngle, Math.PI / 1.75)),
    CONE_TEXTURE_WIDTH: LOW_POWER_MODE ? 512 : 768,
    CONE_TEXTURE_HEIGHT: LOW_POWER_MODE ? 512 : 768,
    CONE_BASE_HALF_ANGLE: Math.atan(0.56),
    // Softness controls are baked into tiny canvas textures once, not blurred every frame.
    // This keeps the beam smooth without asking the browser to melt itself.
    CONE_EDGE_SOFTNESS: LOW_POWER_MODE ? 0.38 : 0.30,
    CONE_TAIL_FADE: LOW_POWER_MODE ? 0.88 : 0.94,
    BLOOM_ALPHA: LOW_POWER_MODE ? 0.10 : 0.16,
    AURA_ALPHA: 0.90,
    AURA_RADIUS: 220,
    // Tiny flicker keeps the flashlight alive without turning it into a disco lawsuit.
    FLICKER_STRENGTH: LOW_POWER_MODE ? 0.0 : 0.012,
    FLICKER_SPEED: LOW_POWER_MODE ? 5.0 : 7.5,
    FOG_DEPTH: 900,
    // World-space padding around the current camera view. The fog layer is
    // bigger than the viewport so zooming in/out does not require resizing it
    // every frame, which was causing the flashlight to drift and the client to hitch.
    FOG_VIEW_PADDING: 240,
    // Smooth the visible guide cone so mouse/network jitter does not make it twitch.
    // This is only visual smoothing; server/client visibility rules still use the real facing.
    CONE_VISUAL_SMOOTHING: LOW_POWER_MODE ? 12 : 16,
    // Feather pass removed: one cone draw is much cheaper than layered cone blending.
    CONE_SEGMENTS: LOW_POWER_MODE ? 8 : 12
  };

  const DEFAULT_AUDIO_CONFIG = {
    music: {
      master: 0.55,
      // Per-layer match music volume multipliers.
      // layer3 is the main chase layer.
      layerVolumes: { layer1: 1.0, layer2: 1.0, layer3: 1.0 },
      menuMaster: 0.14,
      fade: 0.065,
      menu: "/menu.mp3",
      layers: ["/layer_1.mp3", "/layer_2.mp3", "/layer_3.mp3"],
      // Layer 3 stays normal unless the local survivor is injured.
      // Deposit pitch is separate and always ramps upward.
      layer3NormalPlaybackRate: 1.0,
      layer3InjuredPlaybackRate: 1.12
    },
    sfx: {
      master: 0.72,
      // Controls randomized pitch variation for SFX listed in pitchSteps.
      // Add any SFX key to pitchSteps and playSfx(name) will automatically use it.
      // Deposit pitch is intentionally separate and always ramps upward.
      enablePitchVariation: true,
      files: {
        hooked: "/hooked.mp3",
        dead: "/dead.mp3",
        gen: "/gen.mp3",
        riftsComplete: "/rifts_complete.mp3",
        swing: "/swing.ogg",
        windowVault: "/window_vault.ogg",
        palletVault: "/pallet_vault.ogg",
        palletDrop: "/pallet_drop.mp3",
        palletStun: "/pallet_stun.mp3",
        injured: "/injured.ogg",
        orbPickup: "/orb_pickup.mp3",
        orbDeposit: "/orb_deposit.mp3",
        buttonClick: "/button_click.mp3",
        playerSpeak: "/player_speak.mp3"
      },
      volumes: {
        hooked: 0.82,
        dead: 0.9,
        gen: 0.76,
        riftsComplete: 0.86,
        swing: 0.42,
        windowVault: 0.34,
        palletVault: 0.76,
        palletDrop: 0.72,
        palletStun: 0.72,
        injured: 0.8,
        orbPickup: 0.68,
        orbDeposit: 0.72,
        buttonClick: 0.55,
        playerSpeak: 0.62
      },
      pitchSteps: {
        hooked: [0.84, 0.92, 1.0, 1.09, 1.18, 1.28],
        swing: [0.9, 0.96, 1.0, 1.08, 1.16, 1.25, 1.34],
        windowVault: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
        palletDrop: [0.86, 0.94, 1.0, 1.08, 1.17, 1.26],
        palletStun: [0.82, 0.90, 1.0, 1.10, 1.22],
        orbPickup: [0.9, 0.96, 1.0, 1.08, 1.16, 1.25, 1.34],
        buttonClick: [0.92, 0.97, 1.0, 1.05, 1.11, 1.18],
        playerSpeak: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24]
      },
      localRange: {
        swing: 315,
        hit: 440,
        palletStun: 300
      }
    }
  };

  function mergeAudioConfig(defaults, overrides) {
    const source = overrides && typeof overrides === "object" ? overrides : {};
    return {
      music: {
        ...defaults.music,
        ...(source.music || {}),
        layerVolumes: {
          ...(defaults.music.layerVolumes || {}),
          ...((source.music || {}).layerVolumes || {})
        }
      },
      sfx: {
        ...defaults.sfx,
        ...(source.sfx || {}),
        files: { ...defaults.sfx.files, ...((source.sfx || {}).files || {}) },
        volumes: { ...defaults.sfx.volumes, ...((source.sfx || {}).volumes || {}) },
        pitchSteps: { ...defaults.sfx.pitchSteps, ...((source.sfx || {}).pitchSteps || {}) },
        localRange: { ...defaults.sfx.localRange, ...((source.sfx || {}).localRange || {}) }
      }
    };
  }

  const AUDIO_CONFIG = mergeAudioConfig(DEFAULT_AUDIO_CONFIG, window.GAME_AUDIO_CONFIG);

  const MUSIC = {
    MASTER: AUDIO_CONFIG.music.master,
    MENU_MASTER: AUDIO_CONFIG.music.menuMaster,
    FADE: AUDIO_CONFIG.music.fade,
    MENU: AUDIO_CONFIG.music.menu,
    LAYERS: AUDIO_CONFIG.music.layers,
    LAYER_VOLUMES: AUDIO_CONFIG.music.layerVolumes || {},
    LAYER_3_NORMAL_PLAYBACK_RATE: AUDIO_CONFIG.music.layer3NormalPlaybackRate ?? 1,
    LAYER_3_INJURED_PLAYBACK_RATE: AUDIO_CONFIG.music.layer3InjuredPlaybackRate ?? 1.12
  };

  const SFX = {
    MASTER: AUDIO_CONFIG.sfx.master,
    FILES: AUDIO_CONFIG.sfx.files,
    VOLUMES: AUDIO_CONFIG.sfx.volumes
  };

  const SFX_PITCH_STEPS = AUDIO_CONFIG.sfx.pitchSteps || {};
  const ENABLE_SFX_PITCH_VARIATION = AUDIO_CONFIG.sfx.enablePitchVariation !== false;

  // Client-only fear tuning. This does not change hitboxes or movement on the server.
  // It just makes the camera and overlay behave like the chase is pulling you inward.
  const IMMERSION = {
    BASE_ZOOM: cameraNumber("baseZoom", "lowPowerBaseZoom", 1),
    // Camera zoom offsets are added to BASE_ZOOM after a single winner is chosen.
    // Negative values are supported now, so injuredZoom: -0.5 can zoom the camera out.
    TERROR_ZOOM: cameraNumber("terrorZoom", "lowPowerTerrorZoom", LOW_POWER_MODE ? 0.025 : 0.04),
    CHASE_ZOOM: cameraNumber("chaseZoom", "lowPowerChaseZoom", LOW_POWER_MODE ? 0.42 : 0.66),

    KILLER_M1_HOLD_ZOOM: cameraNumber("voidM1HoldZoom", "lowPowerVoidM1HoldZoom", LOW_POWER_MODE ? 0.045 : 0.085),
    KILLER_M1_PULSE_ZOOM: cameraNumber("voidM1PulseZoom", "lowPowerVoidM1PulseZoom", LOW_POWER_MODE ? 0.035 : 0.065),
    DEPOSIT_ZOOM: cameraNumber("riftDepositZoom", "lowPowerRiftDepositZoom", LOW_POWER_MODE ? 0.055 : 0.12),
    RIFT_KICK_ZOOM: cameraNumber("riftKickZoom", "lowPowerRiftKickZoom", LOW_POWER_MODE ? 0.04 : 0.075),
    HEAL_ZOOM: cameraNumber("healZoom", "lowPowerHealZoom", LOW_POWER_MODE ? 0.025 : 0.045),
    UNHOOK_ZOOM: cameraNumber("unhookZoom", "lowPowerUnhookZoom", LOW_POWER_MODE ? 0.06 : 0.12),
    HOOKED_ZOOM: cameraNumber("hookedZoom", "lowPowerHookedZoom", LOW_POWER_MODE ? 0.055 : 0.10),
    INJURED_ZOOM: cameraNumber("injuredZoom", "lowPowerInjuredZoom", LOW_POWER_MODE ? 0.018 : 0.035),
    DOWNED_ZOOM: cameraNumber("downedZoom", "lowPowerDownedZoom", LOW_POWER_MODE ? 0.075 : 0.14),
    ESCAPE_ZOOM: cameraNumber("escapeZoom", "lowPowerEscapeZoom", LOW_POWER_MODE ? 0.06 : 0.12),

    SPAWN_ZOOM: cameraNumber("spawnPopZoom", "lowPowerSpawnPopZoom", LOW_POWER_MODE ? 0.10 : 0.18),
    SPAWN_ZOOM_DECAY: cameraNumber("spawnPopZoomDecay", "lowPowerSpawnPopZoomDecay", LOW_POWER_MODE ? 4.2 : 5.6),
    MATCH_START_LOCK_SECONDS: cfgNumber(GAMEPLAY_CONFIG.match?.startFreezeSeconds, 1.5),
    MATCH_START_ZOOM_OUT: cameraNumber("matchStartZoomOut", "lowPowerMatchStartZoomOut", LOW_POWER_MODE ? 0.26 : 0.48),
    MIN_ZOOM: cameraNumber("minZoom", "lowPowerMinZoom", LOW_POWER_MODE ? 0.42 : 0.34),

    ZOOM_SMOOTHING: cameraNumber("zoomSmoothing", "lowPowerZoomSmoothing", LOW_POWER_MODE ? 4.4 : 6.4),
    CHASE_IN_LERP: cameraNumber("chaseInLerp", "lowPowerChaseInLerp", LOW_POWER_MODE ? 0.045 : 0.055),
    CHASE_OUT_LERP: cameraNumber("chaseOutLerp", "lowPowerChaseOutLerp", LOW_POWER_MODE ? 0.035 : 0.04),
    TERROR_LERP: cameraNumber("terrorLerp", "lowPowerTerrorLerp", LOW_POWER_MODE ? 0.055 : 0.07),
    BREATH_SWAY: cameraNumber("breathSway", "lowPowerBreathSway", LOW_POWER_MODE ? 2.5 : 4),
    CHASE_SWAY: cameraNumber("chaseSway", "lowPowerChaseSway", LOW_POWER_MODE ? 3 : 5),
    // Direction-change camera sway. No constant running bob. The camera only leans
    // when the player changes movement direction, then smoothly settles back.
    // Smooth direction-change camera sway. The old impulse added pixels instantly,
    // which made normal WASD movement feel jumpy. These values feed a soft spring:
    // direction changes create a tiny target offset, then the camera eases into/out of it.
    DIRECTION_SWAY_IMPULSE: 7,
    DIRECTION_SWAY_MAX: 8,
    DIRECTION_CHANGE_THRESHOLD: 0.45,
    DIRECTION_SWAY_TARGET_DECAY: 8.5,
    DIRECTION_SWAY_SMOOTHING: 14.0,
    DIRECTION_SWAY_IDLE_SMOOTHING: 17.0,
    HEARTBEAT_MIN_INTERVAL: 0.32,
    HEARTBEAT_MAX_INTERVAL: 0.88,
    // Keep the pulse readable, not nauseating. We already made a horror game; no need to attack the monitor.
    HEARTBEAT_SHAKE_BASE: 0.00018,
    HEARTBEAT_SHAKE_CHASE: 0.00022,
    CHASE_START_SHAKE_DURATION: 26,
    CHASE_START_SHAKE_INTENSITY: 0.00020,
    TUNNEL_MAX: 0.68
  };

  const MATCH_START_TRANSITION = {
    TOTAL_MS: 1500,
    FADE_TO_BLACK_MS: 360,
    FADE_TO_GAME_MS: 1140
  };

  const FX_SMOOTHING = {
    // Red vignette ramps quickly when you stare at the killer, then fades slowly when you look away.
    // This prevents the on/off flash that made chase feel cheap and jittery.
    RED_RISE_PER_SECOND: 5.8,
    RED_FALL_PER_SECOND: 2.4,
    TUNNEL_RISE_PER_SECOND: 4.5,
    TUNNEL_FALL_PER_SECOND: 3.0,
    BLOOD_RISE_PER_SECOND: 5.0,
    BLOOD_FALL_PER_SECOND: 2.2
  };

  // Keep this matched with server.js. Client uses it only for local prediction
  // so walking into generators does not feel like rubber-band soup.
  const GENERATOR_COLLISION_SIZE = cfgNumber(GAMEPLAY_CONFIG.rift?.collisionSize, 54);

  const PERFORMANCE = {
    // Expensive world UI is redrawn at fixed rates instead of every network snapshot.
    // Lower these if a very weak laptop is still wheezing. Raise them if you want
    // smoother generator bars / scratch marks at the cost of more Graphics work.
    DYNAMIC_WORLD_FPS: LOW_POWER_MODE ? 4 : 7,
    // Generator bars update on their own cheap layer. Full-map redraws should not
    // happen just because somebody is holding E. Humanity may survive this one.
    GENERATOR_FPS: LOW_POWER_MODE ? 4 : 6,
    SCRATCH_DRAW_FPS: LOW_POWER_MODE ? 6 : 8,
    LIGHTING_FPS: LOW_POWER_MODE ? 30 : 60,
    WALL_VISION_FPS: LOW_POWER_MODE ? 14 : 22,
    MAX_PARTICLES: LOW_POWER_MODE ? 28 : 58,
    MAX_SHOCKWAVES: LOW_POWER_MODE ? 3 : 6
  };

  const WALL_VISION = {
    // Walls/windows are still real collision. This only controls what the client renders.
    // Keep a small readable bubble around the player so close corners do not become unfair invisible bonks.
    SURVIVOR_NEAR_RADIUS: LOW_POWER_MODE ? 142 : 170,
    KILLER_NEAR_RADIUS: LOW_POWER_MODE ? 170 : 205,
    CONE_EXTRA_LENGTH: 0,
    CONE_EXTRA_ANGLE: 0,
    EDGE_SOFTNESS: LOW_POWER_MODE ? 0.16 : 0.20,
    DISTANCE_FEATHER: 0.16,
    FADE_IN_PER_SECOND: LOW_POWER_MODE ? 8.5 : 12.5,
    FADE_OUT_PER_SECOND: LOW_POWER_MODE ? 4.2 : 5.8,
    MIN_VISIBLE_ALPHA: 0.018
  };

  // Visual generator tuning. Put your actual SVG at public/gen.svg.
  // The fallback canvas texture below keeps the game from collapsing if the file is missing,
  // because browsers are apparently dramatic about absent art assets.
  const GROUND_VISUAL = {
    TILE_SIZE: 72,
    BASE: 0x090a10,
    BASE_DARK: 0x05060a,
    BASE_LIGHT: 0x121626,
    EDGE_GREEN: 0x171b2c,
    PATCH_ALPHA: 0.16,
    EDGE_ALPHA: 0.18
  };

  const WALL_VISUAL = {
    PLANK_HEIGHT: 18,
    PLANK_WIDTH: 44,
    WOOD_BASE: 0x241821,
    WOOD_DARK: 0x08070d,
    WOOD_LIGHT: 0x4b3348,
    WOOD_GRAIN: 0x15101a,
    WOOD_GLOW: 0x8162ff,
    KNOT_COLOR: 0x09060b,
    EDGE_ALPHA: 0.72,
    HIGHLIGHT_ALPHA: 0.24,
    GRAIN_ALPHA: 0.38,
    SEAM_ALPHA: 0.66
  };

  const GENERATOR_VISUAL = {
    TEXTURE_KEY: "generatorSvg",
    FALLBACK_KEY: "generatorFallback",
    FILE: "/gen.svg",
    SIZE: 76,
    DONE_TINT: 0xb8ffae,
    WORKING_TINT: 0xffffff,
    BROKEN_TINT: 0xcfc6b7,
    BAR_WIDTH: 68,
    BAR_HEIGHT: 8,
    BAR_Y_OFFSET: 48,
    REPAIR_GLOW_COLOR: 0xffd15c,
    KICK_GLOW_COLOR: 0xff4b4b,
    DEPOSIT_PROGRESS_SMOOTHING: 18,
    DEPOSIT_FULL_SNAP: 0.98
  };

  const HOOK_INDICATOR = {
    // Survivor-only edge bubble that points toward hooked teammates.
    // Raise EDGE_PADDING if your HUD overlaps the screen border.
    EDGE_PADDING: 66,
    ON_SCREEN_PADDING: 92,
    RADIUS: 27,
    PULSE: 3.5,
    LINE_ALPHA: 0.82,
    FILL_ALPHA: 0.74,
    ARROW_ALPHA: 0.92
  };

  const LOCAL_SPEEDS = {
    survivorWalk: cfgNumber(GAMEPLAY_CONFIG.survivor?.walkSpeed, 170),
    survivorSprint: cfgNumber(GAMEPLAY_CONFIG.survivor?.sprintSpeed, 285),
    survivorBoost: cfgNumber(GAMEPLAY_CONFIG.survivor?.hitBurstSpeed, 350),
    killer: cfgNumber(GAMEPLAY_CONFIG.void?.speed, 310),
    killerRecoveryMult: cfgNumber(GAMEPLAY_CONFIG.void?.recoverySpeedMultiplier, 0.28),
    killerLungeMult: cfgNumber(GAMEPLAY_CONFIG.attack?.lungeSpeedMultiplier, 1.22),
    downedCrawl: cfgNumber(GAMEPLAY_CONFIG.survivor?.downedCrawlSpeed, 62),
    survivorSize: cfgNumber(GAMEPLAY_CONFIG.actor?.survivorSize, 30),
    killerSize: cfgNumber(GAMEPLAY_CONFIG.actor?.voidSize, 38)
  };

  const COLORS = {
    floorA: 0x090a10,
    floorB: 0x05060a,
    grassLine: 0x1d2440,
    blood: 0xf04444,
    hook: 0x9ca3af,
    hookIron: 0x02030a,
    downed: 0xf87171,
    wall: 0x0b1020,
    wallDark: 0x030712,
    wallLight: 0x27345f,
    window: 0x38d5ff,
    pallet: 0x8b5cf6,
    palletDark: 0x111827,
    gen: 0x8b5cf6,
    gate: 0x34d399,
    survivor: 0x75d5ff,
    survivorInjured: 0xff6868,
    killer: 0x7c3aed,
    text: 0xf2efea,
    scratch: 0x38bdf8,
    collectibleDot: 0xfbbf24,
    collectibleDotGlow: 0xffe08a
  };

  const SURVIVOR_DOT_MAX = cfgNumber(GAMEPLAY_CONFIG.orbs?.survivorMax, 10);

  const DOT_ORBIT_VISUAL = {
    RADIUS_BASE: 22,
    RADIUS_STEP: 1.4,
    SIZE_PRIMARY: 3.8,
    SIZE_SECONDARY: 3.1,
    BOB: 1.2,
    // Matches the old decorative orbit speed (performance.now() / 360).
    SPIN_SPEED: 2.75,
    PICKUP_SMOOTHING: 11,
    DEPOSIT_SMOOTHING: 5.5,
    DEPOSIT_PROGRESS_SMOOTHING: 16,
    DEPOSIT_EXIT_PUSH: 16
  };

  const DOT_FADE_VISUAL = {
    IN_SPEED: LOW_POWER_MODE ? 8.5 : 11.5,
    OUT_SPEED: LOW_POWER_MODE ? 9.5 : 13.5,
    FPS: LOW_POWER_MODE ? 12 : 18,
    REMOVE_ALPHA: 0.018
  };


  const ORB_FULL_CHAT_MESSAGES = new Set([
    "I have too many orbs...",
    "I should deposit these",
    "I can't pick any more up.",
    "I'm getting full..."
  ]);

  function visibleChatTextForActor(actor) {
    const text = actor?.chatText || "";
    if (!text) return "";
    if ((actor.downed || actor.hooked || actor.dead || actor.escaped) && ORB_FULL_CHAT_MESSAGES.has(text)) return "";
    return text;
  }

  const SURVIVOR_SKINS = {
    // Keep the original IDs so existing lobby/server skin data still works.
    // The visuals are now themed as soft .io-style signal creatures instead of plain geometry.
    blueSquare: {
      id: "blueSquare",
      label: "Azure Orbit",
      shape: "orbit",
      color: 0x38bdf8,
      accent: 0x818cf8,
      glow: 0xbae6fd,
      outline: 0xf0f9ff
    },
    yellowStar: {
      id: "yellowStar",
      label: "Solar Sprite",
      shape: "sprite",
      color: 0xfacc15,
      accent: 0xfb7185,
      glow: 0xfef3c7,
      outline: 0xfffbeb
    },
    purplePentagon: {
      id: "purplePentagon",
      label: "Prism Ghost",
      shape: "prism",
      color: 0xa78bfa,
      accent: 0x22d3ee,
      glow: 0xede9fe,
      outline: 0xf5f3ff
    },
    nebulaBloom: {
      id: "nebulaBloom",
      label: "Nebula Bloom",
      shape: "bloom",
      color: 0xec4899,
      accent: 0x38bdf8,
      glow: 0xfbcfe8,
      outline: 0xfdf2f8
    },
    eclipseWisp: {
      id: "eclipseWisp",
      label: "Eclipse Wisp",
      shape: "wisp",
      color: 0x14b8a6,
      accent: 0x4c1d95,
      glow: 0x99f6e4,
      outline: 0xccfbf1
    },
    riftMoth: {
      id: "riftMoth",
      label: "Rift Moth",
      shape: "moth",
      color: 0x60a5fa,
      accent: 0xc084fc,
      glow: 0xdbeafe,
      outline: 0xeff6ff
    },
    signalDrone: {
      id: "signalDrone",
      label: "Signal Drone",
      shape: "drone",
      color: 0x34d399,
      accent: 0xfbbf24,
      glow: 0xd1fae5,
      outline: 0xecfdf5
    }
  };

  // In-match radial chat. Hold R, aim with the mouse, release R to send.
  const CHAT_WHEEL = {
    RADIUS: 126,
    INNER_RADIUS: 34,
    LABEL_RADIUS: 100,
    CENTER_ALPHA: 0.76,
    SEGMENT_ALPHA: 0.58,
    SELECTED_ALPHA: 0.88,
    DIM_ALPHA: 0.30,
    TEXT_SIZE: "13px",
    MESSAGES: {
      survivor: {
        normal: ["Let's feed a rift.", "I'm so scared...", "Here he comes!", "What was that?!"],
        chase: ["He's on me...!", "Leave me alone!", "I'm so scared!", "AHHHH!"],
        injured: ["I need healing...", "Please, help me...", "I need to hide.", "Over here..."],
        downed: ["Pick me up!", "Help, please...", "I don't wanna die...", "I'm down...!"],
        hooked: ["Save me!", "Unhook me!", "Grab me!", "He's here..."]
      },
      killer: ["Im going to get you", "You cant hide forever", "Ill be back...", "What the...?!"]
    }
  };

  function getSurvivorSkin(id) {
    return SURVIVOR_SKINS[id] || SURVIVOR_SKINS.blueSquare;
  }

  const ui = {
    menu: document.getElementById("menu"),
    playScreen: document.getElementById("playScreen"),
    skinScreen: document.getElementById("skinScreen"),
    optionsScreen: document.getElementById("optionsScreen"),
    howScreen: document.getElementById("howScreen"),
    lobbyScreen: document.getElementById("lobbyScreen"),
    endScreen: document.getElementById("endScreen"),
    menuPlayBtn: document.getElementById("menuPlayBtn"),
    menuSkinsBtn: document.getElementById("menuSkinsBtn"),
    menuOptionsBtn: document.getElementById("menuOptionsBtn"),
    menuHowBtn: document.getElementById("menuHowBtn"),
    menuMusicToggleBtn: document.getElementById("menuMusicToggleBtn"),
    menuMusicToggleBtnOptions: document.getElementById("menuMusicToggleBtnOptions"),
    menuMusicVolumeSlider: document.getElementById("menuMusicVolumeSlider"),
    menuMusicVolumeValue: document.getElementById("menuMusicVolumeValue"),
    menuBackBtns: [...document.querySelectorAll(".menu-back-btn")],
    playerName: document.getElementById("playerName"),
    roleBtns: [...document.querySelectorAll(".role-btn")],
    skinBtns: [...document.querySelectorAll(".skin-btn")],
    quickJoinBtn: document.getElementById("quickJoinBtn"),
    createLobbyBtn: document.getElementById("createLobbyBtn"),
    lobbyList: document.getElementById("lobbyList"),
    lobbyTitle: document.getElementById("lobbyTitle"),
    playersList: document.getElementById("playersList"),
    beSurvivorBtn: document.getElementById("beSurvivorBtn"),
    beKillerBtn: document.getElementById("beKillerBtn"),
    readyBtn: document.getElementById("readyBtn"),
    addBotSurvivorBtn: document.getElementById("addBotSurvivorBtn"),
    addBotKillerBtn: document.getElementById("addBotKillerBtn"),
    startBtn: document.getElementById("startBtn"),
    leaveBtn: document.getElementById("leaveBtn"),
    hud: document.getElementById("hud"),
    survivorStatusHud: document.getElementById("survivorStatusHud"),
    horrorFx: document.getElementById("horrorFx"),
    roleLabel: document.getElementById("roleLabel"),
    controlsLabel: document.getElementById("controlsLabel"),
    genText: document.getElementById("genText"),
    bigGenCounter: document.getElementById("bigGenCounter"),
    bigGenText: document.getElementById("bigGenText"),
    gateText: document.getElementById("gateText"),
    healthText: document.getElementById("healthText"),
    audioText: document.getElementById("audioText"),
    toast: document.getElementById("toast"),
    winnerText: document.getElementById("winnerText"),
    reasonText: document.getElementById("reasonText"),
    backToLobbyBtn: document.getElementById("backToLobbyBtn"),
    spectateBtn: document.getElementById("spectateBtn"),
    mainMenuBtn: document.getElementById("mainMenuBtn"),
    mobileControls: document.getElementById("mobileControls")
  };

  function ensureFpsCounter() {
    if (ui.fpsText) return ui.fpsText;
    const card = document.querySelector(".objective-card");
    if (!card) return null;
    const row = document.createElement("div");
    row.id = "fpsCounterRow";
    row.className = "fps-counter-row";
    const label = document.createElement("span");
    label.textContent = "FPS";
    const value = document.createElement("b");
    value.id = "fpsText";
    value.textContent = "--";
    row.append(label, value);
    card.appendChild(row);
    ui.fpsText = value;
    return value;
  }

  const fxState = {
    redChase: 0,
    tunnel: 0,
    blood: 0,
    lastUpdate: performance.now()
  };

  let socket = null;
  let myId = null;
  let selectedRole = "survivor";
  let selectedSkin = "blueSquare";
  let currentLobbyState = null;
  let currentSnapshot = null;
  let phaserScene = null;
  let lastInputPayload = "";
  let toastTimer = null;
  let activeScreenName = "menu";

  function setSelectedSkin(skinId) {
    selectedSkin = SURVIVOR_SKINS[skinId] ? skinId : "blueSquare";
    ui.skinBtns.forEach((b) => b.classList.toggle("selected", b.dataset.skin === selectedSkin));
  }

  const input = {
    up: false,
    down: false,
    left: false,
    right: false,
    sprint: false,
    repair: false,
    action: false,
    attack: false,
    attackHeld: false,
    angle: 0
  };

  const audio = {
    ready: false,
    tried: false,
    gameActive: false,
    lastTryAt: 0,
    layers: [],
    menu: null,
    menuActive: false,
    sfx: {},
    targets: [0, 0, 0],
    volumes: [0, 0, 0],
    layer3ChaseActive: false,
    layer3InjuredPitchActive: false,
    lastHookPitchIndex: -1,
    lastWindowVaultPitchIndex: -1,
    lastSfxPitchIndices: Object.create(null)
  };

  const MENU_MUSIC_MUTE_KEY = "surviveMenuMusicMuted";
  const MENU_MUSIC_VOLUME_KEY = "surviveMenuMusicVolume";

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function isMenuMusicMuted() {
    try { return localStorage.getItem(MENU_MUSIC_MUTE_KEY) === "1"; }
    catch { return false; }
  }

  function getMenuMusicVolume() {
    const configDefault = Number.isFinite(MUSIC.MENU_MASTER) ? MUSIC.MENU_MASTER : 0.14;
    try {
      const saved = localStorage.getItem(MENU_MUSIC_VOLUME_KEY);
      if (saved !== null) return clamp01(Number(saved));
    } catch {
      // Storage can fail in strict/private browser modes. The config default still works.
    }
    return clamp01(configDefault);
  }

  function setMenuMusicVolume(value) {
    const volume = clamp01(Number(value));
    try { localStorage.setItem(MENU_MUSIC_VOLUME_KEY, String(volume)); }
    catch { /* Still applies for this session through the audio element. */ }
    syncMenuMusicVolumeUi();
    applyMenuMusicVolume();
  }

  function setMenuMusicMuted(muted) {
    try { localStorage.setItem(MENU_MUSIC_MUTE_KEY, muted ? "1" : "0"); }
    catch { /* Private browsing can refuse storage. Mute still works this session. */ }
    syncMenuMusicToggleUi();
    syncMenuMusicVolumeUi();
    applyMenuMusicVolume();
  }

  function applyMenuMusicVolume() {
    const menu = audio.menu;
    if (!menu) return;
    const muted = isMenuMusicMuted();
    const volume = getMenuMusicVolume();
    menu.volume = muted ? 0 : volume;
    if (muted || volume <= 0.001) {
      menu.pause();
      return;
    }
    if (audio.menuActive) menu.play().catch(() => null);
  }

  function syncMenuMusicToggleUi() {
    const muted = isMenuMusicMuted();
    const label = muted ? "Menu music off" : "Menu music on";
    for (const btn of [ui.menuMusicToggleBtn, ui.menuMusicToggleBtnOptions]) {
      if (!btn) continue;
      btn.textContent = label;
      btn.setAttribute("aria-pressed", muted ? "true" : "false");
      btn.classList.toggle("is-muted", muted);
    }
  }

  function syncMenuMusicVolumeUi() {
    const volume = getMenuMusicVolume();
    const percent = Math.round(volume * 100);
    if (ui.menuMusicVolumeSlider) {
      ui.menuMusicVolumeSlider.value = String(percent);
      ui.menuMusicVolumeSlider.setAttribute("aria-valuetext", `${percent}%`);
    }
    if (ui.menuMusicVolumeValue) ui.menuMusicVolumeValue.textContent = `${percent}%`;
  }

  function bindMenuMusicVolumeSlider(slider) {
    if (!slider) return;
    const handleChange = () => {
      const next = Number(slider.value || 0) / 100;
      setMenuMusicVolume(next);
      if (next > 0 && isMenuMusicMuted()) setMenuMusicMuted(false);
      ensureMenuAudioStarted();
    };
    slider.addEventListener("input", handleChange);
    slider.addEventListener("change", handleChange);
  }

  function toggleMenuMusicMuted() {
    setMenuMusicMuted(!isMenuMusicMuted());
  }

  function setMenuAudioActive(active, options = {}) {
    audio.menuActive = !!active;
    const menu = audio.menu;
    if (!menu) return;

    if (!audio.menuActive) {
      menu.pause();
      return;
    }

    if (options.restart) {
      try { menu.currentTime = 0; } catch (_) { /* Some browsers get precious about media time. */ }
    }

    applyMenuMusicVolume();
  }

  function ensureMenuAudioStarted(options = {}) {
    if (!audio.menuActive || !audio.menu) return;
    if (options.restart) {
      try { audio.menu.currentTime = 0; } catch (_) { /* ignore */ }
    }
    applyMenuMusicVolume();
  }

  function setGameplayAudioActive(active) {
    audio.gameActive = !!active;
    if (!audio.gameActive) {
      audio.targets = [0, 0, 0];
      audio.volumes = [0, 0, 0];
      audio.layer3ChaseActive = false;
      audio.layer3InjuredPitchActive = false;
      applyMusicPlaybackRate(audio.layers?.[2], MUSIC.LAYER_3_NORMAL_PLAYBACK_RATE);
      for (const layer of audio.layers || []) {
        layer.volume = 0;
        if (!layer.paused) layer.pause();
      }
      return;
    }

    // Resume synced layers when entering a match. Browser autoplay can still block
    // until a user input happens, so ensureAudioStarted() keeps the polite retry path.
    if (audio.ready) {
      for (const layer of audio.layers || []) {
        if (layer.paused) layer.play().catch(() => null);
      }
    }
  }

  function showScreen(name) {
    const previousScreen = activeScreenName;
    const wasGameScreen = previousScreen === "game";
    activeScreenName = name;

    const isGameScreen = name === "game";
    const menuLike = !isGameScreen;
    const shouldRestartMenuMusic = menuLike && wasGameScreen;

    document.body.classList.toggle("is-game-screen", isGameScreen);
    document.body.classList.toggle("is-menu-screen", menuLike);
    setGameplayAudioActive(isGameScreen);
    setMenuAudioActive(menuLike, { restart: shouldRestartMenuMusic });
    ui.menu?.classList.toggle("screen-open", name === "menu");
    ui.playScreen?.classList.toggle("screen-open", name === "play");
    ui.skinScreen?.classList.toggle("screen-open", name === "skins");
    ui.optionsScreen?.classList.toggle("screen-open", name === "options");
    ui.howScreen?.classList.toggle("screen-open", name === "how");
    ui.lobbyScreen?.classList.toggle("screen-open", name === "lobby");
    ui.endScreen?.classList.toggle("screen-open", name === "end");
    ui.hud.classList.toggle("hidden", name !== "game");
    ui.survivorStatusHud?.classList.toggle("hidden", name !== "game");
    ui.bigGenCounter?.classList.toggle("hidden", name !== "game");
    ui.horrorFx?.classList.toggle("hidden", name !== "game");
    ui.mobileControls?.classList.toggle("hidden", name !== "game" || !IS_TOUCH_DEVICE);
  }

  let matchTransitionTimers = [];

  function clearMatchStartTransitionTimers() {
    for (const timer of matchTransitionTimers) clearTimeout(timer);
    matchTransitionTimers = [];
  }

  function getMatchStartTransitionOverlay() {
    let overlay = document.getElementById("matchStartTransition");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "matchStartTransition";
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9000",
      pointerEvents: "none",
      background: "#000",
      opacity: "0",
      display: "none",
      willChange: "opacity"
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function runMatchStartTransition(revealGame) {
    const overlay = getMatchStartTransitionOverlay();
    clearMatchStartTransitionTimers();

    overlay.style.display = "block";
    overlay.style.pointerEvents = "auto";
    overlay.style.transition = "none";
    overlay.style.opacity = "0";
    overlay.getBoundingClientRect();

    const fadeToBlackMs = MATCH_START_TRANSITION.FADE_TO_BLACK_MS;
    const fadeToGameMs = MATCH_START_TRANSITION.FADE_TO_GAME_MS;

    requestAnimationFrame(() => {
      overlay.style.transition = `opacity ${fadeToBlackMs}ms cubic-bezier(.2,.72,.2,1)`;
      overlay.style.opacity = "1";
    });

    matchTransitionTimers.push(setTimeout(() => {
      revealGame?.();
      overlay.style.transition = `opacity ${fadeToGameMs}ms cubic-bezier(.15,.85,.25,1)`;
      overlay.style.opacity = "0";
    }, fadeToBlackMs));

    matchTransitionTimers.push(setTimeout(() => {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
      overlay.style.transition = "none";
      overlay.style.opacity = "0";
    }, fadeToBlackMs + fadeToGameMs + 40));
  }

  function getName() {
    return (ui.playerName.value || "Player").trim().slice(0, 18) || "Player";
  }

  function toast(message, ms = 1800) {
    if (!message) return;
    ui.toast.textContent = message;
    ui.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), ms);
  }


  const ANNOUNCEMENT_LIFETIME_MS = 3200;
  const ANNOUNCEMENT_MAX_VISIBLE = 3;

  function getAnnouncementRoot() {
    let root = document.getElementById("matchAnnouncements");
    if (!root) {
      root = document.createElement("div");
      root.id = "matchAnnouncements";
      root.className = "match-announcements";
      root.setAttribute("aria-live", "polite");
      root.setAttribute("aria-atomic", "false");
      document.body.appendChild(root);
    }
    return root;
  }

  function actorNameFromSnapshot(actorId, fallback = "Survivor") {
    if (!actorId) return fallback;
    const snapshotActor = (currentSnapshot?.actors || []).find((actor) => actor.id === actorId);
    if (snapshotActor?.name) return snapshotActor.name;
    const sceneActor = phaserScene?.actors?.get(actorId);
    if (sceneActor?.data?.name) return sceneActor.data.name;
    return fallback;
  }

  function pushMatchAnnouncement({ title, detail = "", kind = "rift" }) {
    if (!title || activeScreenName !== "game") return;
    const root = getAnnouncementRoot();
    const existing = [...root.querySelectorAll(".match-announcement")];
    for (const old of existing.slice(0, Math.max(0, existing.length - ANNOUNCEMENT_MAX_VISIBLE + 1))) {
      old.remove();
    }

    const card = document.createElement("div");
    card.className = `match-announcement ${kind ? `is-${kind}` : ""}`;
    card.innerHTML = `
      <div class="match-announcement-rune" aria-hidden="true"></div>
      <div class="match-announcement-copy">
        <strong>${escapeHtml(title)}</strong>
        ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
      </div>
    `;
    root.appendChild(card);
    window.setTimeout(() => card.classList.add("leaving"), ANNOUNCEMENT_LIFETIME_MS - 520);
    window.setTimeout(() => card.remove(), ANNOUNCEMENT_LIFETIME_MS);
  }

  function announceMatchEvent(event) {
    if (!event || !event.type) return;

    if (event.type === "hooked") {
      if (event.survivorId === myId) return;
      const name = actorNameFromSnapshot(event.survivorId, "A Survivor");
      pushMatchAnnouncement({
        kind: "hook",
        title: `${name} was hooked`,
        detail: "The Void tightens its grip."
      });
      return;
    }

    if (event.type === "execute" || event.type === "death") {
      if (event.survivorId === myId) return;
      const name = actorNameFromSnapshot(event.survivorId, "A Survivor");
      pushMatchAnnouncement({
        kind: "death",
        title: `${name} was claimed`,
        detail: "Their signal vanished into the dark."
      });
      return;
    }

    if (event.type === "genDone") {
      if (event.allRiftsDone) {
        pushMatchAnnouncement({
          kind: "void",
          title: "Escape Voids Open",
          detail: "Stand in an open Void for 4 seconds."
        });
      } else {
        const completed = Number(event.completedRifts || 0);
        const required = Number(event.requiredRifts || 0);
        pushMatchAnnouncement({
          kind: "rift",
          title: "Rift restored",
          detail: completed && required ? `${completed} / ${required} restored.` : "The escape voids grow closer."
        });
      }
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function dampAlpha(rate, dt) {
    // Time-based smoothing so camera effects feel the same at 30, 60, or 144 FPS.
    return 1 - Math.exp(-Math.max(0, rate) * clamp(dt || 0, 0, 0.05));
  }

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }

  function darken(hex, amount = LIGHTING.MAP_DARKNESS) {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    const m = clamp(1 - amount, 0.05, 1);
    return ((r * m) << 16) | ((g * m) << 8) | (b * m);
  }

  function brighten(hex, amount = 0.22) {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return (clamp(Math.floor(r + (255 - r) * amount), 0, 255) << 16) |
      (clamp(Math.floor(g + (255 - g) * amount), 0, 255) << 8) |
      clamp(Math.floor(b + (255 - b) * amount), 0, 255);
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function hash2(x, y) {
    let n = (x * 374761393 + y * 668265263) ^ (x * y * 1274126177);
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function actorRect(actorLike, x, y) {
    const size = actorLike.role === "killer" ? LOCAL_SPEEDS.killerSize : LOCAL_SPEEDS.survivorSize;
    return { x: x - size / 2, y: y - size / 2, w: size, h: size };
  }

  function getMoveDirectionName() {
    const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (!dx && !dy) return null;
    if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "up" : "down";
    return dx < 0 ? "left" : "right";
  }

  function inputPayload(oneShot = {}) {
    return {
      up: input.up,
      down: input.down,
      left: input.left,
      right: input.right,
      sprint: input.sprint,
      repair: input.repair,
      action: !!oneShot.action,
      attack: !!oneShot.attack,
      attackHeld: !!input.attackHeld,
      attackReleased: !!oneShot.attackReleased,
      actionDir: getMoveDirectionName(),
      angle: input.angle
    };
  }

  function getLocalPlayerData() {
    return currentSnapshot?.actors?.find((a) => a.id === myId)
      || phaserScene?.actors?.get(myId)?.data
      || null;
  }

  function isLocalSpectating() {
    const me = getLocalPlayerData();
    return me?.role === "survivor" && (!!me.dead || !!me.escaped);
  }

  function getLivingTeammates(snapshot = currentSnapshot) {
    return (snapshot?.actors || []).filter(
      (a) => a.role === "survivor" && a.id !== myId && !a.dead && !a.escaped
    );
  }

  function sendInput(oneShot = {}, force = false) {
    if (!socket || !myId) return;
    const me = getLocalPlayerData();
    if (me?.role === "survivor" && me.dead) return;
    const payload = inputPayload(oneShot);
    const signature = JSON.stringify(payload);
    if (force || signature !== lastInputPayload || oneShot.action || oneShot.attack || oneShot.attackReleased) {
      socket.emit("input", payload);
      lastInputPayload = signature;
    }
  }

  function setupAudio() {
    audio.menu = new Audio(MUSIC.MENU);
    audio.menu.loop = true;
    audio.menu.preload = "auto";
    syncMenuMusicToggleUi();
    syncMenuMusicVolumeUi();
    applyMenuMusicVolume();
    audio.menu.addEventListener("error", () => null);

    audio.layers = MUSIC.LAYERS.map((src) => {
      const a = new Audio(src);
      a.loop = true;
      a.preload = "auto";
      a.volume = 0;
      a.addEventListener("error", () => {
        // Missing music files should not break the game. A rare act of mercy.
      });
      return a;
    });

    audio.sfx = Object.fromEntries(Object.entries(SFX.FILES).map(([name, src]) => {
      const a = new Audio(src);
      a.loop = false;
      a.preload = "auto";
      a.volume = clamp((SFX.VOLUMES[name] || 0.75) * SFX.MASTER, 0, 1);
      a.addEventListener("error", () => {
        // Missing SFX files should not brick the match. The void can stay quiet.
      });
      return [name, a];
    }));
  }

  function ensureAudioStarted() {
    if (!audio.gameActive) return;

    if (audio.ready) {
      for (const a of audio.layers) {
        if (a.paused) a.play().catch(() => null);
      }
      return;
    }

    const now = performance.now();
    if (audio.tried && now - audio.lastTryAt < 900) return;
    audio.tried = true;
    audio.lastTryAt = now;

    const plays = audio.layers.map((a) => {
      if (a.paused && a.currentTime === 0) a.currentTime = 0;
      return a.play().catch(() => null);
    });
    Promise.allSettled(plays).then(() => {
      audio.ready = audio.layers.some((a) => !a.paused);
      if (ui.audioText) ui.audioText.textContent = audio.ready ? "On" : "Blocked";
    });
  }

  function isLocalSurvivorInjuredForLayer3() {
    const me = getLocalPlayerData();
    return !!(
      me
      && me.id === myId
      && me.role === "survivor"
      && !me.dead
      && !me.escaped
      && !me.downed
      && !me.hooked
      && (me.injured || me.health <= 1)
    );
  }

  function getLayer3PlaybackRateForLocalState() {
    const rawRate = isLocalSurvivorInjuredForLayer3()
      ? MUSIC.LAYER_3_INJURED_PLAYBACK_RATE
      : MUSIC.LAYER_3_NORMAL_PLAYBACK_RATE;
    const rate = Number(rawRate);
    return Number.isFinite(rate) && rate > 0 ? clamp(rate, 0.75, 1.35) : 1;
  }

  function applyMusicPlaybackRate(layer, rate = 1) {
    if (!layer) return;
    layer.preservesPitch = false;
    layer.mozPreservesPitch = false;
    layer.webkitPreservesPitch = false;
    layer.playbackRate = clamp(Number(rate) || 1, 0.75, 1.35);
  }

  function setMusicTargets(music) {
    const m = music || { layer1: 0.06, layer2: 0, layer3: 0 };
    const layerVolumes = MUSIC.LAYER_VOLUMES || {};
    const nextTargets = [
      clamp((m.layer1 || 0) * (layerVolumes.layer1 ?? 1) * MUSIC.MASTER, 0, 0.34),
      clamp((m.layer2 || 0) * (layerVolumes.layer2 ?? 1) * MUSIC.MASTER, 0, 0.34),
      clamp((m.layer3 || 0) * (layerVolumes.layer3 ?? 1) * MUSIC.MASTER, 0, 0.34)
    ];

    const nextLayer3Active = nextTargets[2] > 0.002;
    const layer3 = audio.layers?.[2];
    const layer3InjuredPitchActive = nextLayer3Active && isLocalSurvivorInjuredForLayer3();
    if (nextLayer3Active && !audio.layer3ChaseActive) {
      if (layer3) {
        try { layer3.currentTime = 0; } catch (_) { /* Some browsers guard media seeking like it is state secrets. */ }
        applyMusicPlaybackRate(layer3, getLayer3PlaybackRateForLocalState());
        if (audio.ready && audio.gameActive && layer3.paused) layer3.play().catch(() => null);
      }
      // Fade the chase layer in from silence, but from the beginning of the actual track.
      audio.volumes[2] = 0;
    } else if (nextLayer3Active && audio.layer3InjuredPitchActive !== layer3InjuredPitchActive) {
      // While layer_3 is already playing, shift pitch only when the local survivor becomes injured/healed.
      // Do not restart here, because that would make mid-chase injury sound like the track tripped over itself.
      applyMusicPlaybackRate(layer3, getLayer3PlaybackRateForLocalState());
    } else if (!nextLayer3Active && audio.layer3ChaseActive) {
      applyMusicPlaybackRate(layer3, MUSIC.LAYER_3_NORMAL_PLAYBACK_RATE);
    }

    audio.layer3ChaseActive = nextLayer3Active;
    audio.layer3InjuredPitchActive = layer3InjuredPitchActive;
    audio.targets[0] = nextTargets[0];
    audio.targets[1] = nextTargets[1];
    audio.targets[2] = nextTargets[2];
  }

  function updateMusic() {
    if (!audio.layers.length) return;
    if (!audio.gameActive) {
      for (let i = 0; i < audio.layers.length; i++) {
        audio.targets[i] = 0;
        audio.volumes[i] = 0;
        audio.layers[i].volume = 0;
        if (!audio.layers[i].paused) audio.layers[i].pause();
      }
      return;
    }

    if (audio.ready) {
      for (const layer of audio.layers) {
        if (layer.paused) layer.play().catch(() => null);
      }
    }

    for (let i = 0; i < audio.layers.length; i++) {
      audio.volumes[i] += (audio.targets[i] - audio.volumes[i]) * MUSIC.FADE;
      if (Number.isFinite(audio.volumes[i])) audio.layers[i].volume = clamp(audio.volumes[i], 0, 1);
    }
  }

  function cleanPitchSteps(steps) {
    if (!Array.isArray(steps)) return [];
    return steps
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
  }

  function getNextSfxPitch(name) {
    if (!ENABLE_SFX_PITCH_VARIATION) return null;
    const steps = cleanPitchSteps(SFX_PITCH_STEPS?.[name]);
    if (!steps.length) return null;

    if (!audio.lastSfxPitchIndices) audio.lastSfxPitchIndices = Object.create(null);
    let index = Math.floor(Math.random() * steps.length);
    const lastIndex = audio.lastSfxPitchIndices[name];
    if (steps.length > 1 && index === lastIndex) {
      index = (index + 1 + Math.floor(Math.random() * (steps.length - 1))) % steps.length;
    }
    audio.lastSfxPitchIndices[name] = index;
    return steps[index];
  }

  function playSfx(name, options = {}) {
    const base = audio.sfx?.[name];
    if (!base) return;
    const clip = base.cloneNode(true);
    clip.loop = false;

    const explicitPlaybackRate = Number(options.playbackRate);
    const configPlaybackRate = options.disablePitchVariation ? null : getNextSfxPitch(name);
    const playbackRate = Number.isFinite(explicitPlaybackRate) && explicitPlaybackRate > 0
      ? explicitPlaybackRate
      : configPlaybackRate;

    if (Number.isFinite(playbackRate) && playbackRate > 0) {
      // Set these before playbackRate so browsers actually pitch-shift instead of preserving pitch like helpful little pests.
      clip.preservesPitch = false;
      clip.mozPreservesPitch = false;
      clip.webkitPreservesPitch = false;
      clip.playbackRate = clamp(playbackRate, 0.5, 2.25);
    }

    clip.volume = clamp((SFX.VOLUMES[name] || 0.75) * SFX.MASTER, 0, 1);
    clip.play().catch(() => {
      // Browser autoplay rules can still block if the user has not interacted yet.
      // Once they click or press a key, future effects will play. Naturally, browsers need consent to scream.
    });
  }

  const LOCAL_SFX_RANGE = AUDIO_CONFIG.sfx.localRange;

  function getLocalVisualActor() {
    const scene = phaserScene;
    if (!scene) return null;
    const subjectId = scene.isSpectating?.() ? scene.resolveSpectateTargetId() : myId;
    return scene.actors?.get(subjectId) || null;
  }

  function distanceToLocalEvent(event) {
    const me = getLocalVisualActor();
    const x = Number(event?.x);
    const y = Number(event?.y);
    if (!me?.current || !Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
    return dist(me.current.x, me.current.y, x, y);
  }

  function playLocalizedSwing(event) {
    if (!event) return;
    const isKillerSwinging = event.actorId === myId;
    const d = distanceToLocalEvent(event);
    // Killer hears their own swing. Everyone else only hears it when it is actually nearby.
    if (isKillerSwinging || d <= LOCAL_SFX_RANGE.swing) playSfx("swing");
  }

  function playLocalizedHit(event) {
    if (!event) return;
    const isMyHit = event.survivorId === myId;
    const d = distanceToLocalEvent(event);
    // The victim always hears impact. Other players only hear it nearby.
    if (isMyHit || d <= LOCAL_SFX_RANGE.hit) playSfx("injured");
  }


  function playLocalizedPalletDrop(event) {
    if (!event) return;
    const isThrower = event.actorId === myId;
    const d = distanceToLocalEvent(event);
    // The Survivor who drops the pallet hears it. Others only hear it when close enough.
    if (isThrower || d <= (LOCAL_SFX_RANGE.palletDrop || 280)) playSfx("palletDrop");
  }

  function playLocalizedPalletStun(event) {
    if (!event) return;
    const isThrower = event.actorId === myId;
    const d = distanceToLocalEvent(event);
    // The Survivor who dropped the pallet always hears the stun. Others only hear it if close.
    if (isThrower || d <= (LOCAL_SFX_RANGE.palletStun || 300)) playSfx("palletStun");
  }

  function playOrbPickupSfx(event) {
    if (!event || event.actorId !== myId) return;
    playSfx("orbPickup");
  }

  function playOrbDepositSfx(event) {
    if (!event || event.survivorId !== myId) return;
    const index = clamp(Number(event.depositIndex || event.chainIndex || 1), 1, SURVIVOR_DOT_MAX);
    const t = SURVIVOR_DOT_MAX <= 1 ? 1 : (index - 1) / (SURVIVOR_DOT_MAX - 1);
    // 1/10 is grounded, 10/10 is clearly higher. Perfectly subtle, unlike human UI requests.
    const rate = 0.86 + t * 1.04;
    playSfx("orbDeposit", { playbackRate: rate });
  }

  function survivorStateLabel(actor) {
    if (actor.dead) return "Dead";
    if (actor.escaped) return "Escaped";
    if (actor.escapeProgress > 0) return `Escaping ${Math.round((actor.escapeProgress || 0) * 100)}%`;
    if (actor.hooked) return actor.unhookProgress > 0 ? "Being Rescued" : `Hooked ${actor.hookCount || 1}/2`;
    if (actor.downed) {
      if (actor.healProgress > 0) return "Being Healed";
      return actor.hookProgress > 0 ? ((actor.hookCount || 0) >= 2 ? "Being Executed" : "Being Hooked") : "Downed";
    }
    if (actor.dotDepositTargetId) return `Depositing ${Math.round((actor.dotDepositProgress || 0) * 100)}%`;
    if (actor.health <= 1 || actor.injured) return actor.healProgress > 0 ? "Being Healed" : "Injured";
    return actor.chase ? "Chased" : "Healthy";
  }

  function survivorCardClass(actor) {
    const classes = ["survivor-status-card"];
    if (actor.id === myId) classes.push("self");
    if (isLocalSpectating() && actor.id === phaserScene?.resolveSpectateTargetId()) classes.push("spectating");
    if (actor.dead) classes.push("dead");
    else if (actor.escaped) classes.push("escaped");
    else if (actor.hooked) classes.push("hooked");
    else if (actor.downed) classes.push("downed");
    else if (actor.health <= 1 || actor.injured) classes.push("injured");
    else classes.push("healthy");
    if (actor.chase && !actor.dead && !actor.escaped && !actor.hooked && !actor.downed) classes.push("chased");
    return classes.join(" ");
  }

  function actionLabel(actor) {
    if (actor.dead) return "skull";
    if (actor.escaped) return "out";
    if (actor.hooked) return actor.unhookProgress > 0 ? "rescue" : "hook";
    if (actor.downed) {
      if (actor.healProgress > 0) return "heal";
      return actor.hookProgress > 0 ? ((actor.hookCount || 0) >= 2 ? "execute" : "capture") : "down";
    }
    if (actor.chase) return "chase";
    if (actor.dotDepositTargetId) return "feed";
    if (actor.healProgress > 0) return "heal";
    if (actor.health <= 1 || actor.injured) return "hurt";
    return "safe";
  }

  function survivorHudChatLine(actor) {
    const text = visibleChatTextForActor(actor);
    if (!text) return "";
    return `<div class="survivor-chat" role="status">"${escapeHtml(text)}"</div>`;
  }

  function renderKillerChatHudCard(killer) {
    if (!killer?.chatText) return "";
    const name = escapeHtml(killer.name || "The Void");
    return `
      <div class="survivor-status-card killer-chat-card has-chat">
        <div class="survivor-portrait killer-portrait" aria-hidden="true"></div>
        <div class="survivor-meta">
          <div class="survivor-name-row"><span class="survivor-name">${name}</span><span class="survivor-you">VOID</span></div>
          ${survivorHudChatLine(killer)}
        </div>
        <div class="survivor-action">chat</div>
      </div>`;
  }

  function renderSurvivorStatusHud(snapshot) {
    if (!ui.survivorStatusHud) return;
    const actors = snapshot.actors || [];
    const killer = actors.find((actor) => actor.role === "killer" && actor.chatText);
    const survivors = actors
      .filter((actor) => actor.role === "survivor")
      .sort((a, b) => {
        if (a.id === myId) return -1;
        if (b.id === myId) return 1;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

    const survivorCards = survivors.map((actor) => {
      const state = survivorStateLabel(actor);
      const name = escapeHtml(actor.name || "Survivor");
      const you = actor.id === myId ? '<span class="survivor-you">You</span>' : "";
      const dotsHeld = Math.min(SURVIVOR_DOT_MAX, actor.dots || 0);
      const depositText = actor.dotDepositTargetId ? ` • feeding ${Math.round((actor.dotDepositProgress || 0) * 100)}%` : "";
      const chatClass = visibleChatTextForActor(actor) ? " has-chat" : "";
      return `
        <div class="${survivorCardClass(actor)}${chatClass}">
          <div class="survivor-portrait" aria-hidden="true"></div>
          <div class="survivor-meta">
            <div class="survivor-name-row"><span class="survivor-name">${name}</span>${you}</div>
            <div class="survivor-state">${escapeHtml(state)}</div>
            ${survivorHudChatLine(actor)}
            <div class="survivor-dots" aria-label="Collectible dots">${dotsHeld} / ${SURVIVOR_DOT_MAX}${depositText}</div>
          </div>
          <div class="survivor-action">${escapeHtml(actionLabel(actor))}</div>
        </div>`;
    }).join("");

    ui.survivorStatusHud.innerHTML = [
      renderKillerChatHudCard(killer),
      survivorCards
    ].filter(Boolean).join("") || '<div class="survivor-status-card dead"><div class="survivor-portrait"></div><div class="survivor-meta"><div class="survivor-name">No survivors</div><div class="survivor-state">Quiet void</div></div><div class="survivor-action">void</div></div>';
  }

  function getThreatLevels(snapshot, me) {
    const music = snapshot?.music || {};
    const terror = clamp(Number(music.terror || 0), 0, 1);
    const chase = (music.chase || me?.chase) ? 1 : 0;
    const injured = me?.role === "survivor" && !me.dead && !me.escaped && (me.health <= 1 || me.injured || me.downed || me.hooked);
    const blood = me?.hooked ? 0.95 : me?.downed ? 1 : injured ? 0.82 : me?.dead ? 1 : 0;
    return { terror, chase, blood, injured };
  }

  function isLookingAtKiller(snapshot, me) {
    if (!snapshot || !me || me.role !== "survivor" || !me.chase || me.dead || me.escaped) return false;
    // The server already computes killer visibility using the survivor's cone and line of sight.
    // Use that instead of duplicating geometry here and inevitably summoning another bug gremlin.
    if (snapshot.music?.killerVisible) return true;
    const killer = (snapshot.actors || []).find((actor) => actor.role === "killer");
    return !!killer?.visible;
  }

  function approachValue(current, target, dt, risePerSecond, fallPerSecond) {
    const rate = target > current ? risePerSecond : fallPerSecond;
    const alpha = 1 - Math.exp(-Math.max(0, dt) * rate);
    return lerp(current, target, clamp(alpha, 0, 1));
  }

  function updateHorrorFx(snapshot, me, smoothed = null) {
    if (!ui.horrorFx) return;
    const raw = getThreatLevels(snapshot, me);
    const now = performance.now();
    const dt = clamp((now - fxState.lastUpdate) / 1000, 0.001, 0.08);
    fxState.lastUpdate = now;

    const terror = smoothed?.terror ?? raw.terror;
    const chase = smoothed?.chase ?? raw.chase;
    const targetBlood = raw.blood;
    const lookingAtKiller = isLookingAtKiller(snapshot, me);
    const targetRedChase = lookingAtKiller ? chase : 0;
    const targetTunnel = clamp(chase * IMMERSION.TUNNEL_MAX + terror * 0.18 + targetBlood * 0.16, 0, 1);

    fxState.redChase = approachValue(
      fxState.redChase,
      targetRedChase,
      dt,
      FX_SMOOTHING.RED_RISE_PER_SECOND,
      FX_SMOOTHING.RED_FALL_PER_SECOND
    );
    fxState.tunnel = approachValue(
      fxState.tunnel,
      targetTunnel,
      dt,
      FX_SMOOTHING.TUNNEL_RISE_PER_SECOND,
      FX_SMOOTHING.TUNNEL_FALL_PER_SECOND
    );
    fxState.blood = approachValue(
      fxState.blood,
      targetBlood,
      dt,
      FX_SMOOTHING.BLOOD_RISE_PER_SECOND,
      FX_SMOOTHING.BLOOD_FALL_PER_SECOND
    );

    const pulseSpeed = `${Math.round(980 - terror * 300 - chase * 170)}ms`;

    ui.horrorFx.style.setProperty("--terror", terror.toFixed(3));
    ui.horrorFx.style.setProperty("--chase", chase.toFixed(3));
    ui.horrorFx.style.setProperty("--red-chase", fxState.redChase.toFixed(3));
    ui.horrorFx.style.setProperty("--blood", fxState.blood.toFixed(3));
    ui.horrorFx.style.setProperty("--tunnel", fxState.tunnel.toFixed(3));
    ui.horrorFx.style.setProperty("--pulse-speed", pulseSpeed);
    document.body.classList.toggle("in-chase", raw.chase > 0);
    document.body.classList.toggle("is-looking-at-killer", fxState.redChase > 0.04);
    document.body.classList.toggle("is-injured", !!raw.injured);
  }

  class GameScene extends Phaser.Scene {
    constructor() {
      super("GameScene");
      this.map = null;
      this.outOfBoundsGraphics = null;
      this.worldGraphics = null;
      this.wallVisuals = [];
      this.wallVisionTimer = 0;
      this.dynamicGraphics = null;
      this.generatorGraphics = null;
      this.scratchGraphics = null;
      this.fogRT = null;
      this.lightConeMask = null;
      this.lightAuraMask = null;
      this.flashlightGlowGraphics = null;
      this.flashlightBloomImage = null;
      this.particleGraphics = null;
      this.actors = new Map();
      this.generatorSprites = new Map();
      this.localVisual = null;
      this.localServerTarget = null;
      this.particles = [];
      this.shockwaves = [];
      this.inputTimer = 0;
      this.dynamicRedrawTimer = 0;
      this.generatorRedrawTimer = 0;
      this.scratchRedrawTimer = 0;
      this.needsDynamicRedraw = false;
      this.needsGeneratorRedraw = false;
      this.pendingScratchMarks = [];
      this.needsScratchRedraw = false;
      this.lastDynamicKey = "";
      this.lastGeneratorKey = "";
      this.collectibleDotVisuals?.clear();
      this.collectibleDotsAnimating = false;
      this.lastHudKey = "";
      this.lastHudRenderAt = 0;
      this.lastFogWidth = 0;
      this.lastFogHeight = 0;
      this.lastSnapshotAt = 0;
      this.renderedMapKey = "";
      this.wallVisionTimer = 0;
      this.chaseBlend = 0;
      this.terrorBlend = 0;
      this.heartbeatTimer = 0;
      this.heartbeatPulse = 0;
      this.breathPhase = 0;
      this.lastRawChase = false;
      this.lightFlickerPhase = 0;
      this.cameraSwayX = 0;
      this.cameraSwayY = 0;
      this.cameraSwayTargetX = 0;
      this.cameraSwayTargetY = 0;
      this.killerM1Pulse = 0;
      this.spawnInPulse = 0;
      this.spawnInPlayed = false;
      this.spawnInAt = 0;
      this.matchStartFreezeRemaining = 0;
      this.matchStartFreezeDuration = IMMERSION.MATCH_START_LOCK_SECONDS;
      this.matchStartZoomUntil = 0;
      this.lastMoveDirX = 0;
      this.lastMoveDirY = 0;
      this.spectateTargetId = null;
      this.lastSpectateEmitId = "";
      this.lastSpectateEmitAt = 0;
      this.localEscapeScreenShown = false;
      this.lastLocalChatText = "";
    }

    isSpectating() {
      const me = this.actors.get(myId)?.data || getLocalPlayerData();
      return me?.role === "survivor" && (!!me.dead || !!me.escaped);
    }

    getLivingTeammates() {
      return getLivingTeammates(currentSnapshot);
    }

    resolveSpectateTargetId() {
      if (!this.isSpectating()) return myId;
      const living = this.getLivingTeammates();
      if (!living.length) return myId;
      if (living.some((a) => a.id === this.spectateTargetId)) return this.spectateTargetId;
      return living[0].id;
    }

    emitSpectateTarget(targetId) {
      if (!socket || !targetId || !this.isSpectating()) return;
      const now = performance.now();
      if (targetId === this.lastSpectateEmitId && now - this.lastSpectateEmitAt < 180) return;
      this.lastSpectateEmitId = targetId;
      this.lastSpectateEmitAt = now;
      socket.emit("spectate", { targetId });
    }

    pickDefaultSpectateTarget() {
      const living = this.getLivingTeammates();
      if (!living.length) {
        this.spectateTargetId = null;
        return null;
      }
      this.spectateTargetId = living[0].id;
      this.emitSpectateTarget(this.spectateTargetId);
      return this.spectateTargetId;
    }

    cycleSpectateTarget(step = 1) {
      if (!this.isSpectating()) return;
      const living = this.getLivingTeammates();
      if (living.length <= 1) return;
      let idx = living.findIndex((a) => a.id === this.resolveSpectateTargetId());
      if (idx < 0) idx = 0;
      idx = (idx + step + living.length) % living.length;
      this.spectateTargetId = living[idx].id;
      this.emitSpectateTarget(this.spectateTargetId);
    }

    getCameraSubjectItem() {
      return this.actors.get(this.isSpectating() ? this.resolveSpectateTargetId() : myId) || null;
    }

    getPovSurvivorData() {
      if (!this.isSpectating()) {
        return this.actors.get(myId)?.data || getLocalPlayerData();
      }
      const id = this.resolveSpectateTargetId();
      return this.actors.get(id)?.data
        || (currentSnapshot?.actors || []).find((a) => a.id === id)
        || null;
    }

    preload() {
      // Phaser can load SVG directly. The game still creates a fallback texture in create(),
      // so missing art will not break testing builds.
      this.load.svg(GENERATOR_VISUAL.TEXTURE_KEY, GENERATOR_VISUAL.FILE, {
        width: GENERATOR_VISUAL.SIZE,
        height: GENERATOR_VISUAL.SIZE
      });
    }

    create() {
      phaserScene = this;
      this.cameras.main.setBackgroundColor("#03040a");
      // No fog RenderTexture anymore. Resize no longer allocates/rebuilds a GPU texture.
      this.grassLayer = null;
      this.worldGraphics = this.add.graphics().setDepth(1);
      this.dynamicGraphics = this.add.graphics().setDepth(3);
      this.generatorGraphics = this.add.graphics().setDepth(3.25);
      this.generatorDepositVisual = new Map();
      this.generatorDepositLastRaw = new Map();
      this.collectibleDotVisuals = new Map();
      this.collectibleDotsAnimating = false;
      this.scratchGraphics = this.add.graphics().setDepth(4);
      // Minimal visibility cone. One small Graphics object.
      // No RenderTexture, no masks, no layered feather pass. Just a cheap "what I can see" hint.
      this.flashlightGlowGraphics = this.add.graphics()
        .setDepth(LIGHTING.FOG_DEPTH - 1)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.chargeGraphics = this.add.graphics().setDepth(21);
      this.swipeGraphics = this.add.graphics().setDepth(22);
      this.particleGraphics = this.add.graphics().setDepth(30);
      this.hookIndicatorGraphics = this.add.graphics()
        .setDepth(2500)
        .setScrollFactor(0, 0);
      this.chatWheelGraphics = this.add.graphics()
        .setDepth(2700)
        .setScrollFactor(0, 0);
      this.chatWheelLabels = Array.from({ length: 4 }, () => this.add.text(0, 0, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: CHAT_WHEEL.TEXT_SIZE,
        fontStyle: "900",
        color: "#fff5e7",
        align: "center",
        stroke: "#000000",
        strokeThickness: 4,
        wordWrap: { width: 112 }
      }).setOrigin(0.5).setDepth(2701).setScrollFactor(0, 0).setVisible(false));
      this.swipes = [];
      this.recentHookIndicators = [];
      this.createGeneratorFallbackTexture();
      // Legacy soft cone textures are intentionally not created here. The minimal
      // system below uses vector alpha + object visibility, which is much cheaper.
      this.input.on("pointerdown", (pointer) => {
        ensureAudioStarted();
        if (pointer.leftButtonDown()) {
          input.attackHeld = true;
          sendInput({}, true);
        }
      });

      this.input.on("pointerup", () => {
        if (input.attackHeld) {
          input.attackHeld = false;
          sendInput({ attackReleased: true }, true);
        }
      });

      window.addEventListener("pointerup", () => {
        if (input.attackHeld) {
          input.attackHeld = false;
          sendInput({ attackReleased: true }, true);
        }
      });
    }

    createGrassTexture() {
      // Legacy no-op. v51 uses a cheap solid/patch ground graphics layer for performance.
      return null;
    }

    createGeneratorFallbackTexture() {
      if (this.textures.exists(GENERATOR_VISUAL.FALLBACK_KEY)) return;

      const size = 96;
      const tex = this.textures.createCanvas(GENERATOR_VISUAL.FALLBACK_KEY, size, size);
      const canvas = tex.getSourceImage();
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, size, size);

      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.fillStyle = "#b8b0a4";
      ctx.strokeStyle = "#211b18";
      ctx.lineWidth = 5;
      roundRectPath(ctx, -30, -22, 60, 50, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#26221f";
      roundRectPath(ctx, -20, -10, 40, 14, 5);
      ctx.fill();

      ctx.strokeStyle = "#d8a84f";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-23, -24);
      ctx.lineTo(-10, -42);
      ctx.moveTo(10, -24);
      ctx.lineTo(25, -43);
      ctx.stroke();

      ctx.fillStyle = "#55473b";
      ctx.fillRect(-24, 24, 10, 18);
      ctx.fillRect(14, 24, 10, 18);
      ctx.restore();

      tex.refresh();

      function roundRectPath(context, x, y, w, h, r) {
        context.beginPath();
        context.moveTo(x + r, y);
        context.lineTo(x + w - r, y);
        context.quadraticCurveTo(x + w, y, x + w, y + r);
        context.lineTo(x + w, y + h - r);
        context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        context.lineTo(x + r, y + h);
        context.quadraticCurveTo(x, y + h, x, y + h - r);
        context.lineTo(x, y + r);
        context.quadraticCurveTo(x, y, x + r, y);
        context.closePath();
      }
    }

    createLightTextures() {
      if (!this.textures.exists("softFlashlightCone")) {
        const w = LIGHTING.CONE_TEXTURE_WIDTH;
        const h = LIGHTING.CONE_TEXTURE_HEIGHT;
        const tex = this.textures.createCanvas("softFlashlightCone", w, h);
        const canvas = tex.getSourceImage();
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const image = ctx.createImageData(w, h);
        const data = image.data;
        const originY = h / 2;
        const tanBase = Math.tan(LIGHTING.CONE_BASE_HALF_ANGLE);
        const edgeStart = clamp(LIGHTING.CONE_EDGE_SOFTNESS, 0.18, 0.62);
        const tailStart = clamp(LIGHTING.CONE_TAIL_FADE, 0.72, 0.98);

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dx = Math.max(0, x);
            const dy = y - originY;
            const halfWidth = Math.max(14, dx * tanBase);
            const edgeRatio = Math.abs(dy) / halfWidth;
            const i = (y * w + x) * 4;
            if (edgeRatio > 1 || dx <= 0) continue;

            const radial = dx / w;
            // Wide edge feather + long radial fade. This removes the sharp cardboard-cone edge
            // while keeping the center bright enough to read as an actual flashlight.
            const edgeFade = 1 - smoothstep(edgeStart, 1.0, edgeRatio);
            const tailFade = 1 - smoothstep(tailStart, 1.0, radial);
            const noseFade = smoothstep(0.0, 0.075, radial);
            const centerLift = 0.42 + 0.58 * (1 - Math.pow(edgeRatio, 1.65));
            const falloff = Math.pow(1 - smoothstep(0.16, 1.0, radial), 0.72);
            const alpha = clamp(edgeFade * tailFade * noseFade * centerLift * (0.50 + falloff * 0.62), 0, 1);

            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = Math.floor(alpha * 255);
          }
        }

        ctx.putImageData(image, 0, 0);
        tex.refresh();
      }

      if (!this.textures.exists("softFlashlightBloom")) {
        const w = LIGHTING.CONE_TEXTURE_WIDTH;
        const h = LIGHTING.CONE_TEXTURE_HEIGHT;
        const tex = this.textures.createCanvas("softFlashlightBloom", w, h);
        const canvas = tex.getSourceImage();
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const image = ctx.createImageData(w, h);
        const data = image.data;
        const originY = h / 2;
        const tanBase = Math.tan(LIGHTING.CONE_BASE_HALF_ANGLE);

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dx = Math.max(0, x);
            const dy = y - originY;
            const halfWidth = Math.max(18, dx * tanBase);
            const edgeRatio = Math.abs(dy) / halfWidth;
            const i = (y * w + x) * 4;
            if (edgeRatio > 1 || dx <= 0) continue;

            const radial = dx / w;
            const edgeFade = 1 - smoothstep(0.18, 1.0, edgeRatio);
            const tailFade = 1 - smoothstep(0.72, 1.0, radial);
            const noseFade = smoothstep(0.0, 0.10, radial);
            const center = 1 - smoothstep(0.0, 0.88, edgeRatio);
            const alpha = clamp(edgeFade * tailFade * noseFade * (0.20 + center * 0.54) * LIGHTING.BLOOM_ALPHA, 0, 0.22);

            // Cold moon-blue bloom. It is purely visual and sits under the fog layer.
            data[i] = 178;
            data[i + 1] = 207;
            data[i + 2] = 255;
            data[i + 3] = Math.floor(alpha * 255);
          }
        }

        ctx.putImageData(image, 0, 0);
        tex.refresh();
      }

      if (!this.textures.exists("softFlashlightAura")) {
        const size = 512;
        const tex = this.textures.createCanvas("softFlashlightAura", size, size);
        const canvas = tex.getSourceImage();
        const ctx = canvas.getContext("2d");
        const r = size / 2;
        const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
        grad.addColorStop(0, "rgba(255,255,255,0.96)");
        grad.addColorStop(0.28, "rgba(255,255,255,0.64)");
        grad.addColorStop(0.62, "rgba(230,238,255,0.22)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        tex.refresh();
      }
    }

    loadMap(map) {
      this.map = map;
      // Let the camera center on the local player even near map edges.
      // Showing a little outside the map is better than letting the player stick to a screen edge.
      this.cameras.main.setBounds(-100000, -100000, map.width + 200000, map.height + 200000);
      this.renderedMapKey = "";
      this.rebuildOutOfBoundsBackdrop();
      this.rebuildGrassLayer();
      this.drawStaticWorld();
      this.drawDynamicWorld();
      this.rebuildFogTexture();
      this.clearGeneratorSprites();
      this.clearActors();
      this.lastDynamicKey = "";
      this.lastGeneratorKey = "";
      this.collectibleDotVisuals?.clear();
      this.collectibleDotsAnimating = false;
      this.needsDynamicRedraw = true;
      this.needsGeneratorRedraw = true;
      this.localVisual = null;
      this.localServerTarget = null;
      this.spectateTargetId = null;
      this.lastSpectateEmitId = "";
    }

    rebuildOutOfBoundsBackdrop() {
      if (this.outOfBoundsGraphics) {
        this.outOfBoundsGraphics.destroy();
        this.outOfBoundsGraphics = null;
      }
      if (!this.map) return;

      // Static menu-style horror grid. Drawn once at map load, not every frame.
      const pad = 5200;
      const x = -pad;
      const y = -pad;
      const w = this.map.width + pad * 2;
      const h = this.map.height + pad * 2;
      const g = this.add.graphics().setDepth(-20).setScrollFactor(1, 1);
      this.outOfBoundsGraphics = g;
      g.fillStyle(0x03040a, 1);
      g.fillRect(x, y, w, h);
      this.drawStaticArenaGrid(g, x, y, w, h, 96, 0x12203a, 0.24);
      this.drawStaticArenaGrid(g, x, y, w, h, 384, 0x263c68, 0.16);
    }

    drawStaticArenaGrid(g, x, y, w, h, step, color, alpha) {
      if (!g || step <= 0) return;
      const startX = Math.floor(x / step) * step;
      const endX = x + w;
      const startY = Math.floor(y / step) * step;
      const endY = y + h;
      g.lineStyle(1, color, alpha);
      for (let xx = startX; xx <= endX; xx += step) {
        g.beginPath();
        g.moveTo(xx, y);
        g.lineTo(xx, y + h);
        g.strokePath();
      }
      for (let yy = startY; yy <= endY; yy += step) {
        g.beginPath();
        g.moveTo(x, yy);
        g.lineTo(x + w, yy);
        g.strokePath();
      }
    }

    rebuildGrassLayer() {
      if (this.grassLayer) {
        this.grassLayer.destroy();
        this.grassLayer = null;
      }
      if (!this.map) return;

      // Static in-bounds grid, matching the main menu without the expensive decorative blobs.
      const g = this.add.graphics()
        .setDepth(0)
        .setScrollFactor(1, 1);

      this.grassLayer = g;
      g.fillStyle(0x070913, 1);
      g.fillRect(0, 0, this.map.width, this.map.height);
      this.drawStaticArenaGrid(g, 0, 0, this.map.width, this.map.height, this.map.tile || 72, 0x172541, 0.32);
      this.drawStaticArenaGrid(g, 0, 0, this.map.width, this.map.height, (this.map.tile || 72) * 4, 0x315082, 0.18);
    }

    rebuildFogTexture() {
      // Legacy compatibility hook. The old version allocated a camera-sized
      // RenderTexture and erased a flashlight cone out of it. That looked nice,
      // and also gave weak laptops a reason to write goodbye letters.
      if (this.fogRT) {
        this.fogRT.destroy();
        this.fogRT = null;
      }
      this.lastFogWidth = 0;
      this.lastFogHeight = 0;
      this.flashlightGlowGraphics?.clear();
    }

    clearGeneratorSprites() {
      for (const sprite of this.generatorSprites.values()) sprite.destroy();
      this.generatorSprites.clear();
      this.generatorGraphics?.clear();
    }

    destroyActorDisplay(item) {
      if (!item) return;
      item.container?.destroy();
      item.nameText?.destroy();
      item.chatText?.destroy();
    }

    clearActors() {
      for (const actor of this.actors.values()) this.destroyActorDisplay(actor);
      this.actors.clear();
    }

    drawStaticWorld() {
      if (!this.map) return;
      this.worldGraphics?.clear();
      this.rebuildWallVisionVisuals();
    }

    clearWallVisionVisuals() {
      for (const item of this.wallVisuals || []) item.graphics?.destroy();
      this.wallVisuals = [];
      this.wallVisionTimer = 0;
      this.lastPalletVisionKey = "";
    }

    rebuildWallVisionVisuals() {
      this.clearWallVisionVisuals();
      if (!this.map) return;

      // Draw each wall/window/pallet once, then only fade its Graphics object in/out at runtime.
      // Collision is unchanged. This is strictly a survivor POV readability/horror layer.
      const makeItem = (rect, type) => {
        const depth = type === "pallet" ? 3.05 : type === "window" ? 1.16 : 1.08;
        const graphics = this.add.graphics()
          .setDepth(depth)
          .setScrollFactor(1, 1)
          .setAlpha(0)
          .setVisible(false);
        if (type === "window") this.drawWindow(graphics, rect);
        else if (type === "pallet") this.drawPallet(graphics, rect);
        else this.drawWall(graphics, rect);
        const centerX = rect.x + rect.w / 2;
        const centerY = rect.y + rect.h / 2;
        const radius = Math.hypot(rect.w, rect.h) / 2;
        const outerWall = type === "wall" && this.isOuterMapWall(rect);
        this.wallVisuals.push({
          graphics,
          rect,
          id: rect.id,
          type,
          outerWall,
          stateKey: type === "pallet" ? this.palletVisionStateKey(rect) : "",
          centerX,
          centerY,
          radius,
          samples: this.wallVisionSamplePoints(rect),
          alpha: outerWall ? 1 : 0,
          targetAlpha: outerWall ? 1 : 0
        });
        if (outerWall) graphics.setVisible(true).setAlpha(1);
      };

      for (const wall of this.map.walls || []) makeItem(wall, "wall");
      for (const win of this.map.windows || []) makeItem(win, "window");
      for (const pallet of currentSnapshot?.map?.pallets || this.map.pallets || []) makeItem(pallet, "pallet");
      this.lastPalletVisionKey = this.getPalletVisionKey();
    }

    drawWall(g, wall) {
      const base = WALL_VISUAL.WOOD_BASE;
      const dark = WALL_VISUAL.WOOD_DARK;
      const light = WALL_VISUAL.WOOD_LIGHT;
      const grain = WALL_VISUAL.WOOD_GRAIN;
      const glow = WALL_VISUAL.WOOD_GLOW;
      const plankH = WALL_VISUAL.PLANK_HEIGHT;
      const plankW = WALL_VISUAL.PLANK_WIDTH;

      // Dark contact shadow first, so the walls sit on the map instead of looking
      // like flat rectangles pasted on top. Static draw only, so it costs nothing per frame.
      g.fillStyle(0x000000, 0.36);
      g.fillRect(wall.x + 3, wall.y + 4, wall.w, wall.h);

      // Board rows with subtle deterministic variation. This keeps the old plank texture,
      // just dragged into a darker horror palette instead of neon-purple cardboard.
      const yStart = Math.floor(wall.y / plankH) * plankH;
      for (let yy = yStart; yy < wall.y + wall.h; yy += plankH) {
        const rowTop = Math.max(wall.y, yy);
        const rowBottom = Math.min(wall.y + wall.h, yy + plankH);
        const rowH = rowBottom - rowTop;
        if (rowH <= 0) continue;
        const rowIndex = Math.floor(yy / plankH);
        const n = hash2(Math.floor(wall.x / plankW), rowIndex);
        const rowColor = n > 0.72 ? brighten(base, 0.12) : n < 0.22 ? darken(base, 0.20) : base;
        g.fillStyle(rowColor, 1);
        g.fillRect(wall.x, rowTop, wall.w, rowH);

        g.fillStyle(light, 0.05 + n * 0.06);
        g.fillRect(wall.x, rowTop, wall.w, Math.min(3, rowH));
        g.fillStyle(dark, 0.18);
        g.fillRect(wall.x, Math.max(rowTop, rowBottom - 2), wall.w, Math.min(2, rowH));
      }

      // World-aligned horizontal plank seams.
      g.lineStyle(1, dark, WALL_VISUAL.SEAM_ALPHA);
      for (let yy = yStart; yy <= wall.y + wall.h; yy += plankH) {
        const y = clamp(yy, wall.y, wall.y + wall.h);
        g.beginPath();
        g.moveTo(wall.x, y);
        g.lineTo(wall.x + wall.w, y);
        g.strokePath();
      }

      // Staggered vertical plank breaks.
      const xStart = Math.floor(wall.x / plankW) * plankW;
      for (let yy = yStart; yy < wall.y + wall.h; yy += plankH) {
        const row = Math.floor(yy / plankH);
        const offset = row % 2 ? plankW / 2 : 0;
        for (let xx = xStart - offset; xx <= wall.x + wall.w; xx += plankW) {
          const x = clamp(xx, wall.x, wall.x + wall.w);
          const y1 = clamp(yy + 2, wall.y, wall.y + wall.h);
          const y2 = clamp(yy + plankH - 2, wall.y, wall.y + wall.h);
          if (y2 <= y1 + 2) continue;
          g.lineStyle(1, dark, 0.42);
          g.beginPath();
          g.moveTo(x, y1);
          g.lineTo(x, y2);
          g.strokePath();
        }
      }

      // Heavy dark grain and cracks, similar to the original wall treatment but less bright.
      const grainRows = Math.max(3, Math.floor(wall.h / 10));
      for (let i = 0; i < grainRows; i++) {
        const y = wall.y + 6 + i * 10 + hash2(Math.floor(wall.x / 17) + i, Math.floor(wall.y / 19)) * 4;
        if (y > wall.y + wall.h - 5) continue;
        const wobble = Math.sin((wall.x + i * 31) * 0.025) * 2.5;
        g.lineStyle(1, grain, WALL_VISUAL.GRAIN_ALPHA);
        g.beginPath();
        g.moveTo(wall.x + 7, y);
        g.lineTo(wall.x + wall.w * 0.42, y + wobble);
        g.lineTo(wall.x + wall.w - 7, y + Math.cos((wall.y + i * 17) * 0.03) * 2.5);
        g.strokePath();
      }

      // Occasional knots. Deterministic so they do not shimmer when redrawn.
      const knotCount = Math.max(1, Math.floor((wall.w * wall.h) / 5200));
      for (let i = 0; i < knotCount; i++) {
        const kx = wall.x + 12 + hash2(wall.tileX || wall.x + i * 13, i + 33) * Math.max(1, wall.w - 24);
        const ky = wall.y + 10 + hash2(i + 91, wall.tileY || wall.y + 7) * Math.max(1, wall.h - 20);
        g.fillStyle(WALL_VISUAL.KNOT_COLOR, 0.42);
        g.fillEllipse(kx, ky, 18, 7);
        g.lineStyle(1, brighten(base, 0.18), 0.18);
        g.strokeEllipse(kx, ky, 22, 10);
      }

      // Subtle cold edge glint so walls read against the now-darker floor.
      g.fillStyle(light, WALL_VISUAL.HIGHLIGHT_ALPHA);
      g.fillRect(wall.x, wall.y, wall.w, 4);
      g.fillStyle(dark, 0.34);
      g.fillRect(wall.x, wall.y + wall.h - 6, wall.w, 6);
      g.lineStyle(1, glow, 0.10);
      g.strokeRect(wall.x + 2, wall.y + 2, Math.max(0, wall.w - 4), Math.max(0, wall.h - 4));

      // Outer edges only. Adjacent wall tiles merge into rooms/corridors instead of checker blocks.
      g.lineStyle(4, dark, WALL_VISUAL.EDGE_ALPHA);
      if (!this.hasWallNeighbor(wall, -1, 0)) {
        g.beginPath(); g.moveTo(wall.x, wall.y); g.lineTo(wall.x, wall.y + wall.h); g.strokePath();
      }
      if (!this.hasWallNeighbor(wall, 1, 0)) {
        g.beginPath(); g.moveTo(wall.x + wall.w, wall.y); g.lineTo(wall.x + wall.w, wall.y + wall.h); g.strokePath();
      }
      if (!this.hasWallNeighbor(wall, 0, -1)) {
        g.beginPath(); g.moveTo(wall.x, wall.y); g.lineTo(wall.x + wall.w, wall.y); g.strokePath();
      }
      if (!this.hasWallNeighbor(wall, 0, 1)) {
        g.beginPath(); g.moveTo(wall.x, wall.y + wall.h); g.lineTo(wall.x + wall.w, wall.y + wall.h); g.strokePath();
      }
    }

    hasWallNeighbor(wall, dx, dy) {
      const tile = this.map?.tile || wall.w || 72;
      const pad = 5;
      const probe = {
        x: wall.x + dx * tile + pad,
        y: wall.y + dy * tile + pad,
        w: Math.max(4, wall.w - pad * 2),
        h: Math.max(4, wall.h - pad * 2)
      };
      return (this.map?.walls || []).some((other) => other !== wall && rectsOverlap(probe, other));
    }

    drawWindow(g, win) {
      const cx = win.x + win.w / 2;
      const cy = win.y + win.h / 2;
      const frame = COLORS.wallDark;
      const wood = COLORS.wallLight;
      const glass = COLORS.window;

      // Dark opening first so it reads as a real vaultable gap.
      g.fillStyle(0x101615, 0.96);
      g.fillRoundedRect(win.x + 5, win.y + 5, win.w - 10, win.h - 10, 7);

      if (win.orientation === "horizontal") {
        // Wooden frame above/below the opening.
        g.fillStyle(frame, 1);
        g.fillRoundedRect(win.x + 6, win.y + 7, win.w - 12, 9, 3);
        g.fillRoundedRect(win.x + 6, win.y + win.h - 16, win.w - 12, 9, 3);
        g.fillStyle(wood, 0.92);
        g.fillRoundedRect(win.x + 12, cy - 8, win.w - 24, 16, 5);
        g.lineStyle(3, glass, 0.82);
        g.beginPath();
        g.moveTo(win.x + 16, cy);
        g.lineTo(win.x + win.w - 16, cy);
        g.strokePath();
        g.lineStyle(2, glass, 0.38);
        for (let i = 1; i < 4; i++) {
          const x = win.x + (win.w / 4) * i;
          g.beginPath(); g.moveTo(x, cy - 8); g.lineTo(x, cy + 8); g.strokePath();
        }
      } else {
        g.fillStyle(frame, 1);
        g.fillRoundedRect(win.x + 7, win.y + 6, 9, win.h - 12, 3);
        g.fillRoundedRect(win.x + win.w - 16, win.y + 6, 9, win.h - 12, 3);
        g.fillStyle(wood, 0.92);
        g.fillRoundedRect(cx - 8, win.y + 12, 16, win.h - 24, 5);
        g.lineStyle(3, glass, 0.82);
        g.beginPath();
        g.moveTo(cx, win.y + 16);
        g.lineTo(cx, win.y + win.h - 16);
        g.strokePath();
        g.lineStyle(2, glass, 0.38);
        for (let i = 1; i < 4; i++) {
          const y = win.y + (win.h / 4) * i;
          g.beginPath(); g.moveTo(cx - 8, y); g.lineTo(cx + 8, y); g.strokePath();
        }
      }

      g.fillStyle(0xffffff, 0.10);
      g.fillRoundedRect(win.x + 11, win.y + 11, win.w - 22, win.h - 22, 5);
    }

    drawDynamicWorld() {
      if (!this.map || !currentSnapshot) return;
      const g = this.dynamicGraphics;
      g.clear();

      // Pallets are now individual vision-faded graphics, like walls/windows.
      // Do not draw them into the shared dynamic layer or they will ignore survivor cone visibility.
      this.syncPalletVisionVisuals();

      // Generator sprites/bars live on their own layer now. Redrawing every gate,
      // hook, and dot because a progress bar moved was the lag monster wearing a nametag.
      this.syncGeneratorSprites(currentSnapshot.map?.generators || this.map.generators || []);
      for (const gate of currentSnapshot.map?.gates || this.map.gates || []) this.drawGate(g, gate);
      for (const hook of currentSnapshot.map?.hooks || this.map.hooks || []) this.drawHook(g, hook);
      this.drawCollectibleDots(g);
    }

    updateCollectibleDotVisuals(dt) {
      if (!this.collectibleDotVisuals) this.collectibleDotVisuals = new Map();
      const visibleDots = currentSnapshot?.collectibleDots || [];
      const seen = new Set();
      let animating = false;

      for (const dot of visibleDots) {
        if (!dot?.id || !Number.isFinite(dot.x) || !Number.isFinite(dot.y)) continue;
        seen.add(dot.id);
        let visual = this.collectibleDotVisuals.get(dot.id);
        if (!visual) {
          visual = {
            id: dot.id,
            x: dot.x,
            y: dot.y,
            alpha: 0,
            targetAlpha: 1,
            phase: hash2(Math.floor(dot.x), Math.floor(dot.y)) * Math.PI * 2
          };
          this.collectibleDotVisuals.set(dot.id, visual);
          animating = true;
        }
        visual.x = lerp(visual.x, dot.x, dampAlpha(14, dt));
        visual.y = lerp(visual.y, dot.y, dampAlpha(14, dt));
        visual.targetAlpha = 1;
      }

      for (const [id, visual] of this.collectibleDotVisuals.entries()) {
        if (!seen.has(id)) visual.targetAlpha = 0;
        const speed = visual.targetAlpha > visual.alpha ? DOT_FADE_VISUAL.IN_SPEED : DOT_FADE_VISUAL.OUT_SPEED;
        const next = lerp(visual.alpha, visual.targetAlpha, dampAlpha(speed, dt));
        if (Math.abs(next - visual.alpha) > 0.002) animating = true;
        visual.alpha = next;
        if (visual.targetAlpha <= 0 && visual.alpha <= DOT_FADE_VISUAL.REMOVE_ALPHA) {
          this.collectibleDotVisuals.delete(id);
          animating = true;
        }
      }

      this.collectibleDotsAnimating = animating;
      return animating;
    }

    drawCollectibleDots(g) {
      if (!this.collectibleDotVisuals?.size) return;
      for (const dot of this.collectibleDotVisuals.values()) this.drawCollectibleDot(g, dot);
    }

    drawCollectibleDot(g, dot) {
      if (!dot || !Number.isFinite(dot.x) || !Number.isFinite(dot.y)) return;
      const alpha = clamp(dot.alpha ?? 1, 0, 1);
      if (alpha <= 0.01) return;
      const pulse = 0.5 + Math.sin(performance.now() / 320 + (dot.phase || 0)) * 0.5;
      const easeAlpha = alpha * alpha * (3 - 2 * alpha);
      const scale = 0.62 + easeAlpha * 0.38;
      g.fillStyle(COLORS.collectibleDot, (0.14 + pulse * 0.12) * easeAlpha);
      g.fillCircle(dot.x, dot.y, (11 + pulse * 2.5) * scale);
      g.fillStyle(COLORS.collectibleDotGlow, 0.92 * easeAlpha);
      g.fillCircle(dot.x, dot.y, (4.5 + pulse * 1.2) * scale);
      g.lineStyle(2, 0xfff7d6, (0.38 + pulse * 0.30) * easeAlpha);
      g.strokeCircle(dot.x, dot.y, (7 + pulse * 1.5) * scale);
    }

    generatorVisionSamplePoints(gen) {
      const r = 48;
      return [
        { x: gen.x, y: gen.y },
        { x: gen.x - r, y: gen.y },
        { x: gen.x + r, y: gen.y },
        { x: gen.x, y: gen.y - r },
        { x: gen.x, y: gen.y + r },
        { x: gen.x - r * 0.7, y: gen.y - r * 0.7 },
        { x: gen.x + r * 0.7, y: gen.y - r * 0.7 },
        { x: gen.x - r * 0.7, y: gen.y + r * 0.7 },
        { x: gen.x + r * 0.7, y: gen.y + r * 0.7 }
      ];
    }

    computeGeneratorVisionAlpha(gen, sourceX, sourceY, facing, length, coneAngle, nearRadius) {
      if (!gen || !Number.isFinite(gen.x) || !Number.isFinite(gen.y)) return 0;
      const fakeRect = { x: gen.x - 44, y: gen.y - 44, w: 88, h: 88 };
      const item = {
        rect: fakeRect,
        type: "generator",
        radius: 44,
        samples: this.generatorVisionSamplePoints(gen)
      };
      return this.computeWallVisionAlpha(item, sourceX, sourceY, facing, length, coneAngle, nearRadius);
    }

    updateGeneratorVisionVisuals(dt) {
      if (!this.generatorVisionVisual) this.generatorVisionVisual = new Map();
      const generators = currentSnapshot?.map?.generators || this.map?.generators || [];
      const seen = new Set();
      const subject = this.getCameraSubjectItem();
      const hasSubject = !!subject?.container;
      const role = subject?.data?.role || "survivor";
      const worldX = subject?.container?.x ?? 0;
      const worldY = subject?.container?.y ?? 0;
      const facing = subject?.container?.rotation || 0;
      const baseLength = role === "killer" ? LIGHTING.KILLER_LENGTH : LIGHTING.SURVIVOR_LENGTH;
      const baseAngle = role === "killer" ? LIGHTING.KILLER_ANGLE : LIGHTING.SURVIVOR_ANGLE;
      const length = baseLength + WALL_VISION.CONE_EXTRA_LENGTH;
      const coneAngle = baseAngle + WALL_VISION.CONE_EXTRA_ANGLE;
      const nearRadius = role === "killer" ? WALL_VISION.KILLER_NEAR_RADIUS : WALL_VISION.SURVIVOR_NEAR_RADIUS;
      let animating = false;

      this.generatorVisionTimer = (this.generatorVisionTimer || 0) + dt;
      const shouldRecompute = this.generatorVisionTimer >= 1 / PERFORMANCE.WALL_VISION_FPS;
      if (shouldRecompute) this.generatorVisionTimer = 0;

      for (const gen of generators) {
        if (!gen?.id) continue;
        seen.add(gen.id);
        let state = this.generatorVisionVisual.get(gen.id);
        if (!state) {
          state = { alpha: role === "killer" ? 1 : 0, targetAlpha: role === "killer" ? 1 : 0 };
          this.generatorVisionVisual.set(gen.id, state);
          animating = true;
        }
        if (shouldRecompute) {
          state.targetAlpha = role === "killer" || !hasSubject
            ? (role === "killer" ? 1 : 0)
            : this.computeGeneratorVisionAlpha(gen, worldX, worldY, facing, length, coneAngle, nearRadius);
        }
        const rate = state.targetAlpha > state.alpha ? WALL_VISION.FADE_IN_PER_SECOND : WALL_VISION.FADE_OUT_PER_SECOND;
        const next = lerp(state.alpha, state.targetAlpha, dampAlpha(rate, dt));
        if (Math.abs(next - state.alpha) > 0.003) animating = true;
        state.alpha = next;
      }

      for (const id of [...this.generatorVisionVisual.keys()]) {
        if (!seen.has(id)) {
          this.generatorVisionVisual.delete(id);
          animating = true;
        }
      }
      return animating;
    }

    drawGeneratorLayer() {
      if (!this.map || !currentSnapshot || !this.generatorGraphics) return;
      const generators = currentSnapshot.map?.generators || this.map.generators || [];
      this.syncGeneratorSprites(generators);
      const g = this.generatorGraphics;
      g.clear();
      for (const gen of generators) {
        const alpha = this.generatorVisionVisual?.get(gen.id)?.alpha ?? 1;
        this.drawGenerator(g, gen, alpha);
      }
    }

    drawPallet(g, pallet) {
      const broken = pallet.broken || pallet.state === "broken";
      const dropped = pallet.state === "dropped";
      const wood = COLORS.pallet;
      const dark = COLORS.palletDark;
      const light = 0xdbeafe;

      if (broken) {
        g.lineStyle(5, dark, 0.72);
        g.beginPath();
        g.moveTo(pallet.x + 12, pallet.y + 13);
        g.lineTo(pallet.x + pallet.w - 14, pallet.y + pallet.h - 11);
        g.moveTo(pallet.x + 18, pallet.y + pallet.h - 13);
        g.lineTo(pallet.x + pallet.w - 11, pallet.y + 12);
        g.strokePath();
        g.lineStyle(2, light, 0.58);
        g.beginPath();
        g.moveTo(pallet.x + 20, pallet.y + 18);
        g.lineTo(pallet.x + pallet.w - 20, pallet.y + pallet.h - 16);
        g.strokePath();
        return;
      }

      if (pallet.orientation === "horizontal") {
        const h = dropped ? pallet.h * 0.72 : pallet.h * 0.36;
        const y = dropped ? pallet.y + pallet.h * 0.14 : pallet.y + pallet.h * 0.32;
        this.drawWoodPalletBody(g, pallet.x + 5, y, pallet.w - 10, h, true, dropped);
      } else {
        const w = dropped ? pallet.w * 0.72 : pallet.w * 0.36;
        const x = dropped ? pallet.x + pallet.w * 0.14 : pallet.x + pallet.w * 0.32;
        this.drawWoodPalletBody(g, x, pallet.y + 5, w, pallet.h - 10, false, dropped);
      }
    }

    drawWoodPalletBody(g, x, y, w, h, horizontal, dropped) {
      // .io-style barricade: bright, readable, and not pretending to be lumber.
      const base = dropped ? 0x1e3a8a : COLORS.pallet;
      const dark = dropped ? 0x312e81 : COLORS.palletDark;
      const light = dropped ? 0x93c5fd : 0xe0f2fe;
      const accent = dropped ? 0xf0abfc : 0xa78bfa;

      g.fillStyle(0x0f172a, dropped ? 0.24 : 0.18);
      g.fillRoundedRect(x + 4, y + 5, w, h, 10);

      g.fillStyle(base, dropped ? 0.96 : 0.88);
      g.fillRoundedRect(x, y, w, h, 10);
      g.lineStyle(3, dark, 0.88);
      g.strokeRoundedRect(x, y, w, h, 10);

      const lanes = 3;
      if (horizontal) {
        const laneW = w / lanes;
        for (let i = 0; i < lanes; i++) {
          const sx = x + i * laneW + 5;
          g.fillStyle(i % 2 ? light : 0xffffff, i % 2 ? 0.46 : 0.34);
          g.fillRoundedRect(sx, y + 5, laneW - 10, h - 10, 8);
        }
        g.lineStyle(4, accent, dropped ? 0.72 : 0.58);
        g.beginPath(); g.moveTo(x + 9, y + h * 0.30); g.lineTo(x + w - 9, y + h * 0.70); g.strokePath();
        g.beginPath(); g.moveTo(x + 9, y + h * 0.70); g.lineTo(x + w - 9, y + h * 0.30); g.strokePath();
      } else {
        const laneH = h / lanes;
        for (let i = 0; i < lanes; i++) {
          const sy = y + i * laneH + 5;
          g.fillStyle(i % 2 ? light : 0xffffff, i % 2 ? 0.46 : 0.34);
          g.fillRoundedRect(x + 5, sy, w - 10, laneH - 10, 8);
        }
        g.lineStyle(4, accent, dropped ? 0.72 : 0.58);
        g.beginPath(); g.moveTo(x + w * 0.30, y + 9); g.lineTo(x + w * 0.70, y + h - 9); g.strokePath();
        g.beginPath(); g.moveTo(x + w * 0.70, y + 9); g.lineTo(x + w * 0.30, y + h - 9); g.strokePath();
      }

      const pulse = 0.5 + Math.sin((performance.now?.() || Date.now()) / 260) * 0.5;
      g.fillStyle(0xffffff, 0.78);
      g.fillCircle(x + w * 0.18, y + h * 0.24, 3.2);
      g.fillCircle(x + w * 0.82, y + h * 0.76, 3.2);
      if (!dropped) {
        g.lineStyle(2, 0xbae6fd, 0.28 + pulse * 0.22);
        g.strokeRoundedRect(x + 2, y + 2, w - 4, h - 4, 9);
      }
    }

    drawHook(g, hook) {
      if (!hook || hook.active === false || !this.map) return;
      const tile = this.map.tile || 72;
      const x = Math.round(((hook.x || 0) - tile / 2) / tile) * tile;
      const y = Math.round(((hook.y || 0) - tile / 2) / tile) * tile;
      const now = this.time?.now || performance.now();
      const cx = x + tile / 2;
      const cy = y + tile / 2;
      const basePulse = 0.5 + Math.sin(now * 0.006) * 0.5;

      // Hook state: no giant red border. A thin containment field pulses outward
      // around the tile so it reads as dangerous without shouting in block letters.
      g.fillStyle(0x170308, 0.22 + basePulse * 0.05);
      g.fillRoundedRect(x + 9, y + 9, tile - 18, tile - 18, 11);

      for (let i = 0; i < 3; i++) {
        const t = ((now / 1050) + i / 3) % 1;
        const ease = 1 - Math.pow(1 - t, 2);
        const inset = 18 - ease * 14;
        const alpha = (1 - t) * (0.42 - i * 0.055);
        g.lineStyle(1.4, 0xff315d, alpha);
        g.strokeRoundedRect(x + inset, y + inset, tile - inset * 2, tile - inset * 2, 12 + ease * 5);
      }

      const bracketAlpha = 0.45 + basePulse * 0.34;
      const pad = 11;
      const len = 14;
      g.lineStyle(2, 0xff6b7d, bracketAlpha);
      // Corner brackets, cheaper than a sprite sheet and less ugly than a red fence.
      g.beginPath();
      g.moveTo(x + pad, y + pad + len); g.lineTo(x + pad, y + pad); g.lineTo(x + pad + len, y + pad);
      g.moveTo(x + tile - pad - len, y + pad); g.lineTo(x + tile - pad, y + pad); g.lineTo(x + tile - pad, y + pad + len);
      g.moveTo(x + tile - pad, y + tile - pad - len); g.lineTo(x + tile - pad, y + tile - pad); g.lineTo(x + tile - pad - len, y + tile - pad);
      g.moveTo(x + pad + len, y + tile - pad); g.lineTo(x + pad, y + tile - pad); g.lineTo(x + pad, y + tile - pad - len);
      g.strokePath();

      g.fillStyle(0xff315d, 0.10 + basePulse * 0.10);
      g.fillCircle(cx, cy, 15 + basePulse * 4);
      g.lineStyle(1.5, 0xff9aac, 0.28 + basePulse * 0.30);
      g.beginPath();
      g.moveTo(cx, cy - 12);
      g.lineTo(cx + 12, cy);
      g.lineTo(cx, cy + 12);
      g.lineTo(cx - 12, cy);
      g.closePath();
      g.strokePath();
      g.fillStyle(0xffd1dc, 0.34 + basePulse * 0.22);
      g.fillCircle(cx, cy, 3.2);
    }

    getGeneratorTextureKey() {
      return this.textures.exists(GENERATOR_VISUAL.TEXTURE_KEY)
        ? GENERATOR_VISUAL.TEXTURE_KEY
        : GENERATOR_VISUAL.FALLBACK_KEY;
    }

    syncGeneratorSprites(generators) {
      // New .io-style generators are drawn entirely with lightweight Graphics.
      // Destroy the old SVG/image sprites so the replacement cannot disappear behind stale art.
      for (const sprite of this.generatorSprites.values()) sprite.destroy();
      this.generatorSprites.clear();
    }

    drawGenerator(g, gen, visibilityAlpha = 1) {
      visibilityAlpha = clamp(visibilityAlpha, 0, 1);
      if (visibilityAlpha <= 0.012) return;
      const showProgress = gen.showProgress !== false;
      const showRepairFx = gen.showRepairFx !== false;
      const progress = clamp(gen.progress || 0, 0, 1);
      const smoothedDeposit = clamp(this.generatorDepositVisual?.get(gen.id) ?? gen.dotDepositProgress ?? 0, 0, 1);
      const repairing = showRepairFx && !gen.done && (gen.repairing || (Array.isArray(gen.activeRepairers) && gen.activeRepairers.length > 0));
      const depositing = showRepairFx && !gen.done && (!!gen.dotDepositing || smoothedDeposit > 0.008);
      const kicking = showProgress && !gen.done && !!gen.beingKicked;
      const now = performance.now();
      const pulse = 0.5 + Math.sin(now / 260 + hash2(Math.floor(gen.x), Math.floor(gen.y)) * Math.PI * 2) * 0.5;
      const coreColor = gen.done ? 0x4de283 : kicking ? 0xff5a66 : depositing ? COLORS.collectibleDot : repairing ? 0x31a9ff : 0xa772ff;
      const rimColor = gen.done ? 0xb8ffd1 : kicking ? 0xffb4bc : depositing ? COLORS.collectibleDotGlow : repairing ? 0xbde7ff : 0xe6d7ff;
      const shadowAlpha = gen.done ? 0.16 : 0.22;

      // Soft contact shadow, like an agar cell hovering just above the field.
      g.fillStyle(0x41536e, shadowAlpha * visibilityAlpha);
      g.fillEllipse(gen.x, gen.y + 32, 78, 18);

      if (repairing || depositing || kicking) {
        const auraSize = 39 + pulse * 7;
        const auraColor = kicking ? GENERATOR_VISUAL.KICK_GLOW_COLOR : depositing ? COLORS.collectibleDot : 0x31a9ff;
        g.fillStyle(auraColor, (kicking ? 0.055 : depositing ? 0.065 : 0.045) * visibilityAlpha);
        g.fillCircle(gen.x, gen.y, auraSize + 15);
        g.lineStyle(3, auraColor, (kicking ? 0.46 : depositing ? 0.44 : 0.32) * visibilityAlpha);
        g.strokeCircle(gen.x, gen.y, auraSize);
      }

      // Main .io-style objective cell. The little bubbles sell “machine/objective”
      // without bringing back the old industrial generator sprite.
      g.fillStyle(0xffffff, 0.94 * visibilityAlpha);
      g.fillCircle(gen.x, gen.y, 34);
      g.lineStyle(4, rimColor, 0.95 * visibilityAlpha);
      g.strokeCircle(gen.x, gen.y, 34);
      g.fillStyle(coreColor, (gen.done ? 0.92 : depositing ? 0.88 : 0.80) * visibilityAlpha);
      g.fillCircle(gen.x, gen.y, 22 + pulse * (repairing || depositing ? 2.2 : 0.8));
      g.fillStyle(0xffffff, 0.26 * visibilityAlpha);
      g.fillCircle(gen.x - 9, gen.y - 10, 8);
      g.fillStyle(0x111827, 0.10 * visibilityAlpha);
      g.fillCircle(gen.x + 8, gen.y + 9, 5);

      const orbitR = 39;
      for (let i = 0; i < 5; i++) {
        const seed = hash2(Math.floor(gen.x / 7) + i * 13, Math.floor(gen.y / 7) + i * 17);
        const angle = seed * Math.PI * 2 + (repairing || depositing ? now / 1250 : 0) + i * 1.18;
        const dotSize = 3.2 + (i % 2) * 1.5;
        g.fillStyle(depositing ? COLORS.collectibleDot : i % 2 ? 0x31a9ff : 0xa772ff, (gen.done ? 0.26 : depositing ? 0.66 : 0.52) * visibilityAlpha);
        g.fillCircle(gen.x + Math.cos(angle) * orbitR, gen.y + Math.sin(angle) * orbitR, dotSize);
      }

      if (showProgress) {
        const ringR = 44;
        g.lineStyle(5, 0xdce7f5, 0.82 * visibilityAlpha);
        g.strokeCircle(gen.x, gen.y, ringR);
        const progressColor = gen.done ? 0x4de283 : kicking ? GENERATOR_VISUAL.KICK_GLOW_COLOR : depositing ? COLORS.collectibleDot : repairing ? 0x31a9ff : 0xa772ff;
        if (progress > 0.002) {
          g.lineStyle(6, progressColor, 0.98 * visibilityAlpha);
          g.beginPath();
          g.arc(gen.x, gen.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
          g.strokePath();
        }
      }

      if (kicking) {
        const kickProgress = clamp(gen.kickProgress || 0, 0, 1);
        g.lineStyle(3, GENERATOR_VISUAL.KICK_GLOW_COLOR, 0.95 * visibilityAlpha);
        g.beginPath();
        g.arc(gen.x, gen.y, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * kickProgress, false);
        g.strokePath();
      }

      if (depositing && smoothedDeposit > 0.002) {
        const depositArc = smoothedDeposit >= GENERATOR_VISUAL.DEPOSIT_FULL_SNAP ? 1 : smoothedDeposit;
        g.lineStyle(4, COLORS.collectibleDotGlow, 0.92 * visibilityAlpha);
        if (depositArc >= 0.995) {
          // Phaser arc strokes can leave a tiny seam at 2π. A real circle closes cleanly.
          g.strokeCircle(gen.x, gen.y, 52);
        } else {
          g.beginPath();
          g.arc(gen.x, gen.y, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * depositArc, false);
          g.strokePath();
        }
      }

      if (gen.done && showProgress) {
        g.lineStyle(3, 0x4de283, (0.55 + pulse * 0.20) * visibilityAlpha);
        g.strokeCircle(gen.x, gen.y, 56 + pulse * 4);
      }
    }

    drawGate(g, gate) {
      if (!gate || !gate.open) return;
      const now = performance.now();
      const open = !!gate.open;
      const pulse = 0.5 + Math.sin(now / 360 + hash2(Math.floor(gate.x), Math.floor(gate.y)) * Math.PI * 2) * 0.5;
      const progress = clamp(gate.escapeProgress || 0, 0, 1);
      const core = open ? 0x8b5cf6 : 0x293041;
      const rim = open ? 0x67e8f9 : COLORS.gate;
      const shadow = open ? 0x0f0526 : 0x0b0f18;

      // Ground shadow / sealed field.
      g.fillStyle(shadow, open ? 0.46 : 0.62);
      g.fillEllipse(gate.x, gate.y + 8, 96, 72);

      if (open) {
        // Low-cost animated void portal: a few circles and rotating satellites, not a GPU sermon.
        g.fillStyle(0xa855f7, 0.10 + pulse * 0.05);
        g.fillCircle(gate.x, gate.y, 58 + pulse * 8);
        g.lineStyle(2, 0x22d3ee, 0.34 + pulse * 0.22);
        g.strokeCircle(gate.x, gate.y, 54 + pulse * 5);
        g.lineStyle(2, 0xc084fc, 0.28 + (1 - pulse) * 0.18);
        g.strokeCircle(gate.x, gate.y, 42 + Math.sin(now / 430) * 4);
      }

      g.fillStyle(0xffffff, open ? 0.92 : 0.72);
      g.fillCircle(gate.x, gate.y, 34);
      g.lineStyle(4, rim, open ? 0.96 : 0.82);
      g.strokeCircle(gate.x, gate.y, 34);
      g.fillStyle(core, open ? 0.95 : 0.74);
      g.fillCircle(gate.x, gate.y, open ? 22 + pulse * 2.5 : 21);
      g.fillStyle(0x020617, open ? 0.34 : 0.16);
      g.fillCircle(gate.x + 7, gate.y + 8, 8);
      g.fillStyle(0xffffff, open ? 0.22 : 0.12);
      g.fillCircle(gate.x - 8, gate.y - 9, 7);

      if (open) {
        const orbitR = 43;
        for (let i = 0; i < 6; i++) {
          const a = now / 900 + i * Math.PI / 3 + hash2(i + 8, Math.floor(gate.x / 9)) * 0.7;
          const color = i % 2 ? 0x67e8f9 : 0xc084fc;
          g.fillStyle(color, 0.46 + pulse * 0.18);
          g.fillCircle(gate.x + Math.cos(a) * orbitR, gate.y + Math.sin(a) * orbitR * 0.78, i % 2 ? 4 : 3);
        }
      }

      if (open) {
        g.lineStyle(4, 0xdbeafe, 0.72);
        g.strokeCircle(gate.x, gate.y, 50);
        if (progress > 0.002) {
          g.lineStyle(6, 0xfef3c7, 0.98);
          if (progress >= 0.995) {
            g.strokeCircle(gate.x, gate.y, 50);
          } else {
            g.beginPath();
            g.arc(gate.x, gate.y, 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
            g.strokePath();
          }
        }
      }
    }

    applySnapshot(snapshot) {
      currentSnapshot = snapshot;
      this.matchStartFreezeRemaining = Math.max(0, Number(snapshot.matchStartFreezeRemaining || 0));
      if (this.matchStartFreezeRemaining > 0) {
        this.matchStartFreezeDuration = Math.max(this.matchStartFreezeDuration || 0, this.matchStartFreezeRemaining);
      }
      setMusicTargets(snapshot.music);
      if (!this.map && snapshot.map) this.loadMap(snapshot.map);
      if (this.map && snapshot.map) this.map = { ...this.map, ...snapshot.map, walls: this.map.walls, windows: this.map.windows };
      // Do not force a dynamic redraw on every network snapshot. Generator repair
      // progress arrives constantly, and forcing redraws here bypassed the coarse
      // dynamic-world key below. Let maybeDrawDynamicWorld() redraw only when the
      // pallet/gen/hook/gate key actually changes.
      if (!this.lastDynamicKey) this.needsDynamicRedraw = true;
      if (!this.lastGeneratorKey) this.needsGeneratorRedraw = true;
      this.pendingScratchMarks = snapshot.scratchMarks || [];
      this.needsScratchRedraw = true;
      this.updateActorTargets(snapshot.actors || []);
      if (!this.spawnInPlayed && this.actors.has(myId)) this.playLocalSpawnIn();
      this.handleEvents(snapshot.events || []);
      this.updateHud(snapshot);
      const localActor = (snapshot.actors || []).find((a) => a.id === myId);
      if (localActor?.role === "survivor" && localActor.escaped && !this.localEscapeScreenShown && activeScreenName === "game") {
        this.localEscapeScreenShown = true;
        showEscapedScreen();
      }
      this.lastSnapshotAt = performance.now();
    }

    updateHud(snapshot) {
      const me = (snapshot.actors || []).find((a) => a.id === myId);
      if (!me) return;

      const now = performance.now();
      const objective = snapshot.objective || {};
      const hudKey = JSON.stringify({
        self: [me.id, me.role, me.health, me.dots, me.injured, me.downed, me.hooked, me.dead, me.escaped, me.escapeProgress, me.escapeGateId, me.chase, me.hookProgress, me.healProgress, me.generatorKickTargetId, me.generatorKickProgress],
        objective: [objective.doneGenerators, objective.requiredGenerators, objective.totalGenerators, objective.escapeOpen],
        survivors: (snapshot.actors || []).filter((a) => a.role === "survivor").map((a) => [a.id, a.health, a.dots, a.injured, a.downed, a.hooked, a.dead, a.escaped, a.escapeProgress, a.escapeGateId, a.chase, a.hookProgress, a.healProgress, a.hookCount, a.chatText]),
        killerChat: (snapshot.actors || []).find((a) => a.role === "killer")?.chatText || null,
        dots: (snapshot.collectibleDots || []).map((d) => d.id).join(",")
      });
      if (hudKey === this.lastHudKey && now - this.lastHudRenderAt < 180) return;
      this.lastHudKey = hudKey;
      this.lastHudRenderAt = now;
      renderSurvivorStatusHud(snapshot);
      ui.roleLabel.textContent = me.role === "killer" ? "The Void" : "Survivor";
      ui.controlsLabel.textContent = me.role === "killer"
        ? "WASD move • Mouse aim • M1 attack/lunge • Space vault/break • hold E hook/execute/kick rift • hold R chat"
        : "WASD move • Shift sprint • Mouse flashlight • Space vault/drop • collect orbs, stand near rifts to deposit • stand in open voids to escape • hold E heal/unhook • hold R chat";
      const done = snapshot.objective?.doneGenerators ?? 0;
      const required = snapshot.objective?.requiredGenerators ?? snapshot.objective?.totalGenerators ?? 0;
      const total = snapshot.objective?.totalGenerators ?? required;
      const shownDone = Math.min(done, required);
      ui.genText.textContent = `${shownDone} / ${required}${total > required ? ` (${total} on map)` : ""}`;
      if (ui.bigGenText) ui.bigGenText.textContent = `${shownDone} / ${required}`;
      ui.bigGenCounter?.classList.toggle("is-complete", required > 0 && shownDone >= required);
      ui.gateText.textContent = snapshot.objective?.escapeOpen ? "Voids Open" : "Sealed";
      if (me.role === "killer") {
        const actors = snapshot.actors || [];
        const hookingTarget = actors.find((a) => a.id === me.hookActionTargetId);
        const readyTarget = actors.find((a) => a.id === me.hookReadyTargetId);
        if (hookingTarget) {
          const executing = me.hookActionType === "execute" || (hookingTarget.hookCount || 0) >= 2;
          ui.healthText.textContent = `${executing ? "Executing" : "Hooking"} ${hookingTarget.name || "survivor"} ${Math.round((hookingTarget.hookProgress || 0) * 100)}%`;
        } else if (readyTarget) {
          const executeReady = (readyTarget.hookCount || 0) >= 2;
          ui.healthText.textContent = `Hold E: ${executeReady ? "Execute" : "hook"} ${readyTarget.name || "Survivor"}`;
        } else if (me.generatorKickTargetId) {
          ui.healthText.textContent = `Kicking rift ${Math.round((me.generatorKickProgress || 0) * 100)}%`;
        } else {
          const kickable = (snapshot.map?.generators || []).some((gen) => !gen.done && !gen.kickLocked && (gen.progress || 0) > 0 && Math.hypot((me.x || 0) - gen.x, (me.y || 0) - gen.y) < 92);
          ui.healthText.textContent = kickable ? "Hold E: Kick rift" : "The Void";
        }
      } else if (me.dead) {
        const target = (snapshot.actors || []).find((a) => a.id === this.resolveSpectateTargetId());
        ui.healthText.textContent = target
          ? `Spectating: ${target.name || "Survivor"}`
          : "Dead";
        ui.controlsLabel.textContent = "Tab / Shift+Tab — switch teammate camera";
      } else ui.healthText.textContent = survivorStateLabel(me);
      const fxActor = this.getPovSurvivorData() || me;
      updateHorrorFx(snapshot, fxActor, { terror: this.terrorBlend, chase: this.chaseBlend });
    }

    updateScratchGraphics(marks) {
      const g = this.scratchGraphics;
      g.clear();
      for (const mark of marks) {
        const alpha = clamp((mark.ttl || 0) / 4, 0, 1) * 0.85;
        const len = 22;
        const a = mark.angle || 0;
        g.lineStyle(6, 0x0f172a, alpha * 0.18);
        g.beginPath();
        g.moveTo(mark.x - Math.cos(a) * len * 0.5, mark.y - Math.sin(a) * len * 0.5);
        g.lineTo(mark.x + Math.cos(a) * len * 0.5, mark.y + Math.sin(a) * len * 0.5);
        g.strokePath();
        g.lineStyle(3, COLORS.scratch, alpha);
        g.beginPath();
        g.moveTo(mark.x - Math.cos(a) * len * 0.5, mark.y - Math.sin(a) * len * 0.5);
        g.lineTo(mark.x + Math.cos(a) * len * 0.5, mark.y + Math.sin(a) * len * 0.5);
        g.strokePath();
        g.lineStyle(1, 0xe0f2fe, alpha * 0.82);
        g.beginPath();
        g.moveTo(mark.x - Math.cos(a) * len * 0.28, mark.y - Math.sin(a) * len * 0.28);
        g.lineTo(mark.x + Math.cos(a) * len * 0.28, mark.y + Math.sin(a) * len * 0.28);
        g.strokePath();
      }
    }

    pointInsideRect(x, y, rect, pad = 0) {
      if (!rect) return false;
      return x >= rect.x - pad
        && x <= rect.x + rect.w + pad
        && y >= rect.y - pad
        && y <= rect.y + rect.h + pad;
    }

    hasClearWallLineOfSight(x1, y1, x2, y2) {
      const blockers = this.map?.walls || [];
      if (!blockers.length) return true;
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(2, Math.ceil(dist / 28));
      for (let i = 1; i < steps; i += 1) {
        const t = i / steps;
        const x = lerp(x1, x2, t);
        const y = lerp(y1, y2, t);
        for (const wall of blockers) {
          if (this.pointInsideRect(x, y, wall, 2)) return false;
        }
      }
      return true;
    }

    shouldRevealVoidToHookedLocal(data, actors) {
      if (data?.role !== "killer" || data.dead || data.escaped) return false;
      const local = actors?.find?.((a) => a.id === myId) || this.actors.get(myId)?.data || getLocalPlayerData();
      if (!local?.hooked) return false;
      const lx = Number(local.x);
      const ly = Number(local.y);
      const kx = Number(data.x);
      const ky = Number(data.y);
      if (![lx, ly, kx, ky].every(Number.isFinite)) return false;
      const maxDistance = Math.max(LIGHTING.SURVIVOR_LENGTH * 1.25, 760);
      if (Math.hypot(kx - lx, ky - ly) > maxDistance) return false;
      return this.hasClearWallLineOfSight(lx, ly, kx, ky);
    }

    updateActorTargets(actors) {
      const seen = new Set();
      for (const data of actors) {
        seen.add(data.id);
        let item = this.actors.get(data.id);
        if (!item || item.role !== data.role) {
          if (item) this.destroyActorDisplay(item);
          item = this.createActorDisplay(data);
          this.actors.set(data.id, item);
        }

        item.data = data;
        item.skin = data.skin || (data.role === "survivor" ? "blueSquare" : "killerCircle");
        item.target.x = Number.isFinite(data.x) ? data.x : item.target.x;
        item.target.y = Number.isFinite(data.y) ? data.y : item.target.y;
        item.target.angle = Number.isFinite(data.angle) ? data.angle : item.target.angle;

        // Actors are always position-updated from the server, even when hidden.
        // We only hide the container visually. That prevents the seen-again teleport jump.
        const hookedLocalCanSeeVoid = this.shouldRevealVoidToHookedLocal(data, actors);
        const isVisible = data.visible !== false || data.id === myId || hookedLocalCanSeeVoid;
        let alpha = isVisible ? 1 : 0;
        if (data.id === myId && this.isSpectating()) alpha = 0.32;
        item.container.setVisible(true);
        item.container.setAlpha(alpha);
        item.nameText.setText(data.name || "");
        item.nameText.setVisible(isVisible && data.id !== myId);
        if (item.chatText) {
          const actorChat = visibleChatTextForActor(data);
          item.chatText.setText(actorChat);
          item.chatText.setVisible(isVisible && !!actorChat);

          // Play the speak chirp only when the local player's own chat bubble appears/changes.
          // Other players can talk all they want without hijacking your ears, a radical concept.
          if (data.id === myId) {
            if (actorChat && actorChat !== this.lastLocalChatText && activeScreenName === "game") {
              playSfx("playerSpeak");
            }
            this.lastLocalChatText = actorChat || "";
          }
        }
        this.styleActor(item, data);

        if (data.id === myId) {
          this.localServerTarget = { x: data.x, y: data.y, angle: data.angle, data };
          if (this.localVisual) {
            this.localVisual.role = data.role;
            this.localVisual.skin = data.skin || "blueSquare";
          }
          if (!this.localVisual || dist(this.localVisual.x, this.localVisual.y, data.x, data.y) > 180) {
            this.localVisual = { x: data.x, y: data.y, angle: data.angle, role: data.role, skin: data.skin || "blueSquare" };
          }
          if (data.dead && data.role === "survivor") {
            const living = this.getLivingTeammates();
            if (living.length && (!this.spectateTargetId || !living.some((a) => a.id === this.spectateTargetId))) {
              this.pickDefaultSpectateTarget();
            }
          }
        }
      }

      for (const [id, item] of this.actors.entries()) {
        if (!seen.has(id)) {
          this.destroyActorDisplay(item);
          this.actors.delete(id);
        }
      }
    }

    createActorDisplay(data) {
      const container = this.add.container(data.x || 0, data.y || 0).setDepth(data.role === "killer" ? 15 : 12);
      const isKiller = data.role === "killer";
      const outline = this.add.graphics();
      const body = this.add.graphics();
      const facing = this.add.rectangle(isKiller ? 24 : 21, 0, isKiller ? 22 : 18, isKiller ? 7 : 5, 0xffffff, 0.42).setOrigin(0, 0.5);
      const healBarBg = this.add.rectangle(0, -29, 38, 5, 0x000000, 0.55).setVisible(false);
      const healBar = this.add.rectangle(-19, -29, 0, 5, 0x8dff9a, 0.95).setOrigin(0, 0.5).setVisible(false);
      const nameText = this.add.text(data.x || 0, (data.y || 0) + 34, data.name || "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        fontStyle: "800",
        color: "#f2efea",
        stroke: "#000000",
        strokeThickness: 3
      }).setOrigin(0.5, 0).setDepth((data.role === "killer" ? 16 : 13));
      const chatText = this.add.text(data.x || 0, (data.y || 0) + 48, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        fontStyle: "900",
        color: "#fff3d8",
        align: "center",
        stroke: "#120807",
        strokeThickness: 5,
        wordWrap: { width: 180 }
      }).setOrigin(0.5, 0).setDepth((data.role === "killer" ? 17 : 14)).setVisible(false);
      container.add([outline, body, facing, healBarBg, healBar]);
      return {
        role: data.role,
        skin: data.skin || "blueSquare",
        container,
        body,
        outline,
        facing,
        healBarBg,
        healBar,
        nameText,
        chatText,
        data,
        current: { x: data.x || 0, y: data.y || 0, angle: data.angle || 0 },
        target: { x: data.x || 0, y: data.y || 0, angle: data.angle || 0 },
        dotDisplay: clamp(data.dots ?? 0, 0, SURVIVOR_DOT_MAX),
        dotDepositVisual: 0,
        dotOrbitPhase: hash2((data.id || "survivor").length, (data.id || "s").charCodeAt(0) || 0) * Math.PI * 2
      };
    }

    getSurvivorDotVisualTarget(item) {
      const serverDots = clamp(item.data?.dots ?? 0, 0, SURVIVOR_DOT_MAX);
      const depositProgress = item.data?.dotDepositProgress ?? 0;
      const isDepositing = depositProgress > 0.001 && !!item.data?.dotDepositTargetId;
      if (!isDepositing) return { targetDots: serverDots, depositing: false };

      const depositVisual = item.dotDepositVisual ?? depositProgress;
      return {
        targetDots: Math.max(0, serverDots - depositVisual),
        depositing: true
      };
    }

    drawHeldDotOrbits(item, body, bodyAlpha, accent, glow, playerAngle) {
      const display = item.dotDisplay ?? 0;
      if (display <= 0.03) return;

      const orbitPhase = item.dotOrbitPhase ?? 0;
      const spreadCount = Math.max(1, Math.min(SURVIVOR_DOT_MAX, display));

      for (let i = 0; i < SURVIVOR_DOT_MAX; i++) {
        const fill = clamp(display - i, 0, 1);
        if (fill <= 0.02) continue;

        const orbitSpin = orbitPhase * (1.05 + i * 0.1);
        const slotAngle = orbitSpin + (i / spreadCount) * Math.PI * 2 - Math.PI / 2;
        const localAngle = slotAngle - (playerAngle || 0);
        const radius = DOT_ORBIT_VISUAL.RADIUS_BASE + (i % 3) * DOT_ORBIT_VISUAL.RADIUS_STEP;
        const bob = Math.sin(orbitPhase * 2.3 + i * 0.85) * DOT_ORBIT_VISUAL.BOB;
        const exitT = 1 - fill;
        const exitEase = exitT * exitT;
        const exitPush = exitEase * DOT_ORBIT_VISUAL.DEPOSIT_EXIT_PUSH;
        const ox = Math.cos(localAngle) * (radius + bob + exitPush);
        const oy = Math.sin(localAngle) * (radius + bob + exitPush);
        const size = (i % 2 === 1 ? DOT_ORBIT_VISUAL.SIZE_PRIMARY : DOT_ORBIT_VISUAL.SIZE_SECONDARY) * (0.65 + fill * 0.35);
        const alpha = bodyAlpha * 0.86 * fill * fill;
        const color = i % 2 === 1 ? accent : glow;

        body.fillStyle(color, alpha);
        body.fillCircle(ox, oy, size);
      }
    }

    drawActorShape(item, data, fillColor, fillAlpha, outlineColor, outlineAlpha) {
      item.body.clear();
      item.outline.clear();
      item.body.fillStyle(fillColor, fillAlpha);
      item.outline.lineStyle(2, outlineColor, outlineAlpha);

      if (data.role === "killer") {
        const now = performance.now();
        const attacking = data.attacking || data.attackState === "quick" || data.attackState === "lunge";
        const charging = data.attackState === "charging";
        const angry = attacking ? 1 : charging ? 0.65 : data.recovery > 0 ? 0.38 : 0.18;
        const wobble = Math.sin(now / 145) * 1.25;
        const pulse = Math.sin(now / 210) * 0.5 + 0.5;
        const coreR = 18.5 + wobble + angry * 3.0;

        // The Void: layered black/purple core with orbiting parasite-circles.
        // Kept simple circles only, because scary should not require a GPU funeral.
        item.body.fillStyle(0x020008, 0.98);
        item.body.fillCircle(0, 0, coreR + 6 + pulse * 1.4);
        item.body.fillStyle(0x120022, 0.94);
        item.body.fillCircle(-2, 1, coreR + 2);
        item.body.fillStyle(0x32105f, 0.86);
        item.body.fillCircle(-5, -3, coreR * 0.86);
        item.body.fillStyle(0x7c3aed, 0.34 + angry * 0.24);
        item.body.fillCircle(6, 4, coreR * 0.72);
        item.body.fillStyle(0x000000, 0.70);
        item.body.fillCircle(4, -5, coreR * 0.46);
        item.body.fillStyle(0x090014, 0.78);
        item.body.fillCircle(-7, 7, coreR * 0.34);

        const orbCount = LOW_POWER_MODE ? 5 : 9;
        for (let i = 0; i < orbCount; i++) {
          const seed = i * 1.731;
          const band = i % 3;
          const a = now / (560 + i * 39) + seed + angry * 0.65;
          const r = 12 + band * 7.8 + (i % 5) * 1.35 + Math.sin(now / (210 + i * 8) + i) * (1.8 + angry * 1.7);
          const size = 2.9 + (i % 4) * 1.35 + angry * 1.2;
          const color = i % 5 === 0 ? 0xd8b4fe : i % 2 ? 0x8b5cf6 : 0x05020a;
          const alpha = i % 2 ? 0.58 + angry * 0.14 : 0.74;
          item.body.fillStyle(color, alpha);
          item.body.fillCircle(Math.cos(a) * r, Math.sin(a * (1.06 + band * 0.04)) * r, size);
        }

        for (let i = 0; i < (LOW_POWER_MODE ? 2 : 3); i++) {
          const a = -Math.PI * 0.85 + i * (Math.PI * 1.7 / 4) + Math.sin(now / 360 + i) * 0.08;
          const inner = 18 + angry * 2;
          const outer = 32 + i % 2 * 3 + angry * 4;
          item.outline.lineStyle(1, i % 2 ? 0xa78bfa : 0x4c1d95, 0.22 + angry * 0.16);
          item.outline.beginPath();
          item.outline.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
          item.outline.lineTo(Math.cos(a + 0.18) * outer, Math.sin(a + 0.18) * outer);
          item.outline.strokePath();
        }

        item.outline.lineStyle(2, 0xd8b4fe, 0.44 + angry * 0.36);
        item.outline.strokeCircle(0, 0, 24 + angry * 2.4);
        item.outline.lineStyle(1, 0x7c3aed, 0.34 + pulse * 0.18);
        item.outline.strokeCircle(0, 0, 34 + pulse * 2.0 + angry * 3.2);
        return;
      }

      const skin = getSurvivorSkin(data.skin);
      const now = performance.now();
      const seed = hash2((data.id || "survivor").length, (data.id || "s").charCodeAt(0) || 0);
      const phase = now / 360 + seed * Math.PI * 2;
      const injured = data.health <= 1 || data.injured || data.downed;
      const disabled = data.dead || data.escaped;
      const r = 15.5 + Math.sin(phase) * 0.75;
      const accent = injured ? 0xfb7185 : (skin.accent || outlineColor);
      const glow = skin.glow || 0xffffff;
      const bodyAlpha = disabled ? fillAlpha * 0.45 : fillAlpha;

      if (skin.shape === "orbit") {
        // Friendly signal-orb: readable, soft, and a little alive.
        item.body.fillStyle(glow, 0.18 * bodyAlpha);
        item.body.fillCircle(0, 0, 24 + Math.sin(phase * 1.2) * 1.6);
        item.body.fillStyle(fillColor, 0.96 * bodyAlpha);
        item.body.fillCircle(0, 0, r);
        item.body.fillStyle(0xffffff, 0.42 * bodyAlpha);
        item.body.fillCircle(-5, -6, r * 0.42);
        item.outline.lineStyle(2, outlineColor, outlineAlpha);
        item.outline.strokeCircle(0, 0, r + 3);
        item.outline.lineStyle(1, accent, 0.64 * outlineAlpha);
        item.outline.strokeCircle(0, 0, 24);
      } else if (skin.shape === "sprite") {
        // Solar sprite: a compact cell with fins, so it looks quick without noisy detail.
        const tail = injured ? 13 : 10;
        item.body.fillStyle(glow, 0.18 * bodyAlpha);
        item.body.fillCircle(0, 0, 24 + Math.sin(phase) * 1.4);
        item.body.fillStyle(accent, 0.34 * bodyAlpha);
        item.body.beginPath();
        item.body.moveTo(-r - tail, -8);
        item.body.lineTo(-r - 2, 0);
        item.body.lineTo(-r - tail, 8);
        item.body.closePath();
        item.body.fillPath();
        item.body.fillStyle(fillColor, 0.96 * bodyAlpha);
        item.body.fillCircle(0, 0, r);
        item.body.fillStyle(0xffffff, 0.48 * bodyAlpha);
        item.body.fillCircle(-4, -6, r * 0.36);
        item.outline.lineStyle(2, outlineColor, outlineAlpha);
        item.outline.strokeCircle(0, 0, r + 3);
        item.outline.lineStyle(2, accent, 0.52 * outlineAlpha);
        item.outline.beginPath();
        item.outline.moveTo(-r - tail, -8);
        item.outline.lineTo(-r - 2, 0);
        item.outline.lineTo(-r - tail, 8);
        item.outline.strokePath();
      } else if (skin.shape === "prism") {
        // Prism ghost: geometric, floaty, and distinct from the killer's void blob.
        const points = [];
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + i * Math.PI * 2 / 6;
          const pr = i % 2 === 0 ? r + 4 : r + 1;
          points.push({ x: Math.cos(a) * pr, y: Math.sin(a) * pr });
        }
        item.body.fillStyle(glow, 0.16 * bodyAlpha);
        item.body.fillCircle(0, 0, 25 + Math.sin(phase) * 1.4);
        item.body.fillStyle(fillColor, 0.94 * bodyAlpha);
        item.body.beginPath();
        item.outline.beginPath();
        points.forEach((p, i) => {
          if (i === 0) { item.body.moveTo(p.x, p.y); item.outline.moveTo(p.x, p.y); }
          else { item.body.lineTo(p.x, p.y); item.outline.lineTo(p.x, p.y); }
        });
        item.body.closePath();
        item.outline.closePath();
        item.body.fillPath();
        item.outline.lineStyle(2, outlineColor, outlineAlpha);
        item.outline.strokePath();
        item.outline.lineStyle(1, accent, 0.72 * outlineAlpha);
        item.outline.beginPath();
        item.outline.moveTo(0, -r - 2);
        item.outline.lineTo(r * 0.72, 0);
        item.outline.lineTo(0, r + 2);
        item.outline.lineTo(-r * 0.72, 0);
        item.outline.closePath();
        item.outline.strokePath();
        item.body.fillStyle(0xffffff, 0.38 * bodyAlpha);
        item.body.fillCircle(-4, -6, 5.5);
      } else if (skin.shape === "bloom") {
        // Nebula bloom: soft petals orbiting a bright core.
        item.body.fillStyle(glow, 0.15 * bodyAlpha);
        item.body.fillCircle(0, 0, 26 + Math.sin(phase) * 1.3);
        for (let i = 0; i < 6; i++) {
          const a = phase * 0.35 + i * Math.PI * 2 / 6;
          const px = Math.cos(a) * 9;
          const py = Math.sin(a) * 9;
          item.body.fillStyle(i % 2 ? accent : fillColor, 0.52 * bodyAlpha);
          item.body.fillCircle(px, py, 8.3);
        }
        item.body.fillStyle(fillColor, 0.96 * bodyAlpha);
        item.body.fillCircle(0, 0, r * 0.78);
        item.body.fillStyle(0xffffff, 0.46 * bodyAlpha);
        item.body.fillCircle(-3.5, -5, 4.8);
        item.outline.lineStyle(2, outlineColor, outlineAlpha);
        item.outline.strokeCircle(0, 0, r + 5);
        item.outline.lineStyle(1, accent, 0.58 * outlineAlpha);
        item.outline.strokeCircle(0, 0, 25);
      } else if (skin.shape === "wisp") {
        // Eclipse wisp: crescent body with little trailing sparks.
        item.body.fillStyle(glow, 0.13 * bodyAlpha);
        item.body.fillCircle(0, 0, 25 + Math.sin(phase) * 1.1);
        item.body.fillStyle(fillColor, 0.96 * bodyAlpha);
        item.body.fillCircle(0, 0, r + 2);
        item.body.fillStyle(0x02040a, 0.58 * bodyAlpha);
        item.body.fillCircle(6, -2, r * 0.82);
        for (let i = 0; i < 3; i++) {
          const a = phase * 0.7 + i * 0.8;
          item.body.fillStyle(i % 2 ? accent : glow, 0.58 * bodyAlpha);
          item.body.fillCircle(-15 - i * 6 + Math.sin(a) * 1.2, 7 - i * 4 + Math.cos(a) * 1.2, 3.8 - i * 0.35);
        }
        item.outline.lineStyle(2, outlineColor, outlineAlpha);
        item.outline.strokeCircle(0, 0, r + 4);
        item.outline.lineStyle(1, accent, 0.46 * outlineAlpha);
        item.outline.beginPath();
        item.outline.moveTo(-16, 11);
        item.outline.lineTo(-27, 15);
        item.outline.lineTo(-20, 3);
        item.outline.strokePath();
      } else if (skin.shape === "moth") {
        // Rift moth: butterfly/moth silhouette built from simple circles.
        item.body.fillStyle(glow, 0.13 * bodyAlpha);
        item.body.fillCircle(0, 0, 27 + Math.sin(phase) * 1.2);
        item.body.fillStyle(accent, 0.42 * bodyAlpha);
        item.body.fillCircle(-10, -3, 10.5);
        item.body.fillCircle(10, -3, 10.5);
        item.body.fillStyle(fillColor, 0.74 * bodyAlpha);
        item.body.fillCircle(-8, 9, 8.3);
        item.body.fillCircle(8, 9, 8.3);
        item.body.fillStyle(fillColor, 0.98 * bodyAlpha);
        item.body.fillCircle(0, 1, r * 0.72);
        item.body.fillStyle(0xffffff, 0.42 * bodyAlpha);
        item.body.fillCircle(-2.8, -5, 4.2);
        item.outline.lineStyle(2, outlineColor, outlineAlpha);
        item.outline.strokeCircle(-10, -3, 11.5);
        item.outline.strokeCircle(10, -3, 11.5);
        item.outline.strokeCircle(0, 1, r * 0.82);
        item.outline.lineStyle(1, accent, 0.52 * outlineAlpha);
        item.outline.beginPath();
        item.outline.moveTo(0, -8);
        item.outline.lineTo(0, 15);
        item.outline.strokePath();
      } else if (skin.shape === "drone") {
        // Signal drone: a compact scout with two satellite pods.
        item.body.fillStyle(glow, 0.14 * bodyAlpha);
        item.body.fillCircle(0, 0, 25 + Math.sin(phase) * 1.2);
        item.body.fillStyle(accent, 0.52 * bodyAlpha);
        item.body.fillCircle(-17, 0, 5.8);
        item.body.fillCircle(17, 0, 5.8);
        item.body.fillStyle(fillColor, 0.95 * bodyAlpha);
        item.body.fillCircle(0, 0, r);
        item.body.fillStyle(0xffffff, 0.42 * bodyAlpha);
        item.body.fillCircle(-4, -6, r * 0.34);
        item.outline.lineStyle(2, outlineColor, outlineAlpha);
        item.outline.strokeCircle(0, 0, r + 3);
        item.outline.lineStyle(1, accent, 0.62 * outlineAlpha);
        item.outline.strokeCircle(-17, 0, 6.8);
        item.outline.strokeCircle(17, 0, 6.8);
        item.outline.beginPath();
        item.outline.moveTo(-11, 0);
        item.outline.lineTo(11, 0);
        item.outline.strokePath();
      } else {
        item.body.fillStyle(fillColor, bodyAlpha);
        item.body.fillCircle(0, 0, r);
        item.outline.lineStyle(2, outlineColor, outlineAlpha);
        item.outline.strokeCircle(0, 0, r + 3);
      }

      this.drawHeldDotOrbits(item, item.body, bodyAlpha, accent, glow, item.current?.angle ?? 0);
    }

    drawHookedSurvivorPulse(item, data) {
      if (!item?.outline || !data?.hooked) return;
      const now = performance.now();
      const danger = (data.hookCount || 1) >= 2;
      const base = danger ? 0xff315d : 0xff4d6d;
      const soft = danger ? 0xff9aac : 0xffb4c2;
      const phase = (now / 880) % 1;

      for (let i = 0; i < 3; i++) {
        const t = (phase + i / 3) % 1;
        const radius = 20 + t * 23;
        const alpha = (1 - t) * (danger ? 0.42 : 0.34);
        item.outline.lineStyle(1.25, base, alpha);
        item.outline.strokeCircle(0, 0, radius);
      }

      const smallPulse = 0.5 + Math.sin(now / 170) * 0.5;
      item.outline.lineStyle(1, soft, 0.35 + smallPulse * 0.25);
      item.outline.strokeCircle(0, 0, 20 + smallPulse * 2.5);

      // Small vertical tether marks the survivor as bound without drawing a solid
      // red leash across the screen. Subtle horror, not kindergarten UI.
      item.outline.lineStyle(1, 0xffd1dc, 0.22 + smallPulse * 0.18);
      item.outline.beginPath();
      item.outline.moveTo(0, -34 - smallPulse * 3);
      item.outline.lineTo(0, -22);
      item.outline.strokePath();
    }

    styleActor(item, data) {
      if (data.role === "killer") {
        const charging = data.attackState === "charging";
        const attacking = data.attacking || data.attackState === "quick" || data.attackState === "lunge";
        const now = performance.now();
        const voidStateKey = `${data.attackState || "idle"}:${data.attacking ? 1 : 0}:${data.recovery > 0 ? 1 : 0}`;
        const redrawEvery = LOW_POWER_MODE ? 150 : 95;
        // The Void still animates, but not by redrawing 20+ circles every single frame.
        // Position updates remain smooth because the container moves independently.
        if (item.lastVoidStateKey !== voidStateKey || !item.lastVoidDrawAt || now - item.lastVoidDrawAt >= redrawEvery) {
          item.lastVoidStateKey = voidStateKey;
          item.lastVoidDrawAt = now;
          this.drawActorShape(item, data, COLORS.killer, 1, 0xd8b4fe, attacking ? 1 : 0.84);
        }
        item.facing.setFillStyle(attacking ? 0xf5d0fe : 0xc084fc, attacking ? 0.82 : data.recovery > 0 ? 0.24 : charging ? 0.72 : 0.48);
      } else {
        const skin = getSurvivorSkin(data.skin);
        let color = data.health <= 1 || data.injured ? COLORS.survivorInjured : skin.color;
        if (data.downed) color = COLORS.downed;
        if (data.hooked) color = COLORS.hook;
        const disabled = data.dead || data.escaped;
        const downedHealProgress = data.downed && data.healProgress > 0 ? data.healProgress : 0;
        const progress = data.hooked ? (data.unhookProgress || 0) : data.downed ? (downedHealProgress || data.hookProgress || 0) : (data.healProgress || 0);
        const showProgress = progress > 0 && !data.dead && !data.escaped;
        const executing = data.downed && (data.hookCount || 0) >= 2 && data.hookProgress > 0;
        const progressColor = data.hooked ? 0x75d5ff : downedHealProgress ? 0x8dff9a : executing ? 0xff4040 : data.downed ? 0xffb36b : 0x8dff9a;
        const outlineColor = showProgress ? progressColor : data.invuln > 0 ? 0xffffff : data.hooked ? 0xffc06a : skin.outline;
        this.drawActorShape(item, data, data.dead ? 0x555555 : color, disabled ? 0.45 : 1, outlineColor, showProgress || data.invuln > 0 ? 1 : 0.82);
        if (data.hooked && !disabled) this.drawHookedSurvivorPulse(item, data);
        item.facing.setFillStyle(0xffffff, disabled || data.hooked ? 0.15 : 0.42);
        if (item.healBarBg && item.healBar) {
          item.healBarBg.setVisible(showProgress);
          item.healBar.setVisible(showProgress);
          item.healBar.setFillStyle(progressColor, 0.95);
          item.healBar.width = 38 * clamp(progress, 0, 1);
        }
      }
    }

    handleEvents(events) {
      for (const event of events) {
        if (this[`seen_${event.id}`]) continue;
        this[`seen_${event.id}`] = true;
        announceMatchEvent(event);
        if (event.type === "swipe" || event.type === "swing") {
          this.addSwipeIndicator(event);
          playLocalizedSwing(event);
          const localActor = this.actors.get(myId);
          if (event.actorId === myId && localActor?.data?.role === "killer") {
            this.killerM1Pulse = 1;
            this.cameras.main.shake(LOW_POWER_MODE ? 48 : 64, LOW_POWER_MODE ? 0.00012 : 0.00020);
          }
        }
        if (event.type === "hooked") {
          playSfx("hooked");
          if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
            this.recentHookIndicators.push({
              id: event.survivorId || event.hookId || event.id,
              x: event.x,
              y: event.y,
              survivorId: event.survivorId || null,
              hookCount: event.hookCount || 1,
              until: performance.now() + 1500
            });
            if (this.recentHookIndicators.length > 8) this.recentHookIndicators.splice(0, this.recentHookIndicators.length - 8);
          }
        }
        if (event.type === "execute" || event.type === "death") {
          playSfx("dead");
          if (event.survivorId === myId) {
            this.pickDefaultSpectateTarget();
            toast("Spectating teammates — Tab to switch", 2800);
          }
        }
        if (event.type === "genDone") playSfx(event.allRiftsDone ? "riftsComplete" : "gen");
        if (event.type === "hit" || event.type === "downed") playLocalizedHit(event);
        if (event.type === "vault" && event.actorId === myId) {
          if (event.vaultType === "pallet") playSfx("palletVault");
          else playSfx("windowVault");
        }
        if (["hit", "death", "execute", "downed", "hooked", "unhooked"].includes(event.type)) {
          const color = event.type === "unhooked" ? 0x75d5ff : event.type === "hooked" ? COLORS.hook : COLORS.blood;
          const heavy = event.type === "death" || event.type === "execute" || event.type === "downed" || event.type === "hooked";
          this.burst(event.x, event.y, color, event.type === "hooked" ? 52 : event.type === "execute" || event.type === "death" ? 62 : 38, event.type === "unhooked" ? 140 : 220);

          const isLocalSurvivorEvent = event.survivorId === myId;
          const shouldShakeForImpact = (event.type === "hit" || event.type === "downed") && isLocalSurvivorEvent;
          const shouldShakeForStateChange = ["death", "execute", "hooked"].includes(event.type) && isLocalSurvivorEvent;
          if (shouldShakeForImpact || shouldShakeForStateChange) {
            this.cameras.main.shake(heavy ? 210 : 110, heavy ? 0.0055 : 0.0032);
          }
        }
        if (event.type === "genDone") {
          this.burst(event.x, event.y, COLORS.gen, 58, 190);
          this.addShockwave(event.x, event.y, COLORS.gen);
        }
        if (event.type === "genKick") {
          this.burst(event.x, event.y, 0xff4b4b, 26, 150);
          this.addShockwave(event.x, event.y, 0xff4b4b);
        }
        if (event.type === "vault") this.burst(event.x, event.y, 0xd8d0bd, 12, 90);
        if (event.type === "palletDrop") {
          playLocalizedPalletDrop(event);
          this.burst(event.x, event.y, COLORS.pallet, 16, 130);
        }
        if (event.type === "palletBreak" || event.type === "palletBreakStart") this.burst(event.x, event.y, 0xffc36a, 18, 150);
        if (event.type === "killerStun") {
          playLocalizedPalletStun(event);
          this.burst(event.x, event.y, 0xfff1a8, 30, 110);
        }
        if (event.type === "escape") {
          this.burst(event.x, event.y, 0xa78bfa, 54, 190);
          this.addShockwave(event.x, event.y, 0x67e8f9);
          if (event.survivorId === myId && !this.localEscapeScreenShown) {
            this.localEscapeScreenShown = true;
            showEscapedScreen();
          }
        }
        if (event.type === "voidOpen") {
          this.burst(event.x, event.y, 0xa78bfa, 44, 170);
          this.addShockwave(event.x, event.y, 0x67e8f9);
        }
        if (event.type === "healDone") this.burst(event.x, event.y, 0x8dff9a, 24, 120);
        if (event.type === "dotPickup") {
          this.burst(event.x, event.y, COLORS.collectibleDot, 10, 95);
          playOrbPickupSfx(event);
        }
        if (event.type === "dotDeposit") {
          playOrbDepositSfx(event);
          this.burst(event.x, event.y, COLORS.collectibleDotGlow, 18, 110);
          this.addShockwave(event.x, event.y, COLORS.collectibleDot);
          if (event.generatorId) {
            if (!this.generatorDepositVisual) this.generatorDepositVisual = new Map();
            if (!this.depositCompleteHold) this.depositCompleteHold = new Map();
            this.generatorDepositVisual.set(event.generatorId, 1);
            this.depositCompleteHold.set(event.generatorId, performance.now() + 180);
            this.needsGeneratorRedraw = true;
          }
        }
        // dotFull is now shown as the same under-player chat bubble used by the R chat wheel.
        if (event.type === "dotLoss") this.burst(event.x, event.y, COLORS.collectibleDot, 14, 120);
      }
    }

    drawChargeIndicators(dt) {
      const g = this.chargeGraphics;
      if (!g) return;
      g.clear();
      for (const [id, item] of this.actors.entries()) {
        const data = item.data || {};
        if (data.role !== "killer" || data.attackState !== "charging") continue;
        const isVisible = item.container.alpha > 0.05 || id === myId;
        if (!isVisible) continue;

        const charge = clamp(data.attackCharge || 0, 0, 0.32);
        const t = clamp(charge / 0.32, 0, 1);
        const range = 58 + 40 * t;
        const arc = Math.PI * 0.42;
        const angle = item.current.angle || item.target.angle || 0;
        const x = item.current.x;
        const y = item.current.y;
        const pulse = 0.65 + Math.sin(performance.now() * 0.018) * 0.25;

        const points = [{ x, y }];
        const steps = 16;
        for (let n = 0; n <= steps; n++) {
          const a = angle - arc / 2 + (arc * n) / steps;
          points.push({ x: x + Math.cos(a) * range, y: y + Math.sin(a) * range });
        }
        g.fillStyle(0xffb36b, 0.10 + 0.16 * t);
        g.fillPoints(points, true, true);
        g.lineStyle(2 + 2 * t, 0xffe2b9, 0.35 + 0.35 * pulse);
        g.beginPath();
        g.arc(x, y, 25 + t * 12, 0, Math.PI * 2);
        g.strokePath();
      }
    }

    addSwipeIndicator(event) {
      // Do not leak hidden killers through walls just because the swipe visual exists.
      const actorId = event.actorId;
      const actorItem = actorId ? this.actors.get(actorId) : null;
      const actorVisible = !actorItem || actorItem.container.alpha > 0.05 || actorId === myId;
      if (!actorVisible) return;

      this.swipes.push({
        actorId,
        x: event.x,
        y: event.y,
        angle: event.angle || 0,
        range: event.range || 82,
        arc: event.arc || Math.PI * 0.58,
        ttl: Math.max(0.18, (event.duration || 0.24) + 0.08),
        startup: event.startup || 0,
        life: 0,
        type: event.attackType || event.type || "quick"
      });
    }

    drawSwipes(dt) {
      const g = this.swipeGraphics;
      g.clear();
      for (let i = this.swipes.length - 1; i >= 0; i--) {
        const s = this.swipes[i];
        s.life += dt;
        if (s.life >= s.ttl) {
          this.swipes.splice(i, 1);
          continue;
        }

        const actor = s.actorId ? this.actors.get(s.actorId) : null;
        const x = actor ? actor.current.x : s.x;
        const y = actor ? actor.current.y : s.y;
        const angle = actor ? actor.current.angle : s.angle;
        const windup = s.life < s.startup;
        const rawT = s.startup > 0 ? clamp((s.life - s.startup) / Math.max(0.001, s.ttl - s.startup), 0, 1) : clamp(s.life / s.ttl, 0, 1);
        const sweepT = windup ? clamp(s.life / Math.max(0.001, s.startup), 0, 1) : rawT;
        const fade = windup ? 0.26 + 0.28 * sweepT : Math.pow(1 - rawT, 1.35);
        const range = s.range * (windup ? 0.84 + 0.16 * sweepT : 1);
        const arc = s.arc * (windup ? 0.55 + 0.45 * sweepT : 1);
        const steps = 22;
        const points = [{ x, y }];

        for (let n = 0; n <= steps; n++) {
          const t = n / steps;
          const a = angle - arc / 2 + arc * t;
          const edgePulse = 0.90 + Math.sin(t * Math.PI) * 0.10;
          points.push({
            x: x + Math.cos(a) * range * edgePulse,
            y: y + Math.sin(a) * range * edgePulse
          });
        }

        // Soft warning/windup fill, then a brighter moving slash edge.
        g.fillStyle(windup ? 0xa3421f : 0xffd5bd, windup ? 0.08 + 0.10 * sweepT : 0.12 * fade);
        g.fillPoints(points, true, true);

        const slashA = angle - arc / 2 + arc * clamp(windup ? sweepT * 0.35 : sweepT, 0, 1);
        const slashLen = range * (windup ? 0.72 : 1);
        const inner = windup ? 22 : 18;
        g.lineStyle(windup ? 3 : 6, windup ? 0xff995c : 0xffeee0, windup ? 0.32 + 0.30 * sweepT : 0.72 * fade);
        g.beginPath();
        g.moveTo(x + Math.cos(slashA) * inner, y + Math.sin(slashA) * inner);
        g.lineTo(x + Math.cos(slashA) * slashLen, y + Math.sin(slashA) * slashLen);
        g.strokePath();

        g.lineStyle(2, windup ? 0xffc089 : 0xffb68c, windup ? 0.22 + 0.28 * sweepT : 0.40 * fade);
        g.beginPath();
        for (let n = 1; n < points.length; n++) {
          if (n === 1) g.moveTo(points[n].x, points[n].y);
          else g.lineTo(points[n].x, points[n].y);
        }
        g.strokePath();
      }
    }

    playLocalSpawnIn() {
      const item = this.actors.get(myId);
      if (!item || this.spawnInPlayed) return;
      const x = item.current?.x ?? item.target?.x ?? item.container?.x;
      const y = item.current?.y ?? item.target?.y ?? item.container?.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      this.spawnInPlayed = true;
      this.spawnInAt = performance.now();
      this.spawnInPulse = 1;
      item.spawnScalePulse = 1;
      item.container?.setScale(LOW_POWER_MODE ? 0.72 : 0.58);

      const primary = item.data?.role === "killer" ? 0xa772ff : 0x31a9ff;
      const secondary = item.data?.role === "killer" ? 0x4c1d95 : COLORS.collectibleDotGlow;
      this.addShockwave(x, y, primary, LOW_POWER_MODE ? 0.62 : 0.84, LOW_POWER_MODE ? 82 : 118);
      this.addShockwave(x, y, secondary, LOW_POWER_MODE ? 0.46 : 0.64, LOW_POWER_MODE ? 52 : 78);
      this.burst(x, y, primary, LOW_POWER_MODE ? 18 : 34, LOW_POWER_MODE ? 145 : 210);
      this.burst(x, y, secondary, LOW_POWER_MODE ? 12 : 24, LOW_POWER_MODE ? 95 : 145);

      // A tiny camera thump makes the spawn feel physical without turning match start into a GPU crime.
      this.cameras.main.shake(LOW_POWER_MODE ? 80 : 120, LOW_POWER_MODE ? 0.0009 : 0.0015);
    }

    addShockwave(x, y, color = 0xffffff, alpha = 0.62, maxRadius = 120) {
      this.shockwaves.push({ x, y, color, alpha, maxRadius, life: 0, ttl: 0.72, radius: 8 });
      if (this.shockwaves.length > PERFORMANCE.MAX_SHOCKWAVES) this.shockwaves.splice(0, this.shockwaves.length - PERFORMANCE.MAX_SHOCKWAVES);
    }

    burst(x, y, color, count, speed) {
      const room = Math.max(0, PERFORMANCE.MAX_PARTICLES - this.particles.length);
      const actualCount = Math.min(count, room);
      for (let i = 0; i < actualCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.35 + Math.random() * 0.65);
        this.particles.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          ttl: 0.55 + Math.random() * 0.35,
          life: 0,
          size: 2 + Math.random() * 5,
          color
        });
      }
    }

    updateFpsCounter(dt) {
      const node = ensureFpsCounter();
      if (!node) return;
      this.fpsAccum = (this.fpsAccum || 0) + dt;
      this.fpsFrames = (this.fpsFrames || 0) + 1;
      if (this.fpsAccum < 0.35) return;
      const fps = Math.max(0, Math.round(this.fpsFrames / Math.max(0.001, this.fpsAccum)));
      node.textContent = String(fps);
      node.style.color = fps >= 55 ? "#bcffb8" : fps >= 35 ? "#fff3b0" : "#ff9a9a";
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    update(time, deltaMs) {
      const dt = Math.min(0.04, deltaMs / 1000);
      updateMusic();
      this.updateAimAngle();
      this.predictLocal(dt);
      this.updateActorDisplays(dt);
      this.updateImmersion(dt);
      this.updateCamera(dt);
      this.updateWallVision(dt);
      this.updateCollectibleDotVisuals(dt);
      this.maybeDrawDynamicWorld(dt);
      this.maybeDrawGeneratorLayer(dt);
      this.maybeUpdateScratchGraphics(dt);
      this.drawLighting(dt);
      this.drawHookIndicators();
      this.drawChatWheel();
      this.drawChargeIndicators(dt);
      this.drawSwipes(dt);
      this.updateParticles(dt);
      this.updateFpsCounter(dt);

      this.inputTimer += dt;
      if (this.inputTimer >= 1 / 60) {
        this.inputTimer = 0;
        sendInput({}, false);
      }
    }

    updateAimAngle() {
      const pointer = this.input.activePointer;
      const cam = this.cameras.main;
      const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
      const me = this.localVisual || this.localServerTarget;
      if (me) input.angle = Math.atan2(worldPoint.y - me.y, worldPoint.x - me.x);
    }

    predictLocal(dt) {
      if (!this.map || !this.localVisual || !this.localServerTarget?.data) return;
      const data = this.localServerTarget.data;
      this.localVisual.angle = input.angle;
      if (data.dead || data.escaped || data.hooked || data.vaulting || data.breaking) {
        this.localVisual.x += (this.localServerTarget.x - this.localVisual.x) * 0.45;
        this.localVisual.y += (this.localServerTarget.y - this.localVisual.y) * 0.45;
        return;
      }

      let dx = 0;
      let dy = 0;
      if (input.up) dy -= 1;
      if (input.down) dy += 1;
      if (input.left) dx -= 1;
      if (input.right) dx += 1;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;

      let speed = data.role === "killer" ? LOCAL_SPEEDS.killer : (input.sprint ? LOCAL_SPEEDS.survivorSprint : LOCAL_SPEEDS.survivorWalk);
      if (data.role === "survivor" && data.downed) speed = LOCAL_SPEEDS.downedCrawl;
      else if (data.role === "survivor" && data.hitBoost > 0) speed = LOCAL_SPEEDS.survivorBoost;
      if (data.role === "killer" && data.attackState === "lunge") {
        dx = Math.cos(input.angle);
        dy = Math.sin(input.angle);
        speed = LOCAL_SPEEDS.killer * LOCAL_SPEEDS.killerLungeMult;
      } else if (data.role === "killer" && data.attackState === "quick") {
        speed = 0;
      } else if (data.role === "killer" && data.recovery > 0) speed *= LOCAL_SPEEDS.killerRecoveryMult;

      const nx = clamp(this.localVisual.x + dx * speed * dt, 36, this.map.width - 36);
      const ny = clamp(this.localVisual.y + dy * speed * dt, 36, this.map.height - 36);
      if (!this.localWouldCollide(data.role, nx, this.localVisual.y)) this.localVisual.x = nx;
      if (!this.localWouldCollide(data.role, this.localVisual.x, ny)) this.localVisual.y = ny;

      // Soft reconciliation with server authority. Not syrupy, not teleporty. Finally, a compromise that doesn't smell like despair.
      this.localVisual.x += (this.localServerTarget.x - this.localVisual.x) * 0.075;
      this.localVisual.y += (this.localServerTarget.y - this.localVisual.y) * 0.075;
    }

    localWouldCollide(role, x, y) {
      const box = actorRect({ role }, x, y);
      const solids = [...(this.map.walls || []), ...(this.map.windows || [])];
      for (const p of currentSnapshot?.map?.pallets || []) {
        if (!p.broken && p.state === "dropped") solids.push(p);
      }
      if (role === "survivor") {
        for (const gen of currentSnapshot?.map?.generators || this.map.generators || []) {
          const size = GENERATOR_COLLISION_SIZE;
          solids.push({ id: gen.id, x: gen.x - size / 2, y: gen.y - size / 2, w: size, h: size });
        }
      }
      return solids.some((r) => rectsOverlap(box, r));
    }

    isOuterMapWall(rect) {
      if (!this.map || !rect) return false;
      const epsilon = 0.5;
      return rect.x <= epsilon
        || rect.y <= epsilon
        || rect.x + rect.w >= this.map.width - epsilon
        || rect.y + rect.h >= this.map.height - epsilon;
    }

    palletVisionStateKey(pallet) {
      if (!pallet) return "";
      return `${pallet.id || ""}:${pallet.x}:${pallet.y}:${pallet.w}:${pallet.h}:${pallet.orientation || ""}:${pallet.state || ""}:${pallet.broken ? 1 : 0}`;
    }

    getPalletVisionKey() {
      const pallets = currentSnapshot?.map?.pallets || this.map?.pallets || [];
      return pallets.map((p) => this.palletVisionStateKey(p)).join("|");
    }

    syncPalletVisionVisuals() {
      if (!this.wallVisuals?.length || !this.map) return;
      const pallets = currentSnapshot?.map?.pallets || this.map?.pallets || [];
      const key = this.getPalletVisionKey();
      if (key === this.lastPalletVisionKey) return;

      const byId = new Map(pallets.map((p) => [p.id, p]));
      let missing = false;
      for (const pallet of pallets) {
        if (!this.wallVisuals.some((item) => item.type === "pallet" && item.id === pallet.id)) {
          missing = true;
          break;
        }
      }
      if (missing) {
        this.rebuildWallVisionVisuals();
        return;
      }

      for (const item of this.wallVisuals) {
        if (item.type !== "pallet") continue;
        const pallet = byId.get(item.id);
        if (!pallet) {
          item.targetAlpha = 0;
          continue;
        }
        const stateKey = this.palletVisionStateKey(pallet);
        if (stateKey === item.stateKey) continue;
        item.rect = pallet;
        item.stateKey = stateKey;
        item.centerX = pallet.x + pallet.w / 2;
        item.centerY = pallet.y + pallet.h / 2;
        item.radius = Math.hypot(pallet.w, pallet.h) / 2;
        item.samples = this.wallVisionSamplePoints(pallet);
        item.graphics.clear();
        this.drawPallet(item.graphics, pallet);
      }
      this.lastPalletVisionKey = key;
    }


    rectDistanceToPoint(rect, px, py) {
      const dx = px < rect.x ? rect.x - px : px > rect.x + rect.w ? px - (rect.x + rect.w) : 0;
      const dy = py < rect.y ? rect.y - py : py > rect.y + rect.h ? py - (rect.y + rect.h) : 0;
      return Math.hypot(dx, dy);
    }

    wallVisionSamplePoints(rect) {
      const x1 = rect.x;
      const y1 = rect.y;
      const x2 = rect.x + rect.w;
      const y2 = rect.y + rect.h;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      return [
        { x: cx, y: cy },
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x1, y: y2 },
        { x: x2, y: y2 },
        { x: cx, y: y1 },
        { x: cx, y: y2 },
        { x: x1, y: cy },
        { x: x2, y: cy }
      ];
    }

    computeWallVisionAlpha(item, sourceX, sourceY, facing, length, coneAngle, nearRadius) {
      const nearDistance = Math.max(0, this.rectDistanceToPoint(item.rect, sourceX, sourceY) - item.radius * 0.18);
      const nearAlpha = 1 - smoothstep(nearRadius * 0.72, nearRadius, nearDistance);

      let coneAlpha = 0;
      const halfAngle = coneAngle / 2;
      const edgeSoftness = Math.max(0.03, WALL_VISION.EDGE_SOFTNESS);
      const distanceFeather = clamp(WALL_VISION.DISTANCE_FEATHER, 0.05, 0.35);
      const maxDistance = length + item.radius * 0.75;

      for (const p of item.samples || this.wallVisionSamplePoints(item.rect)) {
        const dx = p.x - sourceX;
        const dy = p.y - sourceY;
        const d = Math.hypot(dx, dy);
        if (d > maxDistance) continue;
        const a = Math.atan2(dy, dx);
        const diff = angleDiff(a, facing);
        if (diff > halfAngle) continue;

        const angleAlpha = 1 - smoothstep(Math.max(0, halfAngle - edgeSoftness), halfAngle, diff);
        const distanceAlpha = 1 - smoothstep(length * (1 - distanceFeather), maxDistance, d);
        coneAlpha = Math.max(coneAlpha, clamp(angleAlpha * distanceAlpha, 0, 1));
      }

      // Windows are extra important for chase readability, so give visible windows a tiny lift.
      const readableBoost = item.type === "window" ? 0.10 : 0;
      return clamp(Math.max(nearAlpha, coneAlpha) + readableBoost * Math.max(nearAlpha, coneAlpha), 0, 1);
    }

    updateWallVision(dt) {
      if (!this.wallVisuals?.length) return;
      this.syncPalletVisionVisuals();

      const subject = this.getCameraSubjectItem();
      const hasSubject = !!subject?.container;
      const role = subject?.data?.role || "survivor";
      const worldX = subject?.container?.x ?? 0;
      const worldY = subject?.container?.y ?? 0;
      const facing = subject?.container?.rotation || 0;
      const baseLength = role === "killer" ? LIGHTING.KILLER_LENGTH : LIGHTING.SURVIVOR_LENGTH;
      const baseAngle = role === "killer" ? LIGHTING.KILLER_ANGLE : LIGHTING.SURVIVOR_ANGLE;
      const length = baseLength + WALL_VISION.CONE_EXTRA_LENGTH;
      const coneAngle = baseAngle + WALL_VISION.CONE_EXTRA_ANGLE;
      const nearRadius = role === "killer" ? WALL_VISION.KILLER_NEAR_RADIUS : WALL_VISION.SURVIVOR_NEAR_RADIUS;

      this.wallVisionTimer = (this.wallVisionTimer || 0) + dt;
      const shouldRecompute = this.wallVisionTimer >= 1 / PERFORMANCE.WALL_VISION_FPS;
      if (shouldRecompute) this.wallVisionTimer = 0;

      const fadeInRate = WALL_VISION.FADE_IN_PER_SECOND;
      const fadeOutRate = WALL_VISION.FADE_OUT_PER_SECOND;
      const minAlpha = WALL_VISION.MIN_VISIBLE_ALPHA;

      for (const item of this.wallVisuals) {
        if (shouldRecompute) {
          if (!hasSubject) {
            item.targetAlpha = 0;
          } else if (role === "killer" || item.outerWall) {
            // Killer gets normal map readability. Survivors get the cone/near-bubble horror effect.
            // Outer boundary walls stay visible for everyone so the map edge never becomes invisible collision nonsense.
            item.targetAlpha = 1;
          } else {
            item.targetAlpha = this.computeWallVisionAlpha(item, worldX, worldY, facing, length, coneAngle, nearRadius);
          }
        }

        const rate = item.targetAlpha > item.alpha ? fadeInRate : fadeOutRate;
        item.alpha = lerp(item.alpha, item.targetAlpha, dampAlpha(rate, dt));
        if (item.alpha < minAlpha && item.targetAlpha <= minAlpha) {
          item.alpha = 0;
          item.graphics.setVisible(false);
        } else {
          item.graphics.setVisible(true);
          item.graphics.setAlpha(clamp(item.alpha, 0, 1));
        }
      }
    }

    updateActorDisplays(dt) {
      for (const [id, item] of this.actors.entries()) {
        if (id === myId && this.localVisual) {
          item.current.x = this.localVisual.x;
          item.current.y = this.localVisual.y;
          item.current.angle = this.localVisual.angle;
        } else {
          const factor = item.data?.vaulting ? 0.5 : 0.22;
          item.current.x = lerp(item.current.x, item.target.x, factor);
          item.current.y = lerp(item.current.y, item.target.y, factor);
          item.current.angle = lerpAngle(item.current.angle, item.target.angle, 0.24);
        }
        item.container.setPosition(item.current.x, item.current.y);
        item.container.rotation = item.current.angle || 0;
        if (item.spawnScalePulse && item.spawnScalePulse > 0.001) {
          item.spawnScalePulse = Math.max(0, item.spawnScalePulse - dt * (LOW_POWER_MODE ? 3.8 : 4.8));
          const pop = Math.sin((1 - item.spawnScalePulse) * Math.PI);
          const scale = 1 + pop * (LOW_POWER_MODE ? 0.10 : 0.16) - item.spawnScalePulse * (LOW_POWER_MODE ? 0.20 : 0.32);
          item.container.setScale(clamp(scale, 0.72, 1.16));
        } else if (item.container.scaleX !== 1 || item.container.scaleY !== 1) {
          item.container.setScale(1);
        }
        if (item.data?.role === "survivor") {
          const serverDots = clamp(item.data.dots ?? 0, 0, SURVIVOR_DOT_MAX);
          const depositProgress = item.data.dotDepositProgress ?? 0;
          const isDepositing = depositProgress > 0.001 && !!item.data.dotDepositTargetId;

          if (isDepositing) {
            item.dotDepositVisual = lerp(
              item.dotDepositVisual ?? depositProgress,
              depositProgress,
              dampAlpha(DOT_ORBIT_VISUAL.DEPOSIT_PROGRESS_SMOOTHING, dt)
            );
          } else {
            item.dotDepositVisual = 0;
          }

          const { targetDots, depositing } = this.getSurvivorDotVisualTarget(item);
          const prevDisplay = item.dotDisplay ?? targetDots;
          const smoothing = depositing || targetDots < prevDisplay - 0.0001
            ? DOT_ORBIT_VISUAL.DEPOSIT_SMOOTHING
            : DOT_ORBIT_VISUAL.PICKUP_SMOOTHING;

          item.dotOrbitPhase = (item.dotOrbitPhase || 0) + dt * DOT_ORBIT_VISUAL.SPIN_SPEED;
          item.dotDisplay = lerp(prevDisplay, targetDots, dampAlpha(smoothing, dt));
        }
        if (item.data?.role === "killer" || item.data?.role === "survivor") {
          this.styleActor(item, item.data);
        }
        if (item.nameText) {
          const isKiller = item.data?.role === "killer";
          item.nameText.setPosition(item.current.x, item.current.y + (isKiller ? 36 : 34));
          item.nameText.setRotation(0);
        }
        if (item.chatText) {
          const isKiller = item.data?.role === "killer";
          item.chatText.setPosition(item.current.x, item.current.y + (isKiller ? 47 : 43));
          item.chatText.setRotation(0);
        }
      }
    }

    updateImmersion(dt) {
      const me = this.getPovSurvivorData() || this.localServerTarget?.data || this.actors.get(myId)?.data;
      const levels = getThreatLevels(currentSnapshot, me);
      const chaseRate = levels.chase ? IMMERSION.CHASE_IN_LERP : IMMERSION.CHASE_OUT_LERP;
      this.chaseBlend = lerp(this.chaseBlend, levels.chase, chaseRate);
      this.terrorBlend = lerp(this.terrorBlend, levels.terror, IMMERSION.TERROR_LERP);
      this.breathPhase += dt * (1.25 + this.terrorBlend * 2.1 + this.chaseBlend * 2.5);
      this.lightFlickerPhase += dt * LIGHTING.FLICKER_SPEED;
      this.heartbeatPulse = Math.max(0, this.heartbeatPulse - dt * 3.8);
      this.killerM1Pulse = Math.max(0, (this.killerM1Pulse || 0) - dt * 5.5);
      this.spawnInPulse = Math.max(0, (this.spawnInPulse || 0) - dt * IMMERSION.SPAWN_ZOOM_DECAY);

      const interval = lerp(IMMERSION.HEARTBEAT_MAX_INTERVAL, IMMERSION.HEARTBEAT_MIN_INTERVAL, clamp(this.terrorBlend + this.chaseBlend * 0.45, 0, 1));
      this.heartbeatTimer += dt;
      if ((this.terrorBlend > 0.08 || this.chaseBlend > 0.05) && this.heartbeatTimer >= interval) {
        this.heartbeatTimer = 0;
        this.heartbeatPulse = 1;
        const intensity = IMMERSION.HEARTBEAT_SHAKE_BASE * this.terrorBlend + IMMERSION.HEARTBEAT_SHAKE_CHASE * this.chaseBlend;
        if (intensity > 0.0005) this.cameras.main.shake(90, intensity);
      }

      const rawChase = levels.chase > 0;
      if (rawChase && !this.lastRawChase) {
        this.cameras.main.shake(IMMERSION.CHASE_START_SHAKE_DURATION, IMMERSION.CHASE_START_SHAKE_INTENSITY);
      }
      this.lastRawChase = rawChase;

      const currentMe = this.actors.get(myId)?.data;
      updateHorrorFx(currentSnapshot, currentMe, { terror: this.terrorBlend, chase: this.chaseBlend });
    }

    updateCamera(dt = 0) {
      const item = this.getCameraSubjectItem();
      if (!item) return;
      const cam = this.cameras.main;
      const x = item.container.x;
      const y = item.container.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const localData = this.isSpectating()
        ? (this.actors.get(myId)?.data || item.data)
        : (item.data || item.current || item.target || null);
      const subjectData = item.data || item.current || item.target || localData || null;
      const killerCharging = localData?.role === "killer" && localData.attackState === "charging";
      const killerM1Hold = localData?.role === "killer" && (input.attackHeld || killerCharging) ? 1 : 0;
      const povData = this.getPovSurvivorData();

      const isDepositing = !this.isSpectating()
        && povData?.role === "survivor"
        && (!!povData.dotDepositTargetId || (povData.dotDepositProgress || 0) > 0.001);
      const isKickingRift = !this.isSpectating()
        && localData?.role === "killer"
        && (!!localData.generatorKickTargetId || (localData.generatorKickProgress || 0) > 0.001);
      const isHealingSomeone = !this.isSpectating()
        && localData?.role === "survivor"
        && !!localData.healingTargetId;
      const isBeingHealed = subjectData?.role === "survivor"
        && !subjectData?.hooked
        && (subjectData?.healProgress || 0) > 0.001;
      const isUnhookingSomeone = !this.isSpectating()
        && localData?.role === "survivor"
        && !!localData.unhookTargetId;
      const isBeingUnhooked = subjectData?.role === "survivor"
        && !!subjectData?.hooked
        && (subjectData?.unhookProgress || 0) > 0.001;
      const isHookingSomeone = !this.isSpectating()
        && localData?.role === "killer"
        && !!localData.hookActionTargetId;
      const isHooked = subjectData?.role === "survivor" && !!subjectData?.hooked;
      const isDowned = subjectData?.role === "survivor" && !!subjectData?.downed && !subjectData?.escaped && !subjectData?.dead;
      const isInjured = subjectData?.role === "survivor"
        && (!!subjectData?.injured || (subjectData?.health || 2) <= 1)
        && !isDowned
        && !isHooked
        && !subjectData?.escaped
        && !subjectData?.dead;
      const isEscaping = subjectData?.role === "survivor"
        && (!!subjectData?.escapeGateId || (subjectData?.escapeProgress || 0) > 0.001);

      const hardSurvivorStateZoom = isHooked
        ? IMMERSION.HOOKED_ZOOM
        : isDowned
          ? IMMERSION.DOWNED_ZOOM
          : null;

      const zoomCandidates = hardSurvivorStateZoom !== null
        ? [hardSurvivorStateZoom]
        : [
          this.terrorBlend > 0.001 ? this.terrorBlend * IMMERSION.TERROR_ZOOM : null,
          this.chaseBlend > 0.001 ? this.chaseBlend * IMMERSION.CHASE_ZOOM : null,
          killerM1Hold ? IMMERSION.KILLER_M1_HOLD_ZOOM : null,
          (this.killerM1Pulse || 0) > 0.001 ? (this.killerM1Pulse || 0) * IMMERSION.KILLER_M1_PULSE_ZOOM : null,
          isDepositing ? IMMERSION.DEPOSIT_ZOOM : null,
          isKickingRift ? IMMERSION.RIFT_KICK_ZOOM : null,
          (isHealingSomeone || isBeingHealed) ? IMMERSION.HEAL_ZOOM : null,
          (isUnhookingSomeone || isBeingUnhooked) ? IMMERSION.UNHOOK_ZOOM : null,
          isHookingSomeone ? IMMERSION.HOOKED_ZOOM : null,
          isInjured ? IMMERSION.INJURED_ZOOM : null,
          isEscaping ? IMMERSION.ESCAPE_ZOOM : null,
          (this.spawnInPulse || 0) > 0.001 ? (this.spawnInPulse || 0) * IMMERSION.SPAWN_ZOOM : null
        ].filter((value) => Number.isFinite(value));

      // Camera zoom states do not stack. Most of the time, choose the strongest
      // absolute offset so negative values work too. Hard survivor states like
      // hooked/downed override chase/terror completely, otherwise chase can keep
      // winning and a configured hookedZoom: -0.5 never gets to breathe. Rude.
      const strongestZoom = zoomCandidates.length
        ? zoomCandidates.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), zoomCandidates[0])
        : 0;

      const localStartRemaining = Math.max(0, (this.matchStartZoomUntil || 0) - performance.now()) / 1000;
      const startLockRemaining = Math.max(localStartRemaining, this.matchStartFreezeRemaining || 0);
      const startLockDuration = Math.max(0.001, this.matchStartFreezeDuration || IMMERSION.MATCH_START_LOCK_SECONDS || 1.5);
      const startLockT = clamp(startLockRemaining / startLockDuration, 0, 1);
      const startLockZoom = startLockT > 0 ? -IMMERSION.MATCH_START_ZOOM_OUT * startLockT * startLockT : 0;

      const positiveCeiling = Math.max(
        0,
        IMMERSION.TERROR_ZOOM,
        IMMERSION.CHASE_ZOOM,
        IMMERSION.KILLER_M1_HOLD_ZOOM,
        IMMERSION.KILLER_M1_PULSE_ZOOM,
        IMMERSION.DEPOSIT_ZOOM,
        IMMERSION.RIFT_KICK_ZOOM,
        IMMERSION.HEAL_ZOOM,
        IMMERSION.UNHOOK_ZOOM,
        IMMERSION.HOOKED_ZOOM,
        IMMERSION.INJURED_ZOOM,
        IMMERSION.DOWNED_ZOOM,
        IMMERSION.ESCAPE_ZOOM,
        IMMERSION.SPAWN_ZOOM
      );
      const negativeFloor = Math.min(
        0,
        IMMERSION.TERROR_ZOOM,
        IMMERSION.CHASE_ZOOM,
        IMMERSION.KILLER_M1_HOLD_ZOOM,
        IMMERSION.KILLER_M1_PULSE_ZOOM,
        IMMERSION.DEPOSIT_ZOOM,
        IMMERSION.RIFT_KICK_ZOOM,
        IMMERSION.HEAL_ZOOM,
        IMMERSION.UNHOOK_ZOOM,
        IMMERSION.HOOKED_ZOOM,
        IMMERSION.INJURED_ZOOM,
        IMMERSION.DOWNED_ZOOM,
        IMMERSION.ESCAPE_ZOOM,
        IMMERSION.SPAWN_ZOOM,
        -IMMERSION.MATCH_START_ZOOM_OUT
      );

      const minZoom = Math.max(0.12, Math.min(IMMERSION.MIN_ZOOM, IMMERSION.BASE_ZOOM + negativeFloor - 0.04));
      const maxZoom = Math.max(IMMERSION.BASE_ZOOM + 0.05, IMMERSION.BASE_ZOOM + positiveCeiling + 0.04);
      const targetZoom = clamp(
        IMMERSION.BASE_ZOOM + strongestZoom + startLockZoom,
        minZoom,
        maxZoom
      );
      const zoomAlpha = dampAlpha(IMMERSION.ZOOM_SMOOTHING, dt);
      const nextZoom = lerp(cam.zoom || IMMERSION.BASE_ZOOM, targetZoom, zoomAlpha);
      const zoomDelta = Math.abs((cam.zoom || IMMERSION.BASE_ZOOM) - nextZoom);
      const zoomThreshold = cameraNumber("zoomUpdateThreshold", "lowPowerZoomUpdateThreshold", LOW_POWER_MODE ? 0.0065 : 0.0035);
      if (zoomDelta > zoomThreshold) {
        cam.setZoom(nextZoom);
      } else if (zoomDelta > 0.0001 && Math.abs((cam.zoom || IMMERSION.BASE_ZOOM) - targetZoom) < zoomThreshold * 1.35) {
        cam.setZoom(targetZoom);
      }

      // DBD-like soft camera pressure. No constant sprint bob, just subtle lean
      // when movement direction changes and a bit of chase breathing.
      const now = performance.now();
      const moveInput = input?.move || { x: 0, y: 0 };
      const moveX = Number.isFinite(moveInput.x) ? moveInput.x : 0;
      const moveY = Number.isFinite(moveInput.y) ? moveInput.y : 0;
      const moving = Math.hypot(moveX, moveY) > 0.2;
      const moveAngle = moving ? Math.atan2(moveY, moveX) : this.lastMoveAngle;
      if (moving && Number.isFinite(moveAngle)) {
        if (Number.isFinite(this.lastMoveAngle)) {
          const diff = angleDiff(moveAngle, this.lastMoveAngle);
          if (diff > IMMERSION.DIRECTION_CHANGE_THRESHOLD) {
            const impulse = IMMERSION.DIRECTION_SWAY_IMPULSE * clamp(diff / Math.PI, 0, 1);
            this.cameraSwayTargetX += Math.cos(moveAngle) * impulse;
            this.cameraSwayTargetY += Math.sin(moveAngle) * impulse;
            const mag = Math.hypot(this.cameraSwayTargetX || 0, this.cameraSwayTargetY || 0);
            if (mag > IMMERSION.DIRECTION_SWAY_MAX) {
              this.cameraSwayTargetX = (this.cameraSwayTargetX / mag) * IMMERSION.DIRECTION_SWAY_MAX;
              this.cameraSwayTargetY = (this.cameraSwayTargetY / mag) * IMMERSION.DIRECTION_SWAY_MAX;
            }
          }
        }
        this.lastMoveAngle = moveAngle;
      }

      const breath = Math.sin(now * 0.0042) * (IMMERSION.BREATH_SWAY * this.terrorBlend + IMMERSION.CHASE_SWAY * this.chaseBlend);
      const desiredX = Math.cos((localData?.angle ?? item.container.rotation) || 0) * breath;
      const desiredY = Math.sin((localData?.angle ?? item.container.rotation) || 0) * breath;
      const dtClamped = clamp(dt || 0, 0, 0.05);
      const targetDecay = 1 - Math.exp(-IMMERSION.DIRECTION_SWAY_TARGET_DECAY * dtClamped);
      this.cameraSwayTargetX = lerp(this.cameraSwayTargetX || 0, desiredX, targetDecay);
      this.cameraSwayTargetY = lerp(this.cameraSwayTargetY || 0, desiredY, targetDecay);
      const swayRate = moving ? IMMERSION.DIRECTION_SWAY_SMOOTHING : IMMERSION.DIRECTION_SWAY_IDLE_SMOOTHING;
      const smooth = 1 - Math.exp(-swayRate * dtClamped);
      this.cameraSwayX = lerp(this.cameraSwayX || 0, this.cameraSwayTargetX || 0, smooth);
      this.cameraSwayY = lerp(this.cameraSwayY || 0, this.cameraSwayTargetY || 0, smooth);

      cam.centerOn(x + this.cameraSwayX, y + this.cameraSwayY);
    }

    getDynamicWorldKey() {
      const map = currentSnapshot?.map || this.map;
      if (!map) return "";
      const hookKey = (map.hooks || []).map((h) => `${h.id}:${h.active ? 1 : 0}:${h.survivorId || ""}`).join("|");
      const gateKey = (map.gates || []).map((g) => `${g.id}:${g.open ? 1 : 0}:${Math.round((g.escapeProgress || 0) * 20)}`).join("|");
      const dotKey = (currentSnapshot?.collectibleDots || []).map((d) => d.id).join(",");
      return `${hookKey}#${gateKey}#${dotKey}`;
    }

    getGeneratorWorldKey() {
      const map = currentSnapshot?.map || this.map;
      if (!map) return "";
      return (map.generators || []).map((g) => {
        const showProgress = g.showProgress !== false ? 1 : 0;
        const repairOn = (g.showRepairFx !== false && (g.repairing || (Array.isArray(g.activeRepairers) && g.activeRepairers.length > 0))) ? 1 : 0;
        const depositOn = (g.showRepairFx !== false && g.dotDepositing) ? 1 : 0;
        const progressStep = showProgress ? Math.round((g.progress || 0) * 50) : 0;
        const depositStep = showProgress ? Math.round((g.dotDepositProgress || 0) * 12) : 0;
        const kickStep = showProgress ? Math.round((g.kickProgress || 0) * 12) : 0;
        return `${g.id}:${showProgress}:${progressStep}:${g.done ? 1 : 0}:${repairOn}:${depositOn}:${depositStep}:${g.beingKicked ? 1 : 0}:${kickStep}:${g.kickLocked ? 1 : 0}`;
      }).join("|");
    }

    maybeDrawDynamicWorld(dt) {
      this.dynamicRedrawTimer += dt;
      const animatingDots = !!this.collectibleDotsAnimating;
      const animatingHooks = (currentSnapshot?.map?.hooks || this.map?.hooks || []).some((hook) => hook && hook.active !== false);
      const animatingGates = (currentSnapshot?.map?.gates || this.map?.gates || []).some((gate) => gate && gate.open);
      const animated = animatingDots || animatingHooks || animatingGates;
      const interval = 1 / (animatingDots ? DOT_FADE_VISUAL.FPS : (animatingHooks || animatingGates) ? 12 : PERFORMANCE.DYNAMIC_WORLD_FPS);
      if (!this.needsDynamicRedraw && !animated && this.dynamicRedrawTimer < interval) return;
      if (this.dynamicRedrawTimer < interval) return;
      const key = this.getDynamicWorldKey();
      if (key !== this.lastDynamicKey || this.needsDynamicRedraw || animated) {
        this.lastDynamicKey = key;
        this.drawDynamicWorld();
      }
      this.needsDynamicRedraw = false;
      this.dynamicRedrawTimer = 0;
    }

    updateGeneratorDepositVisuals(dt) {
      if (!this.generatorDepositVisual) this.generatorDepositVisual = new Map();
      if (!this.generatorDepositLastRaw) this.generatorDepositLastRaw = new Map();
      const generators = currentSnapshot?.map?.generators || this.map?.generators || [];
      const seen = new Set();
      let animating = false;

      for (const gen of generators) {
        seen.add(gen.id);
        const prev = this.generatorDepositVisual.get(gen.id) ?? 0;

        if (!gen.dotDepositing) {
          this.generatorDepositLastRaw.delete(gen.id);
          const holdUntil = this.depositCompleteHold?.get(gen.id) || 0;
          if (holdUntil > performance.now()) {
            this.generatorDepositVisual.set(gen.id, 1);
            animating = true;
            continue;
          }
          this.depositCompleteHold?.delete(gen.id);
          if (prev !== 0) {
            this.generatorDepositVisual.set(gen.id, 0);
            animating = true;
          }
          continue;
        }

        const raw = clamp(gen.dotDepositProgress || 0, 0, 1);
        const lastRaw = this.generatorDepositLastRaw.get(gen.id) ?? 0;

        // Server resets progress to 0 between back-to-back deposits while still in range.
        if (raw < 0.02) {
          this.generatorDepositLastRaw.set(gen.id, 0);
          if (prev !== 0) {
            this.generatorDepositVisual.set(gen.id, 0);
            animating = true;
          }
          continue;
        }

        if (raw + 0.12 < lastRaw) {
          this.generatorDepositVisual.set(gen.id, 0);
        }
        this.generatorDepositLastRaw.set(gen.id, raw);

        const fillTarget = raw >= GENERATOR_VISUAL.DEPOSIT_FULL_SNAP ? 1 : raw;
        let next = this.generatorDepositVisual.get(gen.id) ?? 0;
        if (fillTarget < next) next = fillTarget;
        else next = lerp(next, fillTarget, dampAlpha(GENERATOR_VISUAL.DEPOSIT_PROGRESS_SMOOTHING, dt));
        next = Math.min(1, Math.max(next, fillTarget));
        if (fillTarget >= 1) next = 1;

        if (next < 1 && Math.abs(next - prev) > 0.0004) animating = true;
        this.generatorDepositVisual.set(gen.id, next);
      }

      for (const id of [...this.generatorDepositVisual.keys()]) {
        if (!seen.has(id)) {
          this.generatorDepositVisual.delete(id);
          this.generatorDepositLastRaw.delete(id);
          this.depositCompleteHold?.delete(id);
        }
      }

      return animating;
    }

    maybeDrawGeneratorLayer(dt) {
      const depositAnimating = this.updateGeneratorDepositVisuals(dt);
      const riftVisibilityAnimating = this.updateGeneratorVisionVisuals(dt);
      this.generatorRedrawTimer += dt;
      const interval = 1 / PERFORMANCE.GENERATOR_FPS;

      if (depositAnimating || riftVisibilityAnimating) {
        this.drawGeneratorLayer();
        return;
      }

      if (!this.needsGeneratorRedraw && this.generatorRedrawTimer < interval) return;
      if (this.generatorRedrawTimer < interval) return;
      const key = this.getGeneratorWorldKey();
      if (key !== this.lastGeneratorKey || this.needsGeneratorRedraw) {
        this.lastGeneratorKey = key;
        this.drawGeneratorLayer();
      }
      this.needsGeneratorRedraw = false;
      this.generatorRedrawTimer = 0;
    }

    maybeUpdateScratchGraphics(dt) {
      this.scratchRedrawTimer += dt;
      if (!this.needsScratchRedraw || this.scratchRedrawTimer < 1 / PERFORMANCE.SCRATCH_DRAW_FPS) return;
      this.updateScratchGraphics(this.pendingScratchMarks || []);
      this.needsScratchRedraw = false;
      this.scratchRedrawTimer = 0;
    }

    drawVisionConeGraphic(g, x, y, facing, length, angle, color, alpha, segments = 10) {
      if (!g || alpha <= 0 || length <= 0 || angle <= 0) return;
      const half = angle / 2;
      g.fillStyle(color, alpha);
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const a = facing - half + angle * t;
        // Slightly rounded cone end so it reads like light, not a debug triangle.
        const edgeEase = 0.94 + Math.sin(t * Math.PI) * 0.06;
        g.lineTo(x + Math.cos(a) * length * edgeEase, y + Math.sin(a) * length * edgeEase);
      }
      g.closePath();
      g.fillPath();
    }

    drawLighting(dt = 0) {
      const g = this.flashlightGlowGraphics;
      if (!g) return;
      g.clear();

      const me = this.getCameraSubjectItem();
      if (!me?.container) {
        this.visionConeVisual = null;
        return;
      }

      const role = me.data?.role || "survivor";
      const length = role === "killer" ? LIGHTING.KILLER_LENGTH : LIGHTING.SURVIVOR_LENGTH;
      const angle = role === "killer" ? LIGHTING.KILLER_ANGLE : LIGHTING.SURVIVOR_ANGLE;
      const targetX = me.container.x;
      const targetY = me.container.y;
      const targetFacing = me.container.rotation || 0;
      const nearRadius = role === "killer" ? WALL_VISION.KILLER_NEAR_RADIUS : WALL_VISION.SURVIVOR_NEAR_RADIUS;

      const flicker = 1 - LIGHTING.FLICKER_STRENGTH * 0.22
        + Math.sin(this.lightFlickerPhase) * LIGHTING.FLICKER_STRENGTH * 0.16
        + Math.sin(this.lightFlickerPhase * 2.37) * LIGHTING.FLICKER_STRENGTH * 0.06;

      const targetLength = length * flicker;
      const smooth = dampAlpha(LIGHTING.CONE_VISUAL_SMOOTHING, dt || 1 / 60);
      if (!this.visionConeVisual) {
        this.visionConeVisual = {
          x: targetX,
          y: targetY,
          facing: targetFacing,
          length: targetLength,
          angle
        };
      } else {
        // Anchor the cone to the actor every frame. Only smooth the direction/size.
        // Smoothing x/y made the light look like it inherited camera/WASD drift.
        this.visionConeVisual.x = targetX;
        this.visionConeVisual.y = targetY;
        this.visionConeVisual.facing = lerpAngle(this.visionConeVisual.facing, targetFacing, smooth);
        this.visionConeVisual.length = lerp(this.visionConeVisual.length, targetLength, smooth);
        this.visionConeVisual.angle = lerp(this.visionConeVisual.angle, angle, smooth);
      }

      const vx = targetX;
      const vy = targetY;
      const vfacing = this.visionConeVisual.facing;
      const vlength = this.visionConeVisual.length;
      const vangle = this.visionConeVisual.angle;

      const lightColor = role === "killer" ? 0x9f5cff : 0xa7dcff;
      const coreColor = role === "killer" ? 0x5b21b6 : 0x38bdf8;
      const coneAlpha = role === "killer" ? (LOW_POWER_MODE ? 0.036 : 0.052) : (LOW_POWER_MODE ? 0.044 : 0.066);
      const nearAlpha = role === "killer" ? 0.036 : 0.048;

      // Near bubble keeps close corners readable. Single fill only for cheaper redraws.
      g.fillStyle(coreColor, nearAlpha);
      g.fillCircle(vx, vy, nearRadius * 0.82);

      // One cone only. The previous feather pass looked smoother, but doubled the Graphics work
      // during movement/zoom and caused noticeable hitches on weaker browsers.
      const segments = LIGHTING.CONE_SEGMENTS;
      this.drawVisionConeGraphic(g, vx, vy, vfacing, vlength, vangle, lightColor, coneAlpha, segments);
    }

    drawHookIndicators() {
      const g = this.hookIndicatorGraphics;
      if (!g) return;
      g.clear();
      if (!currentSnapshot || !this.actors.has(myId)) return;

      const me = this.getPovSurvivorData();
      if (!me || me.role !== "survivor" || me.dead || me.escaped) return;

      const now = performance.now();
      this.recentHookIndicators = (this.recentHookIndicators || []).filter((h) => h.until > now);

      const hookedSurvivors = (currentSnapshot.actors || [])
        .filter((actor) => {
          return actor.role === "survivor"
            && actor.id !== myId
            && actor.hooked
            && !actor.dead
            && !actor.escaped
            && Number.isFinite(actor.x)
            && Number.isFinite(actor.y);
        })
        .map((actor) => ({ ...actor, source: "snapshot" }));

      const ids = new Set(hookedSurvivors.map((actor) => actor.id || actor.survivorId));
      for (const recent of this.recentHookIndicators || []) {
        if (recent.survivorId === myId || ids.has(recent.survivorId)) continue;
        hookedSurvivors.push({ ...recent, role: "survivor", hooked: true, source: "event" });
      }

      if (!hookedSurvivors.length) return;

      const cam = this.cameras.main;
      const viewW = cam.width;
      const viewH = cam.height;
      const centerX = viewW / 2;
      const centerY = viewH / 2;
      const edgePadding = HOOK_INDICATOR.EDGE_PADDING;
      const onScreenPadding = HOOK_INDICATOR.ON_SCREEN_PADDING;
      const pulse = 0.5 + Math.sin(performance.now() * 0.008) * 0.5;

      for (const actor of hookedSurvivors) {
        const screenX = (actor.x - cam.scrollX) * cam.zoom;
        const screenY = (actor.y - cam.scrollY) * cam.zoom;

        const clearlyOnScreen = screenX > onScreenPadding
          && screenX < viewW - onScreenPadding
          && screenY > onScreenPadding
          && screenY < viewH - onScreenPadding;
        if (clearlyOnScreen) continue;

        let dx = screenX - centerX;
        let dy = screenY - centerY;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;

        const halfW = Math.max(1, centerX - edgePadding);
        const halfH = Math.max(1, centerY - edgePadding);
        const scale = Math.min(
          Math.abs(dx) > 0.0001 ? halfW / Math.abs(dx) : Infinity,
          Math.abs(dy) > 0.0001 ? halfH / Math.abs(dy) : Infinity
        );

        const x = centerX + dx * scale;
        const y = centerY + dy * scale;
        const danger = (actor.hookCount || 1) >= 2;
        const mainColor = danger ? 0xff2222 : 0xff3030;
        const ringAlpha = danger ? 0.82 : 0.68;
        const r = HOOK_INDICATOR.RADIUS + pulse * HOOK_INDICATOR.PULSE;

        // Direction pointer, slightly outside the bubble.
        const arrowX = x + dx * 24;
        const arrowY = y + dy * 24;
        const tangentX = -dy;
        const tangentY = dx;
        g.fillStyle(mainColor, HOOK_INDICATOR.ARROW_ALPHA);
        g.fillTriangle(
          arrowX + dx * 10,
          arrowY + dy * 10,
          arrowX - dx * 8 + tangentX * 7,
          arrowY - dy * 8 + tangentY * 7,
          arrowX - dx * 8 - tangentX * 7,
          arrowY - dy * 8 - tangentY * 7
        );

        g.fillStyle(0x120807, HOOK_INDICATOR.FILL_ALPHA);
        g.fillCircle(x, y, HOOK_INDICATOR.RADIUS - 4);
        g.lineStyle(3, mainColor, ringAlpha * HOOK_INDICATOR.LINE_ALPHA);
        g.strokeCircle(x, y, r);
        g.lineStyle(1, 0xffffff, 0.22);
        g.strokeCircle(x, y, 15);

        // Red exclamation marker. No hook glyph, no prop, just "someone is in trouble".
        g.lineStyle(5, 0xff3030, 0.98);
        g.beginPath();
        g.moveTo(x, y - 12);
        g.lineTo(x, y + 4);
        g.strokePath();
        g.fillStyle(0xff3030, 0.98);
        g.fillCircle(x, y + 12, 3.7);
      }
    }

    getChatWheelRole() {
      const me = this.actors.get(myId)?.data;
      return me?.role === "killer" ? "killer" : "survivor";
    }

    getChatWheelMessages() {
      const me = this.actors.get(myId)?.data;
      if (me?.role === "killer") return CHAT_WHEEL.MESSAGES.killer;

      const survivorMessages = CHAT_WHEEL.MESSAGES.survivor;
      const state = this.getSurvivorChatState(me);
      return survivorMessages[state] || survivorMessages.normal;
    }

    getSurvivorChatState(actor) {
      if (!actor || actor.role !== "survivor") return "normal";
      if (actor.hooked) return "hooked";
      if (actor.downed || actor.health <= 0) return "downed";
      if (actor.chase) return "chase";
      if (actor.injured || actor.health <= 1) return "injured";
      return "normal";
    }

    openChatWheel() {
      if (!currentSnapshot || !this.actors.has(myId)) return;
      this.chatWheelOpen = true;
      this.chatWheelSelected = -1;
      this.updateChatWheelSelection();
    }

    closeChatWheel(submit = true) {
      if (!this.chatWheelOpen) return;
      this.updateChatWheelSelection();
      const selected = this.chatWheelSelected;
      this.chatWheelOpen = false;
      this.chatWheelSelected = -1;
      this.chatWheelGraphics?.clear();
      for (const label of this.chatWheelLabels || []) label.setVisible(false);
      if (submit && selected >= 0 && socket && currentSnapshot?.phase === "game") {
        socket.emit("chatWheel", { index: selected });
      }
    }

    updateChatWheelSelection() {
      if (!this.chatWheelOpen) return -1;
      const cam = this.cameras.main;
      const pointer = this.input.activePointer;
      const cx = cam.width / 2;
      const cy = cam.height / 2;
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < CHAT_WHEEL.INNER_RADIUS) {
        this.chatWheelSelected = -1;
        return -1;
      }
      const angle = Math.atan2(dy, dx);
      // 0 = top, 1 = right, 2 = bottom, 3 = left.
      let selected = 0;
      if (angle >= -Math.PI * 0.25 && angle < Math.PI * 0.25) selected = 1;
      else if (angle >= Math.PI * 0.25 && angle < Math.PI * 0.75) selected = 2;
      else if (angle <= -Math.PI * 0.25 && angle > -Math.PI * 0.75) selected = 0;
      else selected = 3;
      this.chatWheelSelected = selected;
      return selected;
    }

    drawChatWheel() {
      const g = this.chatWheelGraphics;
      if (!g) return;
      if (!this.chatWheelOpen || !currentSnapshot || currentSnapshot.phase !== "game") {
        g.clear();
        for (const label of this.chatWheelLabels || []) label.setVisible(false);
        return;
      }

      this.updateChatWheelSelection();
      const messages = this.getChatWheelMessages();
      const cam = this.cameras.main;
      const cx = cam.width / 2;
      const cy = cam.height / 2;
      const r = CHAT_WHEEL.RADIUS;
      const inner = CHAT_WHEEL.INNER_RADIUS;
      const selected = this.chatWheelSelected;
      const wheelColor = this.getChatWheelRole() === "killer" ? 0x7a1010 : 0x131927;
      const selectedColor = this.getChatWheelRole() === "killer" ? 0xff3b3b : 0xffd15c;

      g.clear();
      g.fillStyle(0x050505, 0.34);
      g.fillRect(0, 0, cam.width, cam.height);

      // Segment order: top, right, bottom, left. Draw as fat pie slices.
      const segments = [
        { start: -Math.PI * 0.75, end: -Math.PI * 0.25, lx: 0, ly: -1 },
        { start: -Math.PI * 0.25, end: Math.PI * 0.25, lx: 1, ly: 0 },
        { start: Math.PI * 0.25, end: Math.PI * 0.75, lx: 0, ly: 1 },
        { start: Math.PI * 0.75, end: Math.PI * 1.25, lx: -1, ly: 0 }
      ];

      segments.forEach((seg, i) => {
        const isSelected = i === selected;
        g.fillStyle(isSelected ? selectedColor : wheelColor, isSelected ? CHAT_WHEEL.SELECTED_ALPHA : CHAT_WHEEL.SEGMENT_ALPHA);
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, r, seg.start, seg.end, false);
        g.closePath();
        g.fillPath();
        g.lineStyle(2, isSelected ? 0xfff3d0 : 0xffffff, isSelected ? 0.74 : 0.15);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(seg.start) * r, cy + Math.sin(seg.start) * r);
        g.arc(cx, cy, r, seg.start, seg.end, false);
        g.lineTo(cx, cy);
        g.strokePath();
      });

      g.fillStyle(0x070707, CHAT_WHEEL.CENTER_ALPHA);
      g.fillCircle(cx, cy, inner);
      g.lineStyle(3, selected >= 0 ? selectedColor : 0xffffff, selected >= 0 ? 0.78 : 0.24);
      g.strokeCircle(cx, cy, r);
      g.lineStyle(2, 0xffffff, 0.18);
      g.strokeCircle(cx, cy, inner);

      const labelPositions = [
        { x: cx, y: cy - CHAT_WHEEL.LABEL_RADIUS },
        { x: cx + CHAT_WHEEL.LABEL_RADIUS, y: cy },
        { x: cx, y: cy + CHAT_WHEEL.LABEL_RADIUS },
        { x: cx - CHAT_WHEEL.LABEL_RADIUS, y: cy }
      ];
      for (let i = 0; i < 4; i++) {
        const label = this.chatWheelLabels[i];
        label.setText(messages[i] || "");
        label.setPosition(labelPositions[i].x, labelPositions[i].y);
        label.setAlpha(i === selected ? 1 : 0.66);
        label.setVisible(true);
      }
    }

    updateParticles(dt) {
      const g = this.particleGraphics;
      g.clear();
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const wave = this.shockwaves[i];
        wave.life += dt;
        if (wave.life >= wave.ttl) {
          this.shockwaves.splice(i, 1);
          continue;
        }
        const t = wave.life / wave.ttl;
        const radius = wave.radius + t * (wave.maxRadius || 120);
        g.lineStyle(3, wave.color, (1 - t) * (wave.alpha ?? 0.62));
        g.strokeCircle(wave.x, wave.y, radius);
        g.lineStyle(1, 0xffffff, (1 - t) * 0.24);
        g.strokeCircle(wave.x, wave.y, radius * 0.68);
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life += dt;
        if (p.life >= p.ttl) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.9;
        p.vy *= 0.9;
        const alpha = 1 - p.life / p.ttl;
        g.fillStyle(p.color, alpha);
        g.fillCircle(p.x, p.y, p.size * alpha);
      }
    }
  }

  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function bootPhaser() {
    if (typeof Phaser === "undefined") {
      toast("Phaser failed to load. Run npm install so /vendor/phaser.min.js exists.", 5000);
      return;
    }
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "gameWrap",
      backgroundColor: "#03040a",
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: window.innerWidth,
        height: window.innerHeight
      },
      resolution: RENDER_RESOLUTION,
      render: {
        antialias: false,
        pixelArt: false,
        roundPixels: LOW_POWER_MODE,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
        clearBeforeRender: true
      },
      fps: {
        target: 60,
        min: LOW_POWER_MODE ? 24 : 30,
        forceSetTimeOut: false
      },
      scene: [GameScene]
    });
    window.__surviveIoGame = game;
  }

  let uiClickSfxBound = false;

  function setupUiClickSfx() {
    if (uiClickSfxBound) return;
    uiClickSfxBound = true;

    document.addEventListener("click", (event) => {
      const target = event.target?.closest?.("button, a");
      if (!target) return;
      if (target.disabled || target.getAttribute("aria-disabled") === "true") return;

      // Only UI screens get button click sounds. This avoids mobile gameplay controls
      // and in-match canvas clicks triggering menu audio like an overeager vending machine.
      const screen = target.closest(".screen");
      if (!screen || !screen.classList.contains("screen-open")) return;

      playSfx("buttonClick");
    }, true);
  }

  function showEscapedScreen() {
    if (ui.winnerText) ui.winnerText.textContent = "You Escaped";
    if (ui.reasonText) ui.reasonText.textContent = "You slipped through the void. The match is still going.";
    ui.spectateBtn?.classList.remove("hidden");
    if (ui.backToLobbyBtn) ui.backToLobbyBtn.textContent = "Back To Lobby";
    showScreen("end");
  }

  function showSpectateResultScreen() {
    const me = getLocalPlayerData();
    const isSurvivor = me?.role === "survivor";
    if (!isSurvivor) return false;

    if (me.escaped) {
      showEscapedScreen();
      return true;
    }

    if (me.dead || me.hooked || me.downed || Number(me.health || 0) <= 0) {
      if (ui.winnerText) ui.winnerText.textContent = "You Perished...";
      if (ui.reasonText) ui.reasonText.textContent = "The match is still going. You can keep spectating.";
      ui.spectateBtn?.classList.remove("hidden");
      if (ui.backToLobbyBtn) ui.backToLobbyBtn.textContent = "Back To Lobby";
      showScreen("end");
      return true;
    }

    return false;
  }

  function getFinalActorData(finalActors = []) {
    const fromEvent = (finalActors || []).find((a) => a.id === myId);
    return fromEvent || getLocalPlayerData();
  }

  function showFinalMatchScreen({ winner, reason, escapedCount = 0, finalActors = [] }) {
    const me = getFinalActorData(finalActors);
    const localSurvivor = me?.role === "survivor";
    const localEscaped = localSurvivor && !!me.escaped;
    const localPerished = localSurvivor && !localEscaped && !!escapedCount && (me.dead || me.hooked || me.downed);

    ui.spectateBtn?.classList.add("hidden");

    if (localEscaped) {
      if (ui.winnerText) ui.winnerText.textContent = "You Escaped";
      if (ui.reasonText) ui.reasonText.textContent = "You slipped through the void. The trial is over.";
    } else if (localPerished) {
      if (ui.winnerText) ui.winnerText.textContent = "You Perished...";
      if (ui.reasonText) ui.reasonText.textContent = "The others escaped, but The Void claimed you.";
    } else {
      if (ui.winnerText) ui.winnerText.textContent = winner === "killer" ? "The Void Wins" : "Survivors Win";
      if (ui.reasonText) ui.reasonText.textContent = reason || "Match ended.";
    }

    if (ui.backToLobbyBtn) ui.backToLobbyBtn.textContent = "Back To Lobby";
    showScreen("end");
  }

  function setupUI() {
    setupUiClickSfx();
    syncMenuMusicToggleUi();
    const bindMenuMusicToggle = (btn) => {
      btn?.addEventListener("click", () => {
        ensureMenuAudioStarted();
        toggleMenuMusicMuted();
      });
    };
    bindMenuMusicToggle(ui.menuMusicToggleBtn);
    bindMenuMusicToggle(ui.menuMusicToggleBtnOptions);
    bindMenuMusicVolumeSlider(ui.menuMusicVolumeSlider);
    syncMenuMusicVolumeUi();

    ui.menuPlayBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("play"); });
    ui.menuSkinsBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("skins"); });
    ui.menuOptionsBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("options"); });
    ui.menuHowBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("how"); });
    ui.menuBackBtns?.forEach((btn) => {
      btn.addEventListener("click", () => showScreen(btn.dataset.screen || "menu"));
    });

    ui.roleBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedRole = btn.dataset.role;
        ui.roleBtns.forEach((b) => b.classList.toggle("selected", b === btn));
      });
    });

    ui.skinBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        setSelectedSkin(btn.dataset.skin || "blueSquare");
        const mine = currentLobbyState?.players?.find((p) => p.id === myId);
        if (socket && mine?.role === "survivor") {
          socket.emit("setSkin", { skin: selectedSkin });
        }
      });
    });

    ui.quickJoinBtn.addEventListener("click", () => socket.emit("quickJoin", { role: selectedRole, playerName: getName(), skin: selectedSkin }));
    ui.createLobbyBtn.addEventListener("click", () => socket.emit("createLobby", { role: selectedRole, playerName: getName(), skin: selectedSkin }));
    ui.beSurvivorBtn.addEventListener("click", () => socket.emit("setRole", { role: "survivor", skin: selectedSkin }));
    ui.beKillerBtn.addEventListener("click", () => socket.emit("setRole", { role: "killer" }));
    ui.readyBtn.addEventListener("click", () => {
      const mine = currentLobbyState?.players?.find((p) => p.id === myId);
      socket.emit("setReady", { ready: !mine?.ready });
    });
    ui.addBotSurvivorBtn.addEventListener("click", () => socket.emit("addBot", { role: "survivor" }));
    ui.addBotKillerBtn.addEventListener("click", () => socket.emit("addBot", { role: "killer" }));
    ui.startBtn.addEventListener("click", () => socket.emit("startGame"));
    ui.leaveBtn.addEventListener("click", () => {
      socket.emit("leaveLobby");
      showScreen("menu");
    });
    ui.backToLobbyBtn.addEventListener("click", () => {
      socket.emit("backToLobby");
      showScreen("lobby");
    });
    ui.spectateBtn?.addEventListener("click", () => {
      showScreen("game");
      ensureAudioStarted();
      phaserScene?.pickDefaultSpectateTarget?.();
    });
    ui.mainMenuBtn.addEventListener("click", () => {
      socket.emit("leaveLobby");
      showScreen("menu");
    });
  }

  function renderLobbyList(lobbies) {
    if (!lobbies || !lobbies.length) {
      ui.lobbyList.className = "lobby-list empty";
      ui.lobbyList.textContent = "No open lobbies yet.";
      return;
    }
    ui.lobbyList.className = "lobby-list";
    ui.lobbyList.innerHTML = "";
    for (const lobby of lobbies) {
      const item = document.createElement("div");
      item.className = "lobby-item";
      const left = document.createElement("div");
      left.innerHTML = `<strong>${escapeHtml(lobby.name)}</strong><small>${escapeHtml(lobby.mapName || "Map")} • ${lobby.survivors}/${lobby.maxSurvivors} Survivors • ${lobby.killer ? "Void claimed" : "Void open"}</small>`;
      const button = document.createElement("button");
      button.textContent = lobby.phase === "lobby" ? "Join" : "In Match";
      button.disabled = lobby.phase !== "lobby";
      button.addEventListener("click", () => socket.emit("joinLobby", { lobbyId: lobby.id, role: selectedRole, playerName: getName() }));
      item.append(left, button);
      ui.lobbyList.appendChild(item);
    }
  }

  function renderLobbyState(state) {
    currentLobbyState = state;
    ui.lobbyTitle.textContent = state.name || "Lobby";
    ui.playersList.innerHTML = "";
    for (const player of state.players || []) {
      const item = document.createElement("div");
      item.className = "player-item";
      const skin = player.role === "survivor" ? getSurvivorSkin(player.skin).label : "Void Core";
      const displayRole = player.role === "killer" ? "The Void" : "Survivor";
      item.innerHTML = `<div><strong>${escapeHtml(player.name)}${player.id === myId ? " (You)" : ""}</strong><small>${displayRole}${player.isBot ? " bot" : ""} • ${escapeHtml(skin)}</small></div><small>${player.ready ? "Ready" : "Not ready"}</small>`;
      ui.playersList.appendChild(item);
    }
    const mine = state.players?.find((p) => p.id === myId);
    if (mine?.role === "survivor" && SURVIVOR_SKINS[mine.skin]) {
      setSelectedSkin(mine.skin);
    }
    ui.readyBtn.textContent = mine?.ready ? "Unready" : "Ready";
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[ch]));
  }

  function isEditableTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || "").toLowerCase();
    return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
  }

  function clearHeldGameplayInput() {
    input.up = false;
    input.down = false;
    input.left = false;
    input.right = false;
    input.sprint = false;
    input.repair = false;
    input.attackHeld = false;
    phaserScene?.closeChatWheel(false);
  }

  function setupKeyboard() {
    window.addEventListener("focusin", (e) => {
      if (isEditableTarget(e.target)) {
        clearHeldGameplayInput();
        sendInput({}, true);
      }
    });

    window.addEventListener("keydown", (e) => {
      if (isEditableTarget(e.target)) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
      ensureAudioStarted();
      if (e.code === "KeyR") {
        e.preventDefault();
        phaserScene?.openChatWheel();
        return;
      }
      if (e.code === "Escape" && activeScreenName === "game" && phaserScene?.isSpectating()) {
        e.preventDefault();
        if (showSpectateResultScreen()) return;
      }
      if (e.code === "Tab" && phaserScene?.isSpectating()) {
        e.preventDefault();
        phaserScene.cycleSpectateTarget(e.shiftKey ? -1 : 1);
        return;
      }
      const was = JSON.stringify(inputPayload());
      if (e.code === "KeyW" || e.code === "ArrowUp") input.up = true;
      if (e.code === "KeyS" || e.code === "ArrowDown") input.down = true;
      if (e.code === "KeyA" || e.code === "ArrowLeft") input.left = true;
      if (e.code === "KeyD" || e.code === "ArrowRight") input.right = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.sprint = true;
      if (e.code === "KeyE") input.repair = true;
      if (e.code === "Space" && !e.repeat) sendInput({ action: true }, true);
      if (was !== JSON.stringify(inputPayload())) sendInput({}, true);
    }, { passive: false });

    window.addEventListener("keyup", (e) => {
      if (isEditableTarget(e.target)) return;
      if (e.code === "KeyW" || e.code === "ArrowUp") input.up = false;
      if (e.code === "KeyS" || e.code === "ArrowDown") input.down = false;
      if (e.code === "KeyA" || e.code === "ArrowLeft") input.left = false;
      if (e.code === "KeyD" || e.code === "ArrowRight") input.right = false;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.sprint = false;
      if (e.code === "KeyE") input.repair = false;
      if (e.code === "KeyR") {
        e.preventDefault();
        phaserScene?.closeChatWheel(true);
        return;
      }
      sendInput({}, true);
    });
  }


  function setupMobileControls() {
    const controls = document.getElementById("mobileControls");
    if (!controls) return;
    controls.classList.toggle("hidden", !IS_TOUCH_DEVICE);

    const stickBase = controls.querySelector(".mobile-stick-base");
    const stickKnob = controls.querySelector(".mobile-stick-knob");
    const buttons = [...controls.querySelectorAll("[data-mobile-action]")];
    let stickPointerId = null;
    let stickOrigin = { x: 0, y: 0 };

    function sendTouchInput(immediate = true) {
      ensureAudioStarted();
      sendInput({}, immediate);
    }

    function resetStick() {
      stickPointerId = null;
      input.up = false;
      input.down = false;
      input.left = false;
      input.right = false;
      if (stickKnob) stickKnob.style.transform = "translate(-50%, -50%)";
      sendTouchInput(true);
    }

    function updateStick(clientX, clientY) {
      const dx = clientX - stickOrigin.x;
      const dy = clientY - stickOrigin.y;
      const max = 46;
      const len = Math.hypot(dx, dy);
      const dead = 10;
      const nx = len > max ? (dx / len) * max : dx;
      const ny = len > max ? (dy / len) * max : dy;

      if (stickKnob) stickKnob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;

      input.left = dx < -dead;
      input.right = dx > dead;
      input.up = dy < -dead;
      input.down = dy > dead;
      sendTouchInput(false);
    }

    if (stickBase) {
      stickBase.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        stickPointerId = e.pointerId;
        stickBase.setPointerCapture?.(e.pointerId);
        const rect = stickBase.getBoundingClientRect();
        stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        updateStick(e.clientX, e.clientY);
      }, { passive: false });

      stickBase.addEventListener("pointermove", (e) => {
        if (e.pointerId !== stickPointerId) return;
        e.preventDefault();
        updateStick(e.clientX, e.clientY);
      }, { passive: false });

      stickBase.addEventListener("pointerup", (e) => {
        if (e.pointerId === stickPointerId) resetStick();
      });
      stickBase.addEventListener("pointercancel", (e) => {
        if (e.pointerId === stickPointerId) resetStick();
      });
    }

    for (const button of buttons) {
      const action = button.dataset.mobileAction;
      button.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        button.setPointerCapture?.(e.pointerId);
        ensureAudioStarted();
        if (action === "sprint") input.sprint = true;
        if (action === "interact") input.repair = true;
        if (action === "action") sendInput({ action: true }, true);
        if (action === "attack") {
          input.attackHeld = true;
          sendInput({}, true);
        }
        if (action === "chat") phaserScene?.openChatWheel();
        sendTouchInput(true);
      }, { passive: false });

      const release = (e) => {
        e.preventDefault?.();
        if (action === "sprint") input.sprint = false;
        if (action === "interact") input.repair = false;
        if (action === "attack" && input.attackHeld) {
          input.attackHeld = false;
          sendInput({ attackReleased: true }, true);
          return;
        }
        if (action === "chat") {
          phaserScene?.closeChatWheel(true);
          return;
        }
        sendTouchInput(true);
      };

      button.addEventListener("pointerup", release, { passive: false });
      button.addEventListener("pointercancel", release, { passive: false });
    }
  }

  function setupSockets() {
    socket = io();
    socket.on("hello", ({ id }) => { myId = id; });
    socket.on("toast", ({ message }) => toast(message));
    socket.on("lobbyList", renderLobbyList);
    socket.on("joinedLobby", () => showScreen("lobby"));
    socket.on("lobbyState", renderLobbyState);
    socket.on("gameStarted", (map) => {
      currentSnapshot = null;
      let lockSeconds = Number(map?.startFreezeSeconds || IMMERSION.MATCH_START_LOCK_SECONDS || 1.5);
      if (!Number.isFinite(lockSeconds) || lockSeconds < 0) lockSeconds = IMMERSION.MATCH_START_LOCK_SECONDS || 1.5;
      if (phaserScene) {
        phaserScene.spawnInPlayed = false;
        phaserScene.spawnInPulse = 0;
        phaserScene.spawnInAt = 0;
        phaserScene.localEscapeScreenShown = false;
        phaserScene.matchStartFreezeRemaining = Math.max(0, lockSeconds);
        phaserScene.matchStartFreezeDuration = Math.max(0.001, lockSeconds);
        phaserScene.matchStartZoomUntil = performance.now() + Math.max(0, lockSeconds) * 1000;
        phaserScene.loadMap(map);
        const introZoom = Math.max(0.34, IMMERSION.BASE_ZOOM - IMMERSION.MATCH_START_ZOOM_OUT);
        phaserScene.cameras?.main?.setZoom(introZoom);
      }

      runMatchStartTransition(() => {
        showScreen("game");
        ensureAudioStarted();
      });
    });
    socket.on("snapshot", (snapshot) => {
      if (snapshot?.seq && currentSnapshot?.seq && snapshot.seq <= currentSnapshot.seq) return;
      currentSnapshot = snapshot;
      if (phaserScene) phaserScene.applySnapshot(snapshot);
    });
    socket.on("matchEnded", ({ winner, reason, escapedCount = 0, totalSurvivors = 0, finalActors = [] }) => {
      if (phaserScene) {
        phaserScene.spectateTargetId = null;
        phaserScene.lastSpectateEmitId = "";
      }
      setMusicTargets({ layer1: 0, layer2: 0, layer3: 0 });
      showFinalMatchScreen({ winner, reason, escapedCount, totalSurvivors, finalActors });
    });
  }

  function start() {
    setupAudio();
    setupUI();
    setupKeyboard();
    setupMobileControls();
    setupSockets();
    bootPhaser();
    showScreen("menu");

    const unlockAudio = () => {
      ensureAudioStarted();
      ensureMenuAudioStarted();
    };
    document.addEventListener("pointerdown", unlockAudio, { once: true });
    document.addEventListener("keydown", unlockAudio, { once: true });
    document.addEventListener("touchstart", unlockAudio, { once: true, passive: true });
  }

  start();
})();
