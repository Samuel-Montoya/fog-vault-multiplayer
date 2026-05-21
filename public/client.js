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
      menu: "/sfx/menu.mp3",
      layers: ["/sfx/layer_1.mp3", "/sfx/layer_2.mp3", "/sfx/layer_3.mp3"],
      // Layer 3 stays normal unless the local survivor is injured.
      // Deposit pitch is separate and always ramps upward.
      layer3NormalPlaybackRate: 1.0,
      layer3InjuredPlaybackRate: 1.12
    },
    sfx: {
      master: 0.72,
      // Controls randomized pitch variation for SFX listed in pitchSteps.
      // Add any SFX key to pitchSteps and playSfx(name) will automatically use it.
      // Orb pickup and deposit pitch are intentionally separate and ramp from carried counts.
      enablePitchVariation: true,
      orbPickupPitch: { min: 1.0, max: 1.45, countMax: 10 },
      files: {
        hooked: "/sfx/hooked.mp3",
        dead: "/sfx/dead.mp3",
        gen: "/sfx/gen.mp3",
        riftsComplete: "/sfx/rifts_complete.mp3",
        swing: "/sfx/swing.ogg",
        windowVault: "/sfx/window_vault.ogg",
        palletVault: "/sfx/pallet_vault.ogg",
        palletDrop: "/sfx/pallet_drop.mp3",
        voidStun: "/sfx/void_stun.mp3",
        palletStun: "/sfx/void_stun.mp3",
        injured: "/sfx/injured.ogg",
        orbPickup: "/sfx/orb_pickup.mp3",
        orbDeposit: "/sfx/orb_deposit.mp3",
        buttonClick: "/sfx/button_click.mp3",
        playerSpeak: "/sfx/player_speak.mp3",
        healing: "/sfx/healing.mp3",
        unhooking: ["/sfx/unhooking.mp3", "/sfx/unhook.mp3"]
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
        voidStun: 0.82,
        palletStun: 0.82,
        injured: 0.8,
        orbPickup: 0.68,
        orbDeposit: 0.72,
        buttonClick: 0.55,
        playerSpeak: 0.62,
        healing: 0.34,
        unhooking: 0.44
      },
      pitchSteps: {
        hooked: [0.84, 0.92, 1.0, 1.09, 1.18, 1.28],
        orbPickup: [0.92, 0.98, 1.03, 1.09, 1.16, 1.24],
        swing: [0.9, 0.96, 1.0, 1.08, 1.16, 1.25, 1.34],
        windowVault: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
        palletDrop: [0.86, 0.94, 1.0, 1.08, 1.17, 1.26],
        voidStun: [0.78, 0.86, 0.94, 1.0, 1.08],
        palletStun: [0.78, 0.86, 0.94, 1.0, 1.08],
        buttonClick: [0.92, 0.97, 1.0, 1.05, 1.11, 1.18],
        playerSpeak: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
        healing: [1.0],
        unhooking: [0.96, 1.0, 1.04]
      },
      localRange: {
        swing: 315,
        hit: 440,
        palletStun: 300,
        voidStun: 360,
        healing: 340,
        unhooking: 0
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
    VOID_REVEAL_ZOOM: cameraNumber("voidRevealZoom", "lowPowerVoidRevealZoom", LOW_POWER_MODE ? -0.26 : -0.38),

    SPAWN_ZOOM: cameraNumber("spawnPopZoom", "lowPowerSpawnPopZoom", LOW_POWER_MODE ? 0.10 : 0.18),
    SPAWN_ZOOM_DECAY: cameraNumber("spawnPopZoomDecay", "lowPowerSpawnPopZoomDecay", LOW_POWER_MODE ? 4.2 : 5.6),
    MATCH_START_LOCK_SECONDS: cfgNumber(GAMEPLAY_CONFIG.match?.startFreezeSeconds, 1.5),
    MATCH_START_ZOOM_OUT: cameraNumber("matchStartZoomOut", "lowPowerMatchStartZoomOut", LOW_POWER_MODE ? 0.22 : 0.36),
    MATCH_START_ZOOM_SMOOTHING: cameraNumber("matchStartZoomSmoothing", "lowPowerMatchStartZoomSmoothing", LOW_POWER_MODE ? 2.2 : 3.0),
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
  const SURVIVOR_VAULT_TIME = cfgNumber(GAMEPLAY_CONFIG.survivor?.vaultTime, 0.38);
  const KILLER_VAULT_TIME = cfgNumber(GAMEPLAY_CONFIG.void?.vaultTime, 1.05);

  function vaultEase(t) {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  }

  function vaultDurationForRole(role) {
    return role === "killer" ? KILLER_VAULT_TIME : SURVIVOR_VAULT_TIME;
  }

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

  const ACTOR_VISION = {
    POINT_RADIUS: 18,
    FADE_IN_PER_SECOND: LOW_POWER_MODE ? 7.5 : 11,
    FADE_OUT_PER_SECOND: LOW_POWER_MODE ? 3.4 : 4.6,
    MIN_VISIBLE_ALPHA: 0.02,
    NAME_CHAT_ALPHA: 0.14
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
    // Survivor-only React edge indicator for hooked teammates.
    // These are screen-space values, so camera zoom cannot shove them off-screen.
    EDGE_PADDING: 64,
    ON_SCREEN_PADDING: 96,
    POSITION_ROUNDING: 1
  };

  const VOID_STUN_SECONDS = cfgNumber(GAMEPLAY_CONFIG.pallet?.voidStunSeconds, 1.0);

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


  const SHARED_CHATS = window.RIFTRUNNER_CHATS || {};
  const SHARED_ABILITIES = window.RIFTRUNNER_ABILITIES || {};
  const VOID_ABILITIES = SHARED_ABILITIES.abilities || {};
  const VOID_ABILITY_ORDER = Array.isArray(SHARED_ABILITIES.wheelOrder) ? SHARED_ABILITIES.wheelOrder : Object.keys(VOID_ABILITIES);
  const CHAT_AUTOMATIC = SHARED_CHATS.automatic || {};
  const ORB_FULL_CHAT_MESSAGES = new Set(CHAT_AUTOMATIC.orbFull || [
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
      label: "Night Moth",
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

  // In-match radial chat. React renders the wheel; the shared chat file keeps
  // client labels and server-sent bubbles in lockstep.
  const CHAT_WHEEL_MESSAGES = SHARED_CHATS.chatWheel || {
    survivor: {
      normal: ["Feed this rift.", "Stay close.", "Void nearby.", "I heard something."],
      chase: ["Void on me.", "Keep moving!", "I need distance.", "Do not come here."],
      injured: ["I need healing.", "Hold still near me.", "I need cover.", "Over here."],
      downed: ["Pick me up.", "I need help.", "I am down.", "Not ideal."],
      hooked: ["Get me down.", "I need a rescue.", "Void is close.", "Hurry."]
    },
    killer: ["I hear you.", "Run while you can.", "The dark is moving.", "You are close."]
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
    lobbySkinPicker: document.querySelector(".lobby-skin-picker"),
    quickJoinBtn: document.getElementById("quickJoinBtn"),
    createLobbyBtn: document.getElementById("createLobbyBtn"),
    lobbyList: document.getElementById("lobbyList"),
    lobbyTitle: document.getElementById("lobbyTitle"),
    lobbyRoleMark: document.getElementById("lobbyRoleMark"),
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
    endStats: document.getElementById("endStats"),
    backToLobbyBtn: document.getElementById("backToLobbyBtn"),
    spectateBtn: document.getElementById("spectateBtn"),
    mainMenuBtn: document.getElementById("mainMenuBtn"),
    mobileControls: document.getElementById("mobileControls")
  };

  function ensureFpsCounter() {
    if (ui.fpsText) return ui.fpsText;
    const existing = document.getElementById("fpsText");
    if (existing) {
      ui.fpsText = existing;
      return existing;
    }

    const card = document.getElementById("roleHudCard") || document.querySelector(".role-hud-card");
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

  let survivorHitImpactTimer = null;

  function triggerSurvivorHitImpact(heavy = false) {
    const body = document.body;
    if (!body) return;

    clearTimeout(survivorHitImpactTimer);
    body.classList.remove("survivor-hit-impact", "survivor-hit-heavy");

    // Restart the impact animation for rapid back-to-back hits. It only runs on hits,
    // so this tiny forced reflow is cheaper than making every frame do interpretive dance.
    void body.offsetWidth;

    if (heavy) body.classList.add("survivor-hit-heavy");
    body.classList.add("survivor-hit-impact");

    survivorHitImpactTimer = window.setTimeout(() => {
      body.classList.remove("survivor-hit-impact", "survivor-hit-heavy");
    }, heavy ? 640 : 460);
  }

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

  function setSelectedRole(role) {
    selectedRole = role === "killer" ? "killer" : "survivor";
    ui.roleBtns.forEach((b) => b.classList.toggle("selected", b.dataset.role === selectedRole));
    ui.beKillerBtn?.classList.toggle("selected", selectedRole === "killer");
    ui.beSurvivorBtn?.classList.toggle("selected", selectedRole !== "killer");
    ui.lobbySkinPicker?.classList.toggle("hidden", selectedRole === "killer");
    ui.lobbySkinPicker?.setAttribute("aria-hidden", selectedRole === "killer" ? "true" : "false");
    if (ui.lobbyRoleMark) {
      ui.lobbyRoleMark.classList.toggle("killer", selectedRole === "killer");
      ui.lobbyRoleMark.classList.toggle("survivor", selectedRole !== "killer");
      ui.lobbyRoleMark.setAttribute("aria-label", selectedRole === "killer" ? "Playing as The Void" : "Playing as Runner");
    }
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

  function introLockSecondsRemaining() {
    if (activeScreenName !== "game" || !phaserScene) return 0;
    const localZoom = Math.max(0, ((phaserScene.matchStartZoomUntil || 0) - performance.now()) / 1000);
    const serverLock = Math.max(0, Number(phaserScene.matchStartFreezeRemaining || 0));
    return Math.max(localZoom, serverLock);
  }

  function isIntroInputLocked() {
    return introLockSecondsRemaining() > 0.035;
  }

  function clearMovementInputOnly() {
    input.up = false;
    input.down = false;
    input.left = false;
    input.right = false;
    input.sprint = false;
    input.repair = false;
    input.action = false;
    input.attack = false;
    input.attackHeld = false;
  }

  const INTRO_LOCKED_KEY_CODES = new Set([
    "KeyW", "KeyA", "KeyS", "KeyD",
    "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight",
    "ShiftLeft", "ShiftRight", "Space", "KeyE"
  ]);

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
    lastSfxPitchIndices: Object.create(null),
    healingLoop: null,
    healingLoopVolume: 0,
    healingLoopPitch: 1,
    healingLoopLastTryAt: 0,
    unhookingLoop: null,
    unhookingLoopVolume: 0,
    unhookingLoopPitch: 1,
    unhookingLoopLastTryAt: 0
  };

  const MENU_MUSIC_MUTE_KEY = "voidriftMenuMusicMuted";
  const MENU_MUSIC_VOLUME_KEY = "voidriftMenuMusicVolume";

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
    const nextMuted = !isMenuMusicMuted();
    setMenuMusicMuted(nextMuted);
    if (!nextMuted) ensureMenuAudioStarted();
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
    ensureMenuAudioStarted();
  }

  function ensureMenuAudioStarted(options = {}) {
    if (!audio.menuActive || !audio.menu || !hasManagedAudioSource(audio.menu)) return;
    if (options.restart) {
      try { audio.menu.currentTime = 0; } catch (_) { /* ignore */ }
    }
    applyMenuMusicVolume();
    if (isMenuMusicMuted()) return;
    audio.menu.play().catch(() => {
      // Browser autoplay rules require a click/key first. The global unlock listeners retry this.
    });
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
      stopHealingLoop(true);
      stopUnhookingLoop(true);
      return;
    }

    // Resume synced layers when entering a match. Browser autoplay can still block
    // until a user input happens, so ensureAudioStarted() keeps the polite retry path.
    if (audio.ready) {
      for (const layer of audio.layers || []) {
        if (hasManagedAudioSource(layer) && layer.paused) layer.play().catch(() => null);
      }
    }
  }

  function showScreen(name) {
    const previousScreen = activeScreenName;
    const wasGameScreen = previousScreen === "game";
    activeScreenName = name;

    const isGameScreen = name === "game";
    if (!isGameScreen) {
      closeReactChatWheel(false);
      dispatchHookIndicators([]);
      stopHealingLoop(true);
      stopUnhookingLoop(true);
    }
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
    if (name !== "game") {
      clearTimeout(survivorHitImpactTimer);
      document.body.classList.remove("survivor-hit-impact", "survivor-hit-heavy");
    }
    ui.mobileControls?.classList.toggle("hidden", name !== "game" || !IS_TOUCH_DEVICE);
    if (name !== "game") {
      dispatchVoidAbilityHud(null);
      if (reactAbilityWheelOpen) closeReactAbilityWheel(false);
    }
  }

  let matchTransitionTimers = [];
  let screenFadeTimers = [];

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

  function clearScreenFadeTimers() {
    for (const timer of screenFadeTimers) clearTimeout(timer);
    screenFadeTimers = [];
  }

  function getScreenFadeOverlay() {
    let overlay = document.getElementById("screenFadeOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "screenFadeOverlay";
    overlay.className = "screen-fade-overlay";
    overlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(overlay);
    return overlay;
  }

  function runScreenFadeTransition(swapScreen, options = {}) {
    const overlay = getScreenFadeOverlay();
    const fadeOutMs = Math.max(80, Number(options.fadeOutMs) || 260);
    const fadeInMs = Math.max(120, Number(options.fadeInMs) || 360);
    const holdMs = Math.max(0, Number(options.holdMs) || 45);

    clearScreenFadeTimers();
    overlay.classList.remove("is-hidden");
    overlay.style.display = "block";
    overlay.style.pointerEvents = "auto";
    overlay.style.transition = "none";
    overlay.style.opacity = "0";
    overlay.getBoundingClientRect();

    requestAnimationFrame(() => {
      overlay.style.transition = `opacity ${fadeOutMs}ms cubic-bezier(.18,.76,.18,1)`;
      overlay.style.opacity = "1";
    });

    screenFadeTimers.push(setTimeout(() => {
      swapScreen?.();
      overlay.style.transition = `opacity ${fadeInMs}ms cubic-bezier(.16,.84,.24,1)`;
      overlay.style.opacity = "0";
    }, fadeOutMs + holdMs));

    screenFadeTimers.push(setTimeout(() => {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
      overlay.style.transition = "none";
      overlay.style.opacity = "0";
    }, fadeOutMs + holdMs + fadeInMs + 50));
  }

  function showEndScreenWithFade() {
    if (activeScreenName === "game") {
      runScreenFadeTransition(() => showScreen("end"), { fadeOutMs: 270, fadeInMs: 380, holdMs: 60 });
      return;
    }
    showScreen("end");
  }

  function showGameScreenWithFade(afterShow) {
    if (activeScreenName === "end") {
      runScreenFadeTransition(() => {
        showScreen("game");
        afterShow?.();
      }, { fadeOutMs: 230, fadeInMs: 330, holdMs: 35 });
      return;
    }
    showScreen("game");
    afterShow?.();
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

  function actorNameFromSnapshot(actorId, fallback = "Runner") {
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
      const name = actorNameFromSnapshot(event.survivorId, "A Runner");
      pushMatchAnnouncement({
        kind: "hook",
        title: `${name} was hooked`,
        detail: "The hook is set."
      });
      return;
    }

    if (event.type === "execute" || event.type === "death") {
      if (event.survivorId === myId) return;
      const name = actorNameFromSnapshot(event.survivorId, "A Runner");
      pushMatchAnnouncement({
        kind: "death",
        title: `${name} was claimed`,
        detail: "Their signal went dark."
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

  let reactChatWheelOpen = false;

  function getSurvivorChatState(actor) {
    if (!actor || actor.role !== "survivor") return "normal";
    if (actor.hooked) return "hooked";
    if (actor.downed || actor.health <= 0) return "downed";
    if (actor.chase) return "chase";
    if (actor.injured || actor.health <= 1) return "injured";
    return "normal";
  }

  function getChatWheelDetail(pointerEvent = null) {
    const me = getLocalPlayerData();
    const role = me?.role === "killer" ? "killer" : "survivor";
    const state = role === "killer" ? "killer" : getSurvivorChatState(me);
    const messages = role === "killer"
      ? CHAT_WHEEL_MESSAGES.killer
      : (CHAT_WHEEL_MESSAGES.survivor[state] || CHAT_WHEEL_MESSAGES.survivor.normal);

    return {
      role,
      state,
      messages,
      pointer: Number.isFinite(pointerEvent?.clientX) && Number.isFinite(pointerEvent?.clientY)
        ? { x: pointerEvent.clientX, y: pointerEvent.clientY }
        : null
    };
  }

  function dispatchChatWheelEvent(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function dispatchHookIndicators(items = []) {
    window.dispatchEvent(new CustomEvent("voidrift:hook-indicators", {
      detail: { items: Array.isArray(items) ? items : [] }
    }));
  }

  function dispatchSurvivorStatusHud(snapshot) {
    window.dispatchEvent(new CustomEvent("voidrift:survivor-status-hud", {
      detail: {
        snapshot,
        myId,
        spectateTargetId: phaserScene?.spectateTargetId || null,
        spectating: isLocalSpectating()
      }
    }));
  }

  function openReactChatWheel(pointerEvent = null) {
    if (reactChatWheelOpen) return;
    if (!currentSnapshot || currentSnapshot.phase !== "game" || !getLocalPlayerData()) return;
    reactChatWheelOpen = true;
    dispatchChatWheelEvent("voidrift:chat-wheel-open", getChatWheelDetail(pointerEvent));
  }

  function closeReactChatWheel(submit = true) {
    if (!reactChatWheelOpen) return;
    reactChatWheelOpen = false;
    dispatchChatWheelEvent("voidrift:chat-wheel-close", { submit: !!submit });
  }

  function sendReactChatWheelSelection(index) {
    const selected = Number(index);
    if (!Number.isInteger(selected) || selected < 0 || selected > 3) return;
    if (!socket || currentSnapshot?.phase !== "game") return;
    socket.emit("chatWheel", { index: selected });
  }

  function setupReactChatWheelBridge() {
    window.addEventListener("voidrift:chat-wheel-submit", (event) => {
      sendReactChatWheelSelection(event.detail?.index);
    });
  }

  let reactAbilityWheelOpen = false;

  function getAbilityListForVoid(actor = getLocalPlayerData()) {
    const orbs = Math.max(0, Math.floor(actor?.dots || 0));
    return VOID_ABILITY_ORDER.slice(0, 4).map((id) => {
      const ability = VOID_ABILITIES[id] || { id, name: "Void Ability", shortName: "Ability", cost: 0, summary: "The Void bends the run.", cooldown: 20 };
      const isCancel = !!ability.cancel || id === "cancel";
      const cooldownRemaining = isCancel ? 0 : Math.max(0, Number(actor?.voidAbilityCooldowns?.[ability.id || id] || 0));
      return {
        id: ability.id || id,
        name: ability.name || (isCancel ? "Cancel" : "Void Ability"),
        shortName: ability.shortName || ability.name || (isCancel ? "Cancel" : "Ability"),
        cost: Number(ability.cost || 0),
        summary: ability.summary || (isCancel ? "Close the wheel." : "The Void bends the run."),
        accent: ability.accent || (isCancel ? "muted" : "purple"),
        cancel: isCancel,
        cooldown: Number(ability.cooldown || 20),
        cooldownRemaining,
        available: isCancel || (orbs >= Number(ability.cost || 0) && cooldownRemaining <= 0),
        active: !!(actor && !isCancel && (
          (ability.id === "nullRush" && (actor.voidSpeedBoost || 0) > 0) ||
          (ability.id === "redshiftOrbs" && (currentSnapshot?.voidEffects?.redOrbs || 0) > 0) ||
          (ability.id === "voidReveal" && (currentSnapshot?.voidEffects?.runnerReveal || 0) > 0)
        ))
      };
    });
  }

  function getAbilityWheelDetail(pointerEvent = null) {
    const me = getLocalPlayerData();
    return {
      role: "killer",
      orbs: Math.max(0, Math.floor(me?.dots || 0)),
      abilities: getAbilityListForVoid(me),
      pointer: Number.isFinite(pointerEvent?.clientX) && Number.isFinite(pointerEvent?.clientY)
        ? { x: pointerEvent.clientX, y: pointerEvent.clientY }
        : null
    };
  }

  function dispatchAbilityWheelEvent(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function openReactAbilityWheel(pointerEvent = null) {
    const me = getLocalPlayerData();
    if (reactAbilityWheelOpen) return;
    if (!currentSnapshot || currentSnapshot.phase !== "game" || me?.role !== "killer" || me.dead || (currentSnapshot.matchStartFreezeRemaining || 0) > 0) return;
    reactAbilityWheelOpen = true;
    dispatchAbilityWheelEvent("riftrunner:void-ability-open", getAbilityWheelDetail(pointerEvent));
  }

  function closeReactAbilityWheel(submit = true) {
    if (!reactAbilityWheelOpen) return;
    reactAbilityWheelOpen = false;
    dispatchAbilityWheelEvent("riftrunner:void-ability-close", { submit: !!submit });
  }

  function sendVoidAbilitySelection(selection) {
    let abilityId = String(selection?.id || selection || "");
    if (Number.isInteger(selection?.index)) {
      abilityId = getAbilityListForVoid()[selection.index]?.id || "";
    }
    if (!abilityId || abilityId === "cancel" || !socket || currentSnapshot?.phase !== "game") return;
    socket.emit("voidAbility", { id: abilityId });
  }

  function setupReactAbilityWheelBridge() {
    window.addEventListener("riftrunner:void-ability-submit", (event) => {
      sendVoidAbilitySelection(event.detail || {});
    });
  }

  function dispatchVoidAbilityHud(snapshot = currentSnapshot) {
    const me = snapshot?.actors?.find((a) => a.id === myId);
    const isVoid = me?.role === "killer" && snapshot?.phase === "game" && !me.dead;
    const effects = [];
    if (isVoid && (me.voidSpeedBoost || 0) > 0) effects.push({ id: "nullRush", label: "rush", time: me.voidSpeedBoost });
    if (isVoid && (snapshot?.voidEffects?.redOrbs || 0) > 0) effects.push({ id: "redshiftOrbs", label: "redshift", time: snapshot.voidEffects.redOrbs });
    if (isVoid && (snapshot?.voidEffects?.runnerReveal || 0) > 0) effects.push({ id: "voidReveal", label: "sight", time: snapshot.voidEffects.runnerReveal });
    window.dispatchEvent(new CustomEvent("riftrunner:void-ability-hud", {
      detail: {
        visible: isVoid,
        orbs: isVoid ? Math.max(0, Math.floor(me.dots || 0)) : 0,
        effects
      }
    }));
    if (reactAbilityWheelOpen && isVoid) {
      dispatchAbilityWheelEvent("riftrunner:void-ability-update", {
        orbs: Math.max(0, Math.floor(me.dots || 0)),
        abilities: getAbilityListForVoid(me)
      });
    }
  }

  function isLocalSpectating() {
    const me = getLocalPlayerData();
    return me?.role === "survivor" && (!!me.dead || !!me.escaped);
  }

  function getLivingTeammates(snapshot = currentSnapshot) {
    return (snapshot?.actors || []).filter(
      (a) => a.role === "survivor"
        && a.id !== myId
        && !a.dead
        && !a.escaped
    );
  }

  function sendInput(oneShot = {}, force = false) {
    if (!socket || !myId) return;
    const me = getLocalPlayerData();
    if (me?.role === "survivor" && me.dead) return;

    if (isIntroInputLocked()) {
      clearMovementInputOnly();
      const payload = inputPayload();
      const signature = JSON.stringify(payload);
      if (force || signature !== lastInputPayload) {
        socket.emit("input", payload);
        lastInputPayload = signature;
      }
      return;
    }

    const payload = inputPayload(oneShot);
    const signature = JSON.stringify(payload);
    if (force || signature !== lastInputPayload || oneShot.action || oneShot.attack || oneShot.attackReleased) {
      socket.emit("input", payload);
      lastInputPayload = signature;
    }
  }


  const audioAssetCache = new Map();

  function normalizeAudioSources(sources) {
    return (Array.isArray(sources) ? sources : [sources])
      .map((src) => String(src || "").trim())
      .filter(Boolean);
  }

  function isUsableAudioResponse(response) {
    if (!response || !response.ok) return false;
    const type = String(response.headers?.get?.("content-type") || "").toLowerCase();
    // Vite serves index.html for unknown SPA paths. That is not an audio file, despite the browser's brave little attempt.
    return !type.includes("text/html");
  }

  async function resolveAudioSource(sources, label = "audio") {
    const candidates = normalizeAudioSources(sources);
    for (const src of candidates) {
      if (audioAssetCache.has(src)) {
        if (audioAssetCache.get(src)) return src;
        continue;
      }
      try {
        const response = await fetch(src, { method: "HEAD", cache: "no-store" });
        const usable = isUsableAudioResponse(response);
        audioAssetCache.set(src, usable);
        if (usable) return src;
      } catch (_) {
        audioAssetCache.set(src, false);
      }
    }
    console.warn(`[audio] Missing ${label}: ${candidates.join(", ") || "no source configured"}`);
    return null;
  }

  function createManagedAudio(label, sources, options = {}) {
    const el = new Audio();
    el.loop = !!options.loop;
    el.preload = options.preload || "auto";
    if (Number.isFinite(options.volume)) el.volume = clamp(options.volume, 0, 1);
    el._voidriftReady = false;
    el._voidriftMissing = false;
    el._voidriftPending = resolveAudioSource(sources, label).then((src) => {
      if (!src) {
        el._voidriftMissing = true;
        return el;
      }
      el.src = src;
      el.load();
      el._voidriftReady = true;
      options.onReady?.(el);
      return el;
    });
    el.addEventListener("error", () => {
      el._voidriftMissing = true;
      el._voidriftReady = false;
    });
    return el;
  }

  function hasManagedAudioSource(el) {
    return !!(el && el._voidriftReady && !el._voidriftMissing && (el.currentSrc || el.src));
  }

  function setupAudio() {
    audio.menu = createManagedAudio("menu music", MUSIC.MENU, {
      loop: true,
      preload: "auto",
      onReady: () => {
        applyMenuMusicVolume();
        if (audio.menuActive && !isMenuMusicMuted()) ensureMenuAudioStarted();
      }
    });
    syncMenuMusicToggleUi();
    syncMenuMusicVolumeUi();
    applyMenuMusicVolume();

    audio.layers = MUSIC.LAYERS.map((src, index) => createManagedAudio(`music layer ${index + 1}`, src, {
      loop: true,
      preload: "auto",
      volume: 0,
      onReady: (layer) => {
        layer.volume = 0;
        if (audio.gameActive) ensureAudioStarted();
      }
    }));

    audio.sfx = Object.fromEntries(Object.entries(SFX.FILES).map(([name, src]) => {
      const a = createManagedAudio(`sfx:${name}`, src, {
        loop: false,
        preload: "auto",
        volume: clamp((SFX.VOLUMES[name] || 0.75) * SFX.MASTER, 0, 1)
      });
      return [name, a];
    }));
  }

  function ensureAudioStarted() {
    if (!audio.gameActive) return;

    if (audio.ready) {
      for (const a of audio.layers) {
        if (hasManagedAudioSource(a) && a.paused) a.play().catch(() => null);
      }
      return;
    }

    const now = performance.now();
    if (audio.tried && now - audio.lastTryAt < 900) return;
    audio.tried = true;
    audio.lastTryAt = now;

    const plays = audio.layers.filter(hasManagedAudioSource).map((a) => {
      if (a.paused && a.currentTime === 0) a.currentTime = 0;
      return a.play().catch(() => null);
    });
    Promise.allSettled(plays).then(() => {
      audio.ready = audio.layers.some((a) => hasManagedAudioSource(a) && !a.paused);
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
        if (audio.ready && audio.gameActive && hasManagedAudioSource(layer3) && layer3.paused) layer3.play().catch(() => null);
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
        if (hasManagedAudioSource(layer) && layer.paused) layer.play().catch(() => null);
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
    if (!hasManagedAudioSource(base)) return;
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

  function ensureHealingLoopElement() {
    if (audio.healingLoop && hasManagedAudioSource(audio.healingLoop)) return audio.healingLoop;
    const base = audio.sfx?.healing;
    if (!hasManagedAudioSource(base)) return null;

    const loop = base.cloneNode(true);
    loop.loop = true;
    loop.volume = 0;
    loop.preservesPitch = false;
    loop.mozPreservesPitch = false;
    loop.webkitPreservesPitch = false;
    loop.playbackRate = audio.healingLoopPitch || 1;
    loop._voidriftReady = true;
    loop._voidriftMissing = false;
    audio.healingLoop = loop;
    return loop;
  }

  function stopHealingLoop(reset = false) {
    audio.healingLoopVolume = 0;
    const loop = audio.healingLoop;
    if (!loop) return;
    loop.volume = 0;
    if (!loop.paused) loop.pause();
    if (reset) {
      try { loop.currentTime = 0; } catch (_) { /* Some browsers guard media time like crown jewels. */ }
    }
  }

  function healingActorCount(actor) {
    if (!actor || (actor.healProgress || 0) <= 0.001 || actor.dead || actor.escaped || actor.hooked) return 0;
    const healers = Array.isArray(actor.activeHealers) ? actor.activeHealers.filter(Boolean) : [];
    return healers.length;
  }

  function getHealingAudioActivity(snapshot = currentSnapshot) {
    if (!snapshot || snapshot.phase !== "game" || activeScreenName !== "game") return { active: false, healerCount: 0 };
    const actors = snapshot.actors || [];
    if (!actors.length) return { active: false, healerCount: 0 };

    const localItem = getLocalVisualActor();
    const localData = localItem?.data || actors.find((actor) => actor.id === myId);
    if (!localData) return { active: false, healerCount: 0 };

    const lx = Number(localItem?.current?.x ?? localData.x);
    const ly = Number(localItem?.current?.y ?? localData.y);
    const localId = localData.id || myId;
    const range = Math.max(90, Number(LOCAL_SFX_RANGE?.healing) || 340);

    let best = { active: false, healerCount: 0, distance: Infinity, linked: false };
    for (const actor of actors) {
      const healerCount = healingActorCount(actor);
      if (!healerCount) continue;

      const healerIds = Array.isArray(actor.activeHealers) ? actor.activeHealers : [];
      const linked = actor.id === localId || healerIds.includes(localId) || localData.healingTargetId === actor.id;
      const d = Number.isFinite(lx) && Number.isFinite(ly) ? dist(lx, ly, actor.x || 0, actor.y || 0) : Infinity;
      const audible = linked || d <= range;
      if (!audible) continue;

      if (!best.active || healerCount > best.healerCount || (healerCount === best.healerCount && d < best.distance)) {
        best = { active: true, healerCount, distance: d, linked };
      }
    }
    return best;
  }

  function updateHealingSfx(dt = 0.016) {
    const loop = ensureHealingLoopElement();
    if (!loop) return;

    const activity = getHealingAudioActivity(currentSnapshot);
    const healerCount = Math.max(0, Number(activity.healerCount) || 0);
    const active = !!activity.active && healerCount > 0 && audio.gameActive && activeScreenName === "game";
    const countBoost = clamp(healerCount - 1, 0, 4);
    const distanceScale = Number.isFinite(activity.distance) && !activity.linked
      ? clamp(1 - (activity.distance / Math.max(90, Number(LOCAL_SFX_RANGE?.healing) || 340)) * 0.55, 0.38, 1)
      : 1;
    const targetVolume = active
      ? clamp((SFX.VOLUMES.healing || 0.34) * SFX.MASTER * distanceScale * (1 + countBoost * 0.10), 0, 0.72)
      : 0;

    audio.healingLoopVolume = lerp(audio.healingLoopVolume || 0, targetVolume, dampAlpha(active ? 7.5 : 10.5, dt));
    loop.volume = clamp(audio.healingLoopVolume, 0, 0.72);

    const pitch = clamp(1 + countBoost * 0.055, 1, 1.24);
    if (Math.abs((audio.healingLoopPitch || 1) - pitch) > 0.005) {
      audio.healingLoopPitch = pitch;
      loop.preservesPitch = false;
      loop.mozPreservesPitch = false;
      loop.webkitPreservesPitch = false;
      loop.playbackRate = pitch;
    }

    if (active) {
      const now = performance.now();
      if (loop.paused && now - (audio.healingLoopLastTryAt || 0) > 650) {
        audio.healingLoopLastTryAt = now;
        loop.play().catch(() => null);
      }
    } else if (audio.healingLoopVolume <= 0.006 && !loop.paused) {
      loop.pause();
      try { loop.currentTime = 0; } catch (_) { /* ignore */ }
    }
  }

  function ensureUnhookingLoopElement() {
    if (audio.unhookingLoop && hasManagedAudioSource(audio.unhookingLoop)) return audio.unhookingLoop;
    const base = audio.sfx?.unhooking;
    if (!hasManagedAudioSource(base)) return null;

    const loop = base.cloneNode(true);
    loop.loop = true;
    loop.volume = 0;
    loop.preservesPitch = false;
    loop.mozPreservesPitch = false;
    loop.webkitPreservesPitch = false;
    loop.playbackRate = audio.unhookingLoopPitch || 1;
    loop._voidriftReady = true;
    loop._voidriftMissing = false;
    audio.unhookingLoop = loop;
    return loop;
  }

  function stopUnhookingLoop(reset = false) {
    audio.unhookingLoopVolume = 0;
    const loop = audio.unhookingLoop;
    if (!loop) return;
    loop.volume = 0;
    if (!loop.paused) loop.pause();
    if (reset) {
      try { loop.currentTime = 0; } catch (_) { /* ignore */ }
    }
  }

  function getUnhookingAudioActivity(snapshot = currentSnapshot) {
    if (!snapshot || snapshot.phase !== "game" || activeScreenName !== "game") return { active: false };
    const actors = snapshot.actors || [];
    const localData = actors.find((actor) => actor.id === myId);
    if (!localData || localData.dead || localData.escaped) return { active: false };

    if (localData.role === "survivor" && localData.hooked && (localData.unhookProgress || 0) > 0.001) {
      return { active: true, progress: localData.unhookProgress || 0, linked: "target" };
    }

    const targetId = localData.role === "survivor" ? localData.unhookTargetId : null;
    if (targetId) {
      const target = actors.find((actor) => actor.id === targetId);
      if (target?.hooked && !target.dead && !target.escaped && (target.unhookProgress || 0) > 0.001) {
        return { active: true, progress: target.unhookProgress || 0, linked: "helper" };
      }
    }

    return { active: false };
  }

  function updateUnhookingSfx() {
    // Unhooking is intentionally a completion cue now, not a loop while rescuing.
    // Keep this cleanup path so older loop instances cannot linger after a transition.
    stopUnhookingLoop(true);
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
  function playLocalizedUnhookComplete(event) {
    if (!event) return;
    const rescuers = Array.isArray(event.rescuerIds) ? event.rescuerIds : [];
    const involved = event.survivorId === myId || rescuers.includes(myId) || event.rescuerId === myId;
    if (involved) playSfx("unhooking", { disablePitchVariation: true });
  }


  function playLocalizedPalletDrop(event) {
    if (!event) return;
    const isThrower = event.actorId === myId;
    const d = distanceToLocalEvent(event);
    // The Survivor who drops the pallet hears it. Others only hear it when close enough.
    if (isThrower || d <= (LOCAL_SFX_RANGE.palletDrop || 280)) playSfx("palletDrop");
  }

  function playLocalizedVoidStun(event) {
    if (!event) return;
    const isThrower = event.actorId === myId || event.survivorId === myId;
    const isStunnedKiller = event.killerId === myId;
    const d = distanceToLocalEvent(event);
    // The survivor who slammed it and The Void who ate it always hear the stun. Others hear it nearby.
    if (isThrower || isStunnedKiller || d <= (LOCAL_SFX_RANGE.voidStun || LOCAL_SFX_RANGE.palletStun || 360)) {
      playSfx("voidStun");
    }
  }

  function getOrbPickupPitch(event) {
    const pitchConfig = AUDIO_CONFIG.sfx?.orbPickupPitch || {};
    const minPitch = clamp(cfgNumber(pitchConfig.min, 1.0), 0.5, 2.25);
    const maxPitch = clamp(cfgNumber(pitchConfig.max, 1.45), 0.5, 2.25);
    const countMax = Math.max(1, Math.round(cfgNumber(pitchConfig.countMax, 10)));
    const carried = clamp(
      Math.round(cfgNumber(event?.dotsAfter ?? event?.carriedDots ?? event?.dotCount ?? 1, 1)),
      1,
      countMax
    );
    const t = countMax <= 1 ? 1 : (carried - 1) / (countMax - 1);
    return minPitch + (maxPitch - minPitch) * t;
  }

  function playOrbPickupSfx(event) {
    if (!event || event.actorId !== myId) return;
    if (event.role === "killer") {
      playSfx("orbPickup");
      return;
    }
    playSfx("orbPickup", {
      playbackRate: getOrbPickupPitch(event),
      disablePitchVariation: true
    });
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
    return "Healthy";
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
    dispatchSurvivorStatusHud(snapshot);
  }

  function getThreatLevels(snapshot, me) {
    const music = snapshot?.music || {};
    const terror = clamp(Number(music.terror || 0), 0, 1);
    const chase = (music.chase || me?.chase) ? 1 : 0;
    const injured = me?.role === "survivor" && !me.dead && !me.escaped && (me.health <= 1 || me.injured || me.downed || me.hooked);
    const voidStun = me?.role === "killer" ? clamp(Number(me.voidStun || 0) / Math.max(0.001, VOID_STUN_SECONDS), 0, 1) : 0;
    const blood = me?.hooked ? 0.95 : me?.downed ? 1 : injured ? 0.82 : me?.dead ? 1 : 0;
    return { terror, chase, blood, injured, voidStun };
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
    ui.horrorFx.style.setProperty("--void-stun", (raw.voidStun || 0).toFixed(3));
    ui.horrorFx.style.setProperty("--tunnel", fxState.tunnel.toFixed(3));
    ui.horrorFx.style.setProperty("--pulse-speed", pulseSpeed);
    document.body.classList.toggle("is-void-stunned", (raw.voidStun || 0) > 0.02);
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
      this.introCameraPrimed = false;
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

    killerHidesRemoteHookedSurvivor(data) {
      const pov = this.getPovSurvivorData();
      return pov?.role === "killer"
        && data?.role === "survivor"
        && !!data?.hooked
        && data.visible === false
        && data.id !== myId;
    }

    killerCanRevealWorldPoint(worldX, worldY) {
      const pov = this.getPovSurvivorData();
      if (pov?.role !== "killer") return true;
      const subject = this.getCameraSubjectItem();
      if (!subject || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
      return this.computePointVisionAlpha(worldX, worldY, subject) > WALL_VISION.MIN_VISIBLE_ALPHA;
    }

    preload() {
      // No external rift/generator art is required. The original build tried to load /gen.svg,
      // and Vite helpfully returned index.html when the file was missing, which made Phaser
      // parse HTML as SVG and die with a useless XML error. Humanity marches on.
      // Rifts are drawn with Graphics in drawGenerator(), and create() still builds a small
      // fallback canvas texture for any legacy code path that asks for one.
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
      this.lastHookIndicatorSignature = "";
      this.swipes = [];
      this.recentHookIndicators = [];
      this.createGeneratorFallbackTexture();
      // Legacy soft cone textures are intentionally not created here. The minimal
      // system below uses vector alpha + object visibility, which is much cheaper.
      this.input.on("pointerdown", (pointer) => {
        ensureAudioStarted();
        if (isIntroInputLocked()) {
          clearMovementInputOnly();
          sendInput({}, true);
          return;
        }
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
      this.introCameraPrimed = false;
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
      item.healAura?.destroy();
      item.healBarBg?.destroy();
      item.healBar?.destroy();
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

    riftsAreComplete(snapshot = currentSnapshot) {
      const objective = snapshot?.objective;
      if (snapshot?.map?.riftsHidden) return true;
      if (!objective) return false;
      if (objective.riftsHidden) return true;
      const required = Number(objective.requiredGenerators ?? objective.required ?? 0);
      const completed = Number(objective.doneGenerators ?? objective.completed ?? 0);
      return required > 0 && completed >= required;
    }

    visibleGenerators(snapshot = currentSnapshot) {
      if (this.riftsAreComplete(snapshot)) return [];
      return snapshot?.map?.generators || this.map?.generators || [];
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
      this.syncGeneratorSprites(this.visibleGenerators());
      for (const gate of currentSnapshot.map?.gates || this.map.gates || []) this.drawGate(g, gate);
      const hookSubject = this.getCameraSubjectItem();
      const hookPov = this.getPovSurvivorData();
      for (const hook of currentSnapshot.map?.hooks || this.map.hooks || []) {
        if (!hook || hook.active === false) continue;
        const hookAlpha = hookSubject
          ? this.computePointVisionAlpha(hook.x, hook.y, hookSubject)
          : 1;
        this.drawHook(g, hook, hookAlpha);
      }
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
      const redshift = (currentSnapshot?.voidEffects?.redOrbs || 0) > 0;
      const outer = redshift ? 0xff273d : COLORS.collectibleDot;
      const core = redshift ? 0xff6b7d : COLORS.collectibleDotGlow;
      const rim = redshift ? 0xffc0c8 : 0xfff7d6;
      g.fillStyle(outer, (0.14 + pulse * 0.12) * easeAlpha);
      g.fillCircle(dot.x, dot.y, (11 + pulse * 2.5) * scale);
      g.fillStyle(core, 0.92 * easeAlpha);
      g.fillCircle(dot.x, dot.y, (4.5 + pulse * 1.2) * scale);
      g.lineStyle(redshift ? 3 : 2, rim, (0.38 + pulse * 0.30) * easeAlpha);
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
      const generators = this.visibleGenerators();
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
      const generators = this.visibleGenerators();
      this.syncGeneratorSprites(generators);
      const g = this.generatorGraphics;
      g.clear();
      if (!generators.length) return;
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

    drawHook(g, hook, visibilityAlpha = 1) {
      if (!hook || hook.active === false || !this.map) return;
      visibilityAlpha = clamp(visibilityAlpha, 0, 1);
      if (visibilityAlpha <= WALL_VISION.MIN_VISIBLE_ALPHA) return;

      const tile = this.map.tile || 72;
      const x = Math.round(((hook.x || 0) - tile / 2) / tile) * tile;
      const y = Math.round(((hook.y || 0) - tile / 2) / tile) * tile;
      const now = this.time?.now || performance.now();
      const cx = x + tile / 2;
      const cy = y + tile / 2;
      const basePulse = 0.5 + Math.sin(now * 0.006) * 0.5;

      // Hook state: no giant red border. A thin containment field pulses outward
      // around the tile so it reads as dangerous without shouting in block letters.
      g.fillStyle(0x170308, (0.22 + basePulse * 0.05) * visibilityAlpha);
      g.fillRoundedRect(x + 9, y + 9, tile - 18, tile - 18, 11);

      for (let i = 0; i < 3; i++) {
        const t = ((now / 1050) + i / 3) % 1;
        const ease = 1 - Math.pow(1 - t, 2);
        const inset = 18 - ease * 14;
        const alpha = (1 - t) * (0.42 - i * 0.055) * visibilityAlpha;
        g.lineStyle(1.4, 0xff315d, alpha);
        g.strokeRoundedRect(x + inset, y + inset, tile - inset * 2, tile - inset * 2, 12 + ease * 5);
      }

      const bracketAlpha = (0.45 + basePulse * 0.34) * visibilityAlpha;
      const pad = 11;
      const len = 14;
      g.lineStyle(2, 0xff6b7d, bracketAlpha);
      g.beginPath();
      g.moveTo(x + pad, y + pad + len); g.lineTo(x + pad, y + pad); g.lineTo(x + pad + len, y + pad);
      g.moveTo(x + tile - pad - len, y + pad); g.lineTo(x + tile - pad, y + pad); g.lineTo(x + tile - pad, y + pad + len);
      g.moveTo(x + tile - pad, y + tile - pad - len); g.lineTo(x + tile - pad, y + tile - pad); g.lineTo(x + tile - pad - len, y + tile - pad);
      g.moveTo(x + pad + len, y + tile - pad); g.lineTo(x + pad, y + tile - pad); g.lineTo(x + pad, y + tile - pad - len);
      g.strokePath();

      g.fillStyle(0xff315d, (0.10 + basePulse * 0.10) * visibilityAlpha);
      g.fillCircle(cx, cy, 15 + basePulse * 4);
      g.lineStyle(1.5, 0xff9aac, (0.28 + basePulse * 0.30) * visibilityAlpha);
      g.beginPath();
      g.moveTo(cx, cy - 12);
      g.lineTo(cx + 12, cy);
      g.lineTo(cx, cy + 12);
      g.lineTo(cx - 12, cy);
      g.closePath();
      g.strokePath();
      g.fillStyle(0xffd1dc, (0.34 + basePulse * 0.22) * visibilityAlpha);
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
      const done = objective.doneGenerators ?? objective.completed ?? 0;
      const required = objective.requiredGenerators ?? objective.required ?? objective.totalGenerators ?? objective.total ?? 0;
      const total = objective.totalGenerators ?? objective.total ?? required;
      const escapeOpen = objective.escapeOpen ?? objective.gatesPowered ?? false;
      const hudKey = JSON.stringify({
        self: [me.id, me.role, me.health, me.dots, me.injured, me.downed, me.hooked, me.dead, me.escaped, me.escapeProgress, me.escapeGateId, me.chase, me.hookProgress, me.healProgress, me.generatorKickTargetId, me.generatorKickProgress, me.voidStun, me.voidSpeedBoost],
        objective: [done, required, total, escapeOpen],
        survivors: (snapshot.actors || []).filter((a) => a.role === "survivor").map((a) => [a.id, a.health, a.dots, a.injured, a.downed, a.hooked, a.dead, a.escaped, a.escapeProgress, a.escapeGateId, a.chase, a.hookProgress, a.healProgress, a.hookCount, a.chatText]),
        killerChat: (snapshot.actors || []).find((a) => a.role === "killer")?.chatText || null,
        dots: (snapshot.collectibleDots || []).map((d) => d.id).join(","),
        redOrbs: snapshot.voidEffects?.redOrbs || 0
      });
      dispatchVoidAbilityHud(snapshot);
      if (hudKey === this.lastHudKey && now - this.lastHudRenderAt < 180) return;
      this.lastHudKey = hudKey;
      this.lastHudRenderAt = now;
      renderSurvivorStatusHud(snapshot);
      ui.hud.dataset.role = me.role === "killer" ? "killer" : "survivor";
      ui.roleLabel.textContent = me.role === "killer" ? "The Void" : "Runner";
      ui.controlsLabel.textContent = me.role === "killer"
        ? "WASD move • Mouse aim • M1 attack/lunge • Space vault/break • hold E hook/execute/kick Rift • hold Q abilities • hold R chat"
        : "WASD move • Shift sprint • Mouse flashlight • Space vault/drop • collect orbs, stand near active Rifts to deposit • stand still near teammates to heal/rescue • hold R chat";
      const shownDone = Math.min(done, required);
      ui.genText.textContent = `${shownDone} / ${required}${total > required ? ` (${total} on map)` : ""}`;
      if (ui.bigGenText) ui.bigGenText.textContent = `${shownDone} / ${required}`;
      ui.bigGenCounter?.classList.toggle("is-complete", required > 0 && shownDone >= required);
      ui.gateText.textContent = escapeOpen ? "Open" : "Sealed";
      if (me.role === "killer") {
        const actors = snapshot.actors || [];
        const hookingTarget = actors.find((a) => a.id === me.hookActionTargetId);
        const readyTarget = actors.find((a) => a.id === me.hookReadyTargetId);
        if ((me.voidStun || 0) > 0) {
          ui.healthText.textContent = `Stunned ${Math.ceil(me.voidStun || 0)}s`;
        } else if (hookingTarget) {
          const executing = me.hookActionType === "execute" || (hookingTarget.hookCount || 0) >= 2;
          ui.healthText.textContent = `${executing ? "Executing" : "Hooking"} ${hookingTarget.name || "runner"} ${Math.round((hookingTarget.hookProgress || 0) * 100)}%`;
        } else if (readyTarget) {
          const executeReady = (readyTarget.hookCount || 0) >= 2;
          ui.healthText.textContent = `Hold E: ${executeReady ? "Execute" : "hook"} ${readyTarget.name || "Runner"}`;
        } else if (me.generatorKickTargetId) {
          ui.healthText.textContent = `Kicking rift ${Math.round((me.generatorKickProgress || 0) * 100)}%`;
        } else {
          const kickable = (snapshot.map?.generators || []).some((gen) => !gen.done && !gen.kickLocked && (gen.progress || 0) > 0 && Math.hypot((me.x || 0) - gen.x, (me.y || 0) - gen.y) < 92);
          ui.healthText.textContent = kickable ? "Hold E: Kick rift" : "The Void";
        }
      } else if (me.dead) {
        const target = (snapshot.actors || []).find((a) => a.id === this.resolveSpectateTargetId());
        ui.healthText.textContent = target
          ? `Spectating: ${target.name || "Runner"}`
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

    shouldAlwaysRevealHookedSurvivor(data) {
      const pov = this.getPovSurvivorData();
      return pov?.role === "survivor"
        && data?.role === "survivor"
        && !!data.hooked
        && !data.dead
        && !data.escaped
        && data.id !== myId;
    }

    shouldAlwaysRevealDownedSurvivor(data) {
      const pov = this.getPovSurvivorData();
      return pov?.role === "survivor"
        && data?.role === "survivor"
        && !!data.downed
        && !data.hooked
        && !data.dead
        && !data.escaped
        && data.id !== myId;
    }

    updateActorTargets(actors) {
      const seen = new Set();
      const localActor = actors.find((actor) => actor.id === myId);
      const voidSightActive = localActor?.role === "killer" && (currentSnapshot?.voidEffects?.runnerReveal || 0) > 0;
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
        const hideHookDestination = this.killerHidesRemoteHookedSurvivor(data);
        if (!hideHookDestination) {
          item.target.x = Number.isFinite(data.x) ? data.x : item.target.x;
          item.target.y = Number.isFinite(data.y) ? data.y : item.target.y;
          item.target.angle = Number.isFinite(data.angle) ? data.angle : item.target.angle;
          if (item.killerHookPosLocked) {
            const jump = dist(item.current.x, item.current.y, item.target.x, item.target.y);
            if (jump > 120) {
              item.current.x = item.target.x;
              item.current.y = item.target.y;
            }
            item.killerHookPosLocked = false;
          }
        } else {
          item.killerHookPosLocked = true;
        }

        // Actors are always position-updated from the server, even when hidden.
        // We only hide the container visually. That prevents the seen-again teleport jump.
        // Killers skip hook-teleport coordinates until they have LOS on the hooked survivor.
        const hookedLocalCanSeeVoid = this.shouldRevealVoidToHookedLocal(data, actors);
        const hookedSurvivorGlobalReveal = this.shouldAlwaysRevealHookedSurvivor(data);
        const downedSurvivorGlobalReveal = this.shouldAlwaysRevealDownedSurvivor(data);
        const voidSightGlobalReveal = voidSightActive
          && data.role === "survivor"
          && !data.dead
          && !data.escaped
          && data.id !== myId;
        item.serverVisible = data.visible !== false || data.id === myId || hookedLocalCanSeeVoid || hookedSurvivorGlobalReveal || downedSurvivorGlobalReveal || voidSightGlobalReveal;
        item.forceFullVision = !!hookedLocalCanSeeVoid || !!hookedSurvivorGlobalReveal || !!downedSurvivorGlobalReveal || !!voidSightGlobalReveal;
        item.nameText.setText(data.name || "");
        if (item.chatText) {
          const actorChat = visibleChatTextForActor(data);
          item.chatText.setText(actorChat);

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
          this.primeIntroCameraForLocalActor(data);
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
      const healAura = this.add.graphics()
        .setDepth(isKiller ? 14 : 11)
        .setScrollFactor(1, 1)
        .setVisible(false);
      // Action bars are scene-level objects, not children of the rotating actor
      // container. Keeping them separate makes healing / rescue / hook / execute
      // bars stay fixed underneath the player instead of rotating or drifting away
      // when the actor turns. A shocking development: UI bars should behave like UI bars.
      const actionBarWidth = 42;
      const actionBarHeight = 6;
      const healBarBg = this.add.rectangle(data.x || 0, (data.y || 0) + 30, actionBarWidth, actionBarHeight, 0x05070d, 0.72)
        .setOrigin(0.5, 0.5)
        .setDepth(data.role === "killer" ? 18 : 15)
        .setScrollFactor(1, 1)
        .setVisible(false);
      const healBar = this.add.rectangle((data.x || 0) - actionBarWidth / 2, (data.y || 0) + 30, 0, actionBarHeight, 0x8dff9a, 0.95)
        .setOrigin(0, 0.5)
        .setDepth(data.role === "killer" ? 19 : 16)
        .setScrollFactor(1, 1)
        .setVisible(false);
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
      container.add([outline, body, facing]);
      return {
        role: data.role,
        skin: data.skin || "blueSquare",
        container,
        body,
        outline,
        facing,
        healAura,
        healBarBg,
        healBar,
        nameText,
        chatText,
        data,
        current: { x: data.x || 0, y: data.y || 0, angle: data.angle || 0 },
        target: { x: data.x || 0, y: data.y || 0, angle: data.angle || 0 },
        dotDisplay: clamp(data.dots ?? 0, 0, SURVIVOR_DOT_MAX),
        dotDepositVisual: 0,
        dotOrbitPhase: hash2((data.id || "survivor").length, (data.id || "s").charCodeAt(0) || 0) * Math.PI * 2,
        visionAlpha: data.id === myId ? 1 : 0,
        visionTargetAlpha: data.id === myId ? 1 : 0,
        serverVisible: data.id === myId,
        forceFullVision: false
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
        const stunned = (data.voidStun || 0) > 0;
        const speedBoost = (data.voidSpeedBoost || 0) > 0;
        const angry = stunned ? 0.82 : attacking ? 1 : charging ? 0.65 : speedBoost ? 0.52 : data.recovery > 0 ? 0.38 : 0.18;
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

        item.outline.lineStyle(2, stunned ? 0xff2a45 : 0xd8b4fe, 0.44 + angry * 0.36);
        item.outline.strokeCircle(0, 0, 24 + angry * 2.4);
        item.outline.lineStyle(1, stunned ? 0xff6b7a : 0x7c3aed, 0.34 + pulse * 0.18);
        item.outline.strokeCircle(0, 0, 34 + pulse * 2.0 + angry * 3.2);
        if (stunned) {
          const stunPulse = 0.5 + Math.sin(now / 70) * 0.5;
          item.outline.lineStyle(3, 0xff2438, 0.58 + stunPulse * 0.30);
          item.outline.strokeCircle(0, 0, 39 + stunPulse * 5);
          item.outline.lineStyle(1, 0xffa1ad, 0.42);
          item.outline.strokeCircle(0, 0, 50 + stunPulse * 8);
        }
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

    drawHealingAura(item, data) {
      if (!item?.healAura || data?.role !== "survivor") return;

      const healerCount = healingActorCount(data);
      const alphaBase = clamp(item.visionAlpha ?? 0, 0, 1);
      const active = healerCount > 0
        && !data.dead
        && !data.escaped
        && !data.hooked
        && alphaBase > ACTOR_VISION.MIN_VISIBLE_ALPHA;

      item.healAura.clear();
      item.healAura.setVisible(active);
      if (!active) return;

      const now = performance.now();
      const seed = hash2((data.id || "heal").length, (data.id || "h").charCodeAt(0) || 0);
      const countBoost = clamp(healerCount - 1, 0, 4);
      const pulse = 0.5 + Math.sin(now / 190 + seed * Math.PI * 2) * 0.5;
      const slowPulse = 0.5 + Math.sin(now / 420 + seed * Math.PI) * 0.5;
      const radius = 27 + countBoost * 3.5 + pulse * 7;
      const alpha = alphaBase * (0.28 + pulse * 0.28);

      item.healAura.setPosition(item.current.x, item.current.y);
      item.healAura.setRotation(0);
      item.healAura.fillStyle(0x45ff8a, alphaBase * (0.035 + slowPulse * 0.025));
      item.healAura.fillCircle(0, 0, radius * 0.92);
      item.healAura.lineStyle(2 + Math.min(countBoost, 2) * 0.35, 0x8dff9a, alpha);
      item.healAura.strokeCircle(0, 0, radius);
      item.healAura.lineStyle(1, 0xd7ffdf, alphaBase * (0.18 + pulse * 0.18));
      item.healAura.strokeCircle(0, 0, radius + 7 + slowPulse * 3);
    }

    drawDownedSurvivorPulse(item, data) {
      if (!item?.outline || !data?.downed || data?.hooked) return;
      const now = performance.now();
      const phase = (now % 1000) / 1000;
      const alphaBase = clamp(item.visionAlpha ?? 0, 0, 1);
      const radius = 22 + phase * 55;
      const alpha = alphaBase * (1 - phase) * (LOW_POWER_MODE ? 0.46 : 0.62);

      item.outline.lineStyle(LOW_POWER_MODE ? 2 : 2.8, 0xff1f3a, alpha);
      item.outline.strokeCircle(0, 0, radius);

      const corePulse = 0.5 + Math.sin(now / 160) * 0.5;
      item.outline.lineStyle(1.5, 0xff8fa3, alphaBase * (0.28 + corePulse * 0.26));
      item.outline.strokeCircle(0, 0, 23 + corePulse * 4);
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

    emitVoidRushTrail(item, data) {
      if (!item || !data || data.role !== "killer" || !(data.voidSpeedBoost > 0)) return;
      const now = performance.now();
      const gap = LOW_POWER_MODE ? 130 : 72;
      if (item.lastVoidRushBubbleAt && now - item.lastVoidRushBubbleAt < gap) return;
      item.lastVoidRushBubbleAt = now;

      const angle = Number.isFinite(data.angle) ? data.angle : (item.current?.angle || 0);
      const baseX = item.current?.x ?? data.x ?? 0;
      const baseY = item.current?.y ?? data.y ?? 0;
      const count = LOW_POWER_MODE ? 1 : 2;
      for (let i = 0; i < count; i += 1) {
        const side = (Math.random() - 0.5) * 22;
        const back = 22 + Math.random() * 18 + i * 7;
        const x = baseX - Math.cos(angle) * back + Math.cos(angle + Math.PI / 2) * side;
        const y = baseY - Math.sin(angle) * back + Math.sin(angle + Math.PI / 2) * side;
        const radius = 3.5 + Math.random() * 4.5;
        const bubble = this.add.circle(x, y, radius, 0xf8fafc, LOW_POWER_MODE ? 0.30 : 0.42)
          .setDepth(10)
          .setBlendMode(Phaser.BlendModes.SCREEN);
        this.tweens.add({
          targets: bubble,
          alpha: 0,
          scale: 1.75 + Math.random() * 0.55,
          x: x - Math.cos(angle) * (10 + Math.random() * 10),
          y: y - Math.sin(angle) * (10 + Math.random() * 10),
          duration: LOW_POWER_MODE ? 260 : 340,
          ease: "Quad.easeOut",
          onComplete: () => bubble.destroy()
        });
      }
    }

    styleActor(item, data) {
      if (data.role === "killer") {
        if (item.healAura) {
          item.healAura.clear();
          item.healAura.setVisible(false);
        }
        const charging = data.attackState === "charging";
        const attacking = data.attacking || data.attackState === "quick" || data.attackState === "lunge";
        const now = performance.now();
        const voidStateKey = `${data.attackState || "idle"}:${data.attacking ? 1 : 0}:${data.recovery > 0 ? 1 : 0}:${data.voidStun > 0 ? 1 : 0}:${data.voidSpeedBoost > 0 ? 1 : 0}`;
        const redrawEvery = LOW_POWER_MODE ? 150 : 95;
        // The Void still animates, but not by redrawing 20+ circles every single frame.
        // Position updates remain smooth because the container moves independently.
        if (item.lastVoidStateKey !== voidStateKey || !item.lastVoidDrawAt || now - item.lastVoidDrawAt >= redrawEvery) {
          item.lastVoidStateKey = voidStateKey;
          item.lastVoidDrawAt = now;
          this.drawActorShape(item, data, COLORS.killer, 1, 0xd8b4fe, attacking ? 1 : 0.84);
        }
        item.facing.setFillStyle(data.voidStun > 0 ? 0xff3048 : attacking ? 0xf5d0fe : 0xc084fc, data.voidStun > 0 ? 0.76 : attacking ? 0.82 : data.recovery > 0 ? 0.24 : charging ? 0.72 : 0.48);
      } else {
        const skin = getSurvivorSkin(data.skin);
        let color = data.health <= 1 || data.injured ? COLORS.survivorInjured : skin.color;
        if (data.downed) color = COLORS.downed;
        if (data.hooked) color = COLORS.hook;
        const disabled = data.dead || data.escaped;
        const downedHealProgress = data.downed && data.healProgress > 0 ? data.healProgress : 0;
        const hookOrExecuteProgress = data.downed && (data.hookProgress || 0) > 0 && downedHealProgress <= 0;
        const progress = data.hooked ? (data.unhookProgress || 0) : data.downed ? (downedHealProgress || data.hookProgress || 0) : (data.healProgress || 0);
        const showProgress = progress > 0 && !data.dead && !data.escaped;
        const progressColor = data.hooked ? 0x75d5ff : downedHealProgress ? 0x8dff9a : hookOrExecuteProgress ? 0xff4040 : data.downed ? 0xffb36b : 0x8dff9a;
        const outlineColor = showProgress ? progressColor : data.invuln > 0 ? 0xffffff : data.hooked ? 0xffc06a : skin.outline;
        this.drawActorShape(item, data, data.dead ? 0x555555 : color, disabled ? 0.45 : 1, outlineColor, showProgress || data.invuln > 0 ? 1 : 0.82);
        this.drawHealingAura(item, data);
        if (data.downed && !disabled && !data.hooked && (item.visionAlpha ?? 0) > ACTOR_VISION.MIN_VISIBLE_ALPHA) {
          this.drawDownedSurvivorPulse(item, data);
        }
        if (data.hooked && !disabled && (item.visionAlpha ?? 0) > ACTOR_VISION.MIN_VISIBLE_ALPHA) {
          this.drawHookedSurvivorPulse(item, data);
        }
        item.facing.setFillStyle(0xffffff, disabled || data.hooked ? 0.15 : 0.42);
        if (item.healBarBg && item.healBar) {
          const barVisible = showProgress && (item.visionAlpha ?? 0) > ACTOR_VISION.MIN_VISIBLE_ALPHA;
          item.healBarBg.setVisible(barVisible);
          item.healBar.setVisible(barVisible);
          item.healBar.setFillStyle(progressColor, 0.96);
          item.healBar.width = 42 * clamp(progress, 0, 1);
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
          const hookSiteHiddenFromKiller = this.getPovSurvivorData()?.role === "killer"
            && !this.killerCanRevealWorldPoint(event.x, event.y);
          if (!hookSiteHiddenFromKiller && Number.isFinite(event.x) && Number.isFinite(event.y) && this.getPovSurvivorData()?.role === "survivor") {
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
        if (event.type === "unhooked") playLocalizedUnhookComplete(event);
        if (event.type === "vault" && event.actorId === myId) {
          if (event.vaultType === "pallet") playSfx("palletVault");
          else playSfx("windowVault");
        }
        if (["hit", "death", "execute", "downed", "hooked", "unhooked"].includes(event.type)) {
          const heavy = event.type === "death" || event.type === "execute" || event.type === "downed" || event.type === "hooked";
          const hookBurstHidden = event.type === "hooked"
            && this.getPovSurvivorData()?.role === "killer"
            && !this.killerCanRevealWorldPoint(event.x, event.y);
          if (!hookBurstHidden) {
            const color = event.type === "unhooked" ? 0x75d5ff : event.type === "hooked" ? COLORS.hook : COLORS.blood;
            this.burst(event.x, event.y, color, event.type === "hooked" ? 52 : event.type === "execute" || event.type === "death" ? 62 : 38, event.type === "unhooked" ? 140 : 220);
          }

          const isLocalSurvivorEvent = event.survivorId === myId;
          const shouldShakeForImpact = (event.type === "hit" || event.type === "downed") && isLocalSurvivorEvent;
          const shouldShakeForStateChange = ["death", "execute", "hooked"].includes(event.type) && isLocalSurvivorEvent;
          if (shouldShakeForImpact || shouldShakeForStateChange) {
            const impactDuration = shouldShakeForImpact
              ? (heavy ? (LOW_POWER_MODE ? 220 : 280) : (LOW_POWER_MODE ? 130 : 175))
              : (heavy ? 210 : 110);
            const impactStrength = shouldShakeForImpact
              ? (heavy ? (LOW_POWER_MODE ? 0.0058 : 0.0074) : (LOW_POWER_MODE ? 0.0038 : 0.0052))
              : (heavy ? 0.0055 : 0.0032);
            this.cameras.main.shake(impactDuration, impactStrength);
            if (shouldShakeForImpact) triggerSurvivorHitImpact(heavy);
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
        if (event.type === "voidStun" || event.type === "killerStun") {
          playLocalizedVoidStun(event);
          this.burst(event.x, event.y, 0xff3048, LOW_POWER_MODE ? 26 : 46, LOW_POWER_MODE ? 150 : 230);
          this.addShockwave(event.x, event.y, 0xff1f3a, 0.88, LOW_POWER_MODE ? 105 : 165);
          this.addShockwave(event.palletX || event.x, event.palletY || event.y, 0xff5268, 0.54, LOW_POWER_MODE ? 84 : 125);
          if (event.killerId === myId) {
            this.cameras.main.shake(LOW_POWER_MODE ? 140 : 190, LOW_POWER_MODE ? 0.0032 : 0.0052);
          }
        }
        if (event.type === "voidAbility") {
          const color = event.abilityId === "redshiftOrbs" ? 0xff3048 : event.abilityId === "voidReveal" ? 0xa78bfa : 0xcbd5e1;
          this.burst(event.x, event.y, color, LOW_POWER_MODE ? 18 : 34, LOW_POWER_MODE ? 130 : 210);
          this.addShockwave(event.x, event.y, color, 0.55, event.radius || (LOW_POWER_MODE ? 110 : 155));
        }
        if (event.type === "redOrbSlow") {
          this.burst(event.x, event.y, 0xff3048, LOW_POWER_MODE ? 10 : 18, 95);
        }
        if (event.type === "voidOrbSteal") {
          this.burst(event.x, event.y, 0xfbbf24, LOW_POWER_MODE ? 12 : 20, 105);
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
          points.push({
            x: x + Math.cos(a) * range,
            y: y + Math.sin(a) * range
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
      item.container?.setScale(LOW_POWER_MODE ? 0.78 : 0.66);

      const introLocked = this.isMatchIntroLocked();
      const primary = item.data?.role === "killer" ? 0xa772ff : 0x31a9ff;
      const secondary = item.data?.role === "killer" ? 0x4c1d95 : COLORS.collectibleDotGlow;
      this.addShockwave(x, y, primary, LOW_POWER_MODE ? 0.46 : 0.62, introLocked ? 74 : (LOW_POWER_MODE ? 82 : 118));
      this.addShockwave(x, y, secondary, LOW_POWER_MODE ? 0.34 : 0.48, introLocked ? 48 : (LOW_POWER_MODE ? 52 : 78));
      this.burst(x, y, primary, introLocked ? (LOW_POWER_MODE ? 8 : 14) : (LOW_POWER_MODE ? 18 : 34), introLocked ? 120 : (LOW_POWER_MODE ? 145 : 210));
      this.burst(x, y, secondary, introLocked ? (LOW_POWER_MODE ? 6 : 10) : (LOW_POWER_MODE ? 12 : 24), introLocked ? 80 : (LOW_POWER_MODE ? 95 : 145));

      if (!introLocked) {
        this.cameras.main.shake(LOW_POWER_MODE ? 80 : 120, LOW_POWER_MODE ? 0.0009 : 0.0015);
      }
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
      updateHealingSfx(dt);
      updateUnhookingSfx(dt);
      this.updateAimAngle();
      if (this.isMatchIntroLocked()) clearMovementInputOnly();
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
      this.updateHookIndicators();
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

    syncVaultPlayback(playback, data, dt) {
      const duration = vaultDurationForRole(data.role);
      const hasEndpoints = Number.isFinite(data.vaultFromX)
        && Number.isFinite(data.vaultFromY)
        && Number.isFinite(data.vaultToX)
        && Number.isFinite(data.vaultToY);
      if (!hasEndpoints) return null;

      const signature = `${data.vaultFromX},${data.vaultFromY},${data.vaultToX},${data.vaultToY}`;
      if (!playback || playback.signature !== signature) {
        playback = {
          signature,
          fromX: data.vaultFromX,
          fromY: data.vaultFromY,
          toX: data.vaultToX,
          toY: data.vaultToY,
          t: 0,
          duration
        };
      }

      playback.t = Math.min(playback.duration, playback.t + dt);
      if (Number.isFinite(data.vaultProgress) && data.vaultProgress > 0) {
        playback.t = Math.max(playback.t, data.vaultProgress * playback.duration);
      }

      const eased = vaultEase(playback.t / playback.duration);
      return {
        playback,
        x: playback.fromX + (playback.toX - playback.fromX) * eased,
        y: playback.fromY + (playback.toY - playback.fromY) * eased
      };
    }

    isMatchIntroLocked() {
      if (activeScreenName !== "game") return false;
      const localZoom = Math.max(0, ((this.matchStartZoomUntil || 0) - performance.now()) / 1000);
      const serverLock = Math.max(0, Number(this.matchStartFreezeRemaining || 0));
      return Math.max(localZoom, serverLock) > 0.035;
    }

    primeIntroCameraForLocalActor(data) {
      if (this.introCameraPrimed || !data || !this.isMatchIntroLocked()) return;
      const x = Number(data.x);
      const y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this.introCameraPrimed = true;
      this.cameraSwayX = 0;
      this.cameraSwayY = 0;
      this.cameraSwayTargetX = 0;
      this.cameraSwayTargetY = 0;
      this.localVisual = { x, y, angle: data.angle || 0, role: data.role, skin: data.skin || "blueSquare" };
      const introZoom = Math.max(0.38, IMMERSION.BASE_ZOOM - IMMERSION.MATCH_START_ZOOM_OUT);
      this.cameras.main.setZoom(introZoom);
      this.cameras.main.centerOn(x, y);
    }

    predictLocal(dt) {
      if (!this.map || !this.localVisual || !this.localServerTarget?.data) return;
      const data = this.localServerTarget.data;
      this.localVisual.angle = input.angle;

      if (this.isMatchIntroLocked()) {
        clearMovementInputOnly();
        this.localVisual.x += (this.localServerTarget.x - this.localVisual.x) * 0.55;
        this.localVisual.y += (this.localServerTarget.y - this.localVisual.y) * 0.55;
        return;
      }

      if (data.vaulting) {
        const vault = this.syncVaultPlayback(this.localVaultPlayback, data, dt);
        if (vault) {
          this.localVaultPlayback = vault.playback;
          this.localVisual.x = vault.x;
          this.localVisual.y = vault.y;
          return;
        }
      } else {
        this.localVaultPlayback = null;
      }

      if (data.dead || data.escaped || data.hooked || data.breaking || (data.role === "killer" && data.voidStun > 0)) {
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
      if (data.role === "survivor" && (data.orbSlow || data.voidSlow || 0) > 0) speed *= 0.58;
      if (data.role === "killer" && (data.voidSpeedBoost || 0) > 0) speed *= 1.28;
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
        for (const gen of this.visibleGenerators()) {
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

    computeActorPointVisionAlpha(worldX, worldY, subject) {
      if (!subject) return 0;
      const role = subject.data?.role || "survivor";
      const sourceX = subject.current?.x ?? subject.container?.x ?? 0;
      const sourceY = subject.current?.y ?? subject.container?.y ?? 0;
      const facing = subject.current?.angle ?? subject.container?.rotation ?? 0;
      const length = (role === "killer" ? LIGHTING.KILLER_LENGTH : LIGHTING.SURVIVOR_LENGTH) + WALL_VISION.CONE_EXTRA_LENGTH;
      const coneAngle = (role === "killer" ? LIGHTING.KILLER_ANGLE : LIGHTING.SURVIVOR_ANGLE) + WALL_VISION.CONE_EXTRA_ANGLE;
      const nearRadius = role === "killer" ? WALL_VISION.KILLER_NEAR_RADIUS : WALL_VISION.SURVIVOR_NEAR_RADIUS;
      const r = ACTOR_VISION.POINT_RADIUS;
      const pointItem = {
        rect: { x: worldX - r, y: worldY - r, w: r * 2, h: r * 2 },
        radius: r,
        samples: [{ x: worldX, y: worldY }]
      };
      return this.computeWallVisionAlpha(pointItem, sourceX, sourceY, facing, length, coneAngle, nearRadius);
    }

    computePointVisionAlpha(worldX, worldY, subject) {
      const coneAlpha = this.computeActorPointVisionAlpha(worldX, worldY, subject);
      if (coneAlpha <= WALL_VISION.MIN_VISIBLE_ALPHA) return 0;
      const sourceX = subject?.current?.x ?? subject?.container?.x ?? 0;
      const sourceY = subject?.current?.y ?? subject?.container?.y ?? 0;
      if (!this.hasClearWallLineOfSight(sourceX, sourceY, worldX, worldY)) return 0;
      return coneAlpha;
    }

    updateActorVisionAlpha(dt) {
      const subject = this.getCameraSubjectItem();
      const fadeInRate = ACTOR_VISION.FADE_IN_PER_SECOND;
      const fadeOutRate = ACTOR_VISION.FADE_OUT_PER_SECOND;
      const minAlpha = ACTOR_VISION.MIN_VISIBLE_ALPHA;
      const nameAlpha = ACTOR_VISION.NAME_CHAT_ALPHA;

      for (const [id, item] of this.actors.entries()) {
        const data = item.data || {};
        let target = 0;

        if (id === myId) {
          target = this.isSpectating() ? 0.32 : 1;
        } else if (item.forceFullVision) {
          target = 1;
        } else if (item.serverVisible) {
          target = subject ? this.computePointVisionAlpha(item.current.x, item.current.y, subject) : 1;
        }

        item.visionTargetAlpha = target;
        const rate = target > (item.visionAlpha ?? 0) ? fadeInRate : fadeOutRate;
        item.visionAlpha = lerp(item.visionAlpha ?? 0, target, dampAlpha(rate, dt));

        let alpha = item.visionAlpha;
        if (alpha < minAlpha && target <= minAlpha) alpha = 0;

        item.container.setVisible(true);
        item.container.setAlpha(clamp(alpha, 0, 1));

        const showNames = alpha > nameAlpha && id !== myId;
        const actorChat = visibleChatTextForActor(data);
        const showChat = !!actorChat && (id === myId || showNames);
        if (item.nameText) {
          item.nameText.setVisible(showNames);
          item.nameText.setAlpha(alpha);
        }
        if (item.chatText) {
          item.chatText.setVisible(showChat);
          item.chatText.setAlpha(id === myId ? 1 : alpha);
        }
        if (item.healAura) item.healAura.setAlpha(alpha);
        if (item.healBarBg && item.healBar) {
          item.healBarBg.setAlpha(alpha);
          item.healBar.setAlpha(alpha);
        }
      }
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

      const subjectVaulting = !!subject?.data?.vaulting;
      this.wallVisionTimer = (this.wallVisionTimer || 0) + dt;
      const shouldRecompute = subjectVaulting || this.wallVisionTimer >= 1 / PERFORMANCE.WALL_VISION_FPS;
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
        } else if (item.data?.vaulting) {
          const vault = this.syncVaultPlayback(item.vaultPlayback, item.data, dt);
          if (vault) {
            item.vaultPlayback = vault.playback;
            item.current.x = vault.x;
            item.current.y = vault.y;
          } else {
            item.current.x = lerp(item.current.x, item.target.x, 0.35);
            item.current.y = lerp(item.current.y, item.target.y, 0.35);
          }
          item.current.angle = lerpAngle(item.current.angle, item.target.angle, 0.24);
        } else {
          item.vaultPlayback = null;
          if (!this.killerHidesRemoteHookedSurvivor(item.data)) {
            item.current.x = lerp(item.current.x, item.target.x, 0.22);
            item.current.y = lerp(item.current.y, item.target.y, 0.22);
            item.current.angle = lerpAngle(item.current.angle, item.target.angle, 0.24);
          }
        }
        item.container.setPosition(item.current.x, item.current.y);
        item.container.rotation = item.current.angle || 0;
        if (item.data?.role === "killer" && (item.data?.voidSpeedBoost || 0) > 0) {
          this.emitVoidRushTrail(item, item.data);
        }
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
      }

      this.updateActorVisionAlpha(dt);

      for (const [id, item] of this.actors.entries()) {
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
        if (item.healBarBg && item.healBar) {
          const barWidth = 42;
          const barY = item.current.y + 30;
          item.healBarBg.setPosition(item.current.x, barY);
          item.healBarBg.setRotation(0);
          item.healBar.setPosition(item.current.x - barWidth / 2, barY);
          item.healBar.setRotation(0);
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
          localData?.role === "killer" && (currentSnapshot?.voidEffects?.runnerReveal || 0) > 0 ? IMMERSION.VOID_REVEAL_ZOOM : null,
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
      const startLockEase = startLockT * startLockT * (3 - 2 * startLockT);
      const startLockZoom = startLockT > 0 ? -IMMERSION.MATCH_START_ZOOM_OUT * startLockEase : 0;

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
        IMMERSION.VOID_REVEAL_ZOOM,
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
        IMMERSION.VOID_REVEAL_ZOOM,
        IMMERSION.SPAWN_ZOOM,
        -IMMERSION.MATCH_START_ZOOM_OUT
      );

      const minZoom = Math.max(0.12, Math.min(IMMERSION.MIN_ZOOM, IMMERSION.BASE_ZOOM + negativeFloor - 0.04));
      const maxZoom = Math.max(IMMERSION.BASE_ZOOM + 0.05, IMMERSION.BASE_ZOOM + positiveCeiling + 0.04);
      // During the opening lockout, ignore gameplay zoom candidates so the startup zoom has one target.
      // This prevents spawn/chase/downed zoom offsets from fighting the intro camera move.
      const cameraEffectZoom = startLockT > 0 ? 0 : strongestZoom;
      const targetZoom = clamp(
        IMMERSION.BASE_ZOOM + cameraEffectZoom + startLockZoom,
        minZoom,
        maxZoom
      );
      const zoomSmooth = startLockT > 0 ? IMMERSION.MATCH_START_ZOOM_SMOOTHING : IMMERSION.ZOOM_SMOOTHING;
      const zoomAlpha = dampAlpha(zoomSmooth, dt);
      const nextZoom = startLockT > 0
        ? targetZoom
        : lerp(cam.zoom || IMMERSION.BASE_ZOOM, targetZoom, zoomAlpha);
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
      const moving = startLockT > 0 ? false : Math.hypot(moveX, moveY) > 0.2;
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
      if (this.riftsAreComplete()) return "rifts-hidden";
      return this.visibleGenerators().map((g) => {
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
      const generators = this.visibleGenerators();
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

    updateHookIndicators() {
      if (!currentSnapshot || !this.actors.has(myId) || activeScreenName !== "game") {
        if (this.lastHookIndicatorSignature) {
          this.lastHookIndicatorSignature = "";
          dispatchHookIndicators([]);
        }
        return;
      }

      const me = this.getPovSurvivorData();
      if (!me || me.role !== "survivor" || me.dead || me.escaped) {
        if (this.lastHookIndicatorSignature) {
          this.lastHookIndicatorSignature = "";
          dispatchHookIndicators([]);
        }
        return;
      }

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

      if (!hookedSurvivors.length) {
        if (this.lastHookIndicatorSignature) {
          this.lastHookIndicatorSignature = "";
          dispatchHookIndicators([]);
        }
        return;
      }

      const cam = this.cameras.main;
      const viewW = cam.width || window.innerWidth || 1;
      const viewH = cam.height || window.innerHeight || 1;
      const centerX = viewW / 2;
      const centerY = viewH / 2;
      const edgePadding = HOOK_INDICATOR.EDGE_PADDING;
      const onScreenPadding = HOOK_INDICATOR.ON_SCREEN_PADDING;
      const worldView = cam.worldView;
      const worldLeft = Number.isFinite(worldView?.x) ? worldView.x : cam.scrollX;
      const worldTop = Number.isFinite(worldView?.y) ? worldView.y : cam.scrollY;
      const worldWidth = Math.max(1, Number.isFinite(worldView?.width) ? worldView.width : viewW / Math.max(0.001, cam.zoom || 1));
      const worldHeight = Math.max(1, Number.isFinite(worldView?.height) ? worldView.height : viewH / Math.max(0.001, cam.zoom || 1));
      const indicators = [];

      for (const actor of hookedSurvivors) {
        const screenX = ((actor.x - worldLeft) / worldWidth) * viewW;
        const screenY = ((actor.y - worldTop) / worldHeight) * viewH;

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

        const x = Math.round((centerX + dx * scale) / HOOK_INDICATOR.POSITION_ROUNDING) * HOOK_INDICATOR.POSITION_ROUNDING;
        const y = Math.round((centerY + dy * scale) / HOOK_INDICATOR.POSITION_ROUNDING) * HOOK_INDICATOR.POSITION_ROUNDING;
        const angle = Math.atan2(dy, dx);
        const id = actor.id || actor.survivorId || `${Math.round(actor.x)}:${Math.round(actor.y)}`;

        indicators.push({
          id,
          x,
          y,
          angle,
          danger: (actor.hookCount || 1) >= 2,
          name: actor.name || "Runner"
        });
      }

      const signature = indicators
        .map((item) => `${item.id}:${Math.round(item.x)}:${Math.round(item.y)}:${item.danger ? 1 : 0}`)
        .join("|");

      if (signature !== this.lastHookIndicatorSignature) {
        this.lastHookIndicatorSignature = signature;
        dispatchHookIndicators(indicators);
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
      toast("Game renderer failed to load. Run npm install and restart the server.", 5000);
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
    window.__voidriftGame = game;
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

  function canSpectateLiveTeammate() {
    return getLivingTeammates(currentSnapshot).length > 0;
  }

  function setSpectateButtonVisible(visible) {
    ui.spectateBtn?.classList.toggle("hidden", !visible);
  }

  function showEscapedScreen() {
    const canSpectate = canSpectateLiveTeammate();
    if (ui.endStats) ui.endStats.innerHTML = "";
    if (ui.winnerText) ui.winnerText.textContent = "You Escaped";
    if (ui.reasonText) ui.reasonText.textContent = canSpectate
      ? "You slipped through the void. The run is still alive."
      : "You slipped through the void. No live Runners remain to spectate.";
    setSpectateButtonVisible(canSpectate);
    if (ui.backToLobbyBtn) ui.backToLobbyBtn.textContent = "Back to Lobby";
    showEndScreenWithFade();
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
      const canSpectate = canSpectateLiveTeammate();
      if (ui.endStats) ui.endStats.innerHTML = "";
      if (ui.winnerText) ui.winnerText.textContent = "You Perished...";
      if (ui.reasonText) ui.reasonText.textContent = canSpectate
        ? "The run is still going. You can keep spectating."
        : "No live Runners remain to spectate.";
      setSpectateButtonVisible(canSpectate);
      if (ui.backToLobbyBtn) ui.backToLobbyBtn.textContent = "Back to Lobby";
      showEndScreenWithFade();
      return true;
    }

    return false;
  }

  function formatStatSeconds(value) {
    const seconds = Math.max(0, Math.round(Number(value || 0)));
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return minutes > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest}s`;
  }

  function statItem(label, value) {
    return `<div class="end-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function renderFinalStats(finalActors = []) {
    if (!ui.endStats) return;
    const actors = Array.isArray(finalActors) ? finalActors : [];
    if (!actors.length) {
      ui.endStats.innerHTML = "";
      return;
    }

    const sorted = [...actors].sort((a, b) => {
      if (a.id === myId) return -1;
      if (b.id === myId) return 1;
      if (a.role !== b.role) return a.role === "killer" ? -1 : 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    ui.endStats.innerHTML = sorted.map((actor) => {
      const stats = actor.stats || {};
      const isVoid = actor.role === "killer";
      const state = isVoid
        ? "The Void"
        : stats.escaped || actor.escaped
          ? "Escaped"
          : actor.dead
            ? "Dead"
            : actor.hooked
              ? "Hooked"
              : actor.downed
                ? "Downed"
                : "Lost";
      const statHtml = isVoid
        ? [
            statItem("Rifts kicked", stats.riftsKicked || 0),
            statItem("Orbs collected", stats.orbsCollected || 0),
            statItem("Injures", stats.injures || 0),
            statItem("Hooks", stats.hooks || 0),
            statItem("Deaths", stats.deaths || 0),
            statItem("Abilities used", stats.abilitiesUsed || 0)
          ].join("")
        : [
            statItem("Orbs collected", stats.orbsCollected || 0),
            statItem("Orbs deposited", stats.orbsDeposited || 0),
            statItem("Heals", stats.teammatesHealed || 0),
            statItem("Unhooks", stats.unhooks || 0),
            statItem("Escaped", (stats.escaped || actor.escaped) ? "Yes" : "No"),
            statItem("Chase total", formatStatSeconds(stats.chaseSeconds)),
            statItem("Longest chase", formatStatSeconds(stats.longestChase))
          ].join("");

      return `
        <article class="end-stat-card ${isVoid ? "is-void" : "is-runner"}${actor.id === myId ? " is-you" : ""}">
          <div class="end-stat-head">
            <div>
              <strong>${escapeHtml(actor.name || (isVoid ? "The Void" : "Runner"))}</strong>
              <span>${escapeHtml(state)}${actor.id === myId ? " • You" : ""}</span>
            </div>
            <i>${escapeHtml(isVoid ? "VOID" : "RUNNER")}</i>
          </div>
          <div class="end-stat-grid">${statHtml}</div>
        </article>
      `;
    }).join("");
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
    renderFinalStats(finalActors);

    if (localEscaped) {
      if (ui.winnerText) ui.winnerText.textContent = "You Escaped";
      if (ui.reasonText) ui.reasonText.textContent = "You slipped through the void. The run is over.";
    } else if (localPerished) {
      if (ui.winnerText) ui.winnerText.textContent = "You Perished...";
      if (ui.reasonText) ui.reasonText.textContent = "The others escaped, but The Void claimed you.";
    } else {
      if (ui.winnerText) ui.winnerText.textContent = winner === "killer" ? "The Void Wins" : "Runners Escape";
      if (ui.reasonText) ui.reasonText.textContent = reason || "Run ended.";
    }

    if (ui.backToLobbyBtn) ui.backToLobbyBtn.textContent = "Back to Lobby";
    showEndScreenWithFade();
  }

  function setupUI() {
    setupUiClickSfx();
    syncMenuMusicToggleUi();
    const bindMenuMusicToggle = (btn) => {
      btn?.addEventListener("click", () => {
        toggleMenuMusicMuted();
      });
    };
    bindMenuMusicToggle(ui.menuMusicToggleBtn);
    bindMenuMusicToggle(ui.menuMusicToggleBtnOptions);
    bindMenuMusicVolumeSlider(ui.menuMusicVolumeSlider);
    syncMenuMusicVolumeUi();
    setSelectedRole(selectedRole);

    ui.menuPlayBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("play"); });
    ui.menuSkinsBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("skins"); });
    ui.menuOptionsBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("options"); });
    ui.menuHowBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("how"); });
    ui.menuBackBtns?.forEach((btn) => {
      btn.addEventListener("click", () => showScreen(btn.dataset.screen || "menu"));
    });

    ui.roleBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        setSelectedRole(btn.dataset.role);
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
      if (!canSpectateLiveTeammate()) {
        setSpectateButtonVisible(false);
        toast("No live Runners left to spectate.", 2200);
        return;
      }
      showGameScreenWithFade(() => {
        ensureAudioStarted();
        const targetId = phaserScene?.pickDefaultSpectateTarget?.();
        if (!targetId) {
          showEndScreenWithFade();
          setSpectateButtonVisible(false);
          toast("No live Runners left to spectate.", 2200);
        }
      });
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
      const voidCount = Number.isFinite(Number(lobby.killerCount)) ? Number(lobby.killerCount) : (lobby.killer ? 1 : 0);
      const voidLabel = `${voidCount} Void player${voidCount === 1 ? "" : "s"}`;
      left.innerHTML = `<strong>${escapeHtml(lobby.name)}</strong><small>${escapeHtml(lobby.mapName || "Map")} • ${lobby.survivors}/${lobby.maxSurvivors} Runners • ${voidLabel}</small>`;
      const button = document.createElement("button");
      button.textContent = lobby.phase === "lobby" ? "Join" : "In Run";
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

    const players = state.players || [];
    const voidCount = players.filter((player) => player.role === "killer").length;
    const survivorCount = players.filter((player) => player.role === "survivor").length;
    const maxSurvivors = Number.isFinite(Number(state.maxSurvivors)) ? Number(state.maxSurvivors) : 4;
    const humanPlayers = players.filter((player) => !player.isBot);
    const allHumansReady = humanPlayers.length > 0 && humanPlayers.every((player) => !!player.ready);
    const canStartRun = allHumansReady && voidCount === 1 && survivorCount >= 1;
    const statusLine = `${survivorCount}/${maxSurvivors} Runners • ${voidCount} Void player${voidCount === 1 ? "" : "s"}`;
    const subtitle = voidCount === 1
      ? `${statusLine}. Ready up, then start the run.`
      : `${statusLine}. The run needs exactly 1 Void.`;
    const lobbySubtitle = document.getElementById("lobbySubtitle");
    if (lobbySubtitle) lobbySubtitle.textContent = subtitle;

    const renderPlayerRow = (player) => {
      const item = document.createElement("div");
      const isKiller = player.role === "killer";
      item.className = `player-item ${isKiller ? "is-killer" : "is-survivor"}${player.id === myId ? " is-you" : ""}${player.isBot ? " is-bot" : ""}`;

      const emblem = document.createElement("span");
      emblem.className = `player-role-emblem ${isKiller ? "killer" : "survivor"}`;
      emblem.setAttribute("aria-hidden", "true");

      const summary = document.createElement("div");
      summary.className = "player-summary";

      const name = document.createElement("strong");
      name.title = player.name || "Player";
      name.append(document.createTextNode(player.name || "Player"));
      if (player.id === myId) {
        const you = document.createElement("em");
        you.textContent = " (You)";
        name.appendChild(you);
      }

      const meta = document.createElement("small");
      const roleName = document.createElement("span");
      roleName.className = "player-role-name";
      roleName.textContent = `${isKiller ? "The Void" : "Runner"}${player.isBot ? " bot" : ""}`;

      const dot = document.createElement("span");
      dot.className = "player-dot";
      dot.textContent = "•";

      const skin = document.createElement("span");
      const skinName = isKiller ? "Void Core" : getSurvivorSkin(player.skin).label;
      skin.className = "player-skin-name";
      skin.title = skinName;
      skin.textContent = skinName;

      meta.append(roleName, dot, skin);
      summary.append(name, meta);

      const ready = document.createElement("small");
      const isReady = player.isBot || !!player.ready;
      ready.className = `player-ready ${isReady ? "is-ready" : ""}`;
      ready.textContent = isReady ? "Ready" : "Not ready";

      item.append(emblem, summary, ready);

      if (player.isBot) {
        const kick = document.createElement("button");
        kick.className = "bot-kick-btn";
        kick.type = "button";
        kick.textContent = "Kick";
        kick.title = `Kick ${player.name || "bot"}`;
        kick.addEventListener("click", () => socket.emit("removeBot", { botId: player.id }));
        item.appendChild(kick);
      }

      return item;
    };

    const appendPlayerGroup = (title, countLabel, groupClass, groupPlayers) => {
      const group = document.createElement("section");
      group.className = `player-group ${groupClass}`;

      const heading = document.createElement("div");
      heading.className = "player-group-heading";

      const label = document.createElement("span");
      label.textContent = title;

      const count = document.createElement("small");
      count.textContent = countLabel;

      heading.append(label, count);
      group.appendChild(heading);

      const body = document.createElement("div");
      body.className = "player-group-list";

      if (groupPlayers.length) {
        for (const player of groupPlayers) body.appendChild(renderPlayerRow(player));
      } else {
        const empty = document.createElement("div");
        empty.className = "player-group-empty";
        empty.textContent = groupClass === "void-group" ? "No Void selected yet." : "No runners selected yet.";
        body.appendChild(empty);
      }

      group.appendChild(body);
      ui.playersList.appendChild(group);
    };

    const voidPlayers = players.filter((player) => player.role === "killer");
    const survivorPlayers = players.filter((player) => player.role !== "killer");
    appendPlayerGroup("Void player", `${voidPlayers.length} selected`, "void-group", voidPlayers);
    appendPlayerGroup("Runners", `${survivorPlayers.length}/${maxSurvivors}`, "survivor-group", survivorPlayers);
    const mine = players.find((p) => p.id === myId);
    if (mine?.role) setSelectedRole(mine.role);
    if (mine?.role === "survivor" && SURVIVOR_SKINS[mine.skin]) {
      setSelectedSkin(mine.skin);
    }
    ui.readyBtn.textContent = mine?.ready ? "Unready" : "Ready";
    ui.readyBtn.dataset.readyState = mine?.ready ? "unready" : "ready";
    if (ui.startBtn) {
      ui.startBtn.disabled = !canStartRun;
      ui.startBtn.title = canStartRun ? "Start the run" : "Every human Runner and Void player has to ready up, and exactly 1 Void is required.";
    }
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
    closeReactChatWheel(false);
    closeReactAbilityWheel(false);
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
      if (isIntroInputLocked() && INTRO_LOCKED_KEY_CODES.has(e.code)) {
        e.preventDefault();
        clearMovementInputOnly();
        sendInput({}, true);
        return;
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        if (!e.repeat) openReactChatWheel(e);
        return;
      }
      if (e.code === "KeyQ") {
        e.preventDefault();
        if (!e.repeat) openReactAbilityWheel(e);
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
        closeReactChatWheel(true);
        return;
      }
      if (e.code === "KeyQ") {
        e.preventDefault();
        closeReactAbilityWheel(true);
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
      if (isIntroInputLocked()) {
        resetStick();
        return;
      }
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
        if (isIntroInputLocked() && action !== "chat") {
          clearMovementInputOnly();
          sendInput({}, true);
          return;
        }
        if (action === "sprint") input.sprint = true;
        if (action === "interact") input.repair = true;
        if (action === "action") sendInput({ action: true }, true);
        if (action === "attack") {
          input.attackHeld = true;
          sendInput({}, true);
        }
        if (action === "chat") openReactChatWheel(e);
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
          closeReactChatWheel(true);
          return;
        }
        sendTouchInput(true);
      };

      button.addEventListener("pointerup", release, { passive: false });
      button.addEventListener("pointercancel", release, { passive: false });
    }
  }

  function setupSockets() {
    const socketOptions = {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 650,
      reconnectionDelayMax: 3500,
      timeout: 10000
    };
    const configuredSocketUrl = typeof window.RIFTRUNNER_SOCKET_URL === "string"
      ? window.RIFTRUNNER_SOCKET_URL.trim()
      : "";
    socket = configuredSocketUrl ? io(configuredSocketUrl, socketOptions) : io(socketOptions);
    socket.on("connect_error", () => toast("Could not connect to the RiftRunner server."));
    socket.on("disconnect", (reason) => {
      if (reason !== "io client disconnect") toast("Disconnected. Reconnecting...");
    });
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
        phaserScene.chaseBlend = 0;
        phaserScene.terrorBlend = 0;
        phaserScene.cameraSwayX = 0;
        phaserScene.cameraSwayY = 0;
        phaserScene.cameraSwayTargetX = 0;
        phaserScene.cameraSwayTargetY = 0;
        phaserScene.lastMoveAngle = null;
        phaserScene.matchStartFreezeRemaining = Math.max(0, lockSeconds);
        phaserScene.matchStartFreezeDuration = Math.max(0.001, lockSeconds);
        phaserScene.matchStartZoomUntil = performance.now() + Math.max(0, lockSeconds) * 1000;
        phaserScene.introCameraPrimed = false;
        clearMovementInputOnly();
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
    setupReactChatWheelBridge();
    setupReactAbilityWheelBridge();
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
