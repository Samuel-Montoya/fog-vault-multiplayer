/* global io, Phaser */
(() => {
  "use strict";

  const GAMEPLAY_CONFIG = window.GAMEPLAY_CONFIG || {};
  function cfgNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function scopedNumber(scope, key, lowPowerKey, fallback) {
    const value = LOW_POWER_MODE && lowPowerKey ? scope?.[lowPowerKey] : scope?.[key];
    return cfgNumber(value, fallback);
  }

  const CPU_THREADS = Number(navigator.hardwareConcurrency || 0);
  const DEVICE_MEMORY_GB = Number(navigator.deviceMemory || 0);
  const REDUCED_MOTION = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  const PERFORMANCE_CONFIG = GAMEPLAY_CONFIG.performance || {};
  const HARDWARE_LOW_POWER_HINT = Boolean((CPU_THREADS && CPU_THREADS <= 4) || REDUCED_MOTION);
  // Low-performance mode should be earned by measured FPS, not guessed from hardware.
  // Old laptops get a fair shot first; if they dip below the configured threshold,
  // the cheap renderer turns on and stays stable instead of mode-flapping mid-chase.
  const FPS_TRIGGER_ONLY_LOW_POWER = PERFORMANCE_CONFIG.fpsTriggerOnly !== false;
  const LOW_POWER_MODE = Boolean(!FPS_TRIGGER_ONLY_LOW_POWER && HARDWARE_LOW_POWER_HINT);
  const HIGH_END_EFFECTS = Boolean(!LOW_POWER_MODE && !REDUCED_MOTION && (CPU_THREADS >= 8 || DEVICE_MEMORY_GB >= 8));

  const ADAPTIVE_PERFORMANCE_CONFIG = {
    // Only auto-enable low performance after measured FPS drops below this value.
    // Hardware hints no longer force low mode on page load.
    lowFps: cfgNumber(PERFORMANCE_CONFIG.lowFps, 55),
    ultraFps: cfgNumber(PERFORMANCE_CONFIG.ultraFps, 45),
    recoverFps: cfgNumber(PERFORMANCE_CONFIG.recoverFps, 62),
    ultraRecoverFps: cfgNumber(PERFORMANCE_CONFIG.ultraRecoverFps, 47),
    lowSamples: Math.max(2, Math.round(cfgNumber(PERFORMANCE_CONFIG.lowSamples, 3))),
    ultraSamples: Math.max(2, Math.round(cfgNumber(PERFORMANCE_CONFIG.ultraSamples, 2))),
    recoverSamples: Math.max(8, Math.round(cfgNumber(PERFORMANCE_CONFIG.recoverSamples, 18))),
    minModeSeconds: cfgNumber(PERFORMANCE_CONFIG.minModeSeconds, 9),
    toastCooldownMs: cfgNumber(PERFORMANCE_CONFIG.toastCooldownMs, 12000)
  };

  const ADAPTIVE_PERFORMANCE_PROFILES = {
    normal: {
      label: "NORMAL",
      targetFps: 60,
      dynamicWorldFps: 7,
      generatorFps: 6,
      scratchDrawFps: 8,
      lightingFps: 60,
      wallVisionFps: 22,
      actorVisionFps: 60,
      particleFps: 60,
      dotFadeFps: 18,
      maxParticles: HIGH_END_EFFECTS ? 76 : 58,
      maxShockwaves: HIGH_END_EFFECTS ? 8 : 6,
      particleScale: HIGH_END_EFFECTS ? 1.18 : 1,
      shockwaveScale: HIGH_END_EFFECTS ? 1.08 : 1,
      lightingAlphaScale: 1,
      coneSegments: HIGH_END_EFFECTS ? 14 : 12,
      voidRushGapMs: 72,
      voidRushCount: HIGH_END_EFFECTS ? 3 : 2,
      voidRushAlpha: 0.42,
      voidRedrawMs: 95,
      survivorRedrawMs: 0,
      heldOrbMaxDots: 30,
      heldOrbSpinScale: 1,
      heldOrbBobScale: 1,
      voidBodyOrbCount: HIGH_END_EFFECTS ? 11 : 9,
      voidBodySpikeCount: HIGH_END_EFFECTS ? 4 : 3,
      swipeSteps: HIGH_END_EFFECTS ? 26 : 22,
      chargeSteps: HIGH_END_EFFECTS ? 20 : 16,
      shakeScale: 1,
      remoteActorRate: 14,
      actorStyleFps: 60,
      remoteInterpolationDelayMs: 80,
      remoteExtrapolateMs: 70,
      voidInterpolationDelayMs: 55,
      voidExtrapolateMs: 95,
      voidMaxVisualLag: 96,
      remoteSnapDistance: 230,
      localReconcileRate: 4.8,
      localMaxCorrectionPerSecond: 260,
      localCorrectionDeadzoneIdle: 1.5,
      localCorrectionDeadzoneMoving: 3.5,
      localCorrectionSnapDistance: 190,
      localCameraFollowRate: 999,
      localCameraSnapDistance: 240,
      visionConeDirect: 0
    },
    low: {
      label: "LOW",
      targetFps: 50,
      dynamicWorldFps: 2.0,
      generatorFps: 2.4,
      scratchDrawFps: 2.5,
      lightingFps: 24,
      wallVisionFps: 5,
      actorVisionFps: 10,
      particleFps: 7,
      dotFadeFps: 4,
      maxParticles: 4,
      maxShockwaves: 0,
      particleScale: 0.16,
      shockwaveScale: 0,
      lightingAlphaScale: 0.50,
      coneSegments: 5,
      voidRushGapMs: 999999,
      voidRushCount: 0,
      voidRushAlpha: 0,
      voidRedrawMs: 280,
      survivorRedrawMs: 260,
      heldOrbMaxDots: 5,
      heldOrbSpinScale: 0.15,
      heldOrbBobScale: 0.12,
      voidBodyOrbCount: 2,
      voidBodySpikeCount: 0,
      swipeSteps: 5,
      chargeSteps: 4,
      shakeScale: 0.16,
      remoteActorRate: 18,
      actorStyleFps: 18,
      remoteInterpolationDelayMs: 120,
      remoteExtrapolateMs: 90,
      voidInterpolationDelayMs: 70,
      voidExtrapolateMs: 120,
      voidMaxVisualLag: 84,
      remoteSnapDistance: 260,
      localReconcileRate: 5.2,
      localMaxCorrectionPerSecond: 150,
      localCorrectionDeadzoneIdle: 4,
      localCorrectionDeadzoneMoving: 14,
      localCorrectionSnapDistance: 230,
      localCameraFollowRate: 999,
      localCameraSnapDistance: 300,
      visionConeDirect: 1
    },
    ultra: {
      label: "ULTRA LOW",
      targetFps: 40,
      dynamicWorldFps: 0.75,
      generatorFps: 1,
      scratchDrawFps: 1,
      lightingFps: 14,
      wallVisionFps: 2,
      actorVisionFps: 4,
      particleFps: 2,
      dotFadeFps: 2,
      maxParticles: 0,
      maxShockwaves: 0,
      particleScale: 0,
      shockwaveScale: 0,
      lightingAlphaScale: 0.32,
      coneSegments: 3,
      voidRushGapMs: 999999,
      voidRushCount: 0,
      voidRushAlpha: 0,
      voidRedrawMs: 520,
      survivorRedrawMs: 480,
      heldOrbMaxDots: 1,
      heldOrbSpinScale: 0,
      heldOrbBobScale: 0,
      voidBodyOrbCount: 1,
      voidBodySpikeCount: 0,
      swipeSteps: 3,
      chargeSteps: 3,
      shakeScale: 0,
      remoteActorRate: 22,
      actorStyleFps: 10,
      remoteInterpolationDelayMs: 165,
      remoteExtrapolateMs: 115,
      voidInterpolationDelayMs: 90,
      voidExtrapolateMs: 135,
      voidMaxVisualLag: 72,
      remoteSnapDistance: 300,
      localReconcileRate: 4.6,
      localMaxCorrectionPerSecond: 115,
      localCorrectionDeadzoneIdle: 6,
      localCorrectionDeadzoneMoving: 22,
      localCorrectionSnapDistance: 270,
      localCameraFollowRate: 999,
      localCameraSnapDistance: 340,
      visionConeDirect: 1
    }
  };

  const adaptivePerformance = {
    mode: LOW_POWER_MODE ? "low" : "normal",
    fpsAverage: 60,
    lowSamples: 0,
    ultraSamples: 0,
    recoverSamples: 0,
    lockedUntil: 0,
    lastToastAt: 0,
    stickyLow: LOW_POWER_MODE
  };

  function performanceProfile() {
    return ADAPTIVE_PERFORMANCE_PROFILES[adaptivePerformance.mode] || ADAPTIVE_PERFORMANCE_PROFILES.normal;
  }

  function performanceValue(key, fallback) {
    const value = performanceProfile()[key];
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function setAdaptivePerformanceMode(mode, reason = "") {
    const next = ADAPTIVE_PERFORMANCE_PROFILES[mode] ? mode : "normal";
    if (LOW_POWER_MODE && next === "normal") return;
    if (adaptivePerformance.mode === next) return;

    adaptivePerformance.mode = next;
    if (next === "low" || next === "ultra") adaptivePerformance.stickyLow = true;
    adaptivePerformance.lowSamples = 0;
    adaptivePerformance.ultraSamples = 0;
    adaptivePerformance.recoverSamples = 0;
    adaptivePerformance.lockedUntil = performance.now() + ADAPTIVE_PERFORMANCE_CONFIG.minModeSeconds * 1000;

    const root = document.documentElement;
    root.classList.toggle("low-power", LOW_POWER_MODE || next !== "normal");
    root.classList.toggle("adaptive-low-power", next !== "normal");
    root.classList.toggle("ultra-low-power", next === "ultra");
    root.dataset.performanceMode = next;

    phaserScene?.applyAdaptivePerformanceMode?.(next, reason);
  }

  function maybeToastPerformanceMode(mode) {
    if (mode === "normal") return;
    const now = performance.now();
    if (now - adaptivePerformance.lastToastAt < ADAPTIVE_PERFORMANCE_CONFIG.toastCooldownMs) return;
    adaptivePerformance.lastToastAt = now;
    const label = mode === "ultra" ? "Ultra low performance mode" : "Low performance mode";
    toast(`${label} enabled to keep the game smooth.`, 2400);
  }

  const initialRenderCap = LOW_POWER_MODE
    ? cfgNumber(PERFORMANCE_CONFIG.lowPowerDevicePixelRatio, 0.72)
    : HIGH_END_EFFECTS
      ? cfgNumber(PERFORMANCE_CONFIG.highPowerDevicePixelRatio, 1.15)
      : cfgNumber(PERFORMANCE_CONFIG.maxDevicePixelRatio, 1);
  // Allow sub-1 render resolution on old hardware. Phaser upscales the canvas via CSS,
  // which is a much better trade than dropping inputs when a Void swing spawns effects.
  const minRenderResolution = LOW_POWER_MODE ? 0.58 : (HIGH_END_EFFECTS ? 0.9 : 0.8);
  const RENDER_RESOLUTION = Math.max(minRenderResolution, Math.min(window.devicePixelRatio || 1, initialRenderCap));

  document.documentElement.classList.toggle("low-power", LOW_POWER_MODE);
  document.documentElement.classList.toggle("adaptive-low-power", adaptivePerformance.mode !== "normal");
  document.documentElement.classList.toggle("ultra-low-power", adaptivePerformance.mode === "ultra");
  document.documentElement.dataset.performanceMode = adaptivePerformance.mode;
  document.documentElement.classList.toggle("high-fidelity", HIGH_END_EFFECTS);

  // Minimal vision knobs. The map itself is dark; there is no simulated fog RenderTexture.
  // Instead, gameplay objects fade in when they are inside the local POV cone / near bubble,
  // and a tiny additive cone graphic gives the player readable direction without GPU soup.
  const LIGHTING = {
    MAP_DARKNESS: cfgNumber(GAMEPLAY_CONFIG.lighting?.mapDarkness, 0.38),          // 0 = no fog, 0.85 = very dark outside vision
    // Use the same cone values as gameplay visibility by default.
    // The old clientCone values were wider/longer, which made the guide show more than the player could actually see.
    SURVIVOR_LENGTH: cfgNumber(GAMEPLAY_CONFIG.survivor?.coneLength, cfgNumber(GAMEPLAY_CONFIG.survivor?.clientConeLength, 620)),
    SURVIVOR_ANGLE: cfgNumber(GAMEPLAY_CONFIG.survivor?.coneAngle, cfgNumber(GAMEPLAY_CONFIG.survivor?.clientConeAngle, Math.PI / 2.6)),
    SURVIVOR_SAFE_LENGTH_MULT: Math.max(1, cfgNumber(
      GAMEPLAY_CONFIG.survivor?.nonSprintingConeLengthMultiplier ?? GAMEPLAY_CONFIG.survivor?.walkingConeLengthMultiplier,
      1.22
    )),
    SURVIVOR_SAFE_ANGLE_MULT: Math.max(1, cfgNumber(
      GAMEPLAY_CONFIG.survivor?.nonSprintingConeAngleMultiplier ?? GAMEPLAY_CONFIG.survivor?.walkingConeAngleMultiplier,
      1.12
    )),
    SURVIVOR_RIFT_LENS_LENGTH_MULT: cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.riftLensLengthMultiplier, 1.55),
    SURVIVOR_RIFT_LENS_ANGLE_MULT: cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.riftLensAngleMultiplier, 1.38),
    SURVIVOR_HOURGLASS_BACK_LENGTH_MULT: cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.hourglassBackLengthMultiplier, 0.92),
    SURVIVOR_HOURGLASS_BACK_ANGLE_MULT: cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.hourglassBackAngleMultiplier, 1.0),
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
    // bigger than the viewport so camera-size changes do not require resizing it
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
      // layer2 is the warning/tension bed; layer3 is the main chase layer.
      layerVolumes: { layer1: 1.0, start: 0.26, layer2: 0.82, layer3: 1.0 },
      menuMaster: 0.14,
      fade: 0.052,
      menu: "/sfx/menu.mp3",
      // Plays once when a run starts while layer_1 fades in underneath it.
      start: "/sfx/start.mp3",
      startVolume: 0.26,
      startFallbackSeconds: 2.8,
      startFadeOutSeconds: 1.15,
      startLayer1FadeInSeconds: 1.35,
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
      orbPickupPitch: { min: 1.0, max: 1.45, countMax: 30 },
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
        unhooking: ["/sfx/unhooking.mp3", "/sfx/unhook.mp3"],
        speedBoost: "/sfx/speed_boost.mp3"
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
        unhooking: 0.44,
        speedBoost: 0.40
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
        unhooking: [0.96, 1.0, 1.04],
        speedBoost: [0.96, 1.0, 1.04]
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
    START: AUDIO_CONFIG.music.start || "/sfx/start.mp3",
    START_VOLUME: cfgNumber(
      AUDIO_CONFIG.music.startVolume ?? AUDIO_CONFIG.music.layerVolumes?.start,
      0.26
    ),
    START_FALLBACK_SECONDS: cfgNumber(AUDIO_CONFIG.music.startFallbackSeconds, 2.8),
    START_FADE_OUT_SECONDS: cfgNumber(AUDIO_CONFIG.music.startFadeOutSeconds, 1.15),
    START_LAYER_1_FADE_IN_SECONDS: cfgNumber(AUDIO_CONFIG.music.startLayer1FadeInSeconds, 1.35),
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

  const CAMERA_CONFIG = GAMEPLAY_CONFIG.camera || {};
  const IMMERSION_CONFIG = GAMEPLAY_CONFIG.immersion || GAMEPLAY_CONFIG.camera || {};

  const CAMERA = {
    BASE_ZOOM: Math.max(0.12, cfgNumber(
      LOW_POWER_MODE
        ? (CAMERA_CONFIG.lowPowerBaseZoom ?? CAMERA_CONFIG.lowPowerDefaultZoom ?? CAMERA_CONFIG.baseZoom ?? CAMERA_CONFIG.defaultZoom)
        : (CAMERA_CONFIG.baseZoom ?? CAMERA_CONFIG.defaultZoom),
      0.9
    )),
    CHASE_OFFSET: cfgNumber(CAMERA_CONFIG.chaseZoomOffset, 0.5),
    WALK_OFFSET: cfgNumber(CAMERA_CONFIG.walkZoomOffset, 0),
    SPRINT_OFFSET: cfgNumber(CAMERA_CONFIG.sprintZoomOffset ?? CAMERA_CONFIG.runningZoomOffset, 0.2),
    ACTION_OFFSET: cfgNumber(CAMERA_CONFIG.actionZoomOffset, 0.2),
    HOOKED_UNRESCUED_ZOOM: Math.max(0.1, cfgNumber(CAMERA_CONFIG.hookedUnrescuedZoom, 0.3)),
    HOOKED_RESCUE_PROGRESS_EPSILON: Math.max(0, cfgNumber(CAMERA_CONFIG.hookedRescueProgressEpsilon, 0.001)),
    MAX_IN_OFFSET: Math.max(0, cfgNumber(CAMERA_CONFIG.maxZoomInOffset, 0.5)),
    MAX_OUT_OFFSET: Math.max(0, cfgNumber(CAMERA_CONFIG.maxZoomOutOffset, 0.3)),
    ZOOM_LERP_RATE: Math.max(0.01, cfgNumber(
      LOW_POWER_MODE
        ? (CAMERA_CONFIG.lowPowerZoomLerpRate ?? CAMERA_CONFIG.zoomLerpRate)
        : CAMERA_CONFIG.zoomLerpRate,
      LOW_POWER_MODE ? 10.5 : 8.5
    )),
    ZOOM_SNAP_EPSILON: Math.max(0.0001, cfgNumber(CAMERA_CONFIG.zoomSnapEpsilon, 0.002)),
    WALK_ONLY_WHILE_MOVING: CAMERA_CONFIG.applyWalkZoomOnlyWhileMoving !== false,
    SURVIVOR_ABILITY_OFFSETS: CAMERA_CONFIG.survivorAbilityZoomOffsets || {},
    KILLER_ABILITY_OFFSETS: CAMERA_CONFIG.killerAbilityZoomOffsets || {},
    OVERVIEW_PADDING: Math.max(24, cfgNumber(CAMERA_CONFIG.spectatorOverviewPadding, 72)),
    OVERVIEW_MIN_ZOOM: Math.max(0.04, cfgNumber(CAMERA_CONFIG.spectatorOverviewMinZoom, 0.08)),
    OVERVIEW_MAX_ZOOM: Math.max(0.05, cfgNumber(CAMERA_CONFIG.spectatorOverviewMaxZoom, 0.95))
  };
  CAMERA.MIN_ZOOM = Math.max(0.1, CAMERA.BASE_ZOOM - CAMERA.MAX_OUT_OFFSET);
  CAMERA.MAX_ZOOM = Math.max(CAMERA.MIN_ZOOM + 0.01, CAMERA.BASE_ZOOM + CAMERA.MAX_IN_OFFSET);
  CAMERA.BASE_ZOOM = Math.min(CAMERA.MAX_ZOOM, Math.max(CAMERA.MIN_ZOOM, CAMERA.BASE_ZOOM));

  let cameraZoomNow = Math.min(CAMERA.MAX_ZOOM, Math.max(CAMERA.MIN_ZOOM, cfgNumber(window.__RIFTRUNNER_CAMERA_ZOOM__, CAMERA.BASE_ZOOM)));
  window.__RIFTRUNNER_CAMERA_ZOOM__ = cameraZoomNow;
  window.__RIFTRUNNER_CAMERA_BASE_ZOOM__ = CAMERA.BASE_ZOOM;

  function isCameraSubjectLocal(data) {
    return !!(data && myId && data.id === myId);
  }

  function cameraSubjectIsMoving(data) {
    if (!data) return false;
    if (isCameraSubjectLocal(data)) {
      return !!(input.up || input.down || input.left || input.right || data.vaulting);
    }
    return !!(data.moving || data.vaulting);
  }

  function cameraSubjectIsSprinting(data) {
    if (!data || data.role !== "survivor") return false;
    if (isCameraSubjectLocal(data)) return !!input.sprint && cameraSubjectIsMoving(data);
    return !!data.sprinting && cameraSubjectIsMoving(data);
  }

  function survivorVisionHasSprintHeld(data) {
    if (!data || data.role !== "survivor") return false;
    if (isCameraSubjectLocal(data)) return !!input.sprint;
    return !!data.sprinting;
  }

  function survivorVisionIsCareful(data) {
    if (!data || data.role !== "survivor" || data.dead || data.escaped || data.downed || data.hooked) return false;
    // Bigger cone is the awareness reward for not holding sprint. It applies while
    // standing or walking, not just while movement input is active. Holding Shift
    // immediately falls back to the normal cone, matching server visibility.
    return !survivorVisionHasSprintHeld(data);
  }

  function survivorVisionLengthForData(data) {
    let length = LIGHTING.SURVIVOR_LENGTH;
    if (survivorVisionIsCareful(data)) length *= LIGHTING.SURVIVOR_SAFE_LENGTH_MULT;
    if ((data?.riftLens || 0) > 0) length *= LIGHTING.SURVIVOR_RIFT_LENS_LENGTH_MULT;
    return length;
  }

  function survivorVisionAngleForData(data) {
    let angle = LIGHTING.SURVIVOR_ANGLE;
    if (survivorVisionIsCareful(data)) angle *= LIGHTING.SURVIVOR_SAFE_ANGLE_MULT;
    if ((data?.riftLens || 0) > 0) angle *= LIGHTING.SURVIVOR_RIFT_LENS_ANGLE_MULT;
    return Math.min(Math.PI * 1.08, angle);
  }

  function cameraSubjectIsDoingAction(data) {
    if (!data || data.role !== "survivor") return false;
    return !!(
      data.dotDepositTargetId
      || data.healingTargetId
      || data.unhookTargetId
      || (data.dotDepositProgress || 0) > 0.001
      || (data.healProgress || 0) > 0.001
      || (data.unhookProgress || 0) > 0.001
      || (Array.isArray(data.activeHealers) && data.activeHealers.length > 0)
    );
  }

  function cameraSubjectInChase(data) {
    if (!data) return false;
    if (data.role === "survivor") return !!data.chase;
    // The Void gets chase music and UI pressure, but never chase camera zoom.
    // Killer camera zoom should stay stable so M1 aim/cone judgment remains consistent.
    if (data.role === "killer") return false;
    return false;
  }

  function abilityZoomOffsetForSubject(data) {
    if (!data) return 0;
    let offset = 0;
    if (data.role === "survivor") {
      for (const [id, value] of Object.entries(CAMERA.SURVIVOR_ABILITY_OFFSETS || {})) {
        if ((data[id] || 0) > 0) offset += cfgNumber(value, 0);
      }
    } else if (data.role === "killer") {
      const effects = currentSnapshot?.voidEffects || {};
      for (const [id, value] of Object.entries(CAMERA.KILLER_ABILITY_OFFSETS || {})) {
        const active = id === "voidReveal"
          ? (effects.runnerReveal || 0) > 0
          : id === "redshiftOrbs"
            ? (effects.redOrbs || 0) > 0
            : id === "nullRush"
              ? (data.voidSpeedBoost || 0) > 0
              : (data[id] || 0) > 0;
        if (active) offset += cfgNumber(value, 0);
      }
    }
    return offset;
  }

  function cameraSubjectHookedWithoutRescue(data) {
    if (!data || data.role !== "survivor") return false;
    if (!data.hooked || data.dead || data.escaped) return false;
    return (data.unhookProgress || 0) <= CAMERA.HOOKED_RESCUE_PROGRESS_EPSILON;
  }

  function getCameraZoomPlan(data) {
    const modifiers = [];

    if (cameraSubjectHookedWithoutRescue(data)) {
      const zoom = clamp(CAMERA.HOOKED_UNRESCUED_ZOOM, 0.1, CAMERA.MAX_ZOOM);
      return {
        base: CAMERA.BASE_ZOOM,
        rawOffset: zoom - CAMERA.BASE_ZOOM,
        clampedOffset: zoom - CAMERA.BASE_ZOOM,
        zoom,
        modifiers: [{ id: "hookedUnrescued", value: zoom - CAMERA.BASE_ZOOM, absoluteZoom: zoom }]
      };
    }

    if (cameraSubjectInChase(data)) modifiers.push({ id: "chase", value: CAMERA.CHASE_OFFSET });

    if (data?.role === "survivor" && !data.dead && !data.escaped && !data.downed && !data.hooked) {
      const moving = cameraSubjectIsMoving(data);
      const sprinting = cameraSubjectIsSprinting(data);
      // Movement zoom is intentionally sprint-only. Walking should keep the
      // neutral base zoom so players only trade camera awareness when they
      // actively hold Shift to sprint.
      if (sprinting) {
        modifiers.push({ id: "sprint", value: CAMERA.SPRINT_OFFSET });
      }
      if (cameraSubjectIsDoingAction(data)) modifiers.push({ id: "action", value: CAMERA.ACTION_OFFSET });
      const abilityOffset = abilityZoomOffsetForSubject(data);
      if (Math.abs(abilityOffset) > 0.0001) modifiers.push({ id: "ability", value: abilityOffset });
    } else if (data?.role === "killer") {
      const abilityOffset = abilityZoomOffsetForSubject(data);
      if (Math.abs(abilityOffset) > 0.0001) modifiers.push({ id: "ability", value: abilityOffset });
    }

    const rawOffset = modifiers.reduce((sum, entry) => sum + cfgNumber(entry.value, 0), 0);
    const clampedOffset = clamp(rawOffset, -CAMERA.MAX_OUT_OFFSET, CAMERA.MAX_IN_OFFSET);
    const zoom = clamp(CAMERA.BASE_ZOOM + clampedOffset, CAMERA.MIN_ZOOM, CAMERA.MAX_ZOOM);
    return { base: CAMERA.BASE_ZOOM, rawOffset, clampedOffset, zoom, modifiers };
  }

  // Client-only fear tuning. This does not change hitboxes or movement on the server.
  const IMMERSION = {
    MATCH_START_LOCK_SECONDS: cfgNumber(GAMEPLAY_CONFIG.match?.startFreezeSeconds, 1.5),
    CHASE_IN_LERP: scopedNumber(IMMERSION_CONFIG, "chaseInLerp", "lowPowerChaseInLerp", LOW_POWER_MODE ? 0.045 : 0.055),
    CHASE_OUT_LERP: scopedNumber(IMMERSION_CONFIG, "chaseOutLerp", "lowPowerChaseOutLerp", LOW_POWER_MODE ? 0.035 : 0.04),
    TERROR_LERP: scopedNumber(IMMERSION_CONFIG, "terrorLerp", "lowPowerTerrorLerp", LOW_POWER_MODE ? 0.055 : 0.07),
    BREATH_SWAY: scopedNumber(IMMERSION_CONFIG, "breathSway", "lowPowerBreathSway", LOW_POWER_MODE ? 2.5 : 4),
    CHASE_SWAY: scopedNumber(IMMERSION_CONFIG, "chaseSway", "lowPowerChaseSway", LOW_POWER_MODE ? 3 : 5),
    // Direction-change camera sway. No constant running bob. The camera only leans
    // when the player changes movement direction, then smoothly settles back.
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
    survivorSpeedBurstMult: cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.speedBurstSpeedMultiplier, 1.14),
    killer: cfgNumber(GAMEPLAY_CONFIG.void?.speed, 310),
    killerEndgameMult: cfgNumber(GAMEPLAY_CONFIG.void?.endgameSpeedMultiplier, 1.10),
    killerRecoveryMult: cfgNumber(GAMEPLAY_CONFIG.void?.recoverySpeedMultiplier, 0.28),
    killerLungeMult: cfgNumber(GAMEPLAY_CONFIG.attack?.lungeSpeedMultiplier, 1.22),
    downedCrawl: cfgNumber(GAMEPLAY_CONFIG.survivor?.downedCrawlSpeed, 62),
    survivorSize: cfgNumber(GAMEPLAY_CONFIG.actor?.survivorSize, 30),
    killerSize: cfgNumber(GAMEPLAY_CONFIG.actor?.voidSize, 38)
  };

  const ATTACK_VISUAL = {
    quickRange: cfgNumber(GAMEPLAY_CONFIG.attack?.quickRange, 82),
    lungeRange: cfgNumber(GAMEPLAY_CONFIG.attack?.lungeRange, 118),
    arc: cfgNumber(GAMEPLAY_CONFIG.attack?.arcRadians, Math.PI * 0.50),
    edgeGrace: cfgNumber(GAMEPLAY_CONFIG.attack?.edgeGraceRadius, 9),
    targetBodyRadius: cfgNumber(GAMEPLAY_CONFIG.attack?.targetBodyRadius, LOCAL_SPEEDS.survivorSize * 0.5),
    quickActive: cfgNumber(GAMEPLAY_CONFIG.attack?.quickActiveSeconds, 0.24),
    lungeActive: cfgNumber(GAMEPLAY_CONFIG.attack?.lungeActiveSeconds, 0.42),
    quickStartup: cfgNumber(GAMEPLAY_CONFIG.attack?.quickStartupSeconds, 0.045),
    lungeStartup: cfgNumber(GAMEPLAY_CONFIG.attack?.lungeStartupSeconds, 0.075),
    lungeCharge: cfgNumber(GAMEPLAY_CONFIG.attack?.lungeChargeSeconds, 0.32)
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

  const SURVIVOR_DOT_MAX = cfgNumber(GAMEPLAY_CONFIG.orbs?.survivorMax, 30);

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
  const SURVIVOR_ABILITIES = SHARED_ABILITIES.survivorAbilities || {};
  const SURVIVOR_ABILITY_ORDER = Array.isArray(SHARED_ABILITIES.survivorWheelOrder) ? SHARED_ABILITIES.survivorWheelOrder : Object.keys(SURVIVOR_ABILITIES);
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

  const VOID_SKINS = {
    voidCore: {
      id: "voidCore",
      label: "Void Core",
      shape: "core",
      dark: 0x020008,
      base: 0x120022,
      mid: 0x32105f,
      accent: 0x7c3aed,
      glow: 0xd8b4fe,
      shadow: 0x05020a,
      highlight: 0xf5d0fe
    },
    solarMaw: {
      id: "solarMaw",
      label: "Solar Maw",
      shape: "maw",
      dark: 0x130900,
      base: 0x3b1900,
      mid: 0xb45309,
      accent: 0xfacc15,
      glow: 0xfef08a,
      shadow: 0x1c0b00,
      highlight: 0xfffbeb
    },
    azureRift: {
      id: "azureRift",
      label: "Azure Rift",
      shape: "rift",
      dark: 0x020617,
      base: 0x082f49,
      mid: 0x0e7490,
      accent: 0x38bdf8,
      glow: 0xbae6fd,
      shadow: 0x03131f,
      highlight: 0xe0f2fe
    },
    bloodEclipse: {
      id: "bloodEclipse",
      label: "Blood Eclipse",
      shape: "eclipse",
      dark: 0x070006,
      base: 0x2b0714,
      mid: 0x7f1d1d,
      accent: 0xff3b6a,
      glow: 0xfda4af,
      shadow: 0x12020b,
      highlight: 0xffe4e6
    },
    starlessWyrm: {
      id: "starlessWyrm",
      label: "Starless Wyrm",
      shape: "wyrm",
      dark: 0x02030a,
      base: 0x111827,
      mid: 0x4338ca,
      accent: 0x22d3ee,
      glow: 0xc4b5fd,
      shadow: 0x050816,
      highlight: 0xecfeff
    },
    lanternHusk: {
      id: "lanternHusk",
      label: "Lantern Husk",
      shape: "lantern",
      dark: 0x140b00,
      base: 0x3a1c05,
      mid: 0x8b4a12,
      accent: 0xf59e0b,
      glow: 0xfef3c7,
      shadow: 0x1a0d02,
      highlight: 0xfff7ad
    },
    abyssSiren: {
      id: "abyssSiren",
      label: "Abyss Siren",
      shape: "siren",
      dark: 0x001018,
      base: 0x03253d,
      mid: 0x075985,
      accent: 0x38bdf8,
      glow: 0x7dd3fc,
      shadow: 0x001923,
      highlight: 0xe0faff
    },
    crownedHollow: {
      id: "crownedHollow",
      label: "Crowned Hollow",
      shape: "crowned",
      dark: 0x06030d,
      base: 0x1d1238,
      mid: 0x4c1d95,
      accent: 0xfbbf24,
      glow: 0xfef08a,
      shadow: 0x0b0416,
      highlight: 0xfffbeb
    },
    staticNull: {
      id: "staticNull",
      label: "Static Null",
      shape: "static",
      dark: 0x020617,
      base: 0x0f172a,
      mid: 0x475569,
      accent: 0xa3e635,
      glow: 0xd9f99d,
      shadow: 0x020617,
      highlight: 0xf8fafc
    },
    riftSeraph: {
      id: "riftSeraph",
      label: "Rift Seraph",
      shape: "seraph",
      dark: 0x080316,
      base: 0x241048,
      mid: 0x7e22ce,
      accent: 0x67e8f9,
      glow: 0xc084fc,
      shadow: 0x10051f,
      highlight: 0xf5d0fe
    }
  };

  function getVoidSkin(id) {
    const key = id === "killerCircle" ? "voidCore" : id;
    return VOID_SKINS[key] || VOID_SKINS.voidCore;
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
    skinBtns: [...document.querySelectorAll('[data-skin-role="runner"]')],
    voidSkinBtns: [...document.querySelectorAll('[data-skin-role="void"]')],
    lobbySkinPicker: document.querySelector(".runner-lobby-skin-picker") || document.querySelector(".lobby-skin-picker"),
    voidLobbySkinPicker: document.querySelector(".void-lobby-skin-picker"),
    quickJoinBtn: document.getElementById("quickJoinBtn"),
    createLobbyBtn: document.getElementById("createLobbyBtn"),
    lobbyList: document.getElementById("lobbyList"),
    lobbyTitle: document.getElementById("lobbyTitle"),
    lobbyRoleMark: document.getElementById("lobbyRoleMark"),
    playersList: document.getElementById("playersList"),
    beSurvivorBtn: document.getElementById("beSurvivorBtn"),
    beKillerBtn: document.getElementById("beKillerBtn"),
    beSpectatorBtn: document.getElementById("beSpectatorBtn"),
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
    authUsername: document.getElementById("authUsername"),
    authPassword: document.getElementById("authPassword"),
    authLoginBtn: document.getElementById("authLoginBtn"),
    authRegisterBtn: document.getElementById("authRegisterBtn"),
    authGuestBtn: document.getElementById("authGuestBtn"),
    authLogoutBtn: document.getElementById("authLogoutBtn"),
    compactAuthUsername: document.getElementById("compactAuthUsername"),
    compactAuthPassword: document.getElementById("compactAuthPassword"),
    compactAuthLoginBtn: document.getElementById("compactAuthLoginBtn"),
    compactAuthRegisterBtn: document.getElementById("compactAuthRegisterBtn"),
    compactAuthGuestBtn: document.getElementById("compactAuthGuestBtn"),
    compactAuthLogoutBtn: document.getElementById("compactAuthLogoutBtn")
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
    lastUpdate: performance.now(),
    lastDomUpdate: 0,
    lastDomKey: ""
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
  let selectedVoidSkin = "voidCore";
  let currentLobbyState = null;
  let currentSnapshot = null;
  const networkTiming = { lastSnapshotAt: 0, avgGapMs: 50, jitterMs: 0 };
  let phaserScene = null;
  let lastInputPayload = "";
  let lastInputSentAt = 0;
  const INPUT_ANGLE_EPSILON = Math.max(0.002, cfgNumber(PERFORMANCE_CONFIG.inputAngleEpsilon, 0.012));
  const INPUT_HEARTBEAT_MS = Math.max(50, cfgNumber(PERFORMANCE_CONFIG.inputHeartbeatMs, 140));
  let toastTimer = null;
  let activeScreenName = "menu";
  const AUTH_TOKEN_KEY = "riftrunnerAuthToken";
  let authToken = "";
  let currentAccount = null;
  let shopSkins = [];

  function getStoredAuthToken() {
    try { return String(localStorage.getItem(AUTH_TOKEN_KEY) || ""); }
    catch { return ""; }
  }

  function setStoredAuthToken(token) {
    authToken = String(token || "");
    try {
      if (authToken) localStorage.setItem(AUTH_TOKEN_KEY, authToken);
      else localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {
      // Private browsing can refuse storage. The current session still works.
    }
  }

  function accountDisplayName(account = currentAccount) {
    if (!account) return "Playing as guest";
    return `${account.displayName || account.username || "Runner"}${account.isGuest ? " · guest" : ""}`;
  }

  function accountOwnedSet(role = null) {
    const owned = currentAccount?.ownedSkins || {};
    const ids = role === "runner" ? owned.runner : role === "void" ? owned.void : owned.all;
    return new Set(Array.isArray(ids) ? ids : []);
  }

  function skinIsOwned(role, skinId) {
    if (role === "void") return skinId === "voidCore" || accountOwnedSet("void").has(skinId);
    return skinId === "blueSquare" || accountOwnedSet("runner").has(skinId);
  }

  function shopSkinForButton(button) {
    const id = button?.dataset?.skin || "";
    return shopSkins.find((skin) => skin.id === id) || null;
  }

  function refreshSkinLockUi() {
    const buttons = [...document.querySelectorAll(".skin-btn[data-skin][data-skin-role]")];
    for (const button of buttons) {
      const role = button.dataset.skinRole === "void" ? "void" : "runner";
      const skinId = button.dataset.skin || "";
      const shopSkin = shopSkinForButton(button);
      const price = Math.max(0, Math.floor(Number(shopSkin?.price ?? button.dataset.skinPrice ?? 0)));
      const owned = skinIsOwned(role, skinId);
      const affordable = !!currentAccount && (currentAccount.orbBalance || 0) >= price;
      button.classList.toggle("locked", !owned);
      button.classList.toggle("owned", owned);
      button.classList.toggle("affordable", !owned && affordable);
      button.disabled = false;
      button.title = owned ? "Owned" : currentAccount ? `Unlock for ${price} deposited orbs` : "Login or Play as Guest to unlock";
      const priceLabel = button.querySelector("[data-skin-price-label]");
      if (priceLabel) priceLabel.textContent = owned ? "Owned" : `${price} orbs`;
    }

    if (!skinIsOwned("runner", selectedSkin)) setSelectedSkin("blueSquare");
    if (!skinIsOwned("void", selectedVoidSkin)) setSelectedVoidSkin("voidCore");
  }

  function getAccountPanels() {
    return [...document.querySelectorAll("[data-account-panel]")];
  }

  function syncAccountUi() {
    const panels = getAccountPanels();
    const balance = String(Math.max(0, Math.floor(Number(currentAccount?.orbBalance || 0))));
    const lifetime = Math.max(0, Math.floor(Number(currentAccount?.totalOrbsDeposited || 0)));

    for (const panel of panels) {
      const name = panel.querySelector("[data-auth-status-name]");
      const balanceEl = panel.querySelector("[data-auth-orb-balance]");
      const form = panel.querySelector("[data-auth-form]");
      const actions = panel.querySelector("[data-account-actions]");
      const hint = panel.querySelector("[data-account-hint]");

      if (name) name.textContent = accountDisplayName();
      if (balanceEl) balanceEl.textContent = balance;
      form?.classList.toggle("hidden", !!currentAccount);
      actions?.classList.toggle("hidden", !currentAccount);
      if (hint) {
        hint.textContent = currentAccount
          ? `${lifetime} lifetime deposited orbs.`
          : "Login or Play as Guest to save orbs.";
      }
    }

    // Backward-compatible fallback for any older DOM copy that does not have data attributes.
    const fallbackNames = [document.getElementById("authStatusName"), document.getElementById("compactAuthStatusName")].filter(Boolean);
    for (const el of fallbackNames) el.textContent = accountDisplayName();

    document.body.classList.toggle("has-riftrunner-account", !!currentAccount);
    refreshSkinLockUi();
  }

  function applyAccountPayload(payload = {}) {
    if (Array.isArray(payload.skins)) shopSkins = payload.skins;
    currentAccount = payload.account || null;
    syncAccountUi();
    if (payload.reward?.orbsDeposited) {
      const rewardLabel = String(payload.reward.label || "deposited orbs");
      toast(`Banked ${payload.reward.orbsDeposited} ${rewardLabel}.`, 2400);
    }
  }

  async function authFetch(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function reconnectSocketForAuth() {
    if (!socket) return;
    socket.auth = { ...(socket.auth || {}), token: authToken || "" };
    if (socket.connected) socket.emit("refreshAccount", { token: authToken || "" });
  }

  async function submitAuth(kind, source = null) {
    const sourceEl = source && typeof source.closest === "function" ? source : null;
    const panel = sourceEl?.closest("[data-account-panel]") || null;
    const usernameEl = panel?.querySelector("[data-auth-username]") || ui.authUsername;
    const passwordEl = panel?.querySelector("[data-auth-password]") || ui.authPassword;
    const username = (usernameEl?.value || "").trim();
    const password = passwordEl?.value || "";
    const path = kind === "login" ? "/api/auth/login" : kind === "register" ? "/api/auth/register" : "/api/auth/guest";
    const body = kind === "guest" ? { name: getName() } : { username, password };
    const payload = await authFetch(path, { method: "POST", body: JSON.stringify(body) });
    setStoredAuthToken(payload.token || "");
    applyAccountPayload(payload);
    reconnectSocketForAuth();
    toast(kind === "guest" ? "Guest account ready." : kind === "register" ? "Account created." : "Logged in.", 1800);
  }

  async function restoreAccount() {
    authToken = getStoredAuthToken();
    try {
      const shop = await authFetch("/api/shop", { method: "GET" });
      if (Array.isArray(shop.skins)) shopSkins = shop.skins;
      if (authToken) {
        const payload = await authFetch("/api/account", { method: "GET" });
        applyAccountPayload(payload);
      } else {
        syncAccountUi();
      }
    } catch (error) {
      console.warn("[account] restore failed", error);
      syncAccountUi();
    }
  }

  function logoutAccount() {
    setStoredAuthToken("");
    currentAccount = null;
    syncAccountUi();
    reconnectSocketForAuth();
    toast("Logged out.", 1400);
  }

  async function buySkinFromButton(button) {
    const role = button?.dataset?.skinRole === "void" ? "void" : "runner";
    const skinId = button?.dataset?.skin || "";
    if (!skinId) return false;
    if (skinIsOwned(role, skinId)) return true;
    if (!currentAccount || !authToken) {
      toast("Login or Play as Guest first, tiny capitalism gate and all.", 2600);
      return false;
    }
    const shopSkin = shopSkinForButton(button);
    const price = Math.max(0, Math.floor(Number(shopSkin?.price ?? button.dataset.skinPrice ?? 0)));
    if ((currentAccount.orbBalance || 0) < price) {
      toast(`Need ${price} deposited orbs for ${shopSkin?.label || "that skin"}.`, 2600);
      return false;
    }
    const payload = await authFetch("/api/shop/buy", { method: "POST", body: JSON.stringify({ skinId }) });
    applyAccountPayload(payload);
    socket?.emit("refreshAccount", { token: authToken || "" });
    toast(`Unlocked ${shopSkin?.label || "skin"}.`, 1800);
    return true;
  }

  function setSelectedSkin(skinId) {
    selectedSkin = SURVIVOR_SKINS[skinId] ? skinId : "blueSquare";
    ui.skinBtns.forEach((b) => b.classList.toggle("selected", b.dataset.skin === selectedSkin));
  }

  function setSelectedVoidSkin(skinId) {
    selectedVoidSkin = getVoidSkin(skinId).id;
    ui.voidSkinBtns?.forEach((b) => b.classList.toggle("selected", b.dataset.skin === selectedVoidSkin));
  }

  function skinForSelectedRole(role = selectedRole) {
    return role === "killer" ? selectedVoidSkin : selectedSkin;
  }

  function setLobbySkinPickerVisibility(role = selectedRole) {
    const showRunner = role === "survivor";
    const showVoid = role === "killer";
    ui.lobbySkinPicker?.classList.toggle("hidden", !showRunner);
    ui.lobbySkinPicker?.setAttribute("aria-hidden", showRunner ? "false" : "true");
    ui.voidLobbySkinPicker?.classList.toggle("hidden", !showVoid);
    ui.voidLobbySkinPicker?.setAttribute("aria-hidden", showVoid ? "false" : "true");
  }

  function syncLobbyRoleButtons(role = selectedRole) {
    const lobbyRole = role === "spectator" ? "spectator" : role === "killer" ? "killer" : "survivor";
    ui.beKillerBtn?.classList.toggle("selected", lobbyRole === "killer");
    ui.beSurvivorBtn?.classList.toggle("selected", lobbyRole === "survivor");
    ui.beSpectatorBtn?.classList.toggle("selected", lobbyRole === "spectator");
    setLobbySkinPickerVisibility(lobbyRole);
    if (ui.lobbyRoleMark) {
      ui.lobbyRoleMark.classList.toggle("killer", lobbyRole === "killer");
      ui.lobbyRoleMark.classList.toggle("survivor", lobbyRole === "survivor");
      ui.lobbyRoleMark.classList.toggle("spectator", lobbyRole === "spectator");
      ui.lobbyRoleMark.setAttribute("aria-label", lobbyRole === "killer" ? "Playing as The Void" : lobbyRole === "spectator" ? "Joining as Spectator" : "Playing as Runner");
    }
  }

  function setSelectedRole(role) {
    selectedRole = role === "killer" ? "killer" : "survivor";
    ui.roleBtns.forEach((b) => b.classList.toggle("selected", b.dataset.role === selectedRole));
    syncLobbyRoleButtons(selectedRole);
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
    const localLock = Math.max(0, ((phaserScene.matchStartInputLockUntil || 0) - performance.now()) / 1000);
    const serverLock = Math.max(0, Number(phaserScene.matchStartFreezeRemaining || 0));
    return Math.max(localLock, serverLock);
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
    startCue: null,
    startCueActive: false,
    startCueToken: 0,
    startCueStartedAt: 0,
    startCuePlayed: false,
    startCueSourcePending: false,
    startCueMissing: false,
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
      endMatchStartCue(true);
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
    if (name !== "game") {
      dispatchAbilityHuds(null);
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


  function canLocalToggleMatchPause(snapshot = currentSnapshot) {
    return !!(snapshot?.canPause || snapshot?.viewer?.canPause);
  }

  function removeMatchPauseOverlayElement() {
    const overlay = document.getElementById("matchPauseOverlay");
    if (overlay) overlay.remove();
  }

  function updateMatchPauseOverlay(snapshot = currentSnapshot) {
    const paused = !!snapshot?.paused;
    // Keep pause server-authoritative, but do not draw the giant pause screen.
    // The whole point is freezing the match so bot debug labels remain readable,
    // not covering them with a UI memorial plaque.
    removeMatchPauseOverlayElement();
    document.body.classList.toggle("match-paused", paused);
  }

  function requestToggleMatchPause() {
    if (activeScreenName !== "game") return;
    if (!canLocalToggleMatchPause()) {
      toast("Only the host can pause the match.", 1800);
      return;
    }
    clearHeldGameplayInput();
    sendInput({}, true);
    socket?.emit("togglePauseMatch");
  }

  function pushScoreGain(payload = {}) {
    if (!payload || !payload.label || activeScreenName !== "game") return;
    window.dispatchEvent(new CustomEvent("voidrift:score-gain", {
      detail: {
        label: String(payload.label || "Point gained"),
        amount: Math.max(1, Math.floor(Number(payload.amount) || 1)),
        kind: String(payload.kind || "point")
      }
    }));
  }


  const ANNOUNCEMENT_LIFETIME_MS = 3200;

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
        window.setTimeout(() => {
          pushMatchAnnouncement({
            kind: "void-buffed",
            title: "The Void has been buffed",
            detail: `Permanent speed boost active${event.voidSpeedMultiplier ? ` (${Number(event.voidSpeedMultiplier).toFixed(2)}x)` : ""}.`
          });
        }, 1000);
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
    // Supports both smoothstep(t) and smoothstep(edge0, edge1, value).
    // The one-argument form is useful for fade gates and prevents media volume
    // math from turning into NaN when Firefox is already in a mood.
    let start = Number(edge0);
    let end = Number(edge1);
    let v = Number(value);
    if (arguments.length === 1) {
      v = start;
      start = 0;
      end = 1;
    }
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = 1;
    if (!Number.isFinite(v)) v = start;
    const span = end - start;
    const rawT = Math.abs(span) < 0.000001 ? (v >= end ? 1 : 0) : (v - start) / span;
    const t = clamp(Number.isFinite(rawT) ? rawT : 0, 0, 1);
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
      || (currentSnapshot?.viewer?.id === myId ? currentSnapshot.viewer : null)
      || phaserScene?.actors?.get(myId)?.data
      || null;
  }

  function isDedicatedSpectator(snapshot = currentSnapshot) {
    return snapshot?.viewer?.id === myId && snapshot.viewer.role === "spectator";
  }

  const SPECTATE_OVERVIEW_ID = "__overview__";
  const SPECTATE_OVERVIEW_LABEL = "Overview";

  function isSpectateOverviewId(id) {
    return id === SPECTATE_OVERVIEW_ID;
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
        spectateTargetId: phaserScene?.resolveSpectateTargetId?.() || phaserScene?.spectateTargetId || null,
        spectating: isLocalSpectating()
      }
    }));
  }

  function openReactChatWheel(pointerEvent = null) {
    if (reactChatWheelOpen || isDedicatedSpectator()) return;
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
  let reactAbilityWheelRole = null;

  function normalizeAbilityList(order, defs, actor, role) {
    const orbs = Math.max(0, Math.floor(actor?.dots || 0));
    return order.slice(0, 4).map((id) => {
      const fallbackName = role === "survivor" ? "Runner Ability" : "Void Ability";
      const ability = defs[id] || { id, name: fallbackName, shortName: "Ability", cost: 0, summary: "Spend orbs to bend the run.", cooldown: role === "survivor" ? 30 : 20 };
      const isCancel = !!ability.cancel || id === "cancel" || !!ability.disabled;
      const cooldowns = role === "survivor" ? actor?.survivorAbilityCooldowns : actor?.voidAbilityCooldowns;
      const cooldownRemaining = isCancel ? 0 : Math.max(0, Number(cooldowns?.[ability.id || id] || 0));
      const active = !!(actor && !isCancel && (
        (role === "killer" && ability.id === "nullRush" && (actor.voidSpeedBoost || 0) > 0) ||
        (role === "killer" && ability.id === "redshiftOrbs" && (currentSnapshot?.voidEffects?.redOrbs || 0) > 0) ||
        (role === "killer" && ability.id === "voidReveal" && (currentSnapshot?.voidEffects?.runnerReveal || 0) > 0) ||
        (role === "survivor" && ability.id === "riftLens" && (actor.riftLens || 0) > 0) ||
        (role === "survivor" && ability.id === "hourglass" && (actor.hourglass || 0) > 0) ||
        (role === "survivor" && ability.id === "speedBurst" && (actor.speedBurst || 0) > 0)
      ));
      return {
        id: ability.id || id,
        name: ability.name || (isCancel ? "Cancel" : fallbackName),
        shortName: ability.shortName || ability.name || (isCancel ? "Cancel" : "Ability"),
        cost: Number(ability.cost || 0),
        summary: ability.summary || (isCancel ? "Close the wheel." : "Spend orbs to bend the run."),
        accent: ability.accent || (isCancel ? "muted" : role === "survivor" ? "cyan" : "purple"),
        cancel: isCancel,
        cooldown: Number(ability.cooldown || (role === "survivor" ? 30 : 20)),
        cooldownRemaining,
        available: isCancel || (orbs >= Number(ability.cost || 0) && cooldownRemaining <= 0),
        active
      };
    });
  }

  function getAbilityListForActor(actor = getLocalPlayerData()) {
    if (actor?.role === "survivor") return normalizeAbilityList(SURVIVOR_ABILITY_ORDER, SURVIVOR_ABILITIES, actor, "survivor");
    return normalizeAbilityList(VOID_ABILITY_ORDER, VOID_ABILITIES, actor, "killer");
  }

  function getAbilityWheelDetail(pointerEvent = null) {
    const me = getLocalPlayerData();
    const role = me?.role === "survivor" ? "survivor" : "killer";
    return {
      role,
      title: role === "survivor" ? "Runner abilities" : "Void abilities",
      orbs: Math.max(0, Math.floor(me?.dots || 0)),
      abilities: getAbilityListForActor(me),
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
    const canOpen = currentSnapshot
      && currentSnapshot.phase === "game"
      && (me?.role === "killer" || me?.role === "survivor")
      && !me.dead
      && !me.escaped
      && !me.hooked
      && !(me.role === "survivor" && me.downed)
      && (currentSnapshot.matchStartFreezeRemaining || 0) <= 0;
    if (!canOpen) return;
    reactAbilityWheelOpen = true;
    reactAbilityWheelRole = me.role === "survivor" ? "survivor" : "killer";
    dispatchAbilityWheelEvent("riftrunner:ability-open", getAbilityWheelDetail(pointerEvent));
  }

  function closeReactAbilityWheel(submit = true) {
    if (!reactAbilityWheelOpen) return;
    reactAbilityWheelOpen = false;
    dispatchAbilityWheelEvent("riftrunner:ability-close", { submit: !!submit, role: reactAbilityWheelRole });
    reactAbilityWheelRole = null;
  }

  function sendAbilitySelection(selection) {
    let abilityId = String(selection?.id || selection || "");
    const me = getLocalPlayerData();
    if (Number.isInteger(selection?.index)) {
      abilityId = getAbilityListForActor(me)[selection.index]?.id || "";
    }
    if (!abilityId || abilityId === "cancel" || abilityId === "moreSoon" || !socket || currentSnapshot?.phase !== "game") return;
    if (me?.role === "survivor") socket.emit("survivorAbility", { id: abilityId });
    else if (me?.role === "killer") socket.emit("voidAbility", { id: abilityId });
  }

  function setupReactAbilityWheelBridge() {
    window.addEventListener("riftrunner:ability-submit", (event) => {
      sendAbilitySelection(event.detail || {});
    });
  }

  function dispatchAbilityHuds(snapshot = currentSnapshot) {
    const me = snapshot?.actors?.find((a) => a.id === myId);
    const isVoid = me?.role === "killer" && snapshot?.phase === "game" && !me.dead;
    const isRunner = me?.role === "survivor" && snapshot?.phase === "game" && !me.dead && !me.escaped;
    const voidEffects = [];
    if (isVoid && (me.voidSpeedBoost || 0) > 0) voidEffects.push({ id: "nullRush", label: "rush", time: me.voidSpeedBoost });
    if (isVoid && (snapshot?.voidEffects?.redOrbs || 0) > 0) voidEffects.push({ id: "redshiftOrbs", label: "redshift", time: snapshot.voidEffects.redOrbs });
    if (isVoid && (snapshot?.voidEffects?.runnerReveal || 0) > 0) voidEffects.push({ id: "voidReveal", label: "sight", time: snapshot.voidEffects.runnerReveal });
    window.dispatchEvent(new CustomEvent("riftrunner:void-ability-hud", {
      detail: {
        visible: isVoid,
        orbs: isVoid ? Math.max(0, Math.floor(me.dots || 0)) : 0,
        effects: voidEffects
      }
    }));

    const runnerEffects = [];
    if (isRunner && (me.riftLens || 0) > 0) runnerEffects.push({ id: "riftLens", label: "lens", time: me.riftLens });
    if (isRunner && (me.hourglass || 0) > 0) runnerEffects.push({ id: "hourglass", label: "hourglass", time: me.hourglass });
    if (isRunner && (me.speedBurst || 0) > 0) runnerEffects.push({ id: "speedBurst", label: "burst", time: me.speedBurst });
    window.dispatchEvent(new CustomEvent("riftrunner:runner-ability-hud", {
      detail: {
        visible: isRunner,
        orbs: isRunner ? Math.max(0, Math.floor(me.dots || 0)) : 0,
        effects: runnerEffects
      }
    }));

    if (reactAbilityWheelOpen && (isVoid || isRunner)) {
      dispatchAbilityWheelEvent("riftrunner:ability-update", {
        role: me.role === "survivor" ? "survivor" : "killer",
        title: me.role === "survivor" ? "Runner abilities" : "Void abilities",
        orbs: Math.max(0, Math.floor(me.dots || 0)),
        abilities: getAbilityListForActor(me)
      });
    }
  }

  function isLocalSpectating() {
    const me = getLocalPlayerData();
    return isDedicatedSpectator() || (me?.role === "survivor" && (!!me.dead || !!me.escaped));
  }

  function getLivingTeammates(snapshot = currentSnapshot) {
    return (snapshot?.actors || []).filter(
      (a) => a.role === "survivor"
        && a.id !== myId
        && !a.dead
        && !a.escaped
    );
  }

  function getSpectateTargets(snapshot = currentSnapshot) {
    const actors = snapshot?.actors || [];
    if (isDedicatedSpectator(snapshot)) {
      return actors.filter((a) => (
        (a.role === "killer" && !a.dead)
        || (a.role === "survivor" && !a.dead && !a.escaped)
      ));
    }
    return getLivingTeammates(snapshot);
  }

  function getSpectateOptions(snapshot = currentSnapshot) {
    const targets = getSpectateTargets(snapshot);
    if (!isDedicatedSpectator(snapshot)) return targets;
    return [
      ...targets,
      {
        id: SPECTATE_OVERVIEW_ID,
        name: SPECTATE_OVERVIEW_LABEL,
        role: "overview",
        overview: true
      }
    ];
  }

  function inputSendRateHz() {
    if (adaptivePerformance.mode === "ultra") return Math.max(12, cfgNumber(PERFORMANCE_CONFIG.inputRateUltra, 18));
    if (adaptivePerformance.mode === "low" || LOW_POWER_MODE) return Math.max(16, cfgNumber(PERFORMANCE_CONFIG.inputRateLowPower, 24));
    return Math.max(20, cfgNumber(PERFORMANCE_CONFIG.inputRateNormal, 30));
  }

  function inputSignature(payload) {
    const angle = Math.round((Number(payload.angle) || 0) / INPUT_ANGLE_EPSILON);
    return [
      payload.up ? 1 : 0,
      payload.down ? 1 : 0,
      payload.left ? 1 : 0,
      payload.right ? 1 : 0,
      payload.sprint ? 1 : 0,
      payload.repair ? 1 : 0,
      payload.attackHeld ? 1 : 0,
      payload.actionDir || "",
      angle
    ].join(":");
  }

  function hasContinuousInput(payload) {
    return !!(payload.up || payload.down || payload.left || payload.right || payload.sprint || payload.repair || payload.attackHeld);
  }

  function emitInputPayload(payload, signature, now) {
    socket.emit("input", payload);
    lastInputPayload = signature;
    lastInputSentAt = now;
  }

  function sendInput(oneShot = {}, force = false) {
    if (!socket || !myId) return;
    const me = getLocalPlayerData();
    if (me?.role === "spectator") return;
    if (me?.role === "survivor" && me.dead) return;

    const now = performance.now();

    if (isIntroInputLocked()) {
      clearMovementInputOnly();
      const payload = inputPayload();
      const signature = inputSignature(payload);
      if (force || signature !== lastInputPayload) emitInputPayload(payload, signature, now);
      return;
    }

    const payload = inputPayload(oneShot);
    const signature = inputSignature(payload);
    const isOneShot = !!(oneShot.action || oneShot.attack || oneShot.attackReleased);
    const minInterval = 1000 / inputSendRateHz();
    const elapsed = now - lastInputSentAt;
    const changed = signature !== lastInputPayload;
    const active = hasContinuousInput(payload);

    // Continuous movement gets a steady input stream so the server never coasts
    // on stale intent. Aiming-only changes are still rate-limited, because sending
    // 60 tiny mouse-angle packets per second is how sockets become a leaf blower.
    if (force || isOneShot || (changed && elapsed >= minInterval) || (active && elapsed >= minInterval) || (changed && elapsed >= INPUT_HEARTBEAT_MS)) {
      emitInputPayload(payload, signature, now);
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

    audio.startCue = createManagedAudio("match start cue", MUSIC.START, {
      loop: false,
      preload: "auto",
      volume: 0,
      onReady: (cue) => {
        cue.volume = 0;
        if (audio.startCueActive && !audio.startCuePlayed) playMatchStartCue();
      }
    });

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
      if (audio.startCueActive && !audio.startCuePlayed) playMatchStartCue();
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
    if (audio.startCueActive && !audio.startCuePlayed) {
      const startPlay = playMatchStartCue();
      if (startPlay) plays.push(startPlay);
    }
    Promise.allSettled(plays).then(() => {
      audio.ready = audio.layers.some((a) => hasManagedAudioSource(a) && !a.paused)
        || (audio.startCueActive && hasManagedAudioSource(audio.startCue) && !audio.startCue.paused);
      if (ui.audioText) ui.audioText.textContent = audio.ready ? "On" : "Blocked";
    });
  }


  function safeMediaDurationMs(el, fallbackSeconds) {
    const duration = Number(el?.duration);
    if (Number.isFinite(duration) && duration > 0.25 && duration < 120) return duration * 1000;
    const fallback = Number(fallbackSeconds);
    return Math.max(350, (Number.isFinite(fallback) && fallback > 0 ? fallback : 2.8) * 1000);
  }

  function safeMediaVolume(value, fallback = 0) {
    const next = Number(value);
    const safe = Number.isFinite(next) ? next : fallback;
    return clamp(safe, 0, 1);
  }

  function getMatchStartCueTiming(now = performance.now()) {
    const durationMs = safeMediaDurationMs(audio.startCue, MUSIC.START_FALLBACK_SECONDS);
    const fadeOutMs = clamp(Number(MUSIC.START_FADE_OUT_SECONDS || 1.15) * 1000, 180, Math.max(220, durationMs * 0.9));
    const layerFadeMs = clamp(Number(MUSIC.START_LAYER_1_FADE_IN_SECONDS || 1.35) * 1000, 220, 5000);
    const fadeStartMs = Math.max(120, durationMs - fadeOutMs);
    const elapsedMs = Math.max(0, now - (audio.startCueStartedAt || now));
    return { durationMs, fadeOutMs, layerFadeMs, fadeStartMs, elapsedMs };
  }

  function getMatchStartLayer1Gate(now = performance.now()) {
    if (!audio.startCueActive) return 1;
    const { layerFadeMs, elapsedMs } = getMatchStartCueTiming(now);
    // Fade layer_1 in as soon as start.mp3 begins. The intro still fades out near
    // the end, but the bed should already be alive underneath it.
    return smoothstep(0, 1, clamp(elapsedMs / Math.max(1, layerFadeMs), 0, 1));
  }

  function endMatchStartCue(force = false) {
    if (!audio.startCueActive && !force) return;
    audio.startCueActive = false;
    audio.startCuePlayed = false;
    audio.startCueSourcePending = false;
    audio.startCueMissing = false;
    const cue = audio.startCue;
    if (cue) {
      cue.volume = 0;
      if (!cue.paused) cue.pause();
      try { cue.currentTime = 0; } catch (_) { /* Media seeking can fail if the source never loaded. */ }
    }
  }

  function playMatchStartCue() {
    const cue = audio.startCue;
    if (!audio.gameActive || !audio.startCueActive || !hasManagedAudioSource(cue)) return null;
    audio.startCuePlayed = true;
    audio.startCueMissing = false;
    try { cue.currentTime = 0; } catch (_) { /* ignore */ }
    cue.volume = safeMediaVolume(Number(MUSIC.START_VOLUME ?? 0.26) * MUSIC.MASTER);
    const playPromise = cue.play().catch(() => {
      // If autoplay blocks it, unlockAudio/ensureAudioStarted will retry after the next user gesture.
    });
    return playPromise;
  }

  function beginMatchStartCue() {
    const now = performance.now();
    audio.startCueToken = (audio.startCueToken || 0) + 1;
    const token = audio.startCueToken;
    audio.startCueActive = true;
    audio.startCueStartedAt = now;
    audio.startCuePlayed = false;
    audio.startCueMissing = false;
    audio.startCueSourcePending = !!audio.startCue?._voidriftPending && !hasManagedAudioSource(audio.startCue);
    // Start layer_1 from silence, but keep the snapshot target intact so it can
    // fade in immediately under the start cue instead of waiting for the intro fade-out.
    audio.volumes[0] = 0;

    const played = playMatchStartCue();
    if (played) return;

    if (audio.startCueSourcePending) {
      audio.startCue._voidriftPending.finally(() => {
        if (token !== audio.startCueToken || !audio.startCueActive) return;
        audio.startCueSourcePending = false;
        if (!playMatchStartCue()) {
          // Missing start.mp3 should never hold the whole soundtrack hostage.
          endMatchStartCue(true);
        }
      });
      return;
    }

    // Missing asset fallback: release layer_1 immediately instead of serving silence.
    endMatchStartCue(true);
  }

  function updateMatchStartCue(now = performance.now()) {
    if (!audio.startCueActive) return;
    const { durationMs, fadeOutMs, fadeStartMs, elapsedMs } = getMatchStartCueTiming(now);
    const cue = audio.startCue;

    if (hasManagedAudioSource(cue) && audio.startCuePlayed) {
      const fadeT = clamp((elapsedMs - fadeStartMs) / Math.max(1, fadeOutMs), 0, 1);
      const volumeGate = 1 - smoothstep(0, 1, fadeT);
      cue.volume = safeMediaVolume(Number(MUSIC.START_VOLUME ?? 0.26) * MUSIC.MASTER * volumeGate);
    }

    const cueEnded = !!cue?.ended;
    if (cueEnded || elapsedMs > durationMs + fadeOutMs + 400) {
      endMatchStartCue(false);
    }
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
      clamp((m.layer2 || 0) * (layerVolumes.layer2 ?? 1) * MUSIC.MASTER, 0, 0.40),
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
    const now = performance.now();
    updateMatchStartCue(now);
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

    const layer1Gate = getMatchStartLayer1Gate(now);
    for (let i = 0; i < audio.layers.length; i++) {
      const target = i === 0 ? audio.targets[i] * layer1Gate : audio.targets[i];
      audio.volumes[i] += (target - audio.volumes[i]) * MUSIC.FADE;
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

  function playLocalSpeedBoostAbilitySfx(event) {
    if (!event || event.actorId !== myId) return;
    if (event.abilityId !== "nullRush" && event.abilityId !== "speedBurst") return;
    playSfx("speedBoost", { disablePitchVariation: true });
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
    // 1/30 is grounded, 30/30 is higher without becoming chipmunk nonsense.
    const rate = 0.86 + t * 0.74;
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
    const domInterval = adaptivePerformance.mode === "ultra" ? 90 : adaptivePerformance.mode === "low" ? 50 : HIGH_END_EFFECTS ? 16 : 32;
    if (now - (fxState.lastDomUpdate || 0) < domInterval) return;
    fxState.lastDomUpdate = now;

    const domKey = [
      terror.toFixed(2),
      chase.toFixed(2),
      fxState.redChase.toFixed(2),
      fxState.blood.toFixed(2),
      (raw.voidStun || 0).toFixed(2),
      fxState.tunnel.toFixed(2),
      pulseSpeed,
      raw.chase > 0 ? 1 : 0,
      raw.injured ? 1 : 0
    ].join(":");
    if (fxState.lastDomKey === domKey) return;
    fxState.lastDomKey = domKey;

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
      this.actorVisionTimer = 0;
      this.lightingRedrawTimer = 0;
      this.particleRedrawTimer = 0;
      this.activePerformanceMode = adaptivePerformance.mode;
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
      this.cameraFollowX = null;
      this.cameraFollowY = null;
      this.currentCameraZoom = cameraZoomNow;
      this.targetCameraZoom = CAMERA.BASE_ZOOM;
      this.cameraZoomPlan = getCameraZoomPlan(null);
      this.spawnInPlayed = false;
      this.spawnInAt = 0;
      this.matchStartFreezeRemaining = 0;
      this.matchStartFreezeDuration = IMMERSION.MATCH_START_LOCK_SECONDS;
      this.matchStartInputLockUntil = 0;
      this.introCameraPrimed = false;
      this.floorEndgameActive = false;
      this.lastMoveDirX = 0;
      this.lastMoveDirY = 0;
      this.spectateTargetId = null;
      this.lastSpectateEmitId = "";
      this.lastSpectateEmitAt = 0;
      this.lastSpectatorOverviewMode = false;
      this.localEscapeScreenShown = false;
      this.lastLocalChatText = "";
      this.localCollisionCache = new Map();
      this.localCollisionCacheEpoch = 0;
      this.localCollisionCellSize = 96;
      this.killerWallVisionStableKey = "";
      this.hookIndicatorTimer = 0;
    }

    isSpectating() {
      if (isDedicatedSpectator(currentSnapshot)) return true;
      const me = this.actors.get(myId)?.data || getLocalPlayerData();
      return me?.role === "survivor" && (!!me.dead || !!me.escaped);
    }

    getLivingTeammates() {
      return getSpectateTargets(currentSnapshot);
    }

    getSpectateOptions() {
      return getSpectateOptions(currentSnapshot);
    }

    isSpectatorOverviewMode() {
      return this.isSpectating() && isDedicatedSpectator() && isSpectateOverviewId(this.spectateTargetId || currentSnapshot?.viewer?.spectateTargetId);
    }

    resolveSpectateTargetId() {
      if (!this.isSpectating()) return myId;
      const options = this.getSpectateOptions();
      const actorTargets = options.filter((a) => !a.overview);
      const viewerTargetId = currentSnapshot?.viewer?.spectateTargetId || null;

      if (isDedicatedSpectator() && isSpectateOverviewId(this.spectateTargetId)) return SPECTATE_OVERVIEW_ID;
      if (isDedicatedSpectator() && isSpectateOverviewId(viewerTargetId)) {
        this.spectateTargetId = SPECTATE_OVERVIEW_ID;
        return SPECTATE_OVERVIEW_ID;
      }

      if (!actorTargets.length) {
        if (isDedicatedSpectator()) {
          this.spectateTargetId = SPECTATE_OVERVIEW_ID;
          return SPECTATE_OVERVIEW_ID;
        }
        return myId;
      }

      if (actorTargets.some((a) => a.id === this.spectateTargetId)) return this.spectateTargetId;
      if (viewerTargetId && actorTargets.some((a) => a.id === viewerTargetId)) {
        this.spectateTargetId = viewerTargetId;
        return this.spectateTargetId;
      }
      this.spectateTargetId = actorTargets[0].id;
      return this.spectateTargetId;
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
      const options = this.getSpectateOptions();
      const actorTargets = options.filter((a) => !a.overview);
      const viewerTargetId = currentSnapshot?.viewer?.spectateTargetId || null;

      if (isDedicatedSpectator() && isSpectateOverviewId(viewerTargetId)) {
        this.spectateTargetId = SPECTATE_OVERVIEW_ID;
        this.emitSpectateTarget(this.spectateTargetId);
        return this.spectateTargetId;
      }
      if (!actorTargets.length) {
        this.spectateTargetId = isDedicatedSpectator() ? SPECTATE_OVERVIEW_ID : null;
        if (this.spectateTargetId) this.emitSpectateTarget(this.spectateTargetId);
        return this.spectateTargetId;
      }
      this.spectateTargetId = viewerTargetId && actorTargets.some((a) => a.id === viewerTargetId)
        ? viewerTargetId
        : actorTargets[0].id;
      this.emitSpectateTarget(this.spectateTargetId);
      return this.spectateTargetId;
    }

    cycleSpectateTarget(step = 1) {
      if (!this.isSpectating()) return;
      const options = this.getSpectateOptions();
      if (options.length <= 1) return;
      let idx = options.findIndex((a) => a.id === this.resolveSpectateTargetId());
      if (idx < 0) idx = 0;
      idx = (idx + step + options.length) % options.length;
      this.spectateTargetId = options[idx].id;
      this.emitSpectateTarget(this.spectateTargetId);
      if (this.spectateTargetId === SPECTATE_OVERVIEW_ID) {
        toast("Spectating full map overview", 1600);
      } else {
        const target = options[idx];
        toast(`Spectating ${target?.name || (target?.role === "killer" ? "The Void" : "Runner")}`, 1400);
      }
    }

    getCameraSubjectItem() {
      const targetId = this.isSpectating() ? this.resolveSpectateTargetId() : myId;
      if (isSpectateOverviewId(targetId)) return null;
      return targetId ? (this.actors.get(targetId) || null) : null;
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
      cameraZoomNow = CAMERA.BASE_ZOOM;
      this.currentCameraZoom = cameraZoomNow;
      this.targetCameraZoom = cameraZoomNow;
      this.cameras.main.setZoom(cameraZoomNow);
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
        if (isDedicatedSpectator()) {
          input.attackHeld = false;
          clearMovementInputOnly();
          return;
        }
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
      this.invalidateLocalCollisionCache();
      this.killerWallVisionStableKey = "";
      this.spectateTargetId = null;
      this.lastSpectateEmitId = "";
      this.introCameraPrimed = false;
      this.floorEndgameActive = false;
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
      const endgame = !!this.floorEndgameActive;
      g.fillStyle(endgame ? 0x120611 : 0x070913, 1);
      g.fillRect(0, 0, this.map.width, this.map.height);
      if (endgame) {
        // Endgame floor: darker, warmer, and cracked so completed rifts read instantly
        // without needing one more giant UI panel yelling at people.
        this.drawStaticArenaGrid(g, 0, 0, this.map.width, this.map.height, this.map.tile || 72, 0x6d1b47, 0.34);
        this.drawStaticArenaGrid(g, 0, 0, this.map.width, this.map.height, (this.map.tile || 72) * 3, 0xa855f7, 0.15);
        g.lineStyle(2, 0xff3b6a, 0.18);
        const step = Math.max(96, (this.map.tile || 72) * 1.55);
        for (let y = step * 0.5; y < this.map.height; y += step) {
          g.beginPath();
          for (let x = 0; x <= this.map.width; x += step * 0.5) {
            const wobble = Math.sin((x + y) * 0.015) * 16 + Math.sin(x * 0.037) * 6;
            if (x === 0) g.moveTo(x, y + wobble);
            else g.lineTo(x, y + wobble);
          }
          g.strokePath();
        }
        g.fillStyle(0xff3b6a, 0.035);
        for (let i = 0; i < 42; i++) {
          const x = hash2(i * 17, i + 4) * this.map.width;
          const y = hash2(i + 101, i * 29) * this.map.height;
          const r = 16 + hash2(i + 44, i + 88) * 42;
          g.fillCircle(x, y, r);
        }
      } else {
        g.fillStyle(0x070913, 1);
        g.fillRect(0, 0, this.map.width, this.map.height);
        this.drawStaticArenaGrid(g, 0, 0, this.map.width, this.map.height, this.map.tile || 72, 0x172541, 0.32);
        this.drawStaticArenaGrid(g, 0, 0, this.map.width, this.map.height, (this.map.tile || 72) * 4, 0x315082, 0.18);
      }
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
      const generators = snapshot?.map?.generators || this.map?.generators || [];
      // Full-map spectator overview should reveal rift locations even when the normal
      // player HUD hides completed rifts for the endgame floor treatment.
      if (this.isSpectatorOverviewMode()) return generators;
      if (this.riftsAreComplete(snapshot)) return [];
      return generators;
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
      const forceOverviewObjects = this.isSpectatorOverviewMode();
      for (const gate of currentSnapshot.map?.gates || this.map.gates || []) this.drawGate(g, gate, { forceVisible: forceOverviewObjects });
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

      if (this.isSpectatorOverviewMode()) {
        let animating = false;
        for (const gen of generators) {
          if (!gen?.id) continue;
          seen.add(gen.id);
          let state = this.generatorVisionVisual.get(gen.id);
          if (!state) {
            state = { alpha: 1, targetAlpha: 1 };
            this.generatorVisionVisual.set(gen.id, state);
            animating = true;
          }
          if (state.alpha !== 1 || state.targetAlpha !== 1) {
            state.alpha = 1;
            state.targetAlpha = 1;
            animating = true;
          }
        }
        for (const id of [...this.generatorVisionVisual.keys()]) {
          if (!seen.has(id)) {
            this.generatorVisionVisual.delete(id);
            animating = true;
          }
        }
        return animating;
      }

      const subject = this.getCameraSubjectItem();
      const hasSubject = !!subject?.container;
      const role = subject?.data?.role || "survivor";
      const hourglassActive = role === "survivor" && (subject?.data?.hourglass || 0) > 0;
      const worldX = subject?.container?.x ?? 0;
      const worldY = subject?.container?.y ?? 0;
      const facing = subject?.container?.rotation || 0;
      const baseLength = role === "killer" ? LIGHTING.KILLER_LENGTH : survivorVisionLengthForData(subject?.data);
      const baseAngle = role === "killer" ? LIGHTING.KILLER_ANGLE : survivorVisionAngleForData(subject?.data);
      const length = baseLength + WALL_VISION.CONE_EXTRA_LENGTH;
      const coneAngle = baseAngle + WALL_VISION.CONE_EXTRA_ANGLE;
      const backLength = length * LIGHTING.SURVIVOR_HOURGLASS_BACK_LENGTH_MULT;
      const backConeAngle = Math.min(Math.PI * 1.08, coneAngle * LIGHTING.SURVIVOR_HOURGLASS_BACK_ANGLE_MULT);
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
          if (role === "killer" || !hasSubject) {
            state.targetAlpha = role === "killer" ? 1 : 0;
          } else {
            const forwardAlpha = this.computeGeneratorVisionAlpha(gen, worldX, worldY, facing, length, coneAngle, nearRadius);
            const backAlpha = hourglassActive
              ? this.computeGeneratorVisionAlpha(gen, worldX, worldY, facing + Math.PI, backLength, backConeAngle, nearRadius)
              : 0;
            state.targetAlpha = Math.max(forwardAlpha, backAlpha);
          }
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
      const now = performance.now?.() || Date.now();
      const pulse = 0.5 + Math.sin(now / 230 + hash2(Math.floor(pallet.x), Math.floor(pallet.y)) * Math.PI * 2) * 0.5;
      if (broken) {
        this.drawBrokenRiftPallet(g, pallet, pulse);
        return;
      }

      if (pallet.orientation === "horizontal") {
        const h = dropped ? pallet.h * 0.72 : pallet.h * 0.36;
        const y = dropped ? pallet.y + pallet.h * 0.14 : pallet.y + pallet.h * 0.32;
        this.drawRiftPalletBody(g, pallet.x + 5, y, pallet.w - 10, h, true, dropped, pulse);
      } else {
        const w = dropped ? pallet.w * 0.72 : pallet.w * 0.36;
        const x = dropped ? pallet.x + pallet.w * 0.14 : pallet.x + pallet.w * 0.32;
        this.drawRiftPalletBody(g, x, pallet.y + 5, w, pallet.h - 10, false, dropped, pulse);
      }
    }

    drawBrokenRiftPallet(g, pallet, pulse = 0.5) {
      const cx = pallet.x + pallet.w * 0.5;
      const cy = pallet.y + pallet.h * 0.5;
      const padX = Math.max(12, pallet.w * 0.18);
      const padY = Math.max(10, pallet.h * 0.18);
      const x1 = pallet.x + padX;
      const x2 = pallet.x + pallet.w - padX;
      const y1 = pallet.y + padY;
      const y2 = pallet.y + pallet.h - padY;
      const purple = 0xa855f7;
      const hotPurple = 0xff4fd8;
      const paleGlow = 0xf5d0fe;
      const deepVoid = 0x08030f;

      // Ground scorch / contact shadow so broken pallets feel embedded in the arena.
      g.fillStyle(0x04050a, 0.26);
      g.fillEllipse(cx, cy + 7, pallet.w * 0.82, pallet.h * 0.34);

      // A few snapped void-tech fragments around the central X.
      const fragments = [
        [pallet.x + pallet.w * 0.18, pallet.y + pallet.h * 0.31, -0.22, 16],
        [pallet.x + pallet.w * 0.80, pallet.y + pallet.h * 0.34, 0.26, 15],
        [pallet.x + pallet.w * 0.27, pallet.y + pallet.h * 0.72, 0.18, 13],
        [pallet.x + pallet.w * 0.72, pallet.y + pallet.h * 0.70, -0.24, 18]
      ];
      for (const [fx, fy, tilt, len] of fragments) {
        g.lineStyle(5.2, deepVoid, 0.82);
        g.beginPath();
        g.moveTo(fx - Math.cos(tilt) * len * 0.5, fy - Math.sin(tilt) * len * 0.5);
        g.lineTo(fx + Math.cos(tilt) * len * 0.5, fy + Math.sin(tilt) * len * 0.5);
        g.strokePath();
        g.lineStyle(1.4, paleGlow, 0.22 + pulse * 0.12);
        g.beginPath();
        g.moveTo(fx - Math.cos(tilt) * len * 0.34, fy - Math.sin(tilt) * len * 0.34);
        g.lineTo(fx + Math.cos(tilt) * len * 0.34, fy + Math.sin(tilt) * len * 0.34);
        g.strokePath();
      }

      // Main broken-state read: a glowing purple X at the center.
      for (let i = 0; i < 2; i++) {
        const wideAlpha = i === 0 ? 0.22 + pulse * 0.08 : 0.16 + pulse * 0.06;
        const width = i === 0 ? 13 : 8;
        g.lineStyle(width, hotPurple, wideAlpha);
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.moveTo(x2, y1);
        g.lineTo(x1, y2);
        g.strokePath();
      }

      g.lineStyle(7, deepVoid, 0.92);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.moveTo(x2, y1);
      g.lineTo(x1, y2);
      g.strokePath();

      g.lineStyle(4.2, purple, 0.90);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.moveTo(x2, y1);
      g.lineTo(x1, y2);
      g.strokePath();

      g.lineStyle(1.8, paleGlow, 0.60 + pulse * 0.20);
      g.beginPath();
      g.moveTo(x1 + 7, y1 + 6);
      g.lineTo(x2 - 7, y2 - 6);
      g.moveTo(x2 - 7, y1 + 6);
      g.lineTo(x1 + 7, y2 - 6);
      g.strokePath();

      g.fillStyle(hotPurple, 0.44 + pulse * 0.14);
      g.fillCircle(cx, cy, 4.2 + pulse * 1.4);
      g.lineStyle(1.2, paleGlow, 0.34 + pulse * 0.22);
      g.strokeCircle(cx, cy, 10 + pulse * 4.5);
    }

    drawRiftPalletBody(g, x, y, w, h, horizontal, dropped, pulse = 0.5) {
      // RiftRunner barricade: obsidian shell + glowing rift seams so the pallet feels
      // like a scavenged void-tech object instead of a normal wood pallet.
      const shell = dropped ? 0x10254c : 0x110817;
      const shellDark = dropped ? 0x071126 : 0x05030b;
      const panel = dropped ? 0x1e4f85 : 0x3b1365;
      const panelAlt = dropped ? 0x163968 : 0x2a0e48;
      const trim = dropped ? 0x78d4ff : 0xc084fc;
      const glow = dropped ? 0xcbf4ff : 0xffc8fb;
      const rift = dropped ? 0x38bdf8 : 0xff4fd8;
      const core = dropped ? 0x7dd3fc : 0x8b5cf6;
      const shadowAlpha = dropped ? 0.22 : 0.18;
      const glowAlpha = dropped ? 0.26 + pulse * 0.14 : 0.18 + pulse * 0.12;

      g.fillStyle(0x04050a, shadowAlpha);
      g.fillRoundedRect(x + 4, y + 6, w, h, 12);

      g.fillStyle(shellDark, 0.72);
      g.fillRoundedRect(x - 1, y - 1, w + 2, h + 2, 12);
      g.fillStyle(shell, 0.94);
      g.fillRoundedRect(x, y, w, h, 11);
      g.lineStyle(3, trim, dropped ? 0.54 : 0.48);
      g.strokeRoundedRect(x, y, w, h, 11);

      g.fillStyle(core, glowAlpha);
      g.fillRoundedRect(x + 3, y + 3, w - 6, h - 6, 10);

      const lanes = 3;
      if (horizontal) {
        const laneW = w / lanes;
        for (let i = 0; i < lanes; i++) {
          const sx = x + i * laneW + 5;
          const laneColor = i === 1 ? panel : panelAlt;
          g.fillStyle(laneColor, 0.96);
          g.fillRoundedRect(sx, y + 5, laneW - 10, h - 10, 8);
          g.lineStyle(1.4, glow, 0.30 + (i === 1 ? pulse * 0.20 : pulse * 0.12));
          g.strokeRoundedRect(sx + 1, y + 6, laneW - 12, h - 12, 7);
        }

        const seamXs = [x + w * 0.33, x + w * 0.66];
        for (const seamX of seamXs) {
          g.lineStyle(2.3, rift, 0.74 + pulse * 0.10);
          g.beginPath();
          g.moveTo(seamX - 3, y + 8);
          g.lineTo(seamX + 1, y + h * 0.34);
          g.lineTo(seamX - 4, y + h * 0.62);
          g.lineTo(seamX + 2, y + h - 8);
          g.strokePath();
        }

        g.lineStyle(4, trim, dropped ? 0.68 : 0.54);
        g.beginPath(); g.moveTo(x + 10, y + h * 0.28); g.lineTo(x + w - 10, y + h * 0.72); g.strokePath();
        g.beginPath(); g.moveTo(x + 10, y + h * 0.72); g.lineTo(x + w - 10, y + h * 0.28); g.strokePath();
      } else {
        const laneH = h / lanes;
        for (let i = 0; i < lanes; i++) {
          const sy = y + i * laneH + 5;
          const laneColor = i === 1 ? panel : panelAlt;
          g.fillStyle(laneColor, 0.96);
          g.fillRoundedRect(x + 5, sy, w - 10, laneH - 10, 8);
          g.lineStyle(1.4, glow, 0.30 + (i === 1 ? pulse * 0.20 : pulse * 0.12));
          g.strokeRoundedRect(x + 6, sy + 1, w - 12, laneH - 12, 7);
        }

        const seamYs = [y + h * 0.33, y + h * 0.66];
        for (const seamY of seamYs) {
          g.lineStyle(2.3, rift, 0.74 + pulse * 0.10);
          g.beginPath();
          g.moveTo(x + 8, seamY - 3);
          g.lineTo(x + w * 0.34, seamY + 1);
          g.lineTo(x + w * 0.62, seamY - 4);
          g.lineTo(x + w - 8, seamY + 2);
          g.strokePath();
        }

        g.lineStyle(4, trim, dropped ? 0.68 : 0.54);
        g.beginPath(); g.moveTo(x + w * 0.28, y + 10); g.lineTo(x + w * 0.72, y + h - 10); g.strokePath();
        g.beginPath(); g.moveTo(x + w * 0.72, y + 10); g.lineTo(x + w * 0.28, y + h - 10); g.strokePath();
      }

      // Corner clamps / anchor brackets.
      const clamp = 9;
      const pad = 5;
      g.lineStyle(2.2, glow, 0.58 + pulse * 0.12);
      g.beginPath();
      g.moveTo(x + pad, y + pad + clamp); g.lineTo(x + pad, y + pad); g.lineTo(x + pad + clamp, y + pad);
      g.moveTo(x + w - pad - clamp, y + pad); g.lineTo(x + w - pad, y + pad); g.lineTo(x + w - pad, y + pad + clamp);
      g.moveTo(x + w - pad, y + h - pad - clamp); g.lineTo(x + w - pad, y + h - pad); g.lineTo(x + w - pad - clamp, y + h - pad);
      g.moveTo(x + pad + clamp, y + h - pad); g.lineTo(x + pad, y + h - pad); g.lineTo(x + pad, y + h - pad - clamp);
      g.strokePath();

      // Tiny energy anchors make it read as an object connected to the rift network.
      const nodes = horizontal
        ? [[x + w * 0.18, y + h * 0.23], [x + w * 0.82, y + h * 0.77]]
        : [[x + w * 0.23, y + h * 0.18], [x + w * 0.77, y + h * 0.82]];
      for (const [nx, ny] of nodes) {
        g.fillStyle(0xffffff, 0.72);
        g.fillCircle(nx, ny, 3.2);
        g.lineStyle(1.4, rift, 0.30 + pulse * 0.18);
        g.strokeCircle(nx, ny, 6.2 + pulse * 2.0);
      }

      if (!dropped) {
        g.lineStyle(1.6, glow, 0.14 + pulse * 0.18);
        g.strokeRoundedRect(x + 2, y + 2, w - 4, h - 4, 10);
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

    drawGate(g, gate, options = {}) {
      const forceVisible = !!options.forceVisible;
      if (!gate || (!gate.open && !forceVisible)) return;
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
      const nextFloorEndgame = this.riftsAreComplete(snapshot);
      if (this.map && nextFloorEndgame !== this.floorEndgameActive) {
        this.floorEndgameActive = nextFloorEndgame;
        this.rebuildGrassLayer();
      }
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
      const me = (snapshot.actors || []).find((a) => a.id === myId) || (snapshot.viewer?.id === myId ? snapshot.viewer : null);
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
        redOrbs: snapshot.voidEffects?.redOrbs || 0,
        spectateTargetId: snapshot.viewer?.spectateTargetId || this.spectateTargetId || null
      });
      dispatchAbilityHuds(snapshot);
      if (hudKey === this.lastHudKey && now - this.lastHudRenderAt < 180) return;
      this.lastHudKey = hudKey;
      this.lastHudRenderAt = now;
      renderSurvivorStatusHud(snapshot);
      const hudRole = me.role === "killer" ? "killer" : me.role === "spectator" ? "spectator" : "survivor";
      ui.hud.dataset.role = hudRole;
      ui.roleLabel.textContent = hudRole === "killer" ? "The Void" : hudRole === "spectator" ? "Spectator" : "Runner";
      ui.controlsLabel.textContent = hudRole === "killer"
        ? "WASD move • Mouse aim • M1 attack/lunge • Space vault/break • hold E hook/execute/kick Rift • hold Q abilities • hold R chat"
        : hudRole === "spectator"
          ? "Tab / Shift+Tab — switch camera • overview after players"
          : "WASD move • Shift sprint • Mouse flashlight • Space vault/drop • hold Q abilities • collect orbs, stand near active Rifts to deposit • stand still near teammates to heal/rescue • hold R chat";
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
      } else if (me.role === "spectator") {
        const targetId = this.resolveSpectateTargetId();
        const target = (snapshot.actors || []).find((a) => a.id === targetId);
        ui.healthText.textContent = targetId === SPECTATE_OVERVIEW_ID
          ? "Spectating: Full Map Overview"
          : target
            ? `Spectating: ${target.name || (target.role === "killer" ? "The Void" : "Runner")}`
            : "Spectating";
        ui.controlsLabel.textContent = "Tab / Shift+Tab — switch camera • overview after players";
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
        item.skin = data.skin || (data.role === "survivor" ? "blueSquare" : "voidCore");
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

        this.pushActorNetworkSample(item, data);

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
        const nextName = data.name || "";
        if (item.nameText && item.lastNameText !== nextName) {
          item.nameText.setText(nextName);
          item.lastNameText = nextName;
        }
        if (item.chatText) {
          const actorChat = visibleChatTextForActor(data);
          if (item.lastChatText !== actorChat) {
            item.chatText.setText(actorChat);
            item.lastChatText = actorChat;
          }

          // Play the speak chirp only when the local player's own chat bubble appears/changes.
          // Other players can talk all they want without hijacking your ears, a radical concept.
          if (data.id === myId) {
            if (actorChat && actorChat !== this.lastLocalChatText && activeScreenName === "game") {
              playSfx("playerSpeak");
            }
            this.lastLocalChatText = actorChat || "";
          }
        }
        const actorVisualSignature = this.actorVisualSignature(data);
        if (item.lastActorVisualSignature !== actorVisualSignature) {
          item.lastActorVisualSignature = actorVisualSignature;
          item.forceStyleRefresh = true;
        }

        if (data.id === myId) {
          this.localServerTarget = { x: data.x, y: data.y, angle: data.angle, data };
          if (this.localVisual) {
            this.localVisual.role = data.role;
            this.localVisual.skin = data.skin || (data.role === "killer" ? "voidCore" : "blueSquare");
          }
          if (!this.localVisual || dist(this.localVisual.x, this.localVisual.y, data.x, data.y) > 180) {
            this.localVisual = { x: data.x, y: data.y, angle: data.angle, role: data.role, skin: data.skin || (data.role === "killer" ? "voidCore" : "blueSquare") };
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
        skin: data.skin || (data.role === "killer" ? "voidCore" : "blueSquare"),
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
        forceFullVision: false,
        forceStyleRefresh: true,
        actorStyleTimer: 999,
        lastActorVisualSignature: "",
        lastNameText: data.name || "",
        lastChatText: ""
      };
    }

    actorVisualSignature(data) {
      if (!data) return "none";
      const progress = data.hooked
        ? (data.unhookProgress || 0)
        : data.downed
          ? ((data.healProgress || 0) || (data.hookProgress || 0))
          : ((data.healProgress || 0) || (data.dotDepositProgress || 0));
      const dotStep = adaptivePerformance.mode === "ultra" ? 2 : adaptivePerformance.mode === "low" ? 1 : 0.5;
      const dots = Math.round(clamp(Number(data.dots || 0), 0, SURVIVOR_DOT_MAX) / dotStep) * dotStep;
      const progressStep = Math.round(clamp(Number(progress || 0), 0, 1) * (adaptivePerformance.mode === "normal" ? 24 : 10));
      return [
        data.role || "actor",
        data.skin || "",
        data.health || 0,
        data.injured ? 1 : 0,
        data.downed ? 1 : 0,
        data.hooked ? 1 : 0,
        data.dead ? 1 : 0,
        data.escaped ? 1 : 0,
        data.invuln > 0 ? 1 : 0,
        data.attackState || "",
        data.attacking ? 1 : 0,
        data.recovery > 0 ? 1 : 0,
        data.voidStun > 0 ? 1 : 0,
        data.voidSpeedBoost > 0 ? 1 : 0,
        dots,
        progressStep,
        data.dotDepositTargetId || ""
      ].join(":");
    }

    shouldRefreshActorStyle(item, dt) {
      if (!item?.data) return false;
      if (item.forceStyleRefresh) return true;
      item.actorStyleTimer = (item.actorStyleTimer || 0) + Math.max(0, dt || 0);
      const fps = Math.max(1, performanceValue("actorStyleFps", adaptivePerformance.mode === "normal" ? 60 : 12));
      return item.actorStyleTimer >= 1 / fps;
    }

    pushActorNetworkSample(item, data, now = performance.now()) {
      if (!item || !data || data.id === myId) return;
      const x = Number(data.x);
      const y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const angle = Number.isFinite(data.angle) ? data.angle : (item.target?.angle || 0);
      const sample = { x, y, angle, t: now, seq: currentSnapshot?.seq || 0 };
      item.latestServer = sample;
      item.latestServerAt = now;
      const samples = item.netSamples || (item.netSamples = []);
      const last = samples[samples.length - 1];
      const isVoid = data.role === "killer";
      const snapDistance = isVoid
        ? Math.max(160, performanceValue("remoteSnapDistance", LOW_POWER_MODE ? 260 : 230) * 0.78)
        : performanceValue("remoteSnapDistance", LOW_POWER_MODE ? 260 : 230);
      const stateKey = `${data.role || "actor"}:${data.dead ? 1 : 0}:${data.escaped ? 1 : 0}:${data.hooked ? 1 : 0}:${data.vaulting ? 1 : 0}`;

      if (!last) {
        samples.push(sample);
        item.lastNetStateKey = stateKey;
        return;
      }

      const jump = dist(last.x, last.y, sample.x, sample.y);
      const stateChangedHard = item.lastNetStateKey && item.lastNetStateKey !== stateKey && (data.vaulting || data.dead || data.escaped || data.hooked);
      if (jump > snapDistance || stateChangedHard) {
        samples.length = 0;
        samples.push(sample);
        item.current.x = sample.x;
        item.current.y = sample.y;
        item.current.angle = sample.angle;
        item.lastNetStateKey = stateKey;
        return;
      }

      // Avoid filling the interpolation buffer with duplicate same-frame samples.
      if (now - last.t < 8 && jump < 0.25 && Math.abs(angle - last.angle) < 0.002) {
        item.lastNetStateKey = stateKey;
        return;
      }

      samples.push(sample);
      while (samples.length > 7) samples.shift();
      item.lastNetStateKey = stateKey;
    }

    getInterpolatedRemoteState(item) {
      const samples = item?.netSamples;
      if (!samples || samples.length < 2) return null;

      const now = performance.now();
      const isVoid = item.data?.role === "killer";
      const jitterPad = Math.min(
        cfgNumber(PERFORMANCE_CONFIG.snapshotJitterDelayMaxMs, 42),
        Math.max(0, networkTiming.jitterMs * 1.35)
      );
      const delay = Math.max(35, (isVoid
        ? performanceValue("voidInterpolationDelayMs", LOW_POWER_MODE ? 70 : 55)
        : performanceValue("remoteInterpolationDelayMs", LOW_POWER_MODE ? 120 : 80)) + jitterPad);
      const renderTime = now - delay;

      while (samples.length > 2 && samples[1].t <= renderTime) samples.shift();

      const first = samples[0];
      const second = samples[1];
      if (!first || !second) return first || null;

      if (renderTime <= first.t) return first;

      if (renderTime <= second.t) {
        const span = Math.max(1, second.t - first.t);
        const t = clamp((renderTime - first.t) / span, 0, 1);
        return {
          x: lerp(first.x, second.x, t),
          y: lerp(first.y, second.y, t),
          angle: lerpAngle(first.angle, second.angle, t)
        };
      }

      // If the render clock is slightly past the newest snapshot, extrapolate just
      // enough to cover jitter. This is capped hard so a dropped packet does not
      // launch actors into the nearest zip code, which is rude even for netcode.
      const sampleDt = Math.max(0.001, (second.t - first.t) / 1000);
      const maxExtrapolateMs = Math.max(0, item.data?.role === "killer"
        ? performanceValue("voidExtrapolateMs", LOW_POWER_MODE ? 120 : 95)
        : performanceValue("remoteExtrapolateMs", LOW_POWER_MODE ? 90 : 70));
      const extraSeconds = clamp((renderTime - second.t) / 1000, 0, maxExtrapolateMs / 1000);
      const vx = (second.x - first.x) / sampleDt;
      const vy = (second.y - first.y) / sampleDt;
      const speed = Math.hypot(vx, vy);
      const maxReasonableSpeed = item.data?.role === "killer" ? 760 : 660;

      if (speed > maxReasonableSpeed) return second;

      return {
        x: second.x + vx * extraSeconds,
        y: second.y + vy * extraSeconds,
        angle: second.angle
      };
    }

    pullRemoteVoidTowardLatest(item, state) {
      if (!item || !state || item.data?.role !== "killer" || !item.latestServer) return state;
      const latest = item.latestServer;
      const gap = dist(state.x, state.y, latest.x, latest.y);
      const maxLag = Math.max(48, performanceValue("voidMaxVisualLag", LOW_POWER_MODE ? 84 : 96));
      if (gap <= maxLag) return state;

      const pull = (gap - maxLag) / gap;
      return {
        x: lerp(state.x, latest.x, pull),
        y: lerp(state.y, latest.y, pull),
        angle: lerpAngle(state.angle, latest.angle, Math.min(0.65, pull + 0.15))
      };
    }

    localInputMagnitude() {
      return Math.hypot(
        (input.right ? 1 : 0) - (input.left ? 1 : 0),
        (input.down ? 1 : 0) - (input.up ? 1 : 0)
      );
    }

    reconcileLocalVisual(dt, targetX, targetY, sourceData = this.localServerTarget?.data) {
      if (!this.localVisual || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return;
      const role = sourceData?.role || this.localVisual.role || "survivor";

      // If local prediction ever wedged the actor into geometry, free it before
      // applying server correction. Otherwise the client can keep drawing a stuck
      // body while the server has already slid it clear.
      this.maybeResolveLocalActorOverlaps(role, 2, false);

      const dx = targetX - this.localVisual.x;
      const dy = targetY - this.localVisual.y;
      const gap = Math.hypot(dx, dy);
      if (gap < 0.02) return;

      const moving = this.localInputMagnitude() > 0.05;
      const isVoid = role === "killer";
      const snapDistance = isVoid
        ? Math.max(140, performanceValue("localCorrectionSnapDistance", LOW_POWER_MODE ? 230 : 190) * 0.66)
        : performanceValue("localCorrectionSnapDistance", LOW_POWER_MODE ? 230 : 190);
      if (gap > snapDistance) {
        this.localVisual.x = targetX;
        this.localVisual.y = targetY;
        this.cameraFollowX = targetX;
        this.cameraFollowY = targetY;
        return;
      }

      const deadzone = isVoid
        ? (moving ? (LOW_POWER_MODE ? 6 : 2.8) : (LOW_POWER_MODE ? 2.5 : 1.2))
        : performanceValue(
            moving ? "localCorrectionDeadzoneMoving" : "localCorrectionDeadzoneIdle",
            moving ? (LOW_POWER_MODE ? 14 : 3.5) : (LOW_POWER_MODE ? 4 : 1.5)
          );
      if (gap <= deadzone) return;

      const correctionGap = gap - deadzone;
      const reconcileRate = isVoid ? (LOW_POWER_MODE ? 9.5 : 7.2) : performanceValue("localReconcileRate", 4.8);
      const correctionSpeed = isVoid ? (LOW_POWER_MODE ? 360 : 430) : performanceValue("localMaxCorrectionPerSecond", LOW_POWER_MODE ? 150 : 260);
      const alphaStep = correctionGap * dampAlpha(reconcileRate, dt);
      const maxStep = Math.max(1, correctionSpeed * dt);
      const step = Math.min(correctionGap, Math.min(alphaStep, maxStep));
      this.localVisual.x += dx / gap * step;
      this.localVisual.y += dy / gap * step;

      this.maybeResolveLocalActorOverlaps(role, 1, true);
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

      const maxVisualDots = Math.max(0, Math.min(
        SURVIVOR_DOT_MAX,
        Math.floor(performanceValue("heldOrbMaxDots", SURVIVOR_DOT_MAX))
      ));
      if (maxVisualDots <= 0) return;

      const visualDots = Math.max(1, Math.min(maxVisualDots, Math.ceil(display)));
      const spreadCount = Math.max(1, visualDots);
      const spinScale = clamp(performanceValue("heldOrbSpinScale", 1), 0, 1);
      const bobScale = clamp(performanceValue("heldOrbBobScale", 1), 0, 1);
      const orbitPhase = (item.dotOrbitPhase ?? 0) * spinScale;
      const represented = Math.max(1, display / visualDots);
      const highCountScale = display > visualDots ? clamp(display / Math.max(1, SURVIVOR_DOT_MAX), 0.35, 1) : 1;

      for (let i = 0; i < visualDots; i++) {
        const rawFill = display - i * represented;
        const fill = clamp(rawFill / Math.max(1, represented), 0, 1);
        if (fill <= 0.02) continue;

        const orbitSpin = orbitPhase * (1.05 + i * 0.1);
        const slotAngle = orbitSpin + (i / spreadCount) * Math.PI * 2 - Math.PI / 2;
        const localAngle = slotAngle - (playerAngle || 0);
        const radius = DOT_ORBIT_VISUAL.RADIUS_BASE + (i % 3) * DOT_ORBIT_VISUAL.RADIUS_STEP + highCountScale * 3;
        const bob = Math.sin(orbitPhase * 2.3 + i * 0.85) * DOT_ORBIT_VISUAL.BOB * bobScale;
        const exitT = 1 - fill;
        const exitEase = exitT * exitT;
        const exitPush = exitEase * DOT_ORBIT_VISUAL.DEPOSIT_EXIT_PUSH;
        const ox = Math.cos(localAngle) * (radius + bob + exitPush);
        const oy = Math.sin(localAngle) * (radius + bob + exitPush);
        const baseSize = i % 2 === 1 ? DOT_ORBIT_VISUAL.SIZE_PRIMARY : DOT_ORBIT_VISUAL.SIZE_SECONDARY;
        const size = (baseSize + highCountScale * 0.9) * (0.65 + fill * 0.35);
        const alpha = bodyAlpha * (adaptivePerformance.mode === "ultra" ? 0.58 : 0.78) * fill * fill;
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
        const cheapVoidVisual = adaptivePerformance.mode !== "normal" || LOW_POWER_MODE;
        const now = cheapVoidVisual ? ((data.id || "void").length * 997) : performance.now();
        const attacking = data.attacking || data.attackState === "quick" || data.attackState === "lunge";
        const charging = data.attackState === "charging";
        const stunned = (data.voidStun || 0) > 0;
        const speedBoost = (data.voidSpeedBoost || 0) > 0;
        const angry = stunned ? 0.82 : attacking ? 1 : charging ? 0.65 : speedBoost ? 0.52 : data.recovery > 0 ? 0.38 : 0.18;
        const wobble = cheapVoidVisual ? 0 : Math.sin(now / 145) * 1.25;
        const pulse = cheapVoidVisual ? 0.45 : Math.sin(now / 210) * 0.5 + 0.5;
        const coreR = 18.5 + wobble + angry * 3.0;
        const voidSkin = getVoidSkin(data.skin);
        const darkColor = voidSkin.dark || 0x020008;
        const baseColor = voidSkin.base || 0x120022;
        const midColor = voidSkin.mid || 0x32105f;
        const accentColor = voidSkin.accent || 0x7c3aed;
        const glowColor = voidSkin.glow || 0xd8b4fe;
        const shadowColor = voidSkin.shadow || 0x05020a;
        const highlightColor = voidSkin.highlight || 0xf5d0fe;

        // The Void: layered cursed core. Skin palettes change silhouette details too,
        // because a "skin" that is only a recolor is barely a costume, it's accounting.

        // Kept simple circles only, because scary should not require a GPU funeral.
        item.body.fillStyle(darkColor, 0.98);
        item.body.fillCircle(0, 0, coreR + 6 + pulse * 1.4);
        item.body.fillStyle(baseColor, 0.94);
        item.body.fillCircle(-2, 1, coreR + 2);
        item.body.fillStyle(midColor, 0.86);
        item.body.fillCircle(-5, -3, coreR * 0.86);
        item.body.fillStyle(accentColor, 0.34 + angry * 0.24);
        item.body.fillCircle(6, 4, coreR * 0.72);
        item.body.fillStyle(darkColor, 0.70);
        item.body.fillCircle(4, -5, coreR * 0.46);
        item.body.fillStyle(shadowColor, 0.78);
        item.body.fillCircle(-7, 7, coreR * 0.34);

        const orbCount = Math.max(0, Math.floor(performanceValue("voidBodyOrbCount", LOW_POWER_MODE ? 5 : 9)));
        for (let i = 0; i < orbCount; i++) {
          const seed = i * 1.731;
          const band = i % 3;
          const a = now / (560 + i * 39) + seed + angry * 0.65;
          const r = 12 + band * 7.8 + (i % 5) * 1.35 + Math.sin(now / (210 + i * 8) + i) * (1.8 + angry * 1.7);
          const size = 2.9 + (i % 4) * 1.35 + angry * 1.2;
          const color = i % 5 === 0 ? glowColor : i % 2 ? accentColor : shadowColor;
          const alpha = i % 2 ? 0.58 + angry * 0.14 : 0.74;
          item.body.fillStyle(color, alpha);
          item.body.fillCircle(Math.cos(a) * r, Math.sin(a * (1.06 + band * 0.04)) * r, size);
        }

        for (let i = 0; i < Math.max(0, Math.floor(performanceValue("voidBodySpikeCount", LOW_POWER_MODE ? 2 : 3))); i++) {
          const a = -Math.PI * 0.85 + i * (Math.PI * 1.7 / 4) + Math.sin(now / 360 + i) * 0.08;
          const inner = 18 + angry * 2;
          const outer = 32 + i % 2 * 3 + angry * 4;
          item.outline.lineStyle(1, i % 2 ? glowColor : midColor, 0.22 + angry * 0.16);
          item.outline.beginPath();
          item.outline.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
          item.outline.lineTo(Math.cos(a + 0.18) * outer, Math.sin(a + 0.18) * outer);
          item.outline.strokePath();
        }

        item.outline.lineStyle(2, stunned ? 0xff2a45 : glowColor, 0.44 + angry * 0.36);
        item.outline.strokeCircle(0, 0, 24 + angry * 2.4);
        item.outline.lineStyle(1, stunned ? 0xff6b7a : accentColor, 0.34 + pulse * 0.18);
        item.outline.strokeCircle(0, 0, 34 + pulse * 2.0 + angry * 3.2);
        if (voidSkin.shape === "maw") {
          const jaw = coreR + 8 + angry * 4;
          item.body.fillStyle(highlightColor, 0.16 + angry * 0.08);
          item.body.beginPath();
          item.body.moveTo(-jaw * 0.85, -jaw * 0.32);
          item.body.lineTo(jaw * 0.82, -4);
          item.body.lineTo(-jaw * 0.85, jaw * 0.32);
          item.body.closePath();
          item.body.fillPath();
          item.outline.lineStyle(2, accentColor, 0.52 + angry * 0.14);
          item.outline.beginPath();
          item.outline.moveTo(-jaw, -jaw * 0.42);
          item.outline.lineTo(jaw * 0.72, -3);
          item.outline.lineTo(-jaw, jaw * 0.42);
          item.outline.strokePath();
        } else if (voidSkin.shape === "rift") {
          const slash = 29 + angry * 6;
          item.outline.lineStyle(4, highlightColor, 0.52 + pulse * 0.22);
          item.outline.beginPath();
          item.outline.moveTo(-slash * 0.35, -slash);
          item.outline.lineTo(slash * 0.25, slash);
          item.outline.strokePath();
          item.outline.lineStyle(2, accentColor, 0.44);
          item.outline.strokeEllipse(0, 0, 18 + angry * 3, 44 + angry * 5);
        } else if (voidSkin.shape === "eclipse") {
          item.body.fillStyle(0x000000, 0.78);
          item.body.fillCircle(5, -3, coreR * 0.82);
          item.outline.lineStyle(3, accentColor, 0.44 + pulse * 0.20);
          item.outline.strokeCircle(0, 0, 29 + angry * 2);
          item.outline.lineStyle(1, glowColor, 0.36);
          item.outline.strokeCircle(-6, 4, 18 + pulse * 3);
        } else if (voidSkin.shape === "wyrm") {
          const coils = 3;
          for (let i = 0; i < coils; i += 1) {
            const a = now / (370 + i * 60) + i * 2.1;
            const rx = 24 + i * 8 + angry * 3;
            const ry = 10 + i * 2;
            item.outline.lineStyle(2, i % 2 ? glowColor : accentColor, 0.28 + angry * 0.08);
            item.outline.strokeEllipse(Math.cos(a) * 6, Math.sin(a) * 5, rx, ry);
          }
        } else if (voidSkin.shape === "lantern") {
          const sway = cheapVoidVisual ? 0 : Math.sin(now / 260) * 5;
          const cageR = 19 + angry * 3;
          item.outline.lineStyle(2, glowColor, 0.52 + angry * 0.16);
          item.outline.strokeEllipse(0, 3, cageR * 1.15, cageR * 1.55);
          item.outline.lineStyle(1, accentColor, 0.42);
          item.outline.beginPath();
          item.outline.moveTo(-10 + sway * 0.12, -30);
          item.outline.lineTo(-3 + sway * 0.18, -18);
          item.outline.lineTo(6 + sway * 0.12, -30);
          item.outline.strokePath();
          item.body.fillStyle(highlightColor, 0.18 + pulse * 0.18 + angry * 0.10);
          item.body.fillCircle(sway * 0.08, 5, 10 + pulse * 2 + angry * 2);
          for (let i = -1; i <= 1; i += 1) {
            item.outline.lineStyle(1, i === 0 ? highlightColor : accentColor, 0.28 + angry * 0.08);
            item.outline.beginPath();
            item.outline.moveTo(i * 8, -16);
            item.outline.lineTo(i * 5 + sway * 0.12, 25);
            item.outline.strokePath();
          }
        } else if (voidSkin.shape === "siren") {
          const finWave = cheapVoidVisual ? 0 : Math.sin(now / 185) * 4;
          item.body.fillStyle(accentColor, 0.16 + angry * 0.08);
          item.body.beginPath();
          item.body.moveTo(-coreR * 0.5, -8);
          item.body.lineTo(-44 - angry * 5, -16 + finWave);
          item.body.lineTo(-32 - angry * 3, 12 + finWave * 0.5);
          item.body.closePath();
          item.body.fillPath();
          item.body.beginPath();
          item.body.moveTo(coreR * 0.5, -8);
          item.body.lineTo(44 + angry * 5, -16 - finWave);
          item.body.lineTo(32 + angry * 3, 12 - finWave * 0.5);
          item.body.closePath();
          item.body.fillPath();
          for (let i = 0; i < 3; i += 1) {
            const y = -20 + i * 14 + Math.sin(now / 170 + i) * 2;
            item.outline.lineStyle(2, i % 2 ? glowColor : highlightColor, 0.34 + angry * 0.08);
            item.outline.beginPath();
            item.outline.moveTo(-36 - i * 2, y);
            item.outline.lineTo(-12, y + 4);
            item.outline.moveTo(36 + i * 2, y);
            item.outline.lineTo(12, y + 4);
            item.outline.strokePath();
          }
        } else if (voidSkin.shape === "crowned") {
          const crownTop = -coreR - 6;
          const crownPulse = 1 + pulse * 0.08 + angry * 0.10;
          item.body.fillStyle(accentColor, 0.22 + angry * 0.10);
          item.body.beginPath();
          item.body.moveTo(-24 * crownPulse, crownTop + 11);
          item.body.lineTo(-14 * crownPulse, crownTop - 10 - angry * 2);
          item.body.lineTo(-5 * crownPulse, crownTop + 8);
          item.body.lineTo(0, crownTop - 15 - angry * 4);
          item.body.lineTo(7 * crownPulse, crownTop + 8);
          item.body.lineTo(18 * crownPulse, crownTop - 11 - angry * 2);
          item.body.lineTo(26 * crownPulse, crownTop + 11);
          item.body.closePath();
          item.body.fillPath();
          item.outline.lineStyle(2, glowColor, 0.48 + angry * 0.16);
          item.outline.strokeCircle(0, -4, 33 + angry * 4);
          item.body.fillStyle(highlightColor, 0.35 + pulse * 0.22);
          item.body.fillCircle(0, crownTop - 15 - angry * 4, 3.8 + angry);
        } else if (voidSkin.shape === "static") {
          const glitch = Math.floor(now / 95) % 5;
          item.body.fillStyle(highlightColor, 0.11 + angry * 0.07);
          for (let i = 0; i < 6; i += 1) {
            const sign = i % 2 ? 1 : -1;
            const w = 7 + ((i + glitch) % 3) * 4;
            const h = 2 + ((i + 1) % 3) * 2;
            const x = sign * (12 + ((i * 7 + glitch * 5) % 19));
            const y = -22 + ((i * 11 + glitch * 9) % 45);
            item.body.fillRect(sign < 0 ? x - w : x, y, w, h);
          }
          for (let i = 0; i < 4; i += 1) {
            const y = -25 + i * 16 + ((glitch + i) % 2 ? 2 : -2);
            item.outline.lineStyle(1, i % 2 ? accentColor : highlightColor, 0.34 + angry * 0.10);
            item.outline.beginPath();
            item.outline.moveTo(-34 + i * 3, y);
            item.outline.lineTo(34 - i * 2, y + (i % 2 ? 5 : -5));
            item.outline.strokePath();
          }
        } else if (voidSkin.shape === "seraph") {
          const wingLift = cheapVoidVisual ? 0 : Math.sin(now / 240) * 4;
          for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < 3; i += 1) {
              const rx = 21 + i * 9 + angry * 2;
              const ry = 7 + i * 2;
              item.outline.lineStyle(2, i % 2 ? glowColor : accentColor, 0.24 + angry * 0.08);
              item.outline.strokeEllipse(side * (23 + i * 7), -3 + wingLift + i * 7, rx, ry);
            }
          }
          item.outline.lineStyle(3, highlightColor, 0.34 + pulse * 0.22 + angry * 0.12);
          item.outline.strokeEllipse(0, -30 - angry * 2, 20 + pulse * 4, 7 + pulse);
          item.body.fillStyle(glowColor, 0.12 + angry * 0.08);
          item.body.fillCircle(0, 0, coreR + 13 + pulse * 2);
        }

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
      const gap = performanceValue("voidRushGapMs", LOW_POWER_MODE ? 130 : 72);
      const count = Math.max(0, Math.floor(performanceValue("voidRushCount", LOW_POWER_MODE ? 1 : 2)));
      if (count <= 0) return;
      if (item.lastVoidRushBubbleAt && now - item.lastVoidRushBubbleAt < gap) return;
      item.lastVoidRushBubbleAt = now;

      const angle = Number.isFinite(data.angle) ? data.angle : (item.current?.angle || 0);
      const baseX = item.current?.x ?? data.x ?? 0;
      const baseY = item.current?.y ?? data.y ?? 0;
      for (let i = 0; i < count; i += 1) {
        const side = (Math.random() - 0.5) * 22;
        const back = 22 + Math.random() * 18 + i * 7;
        const x = baseX - Math.cos(angle) * back + Math.cos(angle + Math.PI / 2) * side;
        const y = baseY - Math.sin(angle) * back + Math.sin(angle + Math.PI / 2) * side;
        const radius = 3.5 + Math.random() * 4.5;
        const bubble = this.add.circle(x, y, radius, 0xf8fafc, performanceValue("voidRushAlpha", LOW_POWER_MODE ? 0.30 : 0.42))
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

    emitSurvivorSpeedBurstTrail(item, data) {
      if (!item || !data || data.role !== "survivor" || !(data.speedBurst > 0) || data.dead || data.escaped || data.downed || data.hooked) return;
      const now = performance.now();
      const gap = performanceValue("survivorSpeedBurstTrailGapMs", LOW_POWER_MODE ? 145 : 82);
      const count = Math.max(0, Math.floor(performanceValue("survivorSpeedBurstTrailCount", LOW_POWER_MODE ? 1 : 2)));
      if (count <= 0) return;
      if (item.lastSurvivorSpeedBurstTrailAt && now - item.lastSurvivorSpeedBurstTrailAt < gap) return;
      item.lastSurvivorSpeedBurstTrailAt = now;

      const angle = Number.isFinite(data.angle) ? data.angle : (item.current?.angle || 0);
      const baseX = item.current?.x ?? data.x ?? 0;
      const baseY = item.current?.y ?? data.y ?? 0;
      const skin = getSurvivorSkin(data.skin);
      const color = data.health <= 1 || data.injured ? COLORS.survivorInjured : (skin?.color || COLORS.survivor);
      const alpha = performanceValue("survivorSpeedBurstTrailAlpha", LOW_POWER_MODE ? 0.24 : 0.36);

      for (let i = 0; i < count; i += 1) {
        const side = (Math.random() - 0.5) * 20;
        const back = 20 + Math.random() * 16 + i * 6;
        const x = baseX - Math.cos(angle) * back + Math.cos(angle + Math.PI / 2) * side;
        const y = baseY - Math.sin(angle) * back + Math.sin(angle + Math.PI / 2) * side;
        const radius = 3 + Math.random() * 4;
        const bubble = this.add.circle(x, y, radius, color, alpha)
          .setDepth(9.6)
          .setBlendMode(Phaser.BlendModes.SCREEN);
        this.tweens.add({
          targets: bubble,
          alpha: 0,
          scale: 1.55 + Math.random() * 0.45,
          x: x - Math.cos(angle) * (9 + Math.random() * 9),
          y: y - Math.sin(angle) * (9 + Math.random() * 9),
          duration: LOW_POWER_MODE ? 235 : 315,
          ease: "Quad.easeOut",
          onComplete: () => bubble.destroy()
        });
      }
    }

    styleActor(item, data) {
      const now = performance.now();
      if (data.role === "killer") {
        if (item.healAura) {
          item.healAura.clear();
          item.healAura.setVisible(false);
        }
        const charging = data.attackState === "charging";
        const attacking = data.attacking || data.attackState === "quick" || data.attackState === "lunge";
        const voidSkin = getVoidSkin(data.skin);
        const voidStateKey = `${voidSkin.id}:${data.attackState || "idle"}:${data.attacking ? 1 : 0}:${data.recovery > 0 ? 1 : 0}:${data.voidStun > 0 ? 1 : 0}:${data.voidSpeedBoost > 0 ? 1 : 0}`;
        const redrawEvery = performanceValue("voidRedrawMs", LOW_POWER_MODE ? 150 : 95);
        // The Void still animates, but not by redrawing 20+ circles every single frame.
        // Position updates remain smooth because the container moves independently.
        if (item.lastVoidStateKey !== voidStateKey || !item.lastVoidDrawAt || now - item.lastVoidDrawAt >= redrawEvery) {
          item.lastVoidStateKey = voidStateKey;
          item.lastVoidDrawAt = now;
          this.drawActorShape(item, data, voidSkin.accent || COLORS.killer, 1, voidSkin.glow || 0xd8b4fe, attacking ? 1 : 0.84);
        }
        item.facing.setFillStyle(data.voidStun > 0 ? 0xff3048 : attacking ? (voidSkin.highlight || 0xf5d0fe) : (voidSkin.glow || 0xc084fc), data.voidStun > 0 ? 0.76 : attacking ? 0.82 : data.recovery > 0 ? 0.24 : charging ? 0.72 : 0.48);
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
        const progressStep = Math.round(progress * (adaptivePerformance.mode === "ultra" ? 10 : 24));
        const dotKeyStep = adaptivePerformance.mode === "ultra" ? 2 : adaptivePerformance.mode === "low" ? 1 : 0.5;
        const dotVisualKey = Math.round((item.dotDisplay || 0) / dotKeyStep) * dotKeyStep;
        const survivorStateKey = `${data.skin || ""}:${data.health}:${data.injured ? 1 : 0}:${data.downed ? 1 : 0}:${data.hooked ? 1 : 0}:${data.dead ? 1 : 0}:${data.escaped ? 1 : 0}:${data.invuln > 0 ? 1 : 0}:${progressStep}:${dotVisualKey}`;
        const survivorRedrawEvery = performanceValue("survivorRedrawMs", LOW_POWER_MODE ? 85 : 0);
        const shouldRedrawSurvivor = item.lastSurvivorStateKey !== survivorStateKey
          || !item.lastSurvivorDrawAt
          || survivorRedrawEvery <= 0
          || now - item.lastSurvivorDrawAt >= survivorRedrawEvery;
        if (shouldRedrawSurvivor) {
          item.lastSurvivorStateKey = survivorStateKey;
          item.lastSurvivorDrawAt = now;
          this.drawActorShape(item, data, data.dead ? 0x555555 : color, disabled ? 0.45 : 1, outlineColor, showProgress || data.invuln > 0 ? 1 : 0.82);
          this.drawHealingAura(item, data);
          if (data.downed && !disabled && !data.hooked && (item.visionAlpha ?? 0) > ACTOR_VISION.MIN_VISIBLE_ALPHA) {
            this.drawDownedSurvivorPulse(item, data);
          }
          if (data.hooked && !disabled && (item.visionAlpha ?? 0) > ACTOR_VISION.MIN_VISIBLE_ALPHA) {
            this.drawHookedSurvivorPulse(item, data);
          }
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
            this.cameras.main.shake(LOW_POWER_MODE ? 48 : 64, (LOW_POWER_MODE ? 0.00012 : 0.00020) * performanceValue("shakeScale", 1));
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
          const isLocalSurvivorEvent = event.survivorId === myId;
          if (!hookBurstHidden && (adaptivePerformance.mode !== "ultra" || isLocalSurvivorEvent)) {
            const color = event.type === "unhooked" ? 0x75d5ff : event.type === "hooked" ? COLORS.hook : COLORS.blood;
            const baseCount = event.type === "hooked" ? 52 : event.type === "execute" || event.type === "death" ? 62 : 38;
            const fxCount = adaptivePerformance.mode === "ultra" ? 5 : LOW_POWER_MODE ? Math.ceil(baseCount * 0.32) : baseCount;
            this.burst(event.x, event.y, color, fxCount, event.type === "unhooked" ? 140 : 220);
          }

          const shouldShakeForImpact = (event.type === "hit" || event.type === "downed") && isLocalSurvivorEvent;
          const shouldShakeForStateChange = ["death", "execute", "hooked"].includes(event.type) && isLocalSurvivorEvent;
          if (shouldShakeForImpact || shouldShakeForStateChange) {
            const impactDuration = shouldShakeForImpact
              ? (heavy ? (LOW_POWER_MODE ? 220 : 280) : (LOW_POWER_MODE ? 130 : 175))
              : (heavy ? 210 : 110);
            const impactStrength = shouldShakeForImpact
              ? (heavy ? (LOW_POWER_MODE ? 0.0058 : 0.0074) : (LOW_POWER_MODE ? 0.0038 : 0.0052))
              : (heavy ? 0.0055 : 0.0032);
            this.cameras.main.shake(impactDuration, impactStrength * performanceValue("shakeScale", 1));
            if (shouldShakeForImpact) triggerSurvivorHitImpact(heavy);
          }
        }
        if (event.type === "genDone") {
          this.burst(event.x, event.y, COLORS.gen, adaptivePerformance.mode === "ultra" ? 0 : LOW_POWER_MODE ? 18 : 58, 190);
          if (adaptivePerformance.mode !== "ultra") this.addShockwave(event.x, event.y, COLORS.gen);
        }
        if (event.type === "genKick") {
          this.burst(event.x, event.y, 0xff4b4b, adaptivePerformance.mode === "ultra" ? 0 : LOW_POWER_MODE ? 8 : 26, 150);
          if (adaptivePerformance.mode === "normal") this.addShockwave(event.x, event.y, 0xff4b4b);
        }
        if (event.type === "vault" && adaptivePerformance.mode !== "ultra") this.burst(event.x, event.y, 0xd8d0bd, LOW_POWER_MODE ? 4 : 12, 90);
        if (event.type === "palletDrop") {
          playLocalizedPalletDrop(event);
          this.burst(event.x, event.y, COLORS.pallet, 16, 130);
        }
        if ((event.type === "palletBreak" || event.type === "palletBreakStart") && adaptivePerformance.mode !== "ultra") this.burst(event.x, event.y, 0xffc36a, LOW_POWER_MODE ? 6 : 18, 150);
        if (event.type === "voidStun" || event.type === "killerStun") {
          playLocalizedVoidStun(event);
          this.burst(event.x, event.y, 0xff3048, adaptivePerformance.mode === "ultra" ? 3 : LOW_POWER_MODE ? 10 : 46, LOW_POWER_MODE ? 150 : 230);
          if (adaptivePerformance.mode === "normal") {
            this.addShockwave(event.x, event.y, 0xff1f3a, 0.88, 165);
            this.addShockwave(event.palletX || event.x, event.palletY || event.y, 0xff5268, 0.54, 125);
          } else if (adaptivePerformance.mode === "low") {
            this.addShockwave(event.x, event.y, 0xff1f3a, 0.42, 74);
          }
          const localPalletStunner = event.actorId === myId || event.survivorId === myId;
          if (event.killerId === myId) {
            this.cameras.main.shake(LOW_POWER_MODE ? 170 : 230, (LOW_POWER_MODE ? 0.0044 : 0.0068) * performanceValue("shakeScale", 1));
          } else if (localPalletStunner) {
            this.cameras.main.shake(LOW_POWER_MODE ? 115 : 155, (LOW_POWER_MODE ? 0.0024 : 0.0038) * performanceValue("shakeScale", 1));
          } else if (distanceToLocalEvent(event) <= 260) {
            this.cameras.main.shake(LOW_POWER_MODE ? 70 : 95, (LOW_POWER_MODE ? 0.0008 : 0.0014) * performanceValue("shakeScale", 1));
          }
        }
        if (event.type === "voidAbility") {
          playLocalSpeedBoostAbilitySfx(event);
          const color = event.abilityId === "redshiftOrbs" ? 0xff3048 : event.abilityId === "voidReveal" ? 0xa78bfa : 0xcbd5e1;
          this.burst(event.x, event.y, color, adaptivePerformance.mode === "ultra" ? 0 : LOW_POWER_MODE ? 6 : 34, LOW_POWER_MODE ? 130 : 210);
          if (adaptivePerformance.mode === "normal") this.addShockwave(event.x, event.y, color, 0.55, event.radius || 155);
        }
        if (event.type === "survivorAbility") {
          playLocalSpeedBoostAbilitySfx(event);
          const color = event.abilityId === "riftLens" ? 0xfbbf24 : event.abilityId === "hourglass" ? 0x67e8f9 : event.abilityId === "speedBurst" ? 0x86efac : 0x7dd3fc;
          this.burst(event.x, event.y, color, adaptivePerformance.mode === "ultra" ? 0 : LOW_POWER_MODE ? 5 : 28, LOW_POWER_MODE ? 110 : 180);
          if (adaptivePerformance.mode === "normal") this.addShockwave(event.x, event.y, color, 0.42, event.abilityId === "hourglass" ? 176 : 138);
        }
        if (event.type === "redOrbSlow" && adaptivePerformance.mode !== "ultra") {
          this.burst(event.x, event.y, 0xff3048, LOW_POWER_MODE ? 4 : 18, 95);
        }
        if (event.type === "voidOrbSteal" && adaptivePerformance.mode !== "ultra") {
          this.burst(event.x, event.y, 0xfbbf24, LOW_POWER_MODE ? 4 : 20, 105);
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
        if (event.type === "healDone" && adaptivePerformance.mode !== "ultra") this.burst(event.x, event.y, 0x8dff9a, LOW_POWER_MODE ? 7 : 24, 120);
        if (event.type === "dotPickup") {
          const pickupColor = event.red ? 0xff3048 : COLORS.collectibleDot;
          if (adaptivePerformance.mode === "normal") this.burst(event.x, event.y, pickupColor, 10, 95);
          playOrbPickupSfx(event);
        }
        if (event.type === "dotDeposit") {
          playOrbDepositSfx(event);
          if (adaptivePerformance.mode === "normal") {
            this.burst(event.x, event.y, COLORS.collectibleDotGlow, 18, 110);
            this.addShockwave(event.x, event.y, COLORS.collectibleDot);
          }
          if (event.generatorId) {
            if (!this.generatorDepositVisual) this.generatorDepositVisual = new Map();
            if (!this.depositCompleteHold) this.depositCompleteHold = new Map();
            this.generatorDepositVisual.set(event.generatorId, 1);
            this.depositCompleteHold.set(event.generatorId, performance.now() + 180);
            this.needsGeneratorRedraw = true;
          }
        }
        // dotFull is now shown as the same under-player chat bubble used by the R chat wheel.
        if (event.type === "dotLoss" && adaptivePerformance.mode === "normal") this.burst(event.x, event.y, COLORS.collectibleDot, 14, 120);
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

        const chargeLimit = Math.max(0.001, ATTACK_VISUAL.lungeCharge);
        const charge = clamp(data.attackCharge || 0, 0, chargeLimit);
        const t = clamp(charge / chargeLimit, 0, 1);
        const range = lerp(ATTACK_VISUAL.quickRange, ATTACK_VISUAL.lungeRange, t) + ATTACK_VISUAL.edgeGrace;
        const arc = lerp(ATTACK_VISUAL.arc * 0.72, ATTACK_VISUAL.arc * 1.12, t);
        const angle = item.current.angle || item.target.angle || 0;
        const x = item.current.x;
        const y = item.current.y;
        const pulse = 0.65 + Math.sin(performance.now() * 0.018) * 0.25;

        if (adaptivePerformance.mode === "normal") {
          const points = [{ x, y }];
          const steps = Math.max(4, Math.floor(performanceValue("chargeSteps", 16)));
          for (let n = 0; n <= steps; n++) {
            const a = angle - arc / 2 + (arc * n) / steps;
            points.push({ x: x + Math.cos(a) * range, y: y + Math.sin(a) * range });
          }
          g.fillStyle(0xffb36b, 0.10 + 0.16 * t);
          g.fillPoints(points, true, true);
        }
        g.lineStyle(adaptivePerformance.mode === "normal" ? 2 + 2 * t : 2, 0xffe2b9, adaptivePerformance.mode === "normal" ? 0.35 + 0.35 * pulse : 0.34);
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

      const type = event.attackType || event.type || "quick";
      const activeDuration = Math.max(0.08, cfgNumber(
        event.activeDuration ?? event.duration,
        type === "lunge" ? ATTACK_VISUAL.lungeActive : ATTACK_VISUAL.quickActive
      ));
      const trailDuration = adaptivePerformance.mode === "ultra" ? 0.035 : adaptivePerformance.mode === "low" ? 0.05 : 0.075;
      const ttl = activeDuration + trailDuration;
      const createdAt = Number(event.createdAt);
      const serverTime = Number(currentSnapshot?.serverTime);
      const initialLife = Number.isFinite(createdAt) && Number.isFinite(serverTime)
        ? clamp(serverTime - createdAt, 0, ttl)
        : 0;

      // Age the visual by server time so a delayed snapshot does not show an already-expired
      // hit cone as if it were still dangerous. Netcode, the art of lying less badly.
      if (initialLife >= ttl) return;

      this.swipes.push({
        actorId,
        x: event.x,
        y: event.y,
        angle: event.angle || 0,
        range: event.range || (type === "lunge" ? ATTACK_VISUAL.lungeRange : ATTACK_VISUAL.quickRange),
        arc: event.arc || (type === "lunge" ? ATTACK_VISUAL.arc * 1.12 : ATTACK_VISUAL.arc),
        ttl,
        activeDuration,
        startup: clamp(event.startup || 0, 0, activeDuration * 0.82),
        life: initialLife,
        type
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
        const activeDuration = Math.max(0.001, s.activeDuration || s.ttl);
        const windup = s.life < s.startup;
        const postActive = s.life > activeDuration;
        const activeT = s.startup > 0
          ? clamp((Math.min(s.life, activeDuration) - s.startup) / Math.max(0.001, activeDuration - s.startup), 0, 1)
          : clamp(Math.min(s.life, activeDuration) / activeDuration, 0, 1);
        const trailT = postActive ? clamp((s.life - activeDuration) / Math.max(0.001, s.ttl - activeDuration), 0, 1) : 0;
        const sweepT = windup ? clamp(s.life / Math.max(0.001, s.startup), 0, 1) : activeT;
        const fade = windup
          ? 0.26 + 0.28 * sweepT
          : postActive
            ? 0.34 * Math.pow(1 - trailT, 1.65)
            : 0.55 + 0.30 * Math.pow(1 - activeT, 0.9);
        const range = s.range * (windup ? 0.84 + 0.16 * sweepT : 1);
        const arc = s.arc * (windup ? 0.55 + 0.45 * sweepT : 1);
        const steps = Math.max(4, Math.floor(performanceValue("swipeSteps", 22)));
        const points = [{ x, y }];

        for (let n = 0; n <= steps; n++) {
          const t = n / steps;
          const a = angle - arc / 2 + arc * t;
          points.push({
            x: x + Math.cos(a) * range,
            y: y + Math.sin(a) * range
          });
        }

        const cheapSwipe = adaptivePerformance.mode !== "normal";
        if (!cheapSwipe && !postActive) {
          // Filled cone only exists during the real server-active hit window. The trailing
          // slash below is just afterimage, not a promise that the hitbox still exists.
          g.fillStyle(windup ? 0xa3421f : 0xffd5bd, windup ? 0.08 + 0.10 * sweepT : 0.12 * fade);
          g.fillPoints(points, true, true);
        }

        const slashA = angle - arc / 2 + arc * clamp(windup ? sweepT * 0.35 : sweepT, 0, 1);
        const slashLen = range * (windup ? 0.72 : 1);
        const inner = windup ? 22 : 18;
        const slashAlpha = postActive ? 0.22 * fade : (cheapSwipe ? 0.42 * fade : (windup ? 0.32 + 0.30 * sweepT : 0.72 * fade));
        g.lineStyle(cheapSwipe ? 3 : (windup ? 3 : postActive ? 3 : 6), windup ? 0xff995c : postActive ? 0xff9b74 : 0xffeee0, slashAlpha);
        g.beginPath();
        g.moveTo(x + Math.cos(slashA) * inner, y + Math.sin(slashA) * inner);
        g.lineTo(x + Math.cos(slashA) * slashLen, y + Math.sin(slashA) * slashLen);
        g.strokePath();

        if (!cheapSwipe) {
          g.lineStyle(2, windup ? 0xffc089 : 0xffb68c, windup ? 0.22 + 0.28 * sweepT : 0.40 * fade);
          g.beginPath();
          for (let n = 1; n < points.length; n++) {
            if (n === 1) g.moveTo(points[n].x, points[n].y);
            else g.lineTo(points[n].x, points[n].y);
          }
          g.strokePath();
        }
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
        this.cameras.main.shake(LOW_POWER_MODE ? 80 : 120, (LOW_POWER_MODE ? 0.0009 : 0.0015) * performanceValue("shakeScale", 1));
      }
    }

    addShockwave(x, y, color = 0xffffff, alpha = 0.62, maxRadius = 120) {
      const profile = performanceProfile();
      const scaledAlpha = alpha * performanceValue("shockwaveScale", 1);
      const scaledRadius = maxRadius * clamp(performanceValue("shockwaveScale", 1), 0.25, 1);
      if (scaledAlpha <= 0.04 || performanceValue("maxShockwaves", PERFORMANCE.MAX_SHOCKWAVES) <= 0) return;
      this.shockwaves.push({ x, y, color, alpha: scaledAlpha, maxRadius: scaledRadius, life: 0, ttl: adaptivePerformance.mode === "ultra" ? 0.42 : 0.72, radius: 8 });
      const max = Math.max(0, Math.floor(profile.maxShockwaves ?? PERFORMANCE.MAX_SHOCKWAVES));
      if (this.shockwaves.length > max) this.shockwaves.splice(0, this.shockwaves.length - max);
    }

    burst(x, y, color, count, speed) {
      const profile = performanceProfile();
      const maxParticles = Math.max(0, Math.floor(profile.maxParticles ?? PERFORMANCE.MAX_PARTICLES));
      const room = Math.max(0, maxParticles - this.particles.length);
      const scaledCount = Math.max(0, Math.floor(count * performanceValue("particleScale", 1)));
      const actualCount = Math.min(scaledCount, room);
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
      this.fpsAccum = (this.fpsAccum || 0) + dt;
      this.fpsFrames = (this.fpsFrames || 0) + 1;
      if (this.fpsAccum < 0.45) return;

      const fps = Math.max(0, Math.round(this.fpsFrames / Math.max(0.001, this.fpsAccum)));
      adaptivePerformance.fpsAverage = adaptivePerformance.fpsAverage
        ? adaptivePerformance.fpsAverage * 0.72 + fps * 0.28
        : fps;

      this.updateAdaptivePerformance(fps, adaptivePerformance.fpsAverage);

      if (node) {
        const mode = adaptivePerformance.mode;
        const suffix = mode === "normal" ? "" : ` ${performanceProfile().label}`;
        node.textContent = `${fps}${suffix}`;
        node.style.color = fps >= 55 ? "#bcffb8" : fps >= 35 ? "#fff3b0" : "#ff9a9a";
      }

      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    updateAdaptivePerformance(fps, avgFps) {
      const now = performance.now();
      const cfg = ADAPTIVE_PERFORMANCE_CONFIG;
      const mode = adaptivePerformance.mode;
      const hotFps = Math.min(fps, avgFps);

      if (hotFps < cfg.ultraFps) {
        adaptivePerformance.ultraSamples += 1;
        adaptivePerformance.lowSamples += 1;
      } else if (hotFps < cfg.lowFps) {
        adaptivePerformance.lowSamples += 1;
        adaptivePerformance.ultraSamples = Math.max(0, adaptivePerformance.ultraSamples - 1);
      } else {
        adaptivePerformance.lowSamples = Math.max(0, adaptivePerformance.lowSamples - 1);
        adaptivePerformance.ultraSamples = Math.max(0, adaptivePerformance.ultraSamples - 1);
      }

      if (fps >= cfg.recoverFps && avgFps >= cfg.recoverFps - 2) {
        adaptivePerformance.recoverSamples += 1;
      } else {
        adaptivePerformance.recoverSamples = 0;
      }

      if (adaptivePerformance.ultraSamples >= cfg.ultraSamples && mode !== "ultra") {
        setAdaptivePerformanceMode("ultra", `fps ${fps}`);
        maybeToastPerformanceMode("ultra");
        return;
      }

      if (adaptivePerformance.lowSamples >= cfg.lowSamples && mode === "normal") {
        setAdaptivePerformanceMode("low", `fps ${fps}`);
        maybeToastPerformanceMode("low");
        return;
      }

      if (mode === "low" && adaptivePerformance.ultraSamples >= cfg.ultraSamples + 1) {
        setAdaptivePerformanceMode("ultra", `fps ${fps}`);
        maybeToastPerformanceMode("ultra");
        return;
      }

      if (mode === "ultra" && now > adaptivePerformance.lockedUntil && fps >= cfg.ultraRecoverFps && avgFps >= cfg.ultraRecoverFps - 1) {
        // Ultra can relax back to LOW if the machine catches up, but once the client
        // proves it cannot hold 60 FPS, stay in the cheap renderer for the whole match.
        setAdaptivePerformanceMode("low", `stabilized ${fps}`);
        return;
      }

      // Do not recover back to NORMAL automatically. A client that dipped under the
      // configured low-FPS threshold should stay on the stable low-cost path instead
      // of bouncing modes mid-chase.
    }

    applyAdaptivePerformanceMode(mode) {
      this.activePerformanceMode = mode;
      const profile = performanceProfile();
      if (this.game?.loop) {
        if (Number.isFinite(profile.targetFps)) this.game.loop.targetFps = profile.targetFps;
        if (Number.isFinite(profile.targetFps)) this.game.loop.minFps = Math.max(24, Math.min(42, profile.targetFps - 6));
      }
      if (this.particles.length > profile.maxParticles) this.particles.splice(0, this.particles.length - profile.maxParticles);
      if (this.shockwaves.length > profile.maxShockwaves) this.shockwaves.splice(0, this.shockwaves.length - profile.maxShockwaves);
      this.needsDynamicRedraw = true;
      this.needsGeneratorRedraw = true;
      this.needsScratchRedraw = true;
      this.wallVisionTimer = 999;
      this.actorVisionTimer = 999;
      this.lightingRedrawTimer = 999;
      this.killerWallVisionStableKey = "";
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
      const overviewNow = this.isSpectatorOverviewMode();
      if (overviewNow !== this.lastSpectatorOverviewMode) {
        this.lastSpectatorOverviewMode = overviewNow;
        this.needsDynamicRedraw = true;
        this.needsGeneratorRedraw = true;
        this.lastDynamicKey = "";
        this.lastGeneratorKey = "";
        this.killerWallVisionStableKey = "";
        this.wallVisionTimer = 999;
        this.generatorVisionTimer = 999;
      }
      this.updateWallVision(dt);
      this.updateCollectibleDotVisuals(dt);
      this.maybeDrawDynamicWorld(dt);
      this.maybeDrawGeneratorLayer(dt);
      this.maybeUpdateScratchGraphics(dt);
      this.maybeDrawLighting(dt);
      this.updateHookIndicators(dt);
      this.drawChargeIndicators(dt);
      this.drawSwipes(dt);
      this.updateParticles(dt);
      this.updateFpsCounter(dt);

      this.inputTimer += dt;
      const inputStep = 1 / 60;
      let inputSends = 0;
      while (this.inputTimer >= inputStep && inputSends < 3) {
        this.inputTimer -= inputStep;
        sendInput({}, false);
        inputSends++;
      }
      if (this.inputTimer > inputStep * 3) this.inputTimer = inputStep;
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
      const localLock = Math.max(0, ((this.matchStartInputLockUntil || 0) - performance.now()) / 1000);
      const serverLock = Math.max(0, Number(this.matchStartFreezeRemaining || 0));
      return Math.max(localLock, serverLock) > 0.035;
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
      this.cameraFollowX = x;
      this.cameraFollowY = y;
      this.localVisual = { x, y, angle: data.angle || 0, role: data.role, skin: data.skin || (data.role === "killer" ? "voidCore" : "blueSquare") };
      cameraZoomNow = CAMERA.BASE_ZOOM;
      this.currentCameraZoom = cameraZoomNow;
      this.targetCameraZoom = cameraZoomNow;
      this.cameras.main.setZoom(cameraZoomNow);
      this.cameras.main.centerOn(x, y);
    }

    predictLocal(dt) {
      if (!this.map || !this.localVisual || !this.localServerTarget?.data) return;
      const data = this.localServerTarget.data;
      this.localVisual.angle = input.angle;

      if (this.isMatchIntroLocked()) {
        clearMovementInputOnly();
        this.reconcileLocalVisual(dt, this.localServerTarget.x, this.localServerTarget.y, data);
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
        this.reconcileLocalVisual(dt, this.localServerTarget.x, this.localServerTarget.y, data);
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
      if (data.role === "survivor" && (data.speedBurst || 0) > 0 && !data.downed) speed *= LOCAL_SPEEDS.survivorSpeedBurstMult;
      if (data.role === "survivor" && (data.orbSlow || data.voidSlow || 0) > 0) speed *= 0.58;
      if (data.role === "killer" && currentSnapshot?.objective?.voidBuffed) speed *= LOCAL_SPEEDS.killerEndgameMult;
      if (data.role === "killer" && (data.voidSpeedBoost || 0) > 0) speed *= 1.28;
      if (data.role === "killer" && data.attackState === "lunge") {
        dx = Math.cos(input.angle);
        dy = Math.sin(input.angle);
        speed = LOCAL_SPEEDS.killer * LOCAL_SPEEDS.killerLungeMult;
      } else if (data.role === "killer" && data.attackState === "quick") {
        speed = 0;
      } else if (data.role === "killer" && data.recovery > 0) speed *= LOCAL_SPEEDS.killerRecoveryMult;

      const moveX = dx * speed * dt;
      const moveY = dy * speed * dt;
      if (Math.hypot(moveX, moveY) > 0.001) {
        this.moveLocalWithCollision(data.role, moveX, moveY, {
          preferTarget: { x: this.localVisual.x + dx * 96, y: this.localVisual.y + dy * 96 }
        });
      }

      // Soft reconciliation with server authority. The Void uses tighter correction so
      // the client never displays an old position while the server hitbox has moved on.
      this.reconcileLocalVisual(dt, this.localServerTarget.x, this.localServerTarget.y, data);
    }

    invalidateLocalCollisionCache() {
      if (this.localCollisionCache) this.localCollisionCache.clear();
      this.localCollisionCacheEpoch = (this.localCollisionCacheEpoch || 0) + 1;
    }

    localCollisionSignature(role) {
      if (!this.map) return `${role}:no-map`;
      const pallets = currentSnapshot?.map?.pallets || this.map?.pallets || [];
      const palletKey = pallets
        .map((p) => `${p.id || ""}:${Math.round(p.x)}:${Math.round(p.y)}:${Math.round(p.w)}:${Math.round(p.h)}:${p.state || ""}:${p.broken ? 1 : 0}`)
        .join("|");
      const generatorKey = role === "survivor"
        ? this.visibleGenerators()
            .map((g) => `${g.id || ""}:${Math.round(g.x)}:${Math.round(g.y)}:${g.done ? 1 : 0}`)
            .join("|")
        : "";
      return `${this.localCollisionCacheEpoch || 0}:${role}:${this.map.width}:${this.map.height}:${palletKey}:${generatorKey}`;
    }

    buildLocalCollisionGrid(rects) {
      const cellSize = Math.max(48, Math.round(this.map?.tile || this.localCollisionCellSize || 96));
      const grid = new Map();
      for (const rect of rects) {
        if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) continue;
        const minX = Math.floor(rect.x / cellSize);
        const maxX = Math.floor((rect.x + rect.w) / cellSize);
        const minY = Math.floor(rect.y / cellSize);
        const maxY = Math.floor((rect.y + rect.h) / cellSize);
        for (let cy = minY; cy <= maxY; cy += 1) {
          for (let cx = minX; cx <= maxX; cx += 1) {
            const key = `${cx},${cy}`;
            let bucket = grid.get(key);
            if (!bucket) {
              bucket = [];
              grid.set(key, bucket);
            }
            bucket.push(rect);
          }
        }
      }
      return { rects, grid, cellSize };
    }

    localCollisionCacheFor(role) {
      const signature = this.localCollisionSignature(role);
      const cached = this.localCollisionCache?.get(signature);
      if (cached) return cached;

      const solids = [...(this.map?.walls || []), ...(this.map?.windows || [])];
      for (const p of currentSnapshot?.map?.pallets || this.map?.pallets || []) {
        if (!p.broken && p.state === "dropped") solids.push(p);
      }
      if (role === "survivor") {
        for (const gen of this.visibleGenerators()) {
          const size = GENERATOR_COLLISION_SIZE;
          solids.push({ id: gen.id, x: gen.x - size / 2, y: gen.y - size / 2, w: size, h: size });
        }
      }

      const cache = this.buildLocalCollisionGrid(solids);
      if (!this.localCollisionCache) this.localCollisionCache = new Map();
      this.localCollisionCache.clear();
      this.localCollisionCache.set(signature, cache);
      return cache;
    }

    localCollisionBlockingRects(role) {
      return this.localCollisionCacheFor(role).rects;
    }

    localCollisionCandidatesForBox(role, box) {
      const cache = this.localCollisionCacheFor(role);
      if (!cache?.grid || !Number.isFinite(box?.x) || !Number.isFinite(box?.y) || !Number.isFinite(box?.w) || !Number.isFinite(box?.h)) {
        return cache?.rects || [];
      }
      const cellSize = cache.cellSize || 96;
      const minX = Math.floor(box.x / cellSize);
      const maxX = Math.floor((box.x + box.w) / cellSize);
      const minY = Math.floor(box.y / cellSize);
      const maxY = Math.floor((box.y + box.h) / cellSize);
      const seen = new Set();
      const results = [];
      for (let cy = minY; cy <= maxY; cy += 1) {
        for (let cx = minX; cx <= maxX; cx += 1) {
          const bucket = cache.grid.get(`${cx},${cy}`);
          if (!bucket) continue;
          for (const rect of bucket) {
            if (seen.has(rect)) continue;
            seen.add(rect);
            results.push(rect);
          }
        }
      }
      return results;
    }

    localCollisionRectsAt(role, x = this.localVisual?.x, y = this.localVisual?.y) {
      if (!this.localVisual || !Number.isFinite(x) || !Number.isFinite(y)) return [];
      const box = actorRect({ role }, x, y);
      return this.localCollisionCandidatesForBox(role, box).filter((r) => rectsOverlap(box, r));
    }

    localWouldCollide(role, x, y) {
      return this.localCollisionRectsAt(role, x, y).length > 0;
    }

    maybeResolveLocalActorOverlaps(role, maxIterations = 2, force = false) {
      const now = performance.now();
      const cadence = (adaptivePerformance.mode !== "normal" || LOW_POWER_MODE) ? 85 : 24;
      if (!force && now - (this.lastLocalOverlapResolveAt || 0) < cadence) return false;
      this.lastLocalOverlapResolveAt = now;
      return this.resolveLocalActorOverlaps(role, maxIterations);
    }

    resolveLocalActorOverlaps(role, maxIterations = 4) {
      if (!this.map || !this.localVisual) return false;
      let moved = false;
      for (let i = 0; i < maxIterations; i += 1) {
        const box = actorRect({ role }, this.localVisual.x, this.localVisual.y);
        const hits = this.localCollisionCandidatesForBox(role, box).filter((r) => rectsOverlap(box, r));
        if (!hits.length) break;

        let best = null;
        for (const r of hits) {
          const options = [
            { dx: r.x - (box.x + box.w), dy: 0 },
            { dx: (r.x + r.w) - box.x, dy: 0 },
            { dx: 0, dy: r.y - (box.y + box.h) },
            { dx: 0, dy: (r.y + r.h) - box.y }
          ].map((o) => ({ ...o, amount: Math.hypot(o.dx, o.dy) }))
            .filter((o) => o.amount > 0 && Number.isFinite(o.amount));
          const local = options.sort((a, b) => a.amount - b.amount)[0];
          if (local && (!best || local.amount < best.amount)) best = local;
        }

        if (!best) break;
        const padX = best.dx ? Math.sign(best.dx) * 0.75 : 0;
        const padY = best.dy ? Math.sign(best.dy) * 0.75 : 0;
        this.localVisual.x = clamp(this.localVisual.x + best.dx + padX, 36, this.map.width - 36);
        this.localVisual.y = clamp(this.localVisual.y + best.dy + padY, 36, this.map.height - 36);
        moved = true;
      }
      return moved;
    }

    moveLocalWithCollision(role, moveX, moveY, options = {}) {
      if (!this.map || !this.localVisual) return false;
      if (!Number.isFinite(moveX) || !Number.isFinite(moveY)) return false;

      this.maybeResolveLocalActorOverlaps(role, 2, false);

      const distance = Math.hypot(moveX, moveY);
      if (distance <= 0.0001) return false;

      let moved = false;
      const bodySize = role === "killer" ? LOCAL_SPEEDS.killerSize : LOCAL_SPEEDS.survivorSize;
      const maxStep = options.maxStep || Math.max(6, Math.min(10, bodySize * 0.30));
      const steps = Math.max(1, Math.ceil(distance / maxStep));
      const stepX = moveX / steps;
      const stepY = moveY / steps;
      let handledCollision = false;

      for (let i = 0; i < steps; i += 1) {
        const startX = this.localVisual.x;
        const startY = this.localVisual.y;
        const desiredX = clamp(startX + stepX, 36, this.map.width - 36);
        const desiredY = clamp(startY + stepY, 36, this.map.height - 36);

        if (!this.localWouldCollide(role, desiredX, desiredY)) {
          this.localVisual.x = desiredX;
          this.localVisual.y = desiredY;
          moved = true;
          continue;
        }

        handledCollision = true;
        const tryX = !this.localWouldCollide(role, desiredX, startY);
        const tryY = !this.localWouldCollide(role, startX, desiredY);

        if (tryX && tryY) {
          if (Math.abs(stepX) >= Math.abs(stepY)) {
            this.localVisual.x = desiredX;
            if (!this.localWouldCollide(role, this.localVisual.x, desiredY)) this.localVisual.y = desiredY;
          } else {
            this.localVisual.y = desiredY;
            if (!this.localWouldCollide(role, desiredX, this.localVisual.y)) this.localVisual.x = desiredX;
          }
          moved = true;
          continue;
        }

        if (tryX) {
          this.localVisual.x = desiredX;
          moved = true;
          continue;
        }

        if (tryY) {
          this.localVisual.y = desiredY;
          moved = true;
          continue;
        }

        // Last-resort peel-off for convex corners. This mirrors the server, so the
        // client prediction does not insist it is stuck while the server calmly slides away.
        const len = Math.hypot(stepX, stepY) || 1;
        const nudge = Math.max(1.5, Math.min(6, len * 1.25));
        const tangentA = { x: (-stepY / len) * nudge, y: (stepX / len) * nudge };
        const tangentB = { x: -tangentA.x, y: -tangentA.y };
        const backOff = { x: (-stepX / len) * Math.min(3, nudge), y: (-stepY / len) * Math.min(3, nudge) };
        const halfA = { x: tangentA.x * 0.5, y: tangentA.y * 0.5 };
        const halfB = { x: tangentB.x * 0.5, y: tangentB.y * 0.5 };
        const cardinal = [
          { x: nudge, y: 0 },
          { x: -nudge, y: 0 },
          { x: 0, y: nudge },
          { x: 0, y: -nudge }
        ];
        let nudges = [tangentA, tangentB, halfA, halfB, backOff, ...cardinal];
        if (options.preferTarget && Number.isFinite(options.preferTarget.x) && Number.isFinite(options.preferTarget.y)) {
          nudges = nudges.sort((a, b) => (
            dist(startX + a.x, startY + a.y, options.preferTarget.x, options.preferTarget.y)
            - dist(startX + b.x, startY + b.y, options.preferTarget.x, options.preferTarget.y)
          ));
        }

        let nudged = false;
        for (const n of nudges) {
          const nx = clamp(startX + n.x, 36, this.map.width - 36);
          const ny = clamp(startY + n.y, 36, this.map.height - 36);
          if (!this.localWouldCollide(role, nx, ny)) {
            this.localVisual.x = nx;
            this.localVisual.y = ny;
            moved = true;
            nudged = true;
            break;
          }
        }

        if (!nudged) {
          this.maybeResolveLocalActorOverlaps(role, 2, true);
          break;
        }
      }

      if (handledCollision) this.maybeResolveLocalActorOverlaps(role, 1, true);
      return moved;
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

    actorVisionSamplePoints(worldX, worldY, radius = ACTOR_VISION.POINT_RADIUS) {
      return [
        { x: worldX, y: worldY },
        { x: worldX + radius, y: worldY },
        { x: worldX - radius, y: worldY },
        { x: worldX, y: worldY + radius },
        { x: worldX, y: worldY - radius }
      ];
    }

    computeSinglePointVisionAlpha(worldX, worldY, subject) {
      if (!subject) return 0;
      const role = subject.data?.role || "survivor";
      const sourceX = subject.current?.x ?? subject.container?.x ?? 0;
      const sourceY = subject.current?.y ?? subject.container?.y ?? 0;
      const facing = subject.current?.angle ?? subject.container?.rotation ?? 0;
      const hourglassActive = role === "survivor" && (subject?.data?.hourglass || 0) > 0;
      const length = (role === "killer" ? LIGHTING.KILLER_LENGTH : survivorVisionLengthForData(subject?.data)) + WALL_VISION.CONE_EXTRA_LENGTH;
      const coneAngle = (role === "killer" ? LIGHTING.KILLER_ANGLE : survivorVisionAngleForData(subject?.data)) + WALL_VISION.CONE_EXTRA_ANGLE;
      const nearRadius = role === "killer" ? WALL_VISION.KILLER_NEAR_RADIUS : WALL_VISION.SURVIVOR_NEAR_RADIUS;
      const r = 1;
      const pointItem = {
        rect: { x: worldX - r, y: worldY - r, w: r * 2, h: r * 2 },
        radius: r,
        samples: [{ x: worldX, y: worldY }]
      };
      const forwardAlpha = this.computeWallVisionAlpha(pointItem, sourceX, sourceY, facing, length, coneAngle, nearRadius);
      if (!hourglassActive) return forwardAlpha;
      const backLength = length * LIGHTING.SURVIVOR_HOURGLASS_BACK_LENGTH_MULT;
      const backAngle = Math.min(Math.PI * 1.08, coneAngle * LIGHTING.SURVIVOR_HOURGLASS_BACK_ANGLE_MULT);
      const backAlpha = this.computeWallVisionAlpha(pointItem, sourceX, sourceY, facing + Math.PI, backLength, backAngle, nearRadius);
      return Math.max(forwardAlpha, backAlpha);
    }

    computeActorPointVisionAlpha(worldX, worldY, subject) {
      let best = 0;
      for (const sample of this.actorVisionSamplePoints(worldX, worldY, ACTOR_VISION.POINT_RADIUS)) {
        best = Math.max(best, this.computeSinglePointVisionAlpha(sample.x, sample.y, subject));
      }
      return best;
    }

    computePointVisionAlpha(worldX, worldY, subject) {
      if (!subject) return 0;
      const sourceX = subject?.current?.x ?? subject?.container?.x ?? 0;
      const sourceY = subject?.current?.y ?? subject?.container?.y ?? 0;
      let best = 0;
      for (const sample of this.actorVisionSamplePoints(worldX, worldY, ACTOR_VISION.POINT_RADIUS)) {
        if (!this.hasClearWallLineOfSight(sourceX, sourceY, sample.x, sample.y)) continue;
        best = Math.max(best, this.computeSinglePointVisionAlpha(sample.x, sample.y, subject));
      }
      return best <= WALL_VISION.MIN_VISIBLE_ALPHA ? 0 : best;
    }

    updateActorVisionAlpha(dt) {
      const subject = this.getCameraSubjectItem();
      const cheapKillerVision = subject?.data?.role === "killer" && (LOW_POWER_MODE || adaptivePerformance.mode !== "normal");
      const fadeInRate = ACTOR_VISION.FADE_IN_PER_SECOND;
      const fadeOutRate = ACTOR_VISION.FADE_OUT_PER_SECOND;
      const minAlpha = ACTOR_VISION.MIN_VISIBLE_ALPHA;
      const nameAlpha = ACTOR_VISION.NAME_CHAT_ALPHA;

      this.actorVisionTimer = (this.actorVisionTimer || 0) + dt;
      const actorVisionInterval = 1 / Math.max(1, performanceValue("actorVisionFps", 60));
      const shouldRecomputeVision = this.actorVisionTimer >= actorVisionInterval;
      if (shouldRecomputeVision) this.actorVisionTimer = 0;

      const overviewVision = this.isSpectatorOverviewMode();

      for (const [id, item] of this.actors.entries()) {
        const data = item.data || {};
        let target = item.visionTargetAlpha ?? 0;

        if (overviewVision) {
          target = 1;
        } else if (id === myId) {
          target = this.isSpectating() ? 0.32 : 1;
        } else if (item.forceFullVision) {
          target = 1;
        } else if (cheapKillerVision) {
          // The server already decides which runners The Void can see. On weak clients,
          // do not run local cone + wall LOS for every actor just to rediscover it.
          target = item.serverVisible ? 1 : 0;
        } else if (shouldRecomputeVision) {
          target = item.serverVisible
            ? (subject ? this.computePointVisionAlpha(item.current.x, item.current.y, subject) : 1)
            : 0;
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

    applyKillerFullWallVisionIfStable() {
      if (!this.wallVisuals?.length) return;
      const key = `${this.isSpectatorOverviewMode() ? "overview" : "killer"}:${this.wallVisuals.length}:${this.getPalletVisionKey()}:${this.activePerformanceMode}`;
      if (this.killerWallVisionStableKey === key) return;
      this.killerWallVisionStableKey = key;
      for (const item of this.wallVisuals) {
        item.targetAlpha = 1;
        item.alpha = 1;
        item.graphics.setVisible(true);
        item.graphics.setAlpha(1);
      }
    }

    updateWallVision(dt) {
      if (!this.wallVisuals?.length) return;
      this.syncPalletVisionVisuals();

      if (this.isSpectatorOverviewMode()) {
        this.applyKillerFullWallVisionIfStable();
        return;
      }

      const subject = this.getCameraSubjectItem();
      const hasSubject = !!subject?.container;
      const role = subject?.data?.role || "survivor";
      const hourglassActive = role === "survivor" && (subject?.data?.hourglass || 0) > 0;
      const worldX = subject?.container?.x ?? 0;
      const worldY = subject?.container?.y ?? 0;
      const facing = subject?.container?.rotation || 0;
      const baseLength = role === "killer" ? LIGHTING.KILLER_LENGTH : survivorVisionLengthForData(subject?.data);
      const baseAngle = role === "killer" ? LIGHTING.KILLER_ANGLE : survivorVisionAngleForData(subject?.data);
      const length = baseLength + WALL_VISION.CONE_EXTRA_LENGTH;
      const coneAngle = baseAngle + WALL_VISION.CONE_EXTRA_ANGLE;
      const backLength = length * LIGHTING.SURVIVOR_HOURGLASS_BACK_LENGTH_MULT;
      const backConeAngle = Math.min(Math.PI * 1.08, coneAngle * LIGHTING.SURVIVOR_HOURGLASS_BACK_ANGLE_MULT);
      const nearRadius = role === "killer" ? WALL_VISION.KILLER_NEAR_RADIUS : WALL_VISION.SURVIVOR_NEAR_RADIUS;

      if (role !== "killer") this.killerWallVisionStableKey = "";
      if (role === "killer" && (LOW_POWER_MODE || adaptivePerformance.mode !== "normal")) {
        // Low-performance Void POV does not need per-frame wall fading math. The Void
        // should read the whole arena while local prediction gets the CPU budget.
        this.applyKillerFullWallVisionIfStable();
        return;
      }

      const subjectVaulting = !!subject?.data?.vaulting;
      this.wallVisionTimer = (this.wallVisionTimer || 0) + dt;
      const shouldRecompute = subjectVaulting || this.wallVisionTimer >= 1 / Math.max(1, performanceValue("wallVisionFps", PERFORMANCE.WALL_VISION_FPS));
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
            const forwardAlpha = this.computeWallVisionAlpha(item, worldX, worldY, facing, length, coneAngle, nearRadius);
            const backAlpha = hourglassActive
              ? this.computeWallVisionAlpha(item, worldX, worldY, facing + Math.PI, backLength, backConeAngle, nearRadius)
              : 0;
            item.targetAlpha = Math.max(forwardAlpha, backAlpha);
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
            const vaultAlpha = Math.max(dampAlpha(performanceValue("remoteActorRate", 16) + 5, dt), 0.28);
            item.current.x = lerp(item.current.x, item.target.x, vaultAlpha);
            item.current.y = lerp(item.current.y, item.target.y, vaultAlpha);
          }
          item.current.angle = lerpAngle(item.current.angle, item.target.angle, dampAlpha(16, dt));
        } else {
          item.vaultPlayback = null;
          if (!this.killerHidesRemoteHookedSurvivor(item.data)) {
            let interpolated = this.getInterpolatedRemoteState(item);
            if (interpolated) {
              interpolated = this.pullRemoteVoidTowardLatest(item, interpolated);
              const gap = dist(item.current.x, item.current.y, interpolated.x, interpolated.y);
              const snapDistance = item.data?.role === "killer"
                ? Math.max(160, performanceValue("remoteSnapDistance", LOW_POWER_MODE ? 260 : 230) * 0.78)
                : performanceValue("remoteSnapDistance", LOW_POWER_MODE ? 260 : 230);
              if (gap > snapDistance) {
                item.current.x = interpolated.x;
                item.current.y = interpolated.y;
                item.current.angle = interpolated.angle;
              } else {
                // The interpolation buffer already smooths between snapshots. Apply it directly
                // so low-FPS frames don't add a second laggy lerp on top of network smoothing.
                item.current.x = interpolated.x;
                item.current.y = interpolated.y;
                item.current.angle = interpolated.angle;
              }
            } else {
              const dx = item.target.x - item.current.x;
              const dy = item.target.y - item.current.y;
              const gap = Math.hypot(dx, dy);
              let moveAlpha = dampAlpha(performanceValue("remoteActorRate", 14), dt);
              if (gap > 180) moveAlpha = 1;
              else if (gap > 82) moveAlpha = Math.max(moveAlpha, 0.52);
              item.current.x = lerp(item.current.x, item.target.x, moveAlpha);
              item.current.y = lerp(item.current.y, item.target.y, moveAlpha);
              item.current.angle = lerpAngle(item.current.angle, item.target.angle, dampAlpha(16, dt));
            }
          }
        }
        item.container.setPosition(item.current.x, item.current.y);
        item.container.rotation = item.current.angle || 0;
        if (item.data?.role === "killer" && (item.data?.voidSpeedBoost || 0) > 0) {
          this.emitVoidRushTrail(item, item.data);
        }
        if (item.data?.role === "survivor" && (item.data?.speedBurst || 0) > 0) {
          this.emitSurvivorSpeedBurstTrail(item, item.data);
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

          const heldOrbSpinScale = clamp(performanceValue("heldOrbSpinScale", 1), 0, 1);
          if (heldOrbSpinScale > 0) {
            item.dotOrbitPhase = (item.dotOrbitPhase || 0) + dt * DOT_ORBIT_VISUAL.SPIN_SPEED * heldOrbSpinScale;
          }
          item.dotDisplay = lerp(prevDisplay, targetDots, dampAlpha(smoothing, dt));
        }
      }

      this.updateActorVisionAlpha(dt);

      for (const [id, item] of this.actors.entries()) {
        if ((item.data?.role === "killer" || item.data?.role === "survivor") && this.shouldRefreshActorStyle(item, dt)) {
          item.actorStyleTimer = 0;
          item.forceStyleRefresh = false;
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

      const interval = lerp(IMMERSION.HEARTBEAT_MAX_INTERVAL, IMMERSION.HEARTBEAT_MIN_INTERVAL, clamp(this.terrorBlend + this.chaseBlend * 0.45, 0, 1));
      this.heartbeatTimer += dt;
      const cheapRenderer = adaptivePerformance.mode !== "normal" || LOW_POWER_MODE;
      if ((this.terrorBlend > 0.08 || this.chaseBlend > 0.05) && this.heartbeatTimer >= interval) {
        this.heartbeatTimer = 0;
        this.heartbeatPulse = cheapRenderer ? 0 : 1;
        const intensity = IMMERSION.HEARTBEAT_SHAKE_BASE * this.terrorBlend + IMMERSION.HEARTBEAT_SHAKE_CHASE * this.chaseBlend;
        if (!cheapRenderer && intensity > 0.0005) this.cameras.main.shake(90, intensity * performanceValue("shakeScale", 1));
      }

      const rawChase = levels.chase > 0;
      if (!cheapRenderer && rawChase && !this.lastRawChase) {
        this.cameras.main.shake(IMMERSION.CHASE_START_SHAKE_DURATION, IMMERSION.CHASE_START_SHAKE_INTENSITY * performanceValue("shakeScale", 1));
      }
      this.lastRawChase = rawChase;

      const currentMe = this.actors.get(myId)?.data;
      updateHorrorFx(currentSnapshot, currentMe, { terror: this.terrorBlend, chase: this.chaseBlend });
    }

    getSpectatorOverviewZoom() {
      const cam = this.cameras.main;
      const map = currentSnapshot?.map || this.map;
      const mapW = Math.max(1, Number(map?.width || this.map?.width || 1));
      const mapH = Math.max(1, Number(map?.height || this.map?.height || 1));
      const padding = Math.max(0, CAMERA.OVERVIEW_PADDING);
      const viewW = Math.max(1, Number(cam.width || window.innerWidth || 1));
      const viewH = Math.max(1, Number(cam.height || window.innerHeight || 1));
      const fitW = Math.max(1, viewW - padding * 2) / mapW;
      const fitH = Math.max(1, viewH - padding * 2) / mapH;
      return clamp(Math.min(fitW, fitH), CAMERA.OVERVIEW_MIN_ZOOM, CAMERA.OVERVIEW_MAX_ZOOM);
    }

    updateSpectatorOverviewCamera() {
      const cam = this.cameras.main;
      const map = currentSnapshot?.map || this.map;
      const mapW = Math.max(1, Number(map?.width || this.map?.width || 1));
      const mapH = Math.max(1, Number(map?.height || this.map?.height || 1));
      const x = mapW / 2;
      const y = mapH / 2;
      const zoom = this.getSpectatorOverviewZoom();

      this.cameraZoomPlan = {
        base: CAMERA.BASE_ZOOM,
        rawOffset: zoom - CAMERA.BASE_ZOOM,
        clampedOffset: zoom - CAMERA.BASE_ZOOM,
        zoom,
        modifiers: [{ id: "spectatorOverview", value: zoom - CAMERA.BASE_ZOOM, absoluteZoom: zoom }]
      };
      this.targetCameraZoom = zoom;
      this.currentCameraZoom = zoom;
      cameraZoomNow = zoom;
      window.__RIFTRUNNER_CAMERA_ZOOM__ = zoom;
      window.__RIFTRUNNER_CAMERA_TARGET_ZOOM__ = zoom;
      window.__RIFTRUNNER_CAMERA_ZOOM_PLAN__ = this.cameraZoomPlan;

      if (Math.abs((cam.zoom || 1) - zoom) > 0.0001) cam.setZoom(zoom);
      this.cameraSwayX = 0;
      this.cameraSwayY = 0;
      this.cameraSwayTargetX = 0;
      this.cameraSwayTargetY = 0;
      this.cameraFollowX = x;
      this.cameraFollowY = y;
      cam.centerOn(x, y);
    }

    updateCamera(dt = 0) {
      if (this.isSpectatorOverviewMode()) {
        this.updateSpectatorOverviewCamera();
        return;
      }

      const item = this.getCameraSubjectItem();
      if (!item) return;

      const cam = this.cameras.main;
      const x = item.container.x;
      const y = item.container.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const plan = getCameraZoomPlan(item.data);
      const current = Number.isFinite(this.currentCameraZoom) ? this.currentCameraZoom : (cam.zoom || CAMERA.BASE_ZOOM);
      const alpha = dampAlpha(CAMERA.ZOOM_LERP_RATE, dt);
      let nextZoom = lerp(current, plan.zoom, alpha);
      if (Math.abs(nextZoom - plan.zoom) <= CAMERA.ZOOM_SNAP_EPSILON) nextZoom = plan.zoom;
      const planMinZoom = Math.min(CAMERA.MIN_ZOOM, cfgNumber(current, CAMERA.BASE_ZOOM), cfgNumber(plan.zoom, CAMERA.BASE_ZOOM));
      nextZoom = clamp(nextZoom, planMinZoom, CAMERA.MAX_ZOOM);

      this.cameraZoomPlan = plan;
      this.targetCameraZoom = plan.zoom;
      this.currentCameraZoom = nextZoom;
      cameraZoomNow = nextZoom;
      window.__RIFTRUNNER_CAMERA_ZOOM__ = nextZoom;
      window.__RIFTRUNNER_CAMERA_TARGET_ZOOM__ = plan.zoom;
      window.__RIFTRUNNER_CAMERA_ZOOM_PLAN__ = plan;

      if (Math.abs((cam.zoom || 1) - nextZoom) > 0.0001) {
        cam.setZoom(nextZoom);
      }

      this.cameraSwayX = 0;
      this.cameraSwayY = 0;
      this.cameraSwayTargetX = 0;
      this.cameraSwayTargetY = 0;
      this.cameraFollowX = x;
      this.cameraFollowY = y;
      cam.centerOn(x, y);
    }

    getDynamicWorldKey() {
      const map = currentSnapshot?.map || this.map;
      if (!map) return "";
      const hookKey = (map.hooks || []).map((h) => `${h.id}:${h.active ? 1 : 0}:${h.survivorId || ""}`).join("|");
      const gateKey = (map.gates || []).map((g) => `${g.id}:${g.open ? 1 : 0}:${Math.round((g.escapeProgress || 0) * 20)}`).join("|");
      const dotKey = (currentSnapshot?.collectibleDots || []).map((d) => d.id).join(",");
      return `${hookKey}#${gateKey}#${dotKey}#rifts:${this.riftsAreComplete() ? 1 : 0}`;
    }

    getGeneratorWorldKey() {
      const map = currentSnapshot?.map || this.map;
      if (!map) return "";
      if (this.riftsAreComplete() && !this.isSpectatorOverviewMode()) return "rifts-hidden";
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
      const interval = 1 / (animatingDots ? performanceValue("dotFadeFps", DOT_FADE_VISUAL.FPS) : (animatingHooks || animatingGates) ? Math.min(12, performanceValue("dynamicWorldFps", PERFORMANCE.DYNAMIC_WORLD_FPS) + 3) : performanceValue("dynamicWorldFps", PERFORMANCE.DYNAMIC_WORLD_FPS));
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
      const interval = 1 / Math.max(1, performanceValue("generatorFps", PERFORMANCE.GENERATOR_FPS));

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
      if (!this.needsScratchRedraw || this.scratchRedrawTimer < 1 / Math.max(1, performanceValue("scratchDrawFps", PERFORMANCE.SCRATCH_DRAW_FPS))) return;
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

    maybeDrawLighting(dt = 0) {
      this.lightingRedrawTimer = (this.lightingRedrawTimer || 0) + dt;
      const interval = 1 / Math.max(1, performanceValue("lightingFps", PERFORMANCE.LIGHTING_FPS));
      if (this.visionConeVisual && this.lightingRedrawTimer < interval) return;
      const stepDt = this.lightingRedrawTimer || dt;
      this.lightingRedrawTimer = 0;
      this.drawLighting(stepDt);
    }

    drawLighting(dt = 0) {
      const g = this.flashlightGlowGraphics;
      if (!g) return;
      g.clear();

      if (this.isSpectatorOverviewMode()) {
        this.visionConeVisual = null;
        return;
      }

      const me = this.getCameraSubjectItem();
      if (!me?.container) {
        this.visionConeVisual = null;
        return;
      }

      const role = me.data?.role || "survivor";
      const hourglassActive = role === "survivor" && (me.data?.hourglass || 0) > 0;
      const length = role === "killer" ? LIGHTING.KILLER_LENGTH : survivorVisionLengthForData(me.data);
      const angle = role === "killer" ? LIGHTING.KILLER_ANGLE : survivorVisionAngleForData(me.data);
      const targetX = me.container.x;
      const targetY = me.container.y;
      const targetFacing = me.container.rotation || 0;
      const nearRadius = role === "killer" ? WALL_VISION.KILLER_NEAR_RADIUS : WALL_VISION.SURVIVOR_NEAR_RADIUS;

      const flicker = 1 - LIGHTING.FLICKER_STRENGTH * 0.22
        + Math.sin(this.lightFlickerPhase) * LIGHTING.FLICKER_STRENGTH * 0.16
        + Math.sin(this.lightFlickerPhase * 2.37) * LIGHTING.FLICKER_STRENGTH * 0.06;

      const targetLength = length * flicker;
      const directCone = adaptivePerformance.mode !== "normal" || performanceValue("visionConeDirect", 0) > 0;
      const smooth = directCone ? 1 : dampAlpha(LIGHTING.CONE_VISUAL_SMOOTHING, dt || 1 / 60);
      if (!this.visionConeVisual || directCone) {
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
      const alphaScale = performanceValue("lightingAlphaScale", 1);
      const coneAlpha = (role === "killer" ? (LOW_POWER_MODE ? 0.036 : 0.052) : (LOW_POWER_MODE ? 0.044 : 0.066)) * alphaScale;
      const nearAlpha = (role === "killer" ? 0.036 : 0.048) * alphaScale;

      // Near bubble keeps close corners readable. Single fill only for cheaper redraws.
      g.fillStyle(coreColor, nearAlpha);
      g.fillCircle(vx, vy, nearRadius * 0.82);

      // One forward cone by default. Hourglass adds a second rear cone, but only while paid for.
      const segments = Math.max(4, Math.floor(performanceValue("coneSegments", LIGHTING.CONE_SEGMENTS)));
      this.drawVisionConeGraphic(g, vx, vy, vfacing, vlength, vangle, lightColor, coneAlpha, segments);
      if (hourglassActive) {
        const backLength = vlength * LIGHTING.SURVIVOR_HOURGLASS_BACK_LENGTH_MULT;
        const backAngle = Math.min(Math.PI * 1.08, vangle * LIGHTING.SURVIVOR_HOURGLASS_BACK_ANGLE_MULT);
        this.drawVisionConeGraphic(g, vx, vy, vfacing + Math.PI, backLength, backAngle, 0x67e8f9, coneAlpha * 0.82, segments);
      }
    }

    updateHookIndicators(dt = 0) {
      this.hookIndicatorTimer = (this.hookIndicatorTimer || 0) + Math.max(0, dt || 0);
      const interval = adaptivePerformance.mode === "ultra" ? 0.18 : adaptivePerformance.mode === "low" ? 0.10 : 0.045;
      if (this.hookIndicatorTimer < interval) return;
      this.hookIndicatorTimer = 0;

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
      if (!g) return;
      const hasFx = this.shockwaves.length > 0 || this.particles.length > 0;
      if (!hasFx) {
        if (this.particleLayerDirty) {
          g.clear();
          this.particleLayerDirty = false;
        }
        return;
      }

      this.particleRedrawTimer = (this.particleRedrawTimer || 0) + dt;
      const interval = 1 / Math.max(1, performanceValue("particleFps", 60));
      if (this.particleRedrawTimer < interval) return;
      const stepDt = this.particleRedrawTimer;
      this.particleRedrawTimer = 0;
      this.particleLayerDirty = true;
      g.clear();
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const wave = this.shockwaves[i];
        wave.life += stepDt;
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
        p.life += stepDt;
        if (p.life >= p.ttl) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * stepDt;
        p.y += p.vy * stepDt;
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
        target: performanceValue("targetFps", LOW_POWER_MODE ? 45 : 60),
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

      // Only UI screens get button click sounds. This avoids in-match canvas clicks
      // triggering menu audio like an overeager vending machine.
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
      if (a.role !== b.role) return a.role === "killer" ? -1 : 1;
      if (a.id === myId) return -1;
      if (b.id === myId) return 1;
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
            statItem("Orbs stolen", stats.orbsStolen || 0),
            statItem("Injures", stats.injures || 0),
            statItem("Hooks", stats.hooks || 0),
            statItem("Runners consumed", stats.deaths || 0),
            statItem("Abilities used", stats.abilitiesUsed || 0)
          ].join("")
        : [
            statItem("Orbs collected", stats.orbsCollected || 0),
            statItem("Orbs deposited", stats.orbsDeposited || 0),
            statItem("Void stuns", stats.voidStuns || 0),
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
    const bindAccountPanelButtons = () => {
      document.querySelectorAll("[data-auth-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const kind = btn.dataset.authAction || "login";
          submitAuth(kind, btn).catch((error) => toast(error.message || "Account request failed.", 3000));
        });
      });
      document.querySelectorAll("[data-auth-logout]").forEach((btn) => {
        btn.addEventListener("click", logoutAccount);
      });
    };
    bindAccountPanelButtons();
    setSelectedSkin(selectedSkin);
    setSelectedVoidSkin(selectedVoidSkin);
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
      btn.addEventListener("click", async () => {
        try {
          const ok = await buySkinFromButton(btn);
          if (!ok) return;
          setSelectedSkin(btn.dataset.skin || "blueSquare");
          const mine = currentLobbyState?.players?.find((p) => p.id === myId);
          if (socket && mine?.role === "survivor") {
            socket.emit("setSkin", { skin: selectedSkin });
          }
        } catch (error) {
          toast(error.message || "Could not unlock skin.", 2600);
        }
      });
    });

    ui.voidSkinBtns?.forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const ok = await buySkinFromButton(btn);
          if (!ok) return;
          setSelectedVoidSkin(btn.dataset.skin || "voidCore");
          const mine = currentLobbyState?.players?.find((p) => p.id === myId);
          if (socket && mine?.role === "killer") {
            socket.emit("setSkin", { skin: selectedVoidSkin });
          }
        } catch (error) {
          toast(error.message || "Could not unlock skin.", 2600);
        }
      });
    });

    ui.quickJoinBtn.addEventListener("click", () => socket.emit("quickJoin", { role: selectedRole, playerName: getName(), skin: skinForSelectedRole() }));
    ui.createLobbyBtn.addEventListener("click", () => socket.emit("createLobby", { role: selectedRole, playerName: getName(), skin: skinForSelectedRole() }));
    ui.beSurvivorBtn.addEventListener("click", () => socket.emit("setRole", { role: "survivor", skin: selectedSkin }));
    ui.beKillerBtn.addEventListener("click", () => socket.emit("setRole", { role: "killer", skin: selectedVoidSkin }));
    ui.beSpectatorBtn?.addEventListener("click", () => socket.emit("setRole", { role: "spectator" }));
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
      const spectatorCount = Math.max(0, Math.floor(Number(lobby.spectators || 0)));
      const voidLabel = `${voidCount} Void player${voidCount === 1 ? "" : "s"}`;
      const spectatorLabel = spectatorCount ? ` • ${spectatorCount} Spectator${spectatorCount === 1 ? "" : "s"}` : "";
      const phaseLabel = lobby.phase === "game" ? "In progress" : "Waiting";
      left.innerHTML = `<strong>${escapeHtml(lobby.name)}</strong><small>${escapeHtml(lobby.mapName || "Map")} • ${phaseLabel} • ${lobby.survivors}/${lobby.maxSurvivors} Runners • ${voidLabel}${spectatorLabel}</small>`;
      const actions = document.createElement("div");
      actions.className = "lobby-item-actions";
      const button = document.createElement("button");
      button.textContent = lobby.phase === "lobby" ? "Join" : "In Run";
      button.disabled = lobby.phase !== "lobby";
      button.addEventListener("click", () => socket.emit("joinLobby", { lobbyId: lobby.id, role: selectedRole, playerName: getName(), skin: skinForSelectedRole() }));
      const spectateButton = document.createElement("button");
      spectateButton.type = "button";
      spectateButton.className = "spectate-lobby-btn";
      spectateButton.dataset.action = "join-spectator";
      spectateButton.textContent = "Join as Spectator";
      spectateButton.setAttribute("aria-label", `Join ${lobby.name || "this lobby"} as a spectator`);
      spectateButton.title = lobby.phase === "game"
        ? "Join this active run as a watch-only spectator."
        : "Join this lobby as an auto-ready spectator. Spectators are optional and do not block match start.";
      spectateButton.addEventListener("click", () => socket.emit("spectateLobby", { lobbyId: lobby.id, playerName: getName() || "Spectator" }));
      actions.append(button, spectateButton);
      item.append(left, actions);
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
    const requiredHumanPlayers = players.filter((player) => !player.isBot && player.role !== "spectator");
    const allRequiredHumansReady = requiredHumanPlayers.every((player) => !!player.ready);
    const canStartRun = allRequiredHumansReady && voidCount === 1 && survivorCount >= 1;
    const spectatorCount = players.filter((player) => player.role === "spectator").length;
    const statusLine = `${survivorCount}/${maxSurvivors} Runners • ${voidCount} Void player${voidCount === 1 ? "" : "s"}${spectatorCount ? ` • ${spectatorCount} Spectator${spectatorCount === 1 ? "" : "s"}` : ""}`;
    const subtitle = voidCount === 1
      ? `${statusLine}. Players ready up to start. Spectators are auto-ready and optional.`
      : `${statusLine}. The run needs exactly 1 Void. Spectators are auto-ready and optional.`;
    const lobbySubtitle = document.getElementById("lobbySubtitle");
    if (lobbySubtitle) lobbySubtitle.textContent = subtitle;

    const renderPlayerRow = (player) => {
      const item = document.createElement("div");
      const isKiller = player.role === "killer";
      const isSpectator = player.role === "spectator";
      item.className = `player-item ${isKiller ? "is-killer" : isSpectator ? "is-spectator" : "is-survivor"}${player.id === myId ? " is-you" : ""}${player.isBot ? " is-bot" : ""}`;

      const emblem = document.createElement("span");
      emblem.className = `player-role-emblem ${isKiller ? "killer" : isSpectator ? "spectator" : "survivor"}`;
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
      roleName.textContent = `${isKiller ? "The Void" : isSpectator ? "Spectator" : "Runner"}${player.isBot ? " bot" : ""}`;

      const dot = document.createElement("span");
      dot.className = "player-dot";
      dot.textContent = "•";

      const skin = document.createElement("span");
      const skinName = isKiller ? getVoidSkin(player.skin).label : isSpectator ? "Watching only" : getSurvivorSkin(player.skin).label;
      skin.className = "player-skin-name";
      skin.title = skinName;
      skin.textContent = skinName;

      meta.append(roleName, dot, skin);
      summary.append(name, meta);

      const ready = document.createElement("small");
      const isReady = player.role === "spectator" || player.isBot || !!player.ready;
      ready.className = `player-ready ${isReady ? "is-ready" : ""}${isSpectator ? " is-spectator-ready" : ""}`;
      ready.textContent = isSpectator ? "Auto Ready" : isReady ? "Ready" : "Not ready";

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
        empty.textContent = groupClass === "void-group" ? "No Void selected yet." : groupClass === "spectator-group" ? "No spectators yet." : "No runners selected yet.";
        body.appendChild(empty);
      }

      group.appendChild(body);
      ui.playersList.appendChild(group);
    };

    const voidPlayers = players.filter((player) => player.role === "killer");
    const survivorPlayers = players.filter((player) => player.role === "survivor");
    const spectatorPlayers = players.filter((player) => player.role === "spectator");
    appendPlayerGroup("Void player", `${voidPlayers.length} selected`, "void-group", voidPlayers);
    appendPlayerGroup("Runners", `${survivorPlayers.length}/${maxSurvivors}`, "survivor-group", survivorPlayers);
    if (spectatorPlayers.length) appendPlayerGroup("Spectators", `${spectatorPlayers.length} watching`, "spectator-group", spectatorPlayers);
    const mine = players.find((p) => p.id === myId);
    const iAmSpectator = mine?.role === "spectator";
    if (mine?.role === "killer" || mine?.role === "survivor") setSelectedRole(mine.role);
    else if (iAmSpectator) syncLobbyRoleButtons("spectator");
    if (mine?.role === "survivor" && SURVIVOR_SKINS[mine.skin]) {
      setSelectedSkin(mine.skin);
    } else if (mine?.role === "killer") {
      setSelectedVoidSkin(mine.skin);
    }
    ui.readyBtn.textContent = iAmSpectator ? "Spectator Ready" : mine?.ready ? "Unready" : "Ready";
    ui.readyBtn.dataset.readyState = iAmSpectator ? "spectator" : mine?.ready ? "unready" : "ready";
    ui.readyBtn.disabled = !!iAmSpectator;
    ui.readyBtn.title = iAmSpectator ? "Spectators are always ready and do not count toward starting the run." : "Toggle ready status.";
    ui.beKillerBtn.disabled = !!iAmSpectator;
    ui.beSurvivorBtn.disabled = !!iAmSpectator;
    if (ui.beSpectatorBtn) {
      ui.beSpectatorBtn.disabled = !!iAmSpectator;
      ui.beSpectatorBtn.title = iAmSpectator
        ? "You are already joining this lobby as an auto-ready spectator."
        : "Join this lobby as a spectator. You will load into the run without controlling a character.";
    }
    ui.addBotSurvivorBtn.disabled = false;
    ui.addBotKillerBtn.disabled = false;
    setLobbySkinPickerVisibility(iAmSpectator ? "spectator" : selectedRole);
    if (ui.startBtn) {
      ui.startBtn.disabled = !canStartRun;
      ui.startBtn.title = canStartRun ? "Start the run. Spectators will load in watching instead of playing." : "Need exactly 1 Void, at least 1 Runner, and every playable human ready. Spectators are optional and do not block the match.";
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
      if (e.code === "BracketRight") {
        e.preventDefault();
        if (!e.repeat) requestToggleMatchPause();
        return;
      }
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
        if (isDedicatedSpectator()) {
          socket?.emit("leaveLobby");
          showScreen("play");
          return;
        }
        if (showSpectateResultScreen()) return;
      }
      if (e.code === "Tab" && phaserScene?.isSpectating()) {
        e.preventDefault();
        phaserScene.cycleSpectateTarget(e.shiftKey ? -1 : 1);
        return;
      }
      if (isDedicatedSpectator()) {
        e.preventDefault();
        input.attackHeld = false;
        closeReactChatWheel(false);
        closeReactAbilityWheel(false);
        clearMovementInputOnly();
        sendInput({}, true);
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


  function setupSockets() {
    const socketOptions = {
      transports: ["websocket"],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 650,
      reconnectionDelayMax: 3500,
      timeout: 10000,
      auth: { token: authToken || getStoredAuthToken() || "" }
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
    socket.on("accountState", applyAccountPayload);
    socket.on("toast", ({ message }) => toast(message));
    socket.on("matchPauseChanged", (payload = {}) => {
      currentSnapshot = { ...(currentSnapshot || {}), ...payload };
      updateMatchPauseOverlay(currentSnapshot);
      toast(payload.paused ? `Match paused${payload.pausedByName ? ` by ${payload.pausedByName}` : ""}.` : "Match resumed.", 1500);
    });
    socket.on("scoreGain", (payload) => pushScoreGain(payload));
    socket.on("lobbyList", renderLobbyList);
    socket.on("joinedLobby", () => showScreen("lobby"));
    socket.on("lobbyState", renderLobbyState);
    socket.on("gameStarted", (map) => {
      currentSnapshot = null;
      updateMatchPauseOverlay(null);
      let lockSeconds = Number(map?.startFreezeSeconds || IMMERSION.MATCH_START_LOCK_SECONDS || 1.5);
      if (!Number.isFinite(lockSeconds) || lockSeconds < 0) lockSeconds = IMMERSION.MATCH_START_LOCK_SECONDS || 1.5;
      if (phaserScene) {
        phaserScene.spawnInPlayed = false;
        phaserScene.spawnInAt = 0;
        phaserScene.localEscapeScreenShown = false;
        phaserScene.chaseBlend = 0;
        phaserScene.terrorBlend = 0;
        phaserScene.cameraSwayX = 0;
        phaserScene.cameraSwayY = 0;
        phaserScene.cameraSwayTargetX = 0;
        phaserScene.cameraSwayTargetY = 0;
        phaserScene.cameraFollowX = null;
        phaserScene.cameraFollowY = null;
        phaserScene.lastMoveAngle = null;
        phaserScene.matchStartFreezeRemaining = Math.max(0, lockSeconds);
        phaserScene.matchStartFreezeDuration = Math.max(0.001, lockSeconds);
        phaserScene.matchStartInputLockUntil = performance.now() + Math.max(0, lockSeconds) * 1000;
        phaserScene.introCameraPrimed = false;
        clearMovementInputOnly();
        phaserScene.loadMap(map);
        cameraZoomNow = CAMERA.BASE_ZOOM;
        phaserScene.currentCameraZoom = cameraZoomNow;
        phaserScene.targetCameraZoom = cameraZoomNow;
        phaserScene.cameras?.main?.setZoom(cameraZoomNow);
      }

      const inProgressSpectate = !!map?.inProgress;
      const enterGame = () => {
        showScreen("game");
        if (!inProgressSpectate) beginMatchStartCue();
        ensureAudioStarted();
      };
      if (inProgressSpectate) enterGame();
      else runMatchStartTransition(enterGame);
    });
    socket.on("snapshot", (snapshot) => {
      const arrivedAt = performance.now();
      if (snapshot?.seq && currentSnapshot?.seq && snapshot.seq <= currentSnapshot.seq) return;
      if (networkTiming.lastSnapshotAt > 0) {
        const gap = clamp(arrivedAt - networkTiming.lastSnapshotAt, 5, 250);
        networkTiming.avgGapMs = networkTiming.avgGapMs * 0.88 + gap * 0.12;
        networkTiming.jitterMs = networkTiming.jitterMs * 0.86 + Math.abs(gap - networkTiming.avgGapMs) * 0.14;
      }
      networkTiming.lastSnapshotAt = arrivedAt;
      snapshot.clientArrivedAt = arrivedAt;
      currentSnapshot = snapshot;
      updateMatchPauseOverlay(snapshot);
      if (phaserScene) phaserScene.applySnapshot(snapshot);
    });
    socket.on("matchEnded", ({ winner, reason, escapedCount = 0, totalSurvivors = 0, finalActors = [] }) => {
      currentSnapshot = { ...(currentSnapshot || {}), paused: false, canPause: false };
      updateMatchPauseOverlay(currentSnapshot);
      if (phaserScene) {
        phaserScene.spectateTargetId = null;
        phaserScene.lastSpectateEmitId = "";
        if (phaserScene.floorEndgameActive) {
          phaserScene.floorEndgameActive = false;
          phaserScene.rebuildGrassLayer?.();
          phaserScene.needsDynamicRedraw = true;
        }
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
    restoreAccount();
    setupSockets();
    bootPhaser();
    showScreen("menu");

    const unlockAudio = () => {
      ensureAudioStarted();
      ensureMenuAudioStarted();
    };
    document.addEventListener("pointerdown", unlockAudio, { once: true });
    document.addEventListener("keydown", unlockAudio, { once: true });
  }

  start();
})();
