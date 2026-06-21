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
      smokeFps: 24,
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
  // and a small additive cone graphic gives the player readable direction.
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
        speedBoost: "/sfx/speed_boost.mp3",
        dash: "/sfx/dash.mp3",
        shootDart: "/sfx/shoot_dart.mp3",
        healDartImpact: "/sfx/heal.mp3",
        smokeDartImpact: "/sfx/smoke.mp3",
        collectMiss: "/sfx/collect_miss.mp3",
        collected: "/sfx/collected.mp3"
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
        speedBoost: 0.40,
        dash: 0.64,
        shootDart: 0.48,
        healDartImpact: 0.64,
        smokeDartImpact: 0.64,
        collectMiss: 0.58,
        collected: 0.34
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
        speedBoost: [0.96, 1.0, 1.04],
        dash: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
        shootDart: [0.92, 0.97, 1.0, 1.06, 1.12],
        healDartImpact: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
        smokeDartImpact: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
        collectMiss: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
        collected: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24]
      },
      localRange: {
        swing: 315,
        hit: 440,
        palletStun: 300,
        voidStun: 360,
        healing: 340,
        unhooking: 0,
        dash: 900,
        runnerProjectileImpact: 900,
        runnerProjectileImpactVisible: 1125,
        runnerProjectileImpactMinVolumeScale: 0.18,
        runnerProjectileImpactShooterMinVolumeScale: 0.46,
        dartBoxCollect: 420,
        dartBoxCollected: 900,
        dartBoxCollectedVisible: 1125,
        dartBoxCollectedMinVolumeScale: 0.18,
        dartBoxCollectedShooterMinVolumeScale: 0.46,
        // Shooter-only cue. Kept at 0 so config clearly does not localize it to nearby players.
        shootDart: 0
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
    if ((data?.riftLens || 0) > 0) length *= cfgNumber(perkEffectForActor(data, "riftLens", "survivor")?.lengthMultiplier, LIGHTING.SURVIVOR_RIFT_LENS_LENGTH_MULT);
    return length;
  }

  function survivorVisionAngleForData(data) {
    let angle = LIGHTING.SURVIVOR_ANGLE;
    if (survivorVisionIsCareful(data)) angle *= LIGHTING.SURVIVOR_SAFE_ANGLE_MULT;
    if ((data?.riftLens || 0) > 0) angle *= cfgNumber(perkEffectForActor(data, "riftLens", "survivor")?.angleMultiplier, LIGHTING.SURVIVOR_RIFT_LENS_ANGLE_MULT);
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

    if (isTanksSnapshot()) {
      const tankZoom = clamp(cfgNumber(GAMEPLAY_CONFIG.tanks?.cameraZoom, CAMERA.BASE_ZOOM + 0.22), CAMERA.MIN_ZOOM, CAMERA.MAX_ZOOM);
      return { base: tankZoom, rawOffset: 0, clampedOffset: 0, zoom: tankZoom, modifiers: [] };
    }

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
    BLOOD_FALL_PER_SECOND: 2.2,
    SPEED_BOOST_RISE_PER_SECOND: 7.5,
    SPEED_BOOST_FALL_PER_SECOND: 3.0
  };

  // Keep this matched with server.js. Client uses it only for local prediction
  // so walking into generators does not feel like rubber-band soup.
  const GENERATOR_COLLISION_SIZE = cfgNumber(GAMEPLAY_CONFIG.rift?.collisionSize, 54);
  const SCRATCH_MARK_CLIENT_TTL = Math.max(0.5, cfgNumber(GAMEPLAY_CONFIG.match?.scratchMarkTtl, 6.5));
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
  // Handle missing art assets gracefully.
  const GROUND_VISUAL = {
    TILE_SIZE: 72,
    BASE: 0x090a10,
    BASE_DARK: 0x05060a,
    BASE_LIGHT: 0x121626,
    EDGE_GREEN: 0x171b2c,
    PATCH_ALPHA: 0.16,
    EDGE_ALPHA: 0.18
  };

  const SPACE_VISUAL = {
    BACKDROP_KEY: "riftMenuSpaceBackdrop",
    BACKDROP_FILE: "/images/game_background.png",
    STAR_FAR_KEY: "riftSpaceStarsFar",
    STAR_NEAR_KEY: "riftSpaceStarsNear",
    BACKDROP_ALPHA: LOW_POWER_MODE ? 0.28 : 0.34,
    STAR_FAR_ALPHA: LOW_POWER_MODE ? 0.22 : 0.30,
    STAR_NEAR_ALPHA: LOW_POWER_MODE ? 0.18 : 0.26,
    FLOAT_SHADOW_ALPHA: LOW_POWER_MODE ? 0.28 : 0.38,
    EDGE_GLOW_ALPHA: LOW_POWER_MODE ? 0.18 : 0.28,
    // Zoom changes were making the background feel like it was sliding around during
    // sprint camera zooms. Keep the motion nearly locked when zoomed in.
    BACKDROP_PARALLAX_X: LOW_POWER_MODE ? 0.002 : 0.004,
    BACKDROP_PARALLAX_Y: LOW_POWER_MODE ? 0.0015 : 0.003,
    BACKDROP_DRIFT_X: 0,
    BACKDROP_DRIFT_Y: 0,
    STAR_FAR_PARALLAX_X: LOW_POWER_MODE ? 0.004 : 0.008,
    STAR_FAR_PARALLAX_Y: LOW_POWER_MODE ? 0.003 : 0.006,
    STAR_FAR_DRIFT_X: 0,
    STAR_FAR_DRIFT_Y: 0,
    STAR_NEAR_PARALLAX_X: LOW_POWER_MODE ? 0.007 : 0.014,
    STAR_NEAR_PARALLAX_Y: LOW_POWER_MODE ? 0.005 : 0.010,
    STAR_NEAR_DRIFT_X: 0,
    STAR_NEAR_DRIFT_Y: 0,
    ZOOMED_IN_PARALLAX_SCALE: LOW_POWER_MODE ? 0.02 : 0.04,
    ZOOM_COMPENSATION_MIN: 0.72
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
  const SURVIVOR_DOT_PICKUP_RADIUS = cfgNumber(GAMEPLAY_CONFIG.orbs?.survivorPickupRadius, 48);

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
    DEPOSIT_EXIT_PUSH: 16,
    TRAIL_ALPHA: LOW_POWER_MODE ? 0.10 : 0.16,
    RING_ALPHA: LOW_POWER_MODE ? 0.035 : 0.055,
    RING_ARC_ALPHA: LOW_POWER_MODE ? 0.055 : 0.085,
    RING_SPARK_ALPHA: LOW_POWER_MODE ? 0.13 : 0.20,
    NEW_ORB_POP: 0.32
  };

  const DOT_FADE_VISUAL = {
    IN_SPEED: LOW_POWER_MODE ? 8.5 : 11.5,
    OUT_SPEED: LOW_POWER_MODE ? 9.5 : 13.5,
    FPS: LOW_POWER_MODE ? 12 : 18,
    REMOVE_ALPHA: 0.018
  };


  const SHARED_CHATS = window.RIFTRUNNER_CHATS || {};
  const SHARED_ABILITIES = window.RIFTRUNNER_ABILITIES || {};
  const SHARED_PERKS = window.RIFTRUNNER_PERK_CONFIG || {};
  const SHARED_RUNNER_CLASSES = window.RIFTRUNNER_RUNNER_CLASS_CONFIG || {};
  const VOID_ABILITIES = SHARED_ABILITIES.abilities || {};
  const VOID_ABILITY_ORDER = Array.isArray(SHARED_ABILITIES.wheelOrder) ? SHARED_ABILITIES.wheelOrder : Object.keys(VOID_ABILITIES);
  const RUNNER_CLASS_DEFS = SHARED_RUNNER_CLASSES.classes || {};
  const RUNNER_CLASS_ABILITY_DEFS = SHARED_RUNNER_CLASSES.abilities || {};
  const RUNNER_CLASS_DEFAULT_ID = String(SHARED_RUNNER_CLASSES.defaultClass || "orbCollector");
  const SURVIVOR_ABILITIES = { ...(SHARED_ABILITIES.survivorAbilities || {}), ...RUNNER_CLASS_ABILITY_DEFS };
  const SURVIVOR_ABILITY_ORDER = Array.isArray(SHARED_ABILITIES.survivorWheelOrder) ? SHARED_ABILITIES.survivorWheelOrder : Object.keys(SURVIVOR_ABILITIES);
  const CHAT_AUTOMATIC = SHARED_CHATS.automatic || {};
  const ORB_FULL_CHAT_MESSAGES = new Set(CHAT_AUTOMATIC.orbFull || [
    "I have too many orbs...",
    "I should deposit these",
    "I can't pick any more up.",
    "I'm getting full..."
  ]);
  const QUICK_Q_ABILITY_SLOTS = 4;

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
      className: "skin-square",
      shape: "orbit",
      color: 0x38bdf8,
      accent: 0x818cf8,
      glow: 0xbae6fd,
      outline: 0xf0f9ff
    },
    yellowStar: {
      id: "yellowStar",
      label: "Solar Sprite",
      className: "skin-star",
      shape: "sprite",
      color: 0xfacc15,
      accent: 0xfb7185,
      glow: 0xfef3c7,
      outline: 0xfffbeb
    },
    purplePentagon: {
      id: "purplePentagon",
      label: "Prism Ghost",
      className: "skin-pentagon",
      shape: "prism",
      color: 0xa78bfa,
      accent: 0x22d3ee,
      glow: 0xede9fe,
      outline: 0xf5f3ff
    },
    nebulaBloom: {
      id: "nebulaBloom",
      label: "Nebula Bloom",
      className: "skin-nebula",
      shape: "bloom",
      color: 0xec4899,
      accent: 0x38bdf8,
      glow: 0xfbcfe8,
      outline: 0xfdf2f8
    },
    eclipseWisp: {
      id: "eclipseWisp",
      label: "Eclipse Wisp",
      className: "skin-eclipse",
      shape: "wisp",
      color: 0x14b8a6,
      accent: 0x4c1d95,
      glow: 0x99f6e4,
      outline: 0xccfbf1
    },
    riftMoth: {
      id: "riftMoth",
      label: "Night Moth",
      className: "skin-moth",
      shape: "moth",
      color: 0x60a5fa,
      accent: 0xc084fc,
      glow: 0xdbeafe,
      outline: 0xeff6ff
    },
    signalDrone: {
      id: "signalDrone",
      label: "Signal Drone",
      className: "skin-drone",
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
      className: "skin-void-core",
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
      className: "skin-void-solar",
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
      className: "skin-void-azure",
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
      className: "skin-void-eclipse",
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
      className: "skin-void-wyrm",
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
      className: "skin-void-lantern",
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
      className: "skin-void-siren",
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
      className: "skin-void-crowned",
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
      className: "skin-void-static",
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
      className: "skin-void-seraph",
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

  function colorNumberToCss(value, fallback = "#ffffff") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const hex = Math.max(0, Math.min(0xffffff, numeric | 0)).toString(16).padStart(6, "0");
    return `#${hex}`;
  }


  function clearSkinPreviewClasses(element) {
    if (!element) return;
    [...element.classList].forEach((className) => {
      if (className.startsWith("skin-") && className !== "skin-preview") element.classList.remove(className);
    });
  }

  function applySkinPreviewClass(element, skin, role = "runner") {
    if (!element || !skin) return;
    clearSkinPreviewClasses(element);
    element.classList.add("rr-skin-preview", "skin-preview", skin.className || (role === "void" ? "skin-void-core" : role === "spectator" ? "skin-spectator" : "skin-square"));
  }

  function applyRoleHudSkin(actor, hudRole = "survivor") {
    const preview = ui.roleHudSkin || document.getElementById("roleHudSkin");
    if (!preview) return;

    const isVoid = hudRole === "killer" || actor?.role === "killer";
    const isSpectator = hudRole === "spectator" || actor?.role === "spectator";
    const skin = isVoid
      ? getVoidSkin(actor?.skin || selectedVoidSkin)
      : isSpectator
        ? { id: "spectator", label: "Spectator", shape: "spectator", color: 0x94a3b8, accent: 0xc4b5fd, glow: 0xe2e8f0, outline: 0xf8fafc }
        : getSurvivorSkin(actor?.skin || selectedSkin);

    const previewRole = isVoid ? "void" : isSpectator ? "spectator" : "runner";
    applySkinPreviewClass(preview, skin, previewRole);
    preview.dataset.skinRole = isVoid ? "void" : isSpectator ? "spectator" : "survivor";
    preview.dataset.skinShape = String(skin.shape || (isVoid ? "core" : "orbit"));
    preview.dataset.skinId = String(skin.id || "default");
    preview.title = skin.label || (isVoid ? "Void skin" : isSpectator ? "Spectator" : "Runner skin");
    preview.style.setProperty("--skin-base", colorNumberToCss(skin.color ?? skin.base ?? skin.mid, isVoid ? "#32105f" : "#38bdf8"));
    preview.style.setProperty("--skin-accent", colorNumberToCss(skin.accent ?? skin.mid ?? skin.color, isVoid ? "#7c3aed" : "#818cf8"));
    preview.style.setProperty("--skin-glow", colorNumberToCss(skin.glow ?? skin.highlight ?? skin.outline, isVoid ? "#d8b4fe" : "#bae6fd"));
    preview.style.setProperty("--skin-outline", colorNumberToCss(skin.outline ?? skin.highlight ?? skin.glow, "#f8fafc"));
    preview.style.setProperty("--skin-shadow", colorNumberToCss(skin.shadow ?? skin.dark, "#020617"));
  }


  const ui = {
    menu: document.getElementById("menu"),
    playScreen: document.getElementById("playScreen"),
    skinScreen: document.getElementById("skinScreen"),
    perksScreen: document.getElementById("perksScreen"),
    optionsScreen: document.getElementById("optionsScreen"),
    howScreen: document.getElementById("howScreen"),
    lobbyScreen: document.getElementById("lobbyScreen"),
    endScreen: document.getElementById("endScreen"),
    menuPlayBtn: document.getElementById("menuPlayBtn"),
    menuSkinsBtn: document.getElementById("menuSkinsBtn"),
    menuPerksBtn: document.getElementById("menuPerksBtn"),
    menuOptionsBtn: document.getElementById("menuOptionsBtn"),
    menuHowBtn: document.getElementById("menuHowBtn"),
    menuMusicToggleBtn: document.getElementById("menuMusicToggleBtn"),
    menuMusicToggleBtnOptions: document.getElementById("menuMusicToggleBtnOptions"),
    menuMusicVolumeSlider: document.getElementById("menuMusicVolumeSlider"),
    menuMusicVolumeValue: document.getElementById("menuMusicVolumeValue"),
    menuBackBtns: [...document.querySelectorAll(".menu-back-btn")],
    roleBtns: [...document.querySelectorAll(".role-btn")],
    skinBtns: [...document.querySelectorAll('[data-skin-role="runner"]')],
    voidSkinBtns: [...document.querySelectorAll('[data-skin-role="void"]')],
    lobbySkinPicker: document.querySelector(".runner-lobby-skin-picker") || document.querySelector(".lobby-skin-picker"),
    voidLobbySkinPicker: document.querySelector(".void-lobby-skin-picker"),
    quickJoinBtn: document.getElementById("quickJoinBtn"),
    createLobbyBtn: document.getElementById("createLobbyBtn"),
    lobbyList: document.getElementById("lobbyList"),
    lobbyRoleMark: document.getElementById("lobbyRoleMark"),
    playersList: document.getElementById("playersList"),
    beSurvivorBtn: document.getElementById("beSurvivorBtn"),
    beKillerBtn: document.getElementById("beKillerBtn"),
    beFfaBtn: document.getElementById("beFfaBtn"),
    beSpectatorBtn: document.getElementById("beSpectatorBtn"),
    runnerClassPanel: document.getElementById("runnerClassPanel"),
    runnerClassBtns: [...document.querySelectorAll("[data-runner-class]")],
    lobbySelectedClassLabel: document.getElementById("lobbySelectedClassLabel"),
    readyBtn: document.getElementById("readyBtn"),
    addBotSurvivorBtn: document.getElementById("addBotSurvivorBtn"),
    addBotKillerBtn: document.getElementById("addBotKillerBtn"),
    startBtn: document.getElementById("startBtn"),
    leaveBtn: document.getElementById("leaveBtn"),
    hud: document.getElementById("hud"),
    survivorStatusHud: document.getElementById("survivorStatusHud"),
    horrorFx: document.getElementById("horrorFx"),
    roleLabel: document.getElementById("roleLabel"),
    roleHudSkin: document.getElementById("roleHudSkin"),
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
    speedBoost: 0,
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
    // This forced reflow is cheaper than recalculating every frame.
    void body.offsetWidth;

    if (heavy) body.classList.add("survivor-hit-heavy");
    body.classList.add("survivor-hit-impact");

    survivorHitImpactTimer = window.setTimeout(() => {
      body.classList.remove("survivor-hit-impact", "survivor-hit-heavy");
    }, heavy ? 640 : 460);
  }

  function resetHorrorFxVisualState() {
    fxState.redChase = 0;
    fxState.tunnel = 0;
    fxState.blood = 0;
    fxState.speedBoost = 0;
    fxState.lastDomKey = "";

    const horrorFx = ui.horrorFx || document.getElementById("horrorFx");
    if (horrorFx) {
      horrorFx.style.setProperty("--terror", "0");
      horrorFx.style.setProperty("--chase", "0");
      horrorFx.style.setProperty("--red-chase", "0");
      horrorFx.style.setProperty("--blood", "0");
      horrorFx.style.setProperty("--void-stun", "0");
      horrorFx.style.setProperty("--tunnel", "0");
      horrorFx.style.setProperty("--speed-boost", "0");
    }

    document.body.classList.remove(
      "is-looking-at-killer",
      "is-injured",
      "survivor-hit-impact",
      "survivor-hit-heavy"
    );
  }

  let socket = null;
  let myId = null;
  let selectedRole = "survivor";
  let selectedSkin = "blueSquare";
  let selectedVoidSkin = "voidCore";
  let selectedRunnerClass = (() => {
    try { return String(localStorage.getItem("riftrunnerRunnerClass") || RUNNER_CLASS_DEFAULT_ID); }
    catch { return RUNNER_CLASS_DEFAULT_ID; }
  })();
  let currentLobbyState = null;
  let currentSnapshot = null;
  let personalRunResult = null;
  let finalMatchResult = null;
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
  let shopPerks = [];

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

  function formatWholeNumber(value) {
    return Math.max(0, Math.floor(Number(value || 0))).toLocaleString();
  }

  function accountProgressionTrack(track = "account") {
    const key = track === "void" ? "void" : track === "runner" ? "runner" : "account";
    const progression = currentAccount?.progression || {};
    const fallbackLevel = key === "runner" ? currentAccount?.runnerLevel : key === "void" ? currentAccount?.voidLevel : currentAccount?.level;
    const item = progression[key] || {};
    const level = Math.max(1, Math.floor(Number(item.level || fallbackLevel || 1)));
    const xp = Math.max(0, Math.floor(Number(item.xp || 0)));
    const nextXp = Math.max(0, Math.floor(Number(item.nextXp || 0)));
    const progress = Number.isFinite(Number(item.progress)) ? clamp(Number(item.progress), 0, 1) : (nextXp > 0 ? clamp(xp / nextXp, 0, 1) : 0);
    return { key, level, xp, nextXp, progress };
  }

  function progressionXpLabel(track) {
    if (!currentAccount) return "Login to save XP";
    const item = accountProgressionTrack(track);
    if (!item.nextXp) return "MAX LEVEL";
    return `${formatWholeNumber(item.xp)} / ${formatWholeNumber(item.nextXp)} XP`;
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


  function normalizeRunnerClassId(value) {
    const id = String(value || RUNNER_CLASS_DEFAULT_ID);
    if (RUNNER_CLASS_DEFS[id]) return id;
    const aliasMatch = Object.values(RUNNER_CLASS_DEFS).find((runnerClass) => Array.isArray(runnerClass.aliases) && runnerClass.aliases.includes(id));
    if (aliasMatch?.id && RUNNER_CLASS_DEFS[aliasMatch.id]) return aliasMatch.id;
    if (RUNNER_CLASS_DEFS[RUNNER_CLASS_DEFAULT_ID]) return RUNNER_CLASS_DEFAULT_ID;
    return Object.keys(RUNNER_CLASS_DEFS)[0] || "orbCollector";
  }

  function runnerClassDef(value = selectedRunnerClass) {
    return RUNNER_CLASS_DEFS[normalizeRunnerClassId(value)] || null;
  }

  function runnerClassLabel(value = selectedRunnerClass) {
    return runnerClassDef(value)?.name || "Orb Collector";
  }

  function classLevelConfig(levels, actor) {
    const rows = Array.isArray(levels) ? levels : [];
    if (!rows.length) return null;
    const accountRunnerLevel = currentAccount?.progression?.runner?.level || currentAccount?.runnerLevel || 1;
    const runnerLevel = Math.max(1, Math.floor(Number(actor?.runnerLevel || accountRunnerLevel || 1)));
    let best = rows[0];
    for (const row of rows) {
      const minRunnerLevel = Math.max(1, Math.floor(Number(row.minRunnerLevel || 1)));
      if (runnerLevel >= minRunnerLevel) best = row;
    }
    return best || rows[0];
  }

  function passivePerkIdForClass(classDef) {
    if (classDef?.passive?.id) return String(classDef.passive.id);
    const id = String(classDef?.id || "");
    if (id === "orbCollector") return "orbMagnet";
    if (id === "nebulizer") return "voidTrace";
    if (id === "escapist") return "flowState";
    if (id === "healer") return "fieldMedic";
    return "";
  }

  function runnerClassPassive(actor) {
    if (!actor || actor.role !== "survivor") return {};
    const classDef = runnerClassDef(actor.runnerClass || currentAccount?.selectedRunnerClass || selectedRunnerClass);
    const passive = classDef?.passive || {};
    const passiveId = passivePerkIdForClass(classDef);
    const passivePerk = passiveId ? perkConfigById(passiveId, "survivor") : null;
    const boughtLevel = passivePerk ? actorPerkLevel(actor, passiveId, "survivor") : 0;
    const boughtConfig = boughtLevel > 0 ? perkLevelConfig(passivePerk, boughtLevel) : null;
    const autoConfig = passivePerk ? null : classLevelConfig(passive.levels, actor);
    const level = boughtConfig || autoConfig;
    return level ? { ...passive, ...(passivePerk || {}), ...level, id: passiveId || passive.id } : passive;
  }

  function orbPickupAuraForActor(actor) {
    if (!actor || actor.role !== "survivor") return null;
    const classId = normalizeRunnerClassId(actor.runnerClass || currentAccount?.selectedRunnerClass || selectedRunnerClass);
    const passive = runnerClassPassive({ ...actor, runnerClass: classId });
    const multiplier = Math.max(0, Number(passive?.orbPickupRadiusMultiplier || 1));
    if (multiplier <= 1.001) return null;
    const visual = passive.pickupRadiusRing || {};
    return {
      radius: SURVIVOR_DOT_PICKUP_RADIUS * multiplier,
      baseRadius: SURVIVOR_DOT_PICKUP_RADIUS,
      classId,
      isCollector: classId === "orbCollector",
      color: Number(visual.color ?? 0xff9f1c),
      lineAlpha: clamp(Number(visual.lineAlpha ?? 0.82), 0, 1),
      lineWidth: clamp(Number(visual.lineWidth ?? 2.2), 0.5, 8)
    };
  }

  function runnerClassWheelOrder(actor) {
    const classDef = runnerClassDef(actor?.runnerClass || currentAccount?.selectedRunnerClass || selectedRunnerClass);
    const rawOrder = Array.isArray(classDef?.wheelOrder) && classDef.wheelOrder.length
      ? classDef.wheelOrder
      : SURVIVOR_ABILITY_ORDER;

    const activeIds = rawOrder
      .map((id) => String(id || ""))
      .filter((id) => {
        if (!id || id === "cancel" || id === "moreSoon") return false;
        if (id === String(classDef?.passive?.id || "")) return false;
        const ability = SURVIVOR_ABILITIES[id];
        return !(ability?.passive || ability?.disabled);
      })
      .slice(0, 3);

    // Top, right, bottom cancel, left. Passives stay off the wheel because
    // they are always-on class bonuses, not Q abilities.
    return [activeIds[0] || "moreSoon", activeIds[1] || "moreSoon", "cancel", activeIds[2] || "moreSoon"];
  }

  function classGrantedPerkLevel(actor, perkId) {
    if (!actor || actor.role !== "survivor") return 0;
    const classDef = runnerClassDef(actor.runnerClass || currentAccount?.selectedRunnerClass || selectedRunnerClass);
    return Math.max(0, Math.floor(Number(classDef?.grantedPerks?.[String(perkId || "")] || 0)));
  }

  function runnerClassAbilityLevelConfig(ability, actor) {
    return classLevelConfig(ability?.levels, actor) || { level: 1 };
  }

  function syncRunnerClassUi({ preferAccount = true } = {}) {
    const accountClass = preferAccount ? currentAccount?.selectedRunnerClass : null;
    selectedRunnerClass = normalizeRunnerClassId(accountClass || selectedRunnerClass);
    try { localStorage.setItem("riftrunnerRunnerClass", selectedRunnerClass); } catch {}
    for (const button of ui.runnerClassBtns || []) {
      const selected = normalizeRunnerClassId(button.dataset.runnerClass) === selectedRunnerClass;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    if (ui.lobbySelectedClassLabel) ui.lobbySelectedClassLabel.textContent = runnerClassLabel(selectedRunnerClass);
  }

  function setSelectedRunnerClass(value, { emit = true, save = true } = {}) {
    const previousRunnerClass = selectedRunnerClass;
    selectedRunnerClass = normalizeRunnerClassId(value);
    try { localStorage.setItem("riftrunnerRunnerClass", selectedRunnerClass); } catch {}

    // Make the click feel instant. Without this, syncRunnerClassUi() can pull the
    // old account value back over the new selection before the API/socket round trip lands.
    if (currentAccount) {
      currentAccount = { ...currentAccount, selectedRunnerClass };
    }

    syncRunnerClassUi({ preferAccount: false });
    const mine = currentLobbyState?.players?.find((p) => p.id === myId);
    if (emit && socket && mine?.role === "survivor") {
      socket.emit("setRunnerClass", { runnerClass: selectedRunnerClass });
    }
    if (save && authToken && currentAccount) {
      authFetch("/api/runner-class/select", { method: "POST", body: JSON.stringify({ runnerClass: selectedRunnerClass }) })
        .then((payload) => {
          applyAccountPayload(payload);
          socket?.emit("refreshAccount", { token: authToken || "" });
        })
        .catch((error) => {
          selectedRunnerClass = normalizeRunnerClassId(previousRunnerClass);
          if (currentAccount) currentAccount = { ...currentAccount, selectedRunnerClass };
          syncRunnerClassUi({ preferAccount: false });
          toast(error.message || "Could not save Runner class.", 2600);
        });
    }
  }

  function normalizePerkRole(role) {
    const value = String(role || "").toLowerCase();
    if (value === "killer" || value === "void") return "killer";
    return "survivor";
  }

  function configuredPerksForRole(role) {
    const roleKey = normalizePerkRole(role);
    return Object.values(SHARED_PERKS.roles?.[roleKey]?.perks || {});
  }

  function perkConfigById(perkId, role = null) {
    const id = String(perkId || "");
    const roleKey = role ? normalizePerkRole(role) : null;
    if (roleKey && SHARED_PERKS.roles?.[roleKey]?.perks?.[id]) return SHARED_PERKS.roles[roleKey].perks[id];
    for (const roleDef of Object.values(SHARED_PERKS.roles || {})) {
      if (roleDef?.perks?.[id]) return roleDef.perks[id];
    }
    return null;
  }

  function mergePerkDefinition(publicPerk, configuredPerk) {
    if (!publicPerk) return configuredPerk || null;
    if (!configuredPerk) return publicPerk;
    const publicLevels = Array.isArray(publicPerk.levels) ? publicPerk.levels : [];
    const configuredLevels = Array.isArray(configuredPerk.levels) ? configuredPerk.levels : [];
    const levels = configuredLevels.map((configuredLevel) => {
      const levelNumber = Math.max(1, Math.floor(Number(configuredLevel.level || 1)));
      const publicLevel = publicLevels.find((row) => Math.max(1, Math.floor(Number(row.level || 1))) === levelNumber) || {};
      return { ...configuredLevel, ...publicLevel };
    });
    return {
      ...configuredPerk,
      ...publicPerk,
      levels: levels.length ? levels : (publicLevels.length ? publicLevels : configuredLevels)
    };
  }

  function publicPerkById(perkId, role = null) {
    const id = String(perkId || "");
    const roleKey = role ? normalizePerkRole(role) : null;
    const publicPerk = shopPerks.find((perk) => perk.id === id && (!roleKey || normalizePerkRole(perk.role) === roleKey)) || null;
    const configuredPerk = perkConfigById(id, roleKey) || null;
    return mergePerkDefinition(publicPerk, configuredPerk);
  }

  function perkLevels(perk) {
    return Array.isArray(perk?.levels) ? perk.levels : [];
  }

  function perkMaxLevel(perk) {
    const configured = Math.max(1, Math.floor(Number(perk?.maxLevel || SHARED_PERKS.maxLevel || 4)));
    const levels = perkLevels(perk).map((level) => Math.floor(Number(level.level || 0))).filter(Boolean);
    return Math.max(1, Math.min(configured, levels.length ? Math.max(...levels) : configured));
  }

  function perkDefaultLevel(perk) {
    if (!perk) return 0;
    const rawDefault = perk.defaultLevel ?? (perk.passive || perk.alwaysUnlocked ? 1 : 0);
    const level = Math.floor(Number(rawDefault || 0));
    if (!Number.isFinite(level) || level <= 0) return 0;
    return Math.max(0, Math.min(perkMaxLevel(perk), level));
  }


  function perkEffectiveLevel(perk, storedLevel = 0) {
    const maxLevel = perkMaxLevel(perk);
    const boughtLevel = Math.max(0, Math.min(maxLevel, Math.floor(Number(storedLevel || 0))));
    return Math.max(perkDefaultLevel(perk), boughtLevel);
  }

  function perkLevelConfig(perk, level) {
    const target = Math.max(1, Math.floor(Number(level || 1)));
    return perkLevels(perk).find((row) => Math.floor(Number(row.level || 0)) === target) || null;
  }

  function perkNextCost(perk, currentLevel) {
    const level = perkEffectiveLevel(perk, currentLevel);
    if (level >= perkMaxLevel(perk)) return 0;
    const target = perkLevelConfig(perk, level + 1);
    if (!target) return 0;
    if (level <= 0) return Math.max(0, Math.floor(Number(target.unlockCost ?? perk.unlockCost ?? 0)));
    return Math.max(0, Math.floor(Number(target.upgradeCost ?? target.unlockCost ?? perk.upgradeCost ?? 0)));
  }

  function accountPerkLevel(perkId, role = null, account = currentAccount) {
    const id = String(perkId || "");
    const roleKey = role ? normalizePerkRole(role) : null;
    const perk = publicPerkById(id, roleKey) || perkConfigById(id, roleKey);
    const perks = account?.perks || {};
    const sources = [
      roleKey ? perks[roleKey] : null,
      roleKey === "killer" ? perks.void : roleKey === "survivor" ? perks.runner : null,
      perks.all,
      perks
    ].filter(Boolean);
    let best = 0;
    for (const source of sources) {
      const value = Number(source?.[id] || 0);
      if (value > best) best = value;
    }
    return perkEffectiveLevel(perk, best);
  }

  function abilityTestingLevel(actor) {
    const rawLevel = actor?.abilityTestLevel ?? (actor?.abilityTestMode ? 1 : 0);
    const level = Math.floor(Number(rawLevel || 0));
    return Number.isFinite(level) ? Math.max(0, Math.min(3, level)) : 0;
  }

  function abilityTestingEnabled(actor) {
    return abilityTestingLevel(actor) > 0;
  }

  function shortenedAbilityCooldown(value) {
    return Math.max(0, Number(value || 0));
  }

  function isDartAbility(ability, effect = null) {
    return !!(ability?.shootAbility || ability?.inputType === "m1" || ability?.projectileKind || effect?.projectileKind);
  }

  function abilityCostForDisplay(ability, effect, fallback = 0, testing = false) {
    if (testing || isDartAbility(ability, effect)) return 0;
    return Math.max(0, Number(fallback || 0));
  }

  function actorPerkLevel(actor, perkId, role = null) {
    const id = String(perkId || "");
    const roleKey = normalizePerkRole(role || actor?.role);
    const debugLevel = abilityTestingLevel(actor);
    const debugPerk = debugLevel > 0 ? (perkConfigById(id, roleKey) || publicPerkById(id, roleKey)) : null;
    if (debugPerk) return Math.max(1, Math.min(perkMaxLevel(debugPerk), debugLevel));
    if (actor?.isBot) return Math.max(1, Math.floor(Number(SHARED_PERKS.botLevel || SHARED_PERKS.maxLevel || 4)));
    const perks = actor?.perkLevels || actor?.perks || {};
    const accountPerks = actor?.id === myId ? (currentAccount?.perks || {}) : {};
    const sources = [
      perks[roleKey],
      roleKey === "killer" ? perks.void : perks.runner,
      perks.all,
      perks,
      accountPerks[roleKey],
      roleKey === "killer" ? accountPerks.void : accountPerks.runner,
      accountPerks.all,
      accountPerks
    ].filter(Boolean);
    const perk = perkConfigById(id, roleKey) || publicPerkById(id, roleKey);
    let best = Math.max(perkDefaultLevel(perk), roleKey === "survivor" ? classGrantedPerkLevel(actor, id) : 0);
    for (const source of sources) {
      const value = Number(source?.[id] || 0);
      if (value > best) best = value;
    }
    return Math.max(0, Math.floor(best));
  }

  function perkEffectForActor(actor, perkId, role = null) {
    const roleKey = normalizePerkRole(role || actor?.role);
    const perk = perkConfigById(perkId, roleKey);
    const level = actorPerkLevel(actor, perkId, roleKey);
    if (!perk || level <= 0) return null;
    return perkLevelConfig(perk, level) || null;
  }

  function formatSeconds(value) {
    const seconds = Number(value || 0);
    if (!Number.isFinite(seconds)) return "0s";
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function perkFallbackEmblem(perk) {
    const id = String(perk?.id || "").toLowerCase();
    const classId = String(perk?.classId || "").toLowerCase();
    if (/heal/.test(id) || classId === "healer") return "✚";
    if (id === "voidswirl") return "🌀";
    if (/smoke|voidtrace|nebul/.test(id) || classId === "nebulizer") return "☁";
    if (/dash|swift|vault|escape/.test(id) || classId === "escapist") return "➟";
    if (/collect|double|orb/.test(id) || classId === "orbcollector") return "✦";
    if (/redshift|reveal|void|null/.test(id) || normalizePerkRole(perk?.role) === "killer") return "◈";
    return "✦";
  }

  function perkSizeWord(level) {
    const n = Math.max(1, Math.floor(Number(level || 1)));
    if (n <= 1) return "small";
    if (n === 2) return "medium";
    return "large";
  }

  function titleCaseWord(value) {
    const text = String(value || "").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  function perkQualitativeWord(value, thresholds, words) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n <= thresholds[0]) return words[0];
    if (n <= thresholds[1]) return words[1];
    return words[2];
  }

  function perkRadiusWord(value) {
    return perkQualitativeWord(value, [115, 165], ["Small", "Medium", "Large"]);
  }

  function perkRangeWord(value) {
    return perkQualitativeWord(value, [620, 670], ["Short", "Medium", "Long"]);
  }

  function perkDartSpeedWord(value) {
    return perkQualitativeWord(value, [1400, 1580], ["Slow", "Medium", "Fast"]);
  }

  function perkSpeedBoostWord(value) {
    return perkQualitativeWord(value, [1.25, 1.5], ["Weak", "Medium", "Strong"]);
  }

  function perkPassiveStrengthWord(value, fallbackLevel = 1) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 1.2) {
      if (n <= 1.55) return "Small";
      if (n <= 1.8) return "Medium";
      return "Large";
    }
    const level = Math.max(1, Math.floor(Number(fallbackLevel || 1)));
    if (level <= 1) return "Small";
    if (level === 2) return "Medium";
    return "Large";
  }

  function perkCardDescription(perk) {
    const id = String(perk?.id || "");
    const levels = perkLevels(perk);
    const last = levels[levels.length - 1] || null;
    switch (id) {
      case "orbMagnet":
        return "Passive: pull loose orbs in from farther away while moving through the map. Higher tiers make the pickup radius stronger.";
      case "collectionBolt":
        return "Fire a yellow bolt that pulls loose orbs into your inventory. Higher tiers increase the pickup radius, and Max Level also collects orbs the bolt passes through.";
      case "doubleOrb":
        return "Turn normal orb pickups into bonus pickups for a short window. Higher tiers raise the proc chance, duration, and bonus-orb range.";
      case "voidTrace":
        return "Passive: while inside smoke, gain a speed boost and erase scratch marks. Level 1 is 1.2x for 2s, Level 2 is 1.4x for 3s, and Level 3 is 1.8x for 4s.";
      case "smokeDart":
        return "Fire a purple dart that blooms into a two-way void-smoke wall. Outsiders cannot see in, and insiders cannot see out.";
      case "voidSwirl":
        return "Drop a red void swirl trap at your feet. The Void is slowed when he steps into it, and higher tiers increase the trap size, uptime, and slow strength.";
      case "flowState":
        return "Passive: vault windows and pallets faster, making chase routes smoother and harder for The Void to punish.";
      case "dashDart":
        return "Fire an orange bolt that speed-boosts Runners inside the radius. Max Level also hides scratch marks during the boost.";
      case "swiftVault":
        return "Prime your next window or pallet vault. When you vault, you get a short sprint boost for chase routing and escapes.";
      case "fieldMedic":
        return "Passive: finish normal heals and close-range unbinding faster when helping teammates directly.";
      case "healingDart":
        return "Fire a green bolt that starts ranged healing. Tier 2 adds ranged unbinding, and Max Level instantly picks up downed Runners with brief i-frames.";
      case "nullRush":
        return `Surge forward to close distance in chase. Higher tiers extend the rush${last?.speedMultiplier ? " and make the chase pressure stronger" : ""}.`;
      case "redshiftOrbs":
        return "Corrupt loose orbs into slowdown hazards. Higher tiers last longer and punish greedy Runner routing harder.";
      case "voidReveal":
        return "Reveal all Runners for a short hunt window. Higher tiers extend the reveal so The Void can choose a better target.";
      default:
        return perk?.summary || "Unlock and upgrade this perk to improve its match effect.";
    }
  }

  function perkTypeLabel(perk, roleKey) {
    const role = normalizePerkRole(roleKey || perk?.role || "survivor");
    if (role === "killer") return "Void perk";
    if (perk?.passive) return "Runner passive";
    if (perk?.inputType === "m1" || perk?.shootAbility || perk?.projectileKind) return "Runner Dart (M1)";
    if (perk?.inputType === "q" || perk?.classAbility) return "Runner Q Ability";
    return "Runner perk";
  }

  function perkLevelEnglish(perk, level) {
    const rowLevel = Math.max(1, Math.floor(Number(level || 1)));
    const row = perkLevelConfig(perk, rowLevel) || perkLevelConfig(perk, 1) || {};
    const id = String(perk?.id || "");
    const tierName = rowLevel >= perkMaxLevel(perk) ? "Max Level" : `Tier ${rowLevel}`;
    const size = titleCaseWord(perkSizeWord(rowLevel));
    const duration = Number(row.duration || 0) > 0 ? formatSeconds(row.duration) : null;
    const radiusWord = perkRadiusWord(row.radius) || size;
    const rangeWord = perkRangeWord(row.range);
    const dartSpeedWord = perkDartSpeedWord(row.projectileSpeed);
    const speedBoostWord = perkSpeedBoostWord(row.speedMultiplier);

    switch (id) {
      case "orbMagnet":
        return `${tierName} Upgrade: increases your passive orb pickup radius to ${perkPassiveStrengthWord(row.orbPickupRadiusMultiplier, rowLevel).toLowerCase()}.`;
      case "voidTrace": {
        const mult = Number(row.vaporTrailSpeedMultiplier || 0);
        const boost = mult > 1 ? `${mult.toFixed(1)}x speed boost` : "speed boost";
        const time = Number(row.vaporTrailDuration || row.duration || 0) > 0 ? formatSeconds(row.vaporTrailDuration || row.duration) : "a short time";
        return `${tierName} Upgrade: while inside smoke, gives a ${boost}, lasts ${time}, and erases scratch marks.`;
      }
      case "flowState":
        return `${tierName} Upgrade: makes window and pallet vaults ${perkPassiveStrengthWord(row.vaultSpeedMultiplier, rowLevel).toLowerCase()} faster.`;
      case "fieldMedic":
        return `${tierName} Upgrade: makes normal healing and close-range unbinding ${perkPassiveStrengthWord(row.healActionSpeedMultiplier || row.unhookActionSpeedMultiplier, rowLevel).toLowerCase()} faster.`;
      case "collectionBolt": {
        const beam = row.beamCollectRadius ? " It also collects loose orbs the bolt passes through." : "";
        const rangeText = rangeWord ? ` with ${rangeWord.toLowerCase()} range` : "";
        const dartText = dartSpeedWord ? ` and ${dartSpeedWord.toLowerCase()} travel speed` : "";
        return `${tierName} Upgrade: fires a ${radiusWord.toLowerCase()} pickup radius${rangeText}${dartText}.${beam}`;
      }
      case "doubleOrb": {
        const chance = Math.round(Number(row.chance || 0) * 100);
        const min = Math.floor(Number(row.minBonus || 0));
        const max = Math.floor(Number(row.maxBonus || 0));
        return `${tierName} Upgrade: for ${duration || "a short time"}, orb pickups have a ${chance}% chance to add ${min}-${max} bonus orbs.`;
      }
      case "smokeDart":
        return `${tierName} Upgrade: creates a ${radiusWord.toLowerCase()} void-smoke radius for ${duration || "a short time"}.`;
      case "voidSwirl": {
        const slow = Math.round((1 - Number(row.slowMultiplier || 1)) * 100);
        const slowTime = Number(row.slowDuration || 0) > 0 ? formatSeconds(row.slowDuration) : "briefly";
        return `${tierName} Upgrade: drops a ${radiusWord.toLowerCase()} red swirl for ${duration || "a short time"}. The Void is slowed by ${slow}% for ${slowTime}.`;
      }
      case "dashDart": {
        const boostText = speedBoostWord ? `${speedBoostWord.toLowerCase()} speed boost` : "speed boost";
        const special = row.hidesScratchMarks ? " It also hides scratch marks while boosted." : "";
        return `${tierName} Upgrade: gives Runners in the radius a ${boostText} for ${duration || "a short time"}.${special}`;
      }
      case "swiftVault": {
        const boostText = speedBoostWord ? `${speedBoostWord.toLowerCase()} sprint boost` : "sprint boost";
        const boost = Number(row.boostDuration || 0) > 0 ? formatSeconds(row.boostDuration) : duration;
        return `${tierName} Upgrade: your next vault triggers a ${boostText} for ${boost || "a short time"}.`;
      }
      case "healingDart": {
        if (row.canPickupDowned) return `${tierName} Upgrade: instantly picks up downed Runners, keeps healing and unbinding support, resets Void execution pressure, and gives brief i-frames.`;
        if (row.canUnhook) return `${tierName} Upgrade: starts a full heal and can start ranged unbinding on bound teammates.`;
        return `${tierName} Upgrade: starts a full heal over ${duration || "the normal duration"} on hit teammates.`;
      }
      case "nullRush": {
        const boostText = speedBoostWord ? `${speedBoostWord.toLowerCase()} speed rush` : "speed rush";
        return `${tierName} Upgrade: rush forward with a ${boostText} for ${duration || "a short time"}.`;
      }
      case "redshiftOrbs": {
        const slow = Math.round((1 - Number(row.slowMultiplier || 1)) * 100);
        const slowTime = Number(row.slowSeconds || 0) > 0 ? formatSeconds(row.slowSeconds) : "briefly";
        return `${tierName} Upgrade: corrupts loose orbs for ${duration || "a short time"}. Runners who touch them are slowed by ${slow}% for ${slowTime}.`;
      }
      case "voidReveal":
        return `${tierName} Upgrade: reveals all Runners for ${duration || "a short time"}.`;
      default:
        return `${tierName} Upgrade: ${perkEffectLine(perk, rowLevel) || "improves this perk."}`;
    }
  }

  function perkLevelInfoBullets(perk, level) {
    const rowLevel = Math.max(1, Math.floor(Number(level || 1)));
    const row = perkLevelConfig(perk, rowLevel) || perkLevelConfig(perk, 1) || {};
    const id = String(perk?.id || "");
    const bullets = [];
    const duration = Number(row.duration || 0) > 0 ? formatSeconds(row.duration) : "";
    const cooldown = Number(row.cooldown || 0) > 0 ? formatSeconds(row.cooldown) : "";
    const radiusWord = perkRadiusWord(row.radius) || titleCaseWord(perkSizeWord(rowLevel));
    const rangeWord = perkRangeWord(row.range);
    const dartSpeedWord = perkDartSpeedWord(row.projectileSpeed);
    const speedBoostWord = perkSpeedBoostWord(row.speedMultiplier);
    const add = (label, text) => {
      const clean = String(text || "").trim();
      if (clean) bullets.push({ label, text: clean });
    };

    switch (id) {
      case "orbMagnet":
        add("Upgrade", `Passively increases your orb pickup radius to ${perkPassiveStrengthWord(row.orbPickupRadiusMultiplier, rowLevel).toLowerCase()}.`);
        add("Passive", "This is always active on Collector once unlocked. No button press needed.");
        add("Best use", "Run close to loose orbs while pathing to rifts instead of stopping for every pickup.");
        break;
      case "voidTrace": {
        const mult = Number(row.vaporTrailSpeedMultiplier || 0);
        const time = Number(row.vaporTrailDuration || row.duration || 0) > 0 ? formatSeconds(row.vaporTrailDuration || row.duration) : "a short time";
        add("Upgrade", `While inside smoke, gain ${mult > 1 ? `${mult.toFixed(1)}x` : "bonus"} speed for ${time}.`);
        add("Passive", "Scratch marks disappear while Vapor Trail is active.");
        add("Best use", "Throw smoke through a chase route, sprint through the cloud, and leave The Void with nothing useful to track.");
        break;
      }
      case "flowState":
        add("Upgrade", `Makes your window and pallet vaults ${perkPassiveStrengthWord(row.vaultSpeedMultiplier, rowLevel).toLowerCase()} faster.`);
        add("Passive", "This is always active on Escapist once unlocked. No ability charge needed.");
        add("Best use", "Chain windows and pallets more safely during chase without losing as much momentum.");
        break;
      case "fieldMedic":
        add("Upgrade", `Makes normal healing and close-range unbinding ${perkPassiveStrengthWord(row.healActionSpeedMultiplier || row.unhookActionSpeedMultiplier, rowLevel).toLowerCase()} faster.`);
        add("Passive", "This is always active on Healer when helping teammates directly.");
        add("Best use", "Stabilize injured or bound teammates faster when you are close enough to interact normally.");
        break;
      case "collectionBolt":
        add("Upgrade", `Fires a ${radiusWord.toLowerCase()} pickup radius that pulls loose orbs into your inventory.`);
        if (rangeWord || dartSpeedWord) add("Bolt feel", `${rangeWord ? `${rangeWord} range` : ""}${rangeWord && dartSpeedWord ? " · " : ""}${dartSpeedWord ? `${dartSpeedWord} travel speed` : ""}.`);
        if (row.beamCollectRadius) add("Special", "Collects any loose orbs the bolt passes through before it lands.");
        if (cooldown) add("Cooldown", `${cooldown} between uses.`);
        break;
      case "doubleOrb": {
        const chance = Math.round(Number(row.chance || 0) * 100);
        const min = Math.floor(Number(row.minBonus || 0));
        const max = Math.floor(Number(row.maxBonus || 0));
        add("Upgrade", `Orb pickups have a ${chance}% chance to add ${min}-${max} bonus orbs.`);
        if (duration) add("Duration", `Bonus pickups stay active for ${duration}.`);
        if (cooldown) add("Cooldown", `${cooldown} before you can trigger it again.`);
        break;
      }
      case "smokeDart":
        add("Upgrade", `Creates a ${radiusWord.toLowerCase()} void-smoke radius that blocks vision between inside and outside.`);
        if (duration) add("Duration", `The smoke lasts ${duration}.`);
        if (rangeWord || dartSpeedWord) add("Bolt feel", `${rangeWord ? `${rangeWord} range` : ""}${rangeWord && dartSpeedWord ? " · " : ""}${dartSpeedWord ? `${dartSpeedWord} travel speed` : ""}.`);
        if (cooldown) add("Cooldown", `${cooldown} before the next smoke shot.`);
        break;
      case "voidSwirl": {
        const slow = Math.round((1 - Number(row.slowMultiplier || 1)) * 100);
        const slowTime = Number(row.slowDuration || 0) > 0 ? formatSeconds(row.slowDuration) : "briefly";
        add("Trap", `Drops a ${radiusWord.toLowerCase()} red swirl at your feet.`);
        if (duration) add("Uptime", `The swirl waits for The Void for ${duration}.`);
        add("Slow", `The Void is slowed by ${slow}% for ${slowTime} when triggered.`);
        if (cooldown) add("Cooldown", `${cooldown} before the next Void Swirl.`);
        break;
      }
      case "dashDart":
        add("Upgrade", `Gives Runners in the radius a ${speedBoostWord ? speedBoostWord.toLowerCase() : "strong"} speed boost.`);
        if (duration) add("Duration", `The speed boost lasts ${duration}.`);
        if (row.hidesScratchMarks) add("Special", "Boosted Runners also hide scratch marks while the boost is active.");
        if (rangeWord || dartSpeedWord) add("Bolt feel", `${rangeWord ? `${rangeWord} range` : ""}${rangeWord && dartSpeedWord ? " · " : ""}${dartSpeedWord ? `${dartSpeedWord} travel speed` : ""}.`);
        if (cooldown) add("Cooldown", `${cooldown} before the next dash shot.`);
        break;
      case "swiftVault": {
        const boost = Number(row.boostDuration || 0) > 0 ? formatSeconds(row.boostDuration) : duration;
        add("Upgrade", `Your next vault triggers a ${speedBoostWord ? speedBoostWord.toLowerCase() : "strong"} sprint boost.`);
        if (boost) add("Boost", `The sprint boost lasts ${boost}.`);
        if (duration) add("Window", `The vault trigger stays primed for ${duration}.`);
        if (cooldown) add("Cooldown", `${cooldown} before you can prime another vault.`);
        break;
      }
      case "healingDart":
        if (row.canPickupDowned) {
          add("Upgrade", "Instantly picks up downed Runners and gives them a brief escape window.");
          add("Healing", `Still starts a full heal over ${duration || "the normal duration"}.`);
          add("Unbind", "Can start ranged unbinding on bound teammates.");
          add("Special", "Interrupts Void execution pressure and grants brief i-frames after pickup.");
        } else if (row.canUnhook) {
          add("Upgrade", "Starts a full heal and adds ranged unbinding for bound teammates.");
          add("Healing", `Starts a full heal over ${duration || "the normal duration"}.`);
          add("Unbind", "Only Tier 2 and higher can unbind teammates from range.");
        } else {
          add("Upgrade", `Starts a full heal over ${duration || "the normal duration"} on hit teammates.`);
          add("Healing", "Tier 1 heals only. It does not unbind bound teammates.");
        }
        if (rangeWord || dartSpeedWord) add("Bolt feel", `${rangeWord ? `${rangeWord} range` : ""}${rangeWord && dartSpeedWord ? " · " : ""}${dartSpeedWord ? `${dartSpeedWord} travel speed` : ""}.`);
        if (cooldown) add("Cooldown", `${cooldown} before the next healing shot.`);
        break;
      case "nullRush":
        add("Upgrade", `Rush forward with a ${speedBoostWord ? speedBoostWord.toLowerCase() : "strong"} speed surge.`);
        if (duration) add("Duration", `The rush lasts ${duration}.`);
        if (cooldown) add("Cooldown", `${cooldown} before the next rush.`);
        break;
      case "redshiftOrbs": {
        const slow = Math.round((1 - Number(row.slowMultiplier || 1)) * 100);
        const slowTime = Number(row.slowSeconds || 0) > 0 ? formatSeconds(row.slowSeconds) : "briefly";
        add("Upgrade", "Turns loose orbs into slowdown hazards.");
        if (duration) add("Duration", `The corruption lasts ${duration}.`);
        add("Slow", `Runners who touch a redshift orb are slowed by ${slow}% for ${slowTime}.`);
        if (cooldown) add("Cooldown", `${cooldown} before the next bloom.`);
        break;
      }
      case "voidReveal":
        add("Upgrade", "Reveals all living Runners so The Void can choose a target." );
        if (duration) add("Duration", `The reveal lasts ${duration}.`);
        if (cooldown) add("Cooldown", `${cooldown} before the next reveal.`);
        break;
      default:
        add("Upgrade", perkEffectLine(perk, rowLevel) || "Improves this perk.");
        if (duration) add("Duration", `Lasts ${duration}.`);
        if (cooldown) add("Cooldown", `${cooldown} before it can be used again.`);
        break;
    }

    return bullets;
  }

  function perkEffectLine(perk, level) {
    const currentLevel = Math.max(0, Math.floor(Number(level || 0)));
    const effect = currentLevel > 0 ? perkLevelConfig(perk, currentLevel) : perkLevelConfig(perk, 1);
    if (!effect) return "Unlock to use this ability in match.";
    const parts = [];
    if (effect.label) parts.push(String(effect.label)
      .replace(/burst/gi, "radius")
      .replace(/costs?\s+\d+\s+orbs?/gi, "")
      .replace(/costs?\s+no\s+orbs?/gi, "")
      .replace(/(?:^|[·,])\s*\d+(?:\.\d+)?s\s+cooldown/gi, "")
      .replace(/\s+·\s+$/g, "")
      .trim());
    if (Number(effect.duration || 0) > 0) parts.push(`${formatSeconds(effect.duration)} duration`);
    if (Number(effect.boostDuration || 0) > 0) parts.push(`${formatSeconds(effect.boostDuration)} boost`);
    if (effect.chance) parts.push(`${Math.round(Number(effect.chance) * 100)}% proc`);
    if (effect.minBonus != null && effect.maxBonus != null) parts.push(`+${Math.floor(Number(effect.minBonus))}-${Math.floor(Number(effect.maxBonus))} orbs`);
    if (effect.canPickupDowned) parts.push("picks up downed Runners");
    else if (effect.canUnhook) parts.push("can unbind");
    if (effect.orbPickupRadiusMultiplier) parts.push(`${perkPassiveStrengthWord(effect.orbPickupRadiusMultiplier, currentLevel)} pickup radius`);
    if (effect.vaporTrailSpeedMultiplier) parts.push(`${Number(effect.vaporTrailSpeedMultiplier).toFixed(1)}x boost in smoke`);
    if (effect.vaporTrailDuration) parts.push(`${formatSeconds(effect.vaporTrailDuration)} duration`);
    if (effect.vaultSpeedMultiplier) parts.push(`${perkPassiveStrengthWord(effect.vaultSpeedMultiplier, currentLevel)} vault speed`);
    if (effect.healActionSpeedMultiplier || effect.unhookActionSpeedMultiplier) parts.push(`${perkPassiveStrengthWord(effect.healActionSpeedMultiplier || effect.unhookActionSpeedMultiplier, currentLevel)} support speed`);
    if (effect.speedMultiplier) parts.push(`${perkSpeedBoostWord(effect.speedMultiplier) || "Medium"} speed boost`);
    if (effect.radius) parts.push(`${perkRadiusWord(effect.radius) || "Medium"} radius`);
    if (effect.projectileSpeed) parts.push(`${perkDartSpeedWord(effect.projectileSpeed) || "Medium"} dart speed`);
    if (effect.range) parts.push(`${perkRangeWord(effect.range) || "Medium"} range`);
    if (effect.slowMultiplier) parts.push(`${Math.round((1 - Number(effect.slowMultiplier)) * 100)}% slow`);
    if (effect.slowSeconds || effect.slowDuration) parts.push(`${formatSeconds(effect.slowSeconds || effect.slowDuration)} slow`);
    if (effect.hidesScratchMarks) parts.push("hides scratch marks");
    return [...new Set(parts.filter(Boolean))].slice(0, 6).join(" · ") || "Level effect configured.";
  }

  function createPerkLevelMeter(level, maxLevel) {
    const currentLevel = Math.max(0, Math.floor(Number(level || 0)));
    const count = Math.max(1, Math.floor(Number(maxLevel || 1)));
    const meter = document.createElement("div");
    meter.className = "perk-effect-meter";
    meter.style.setProperty("--perk-level-count", String(count));
    meter.setAttribute("aria-label", `Level ${Math.min(currentLevel, count)} of ${count}`);

    for (let i = 1; i <= count; i++) {
      const segment = document.createElement("span");
      segment.className = [
        i <= currentLevel ? "filled" : "",
        i === currentLevel && currentLevel > 0 ? "current" : "",
        i === currentLevel + 1 && currentLevel > 0 && currentLevel < count ? "next" : ""
      ].filter(Boolean).join(" ");
      segment.setAttribute("aria-hidden", "true");
      meter.appendChild(segment);
    }

    return meter;
  }

  function perkLevelCostText(perk, levelRow, index) {
    if (!levelRow) return "-";
    const level = Math.max(1, Math.floor(Number(levelRow.level || index + 1)));
    const cost = level <= 1
      ? Math.max(0, Math.floor(Number(levelRow.unlockCost ?? perk?.unlockCost ?? 0)))
      : Math.max(0, Math.floor(Number(levelRow.upgradeCost ?? levelRow.unlockCost ?? perk?.upgradeCost ?? 0)));
    return cost > 0 ? `${level <= 1 ? "Unlock" : "Upgrade"} · ${cost} orbs` : "Included";
  }

  function perkLevelValueList(levelRow) {
    if (!levelRow || typeof levelRow !== "object") return [];
    const values = [];
    if (Number(levelRow.duration || 0) > 0) values.push({ label: "Duration", value: formatSeconds(levelRow.duration) });
    if (Number(levelRow.boostDuration || 0) > 0) values.push({ label: "Boost time", value: formatSeconds(levelRow.boostDuration) });
    if (Number(levelRow.chance || 0) > 0) values.push({ label: "Chance", value: `${Math.round(Number(levelRow.chance) * 100)}%` });
    if (levelRow.minBonus != null && levelRow.maxBonus != null) values.push({ label: "Bonus orbs", value: `+${Math.floor(Number(levelRow.minBonus))}-${Math.floor(Number(levelRow.maxBonus))}` });
    if (Number(levelRow.speedMultiplier || 0) > 0) values.push({ label: "Boost strength", value: `${perkSpeedBoostWord(levelRow.speedMultiplier) || "Medium"}` });
    if (Number(levelRow.radius || 0) > 0) values.push({ label: "Radius", value: `${perkRadiusWord(levelRow.radius) || "Medium"}` });
    if (Number(levelRow.projectileSpeed || 0) > 0) values.push({ label: "Dart speed", value: `${perkDartSpeedWord(levelRow.projectileSpeed) || "Medium"}` });
    if (Number(levelRow.range || 0) > 0) values.push({ label: "Range", value: `${perkRangeWord(levelRow.range) || "Medium"}` });
    if (Number(levelRow.aimWindow || 0) > 0) values.push({ label: "Aim window", value: formatSeconds(levelRow.aimWindow) });
    if (Number(levelRow.lengthMultiplier || 0) > 0) values.push({ label: "Cone length", value: `${perkSpeedBoostWord(levelRow.lengthMultiplier) || "Medium"}` });
    if (Number(levelRow.angleMultiplier || 0) > 0) values.push({ label: "Cone width", value: `${perkSpeedBoostWord(levelRow.angleMultiplier) || "Medium"}` });
    if (Number(levelRow.backLengthMultiplier || 0) > 0) values.push({ label: "Rear view", value: "Longer" });
    if (Number(levelRow.backAngleMultiplier || 0) > 0) values.push({ label: "Rear width", value: "Wider" });
    if (Number(levelRow.slowMultiplier || 0) > 0 && Number(levelRow.slowMultiplier) < 1) values.push({ label: "Slow", value: `${Math.round((1 - Number(levelRow.slowMultiplier)) * 100)}%` });
    if (Number(levelRow.slowSeconds || levelRow.slowDuration || 0) > 0) values.push({ label: "Slow time", value: formatSeconds(levelRow.slowSeconds || levelRow.slowDuration) });
    if (levelRow.orbPickupRadiusMultiplier) values.push({ label: "Pickup radius", value: perkPassiveStrengthWord(levelRow.orbPickupRadiusMultiplier, levelRow.level) });
    if (levelRow.vaporTrailSpeedMultiplier) values.push({ label: "Boost in smoke", value: `${Number(levelRow.vaporTrailSpeedMultiplier).toFixed(1)}x` });
    if (levelRow.vaporTrailDuration) values.push({ label: "Duration", value: formatSeconds(levelRow.vaporTrailDuration) });
    if (levelRow.vaultSpeedMultiplier) values.push({ label: "Vault speed", value: perkPassiveStrengthWord(levelRow.vaultSpeedMultiplier, levelRow.level) });
    if (levelRow.healActionSpeedMultiplier || levelRow.unhookActionSpeedMultiplier) values.push({ label: "Support speed", value: perkPassiveStrengthWord(levelRow.healActionSpeedMultiplier || levelRow.unhookActionSpeedMultiplier, levelRow.level) });
    return values;
  }

  function perkInfoIconSrc(perk) {
    const key = String(perk?.id || perk?.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const byKey = {
      speedburst: "/images/speed_burst.png",
      riftlens: "/images/speed_burst.png",
      hourglass: "/images/speed_burst.png"
    };
    return byKey[key] || perk?.icon || "";
  }

  function perkInfoBulletList(perk) {
    const id = String(perk?.id || "");
    const fallback = perkCardDescription(perk) || "Level this perk to improve its match effect.";
    switch (id) {
      case "orbMagnet":
        return [
          { label: "Passive", text: "Collector pulls loose orbs in from farther away without pressing an ability button." },
          { label: "Scaling", text: "Higher tiers increase the pickup radius from small to large." },
          { label: "Best use", text: "Sweep through orb paths while rotating to rifts instead of stopping for every orb." }
        ];
      case "voidTrace":
        return [
          { label: "Passive", text: "While inside smoke, Nebulizer gains speed and scratch marks disappear." },
          { label: "Scaling", text: "Level 1 is 1.2x for 2s, Level 2 is 1.4x for 3s, and Level 3 is 1.8x for 4s." },
          { label: "Best use", text: "Cut through smoke during chase, break tracking, and disappear before The Void can re-read the route." }
        ];
      case "flowState":
        return [
          { label: "Passive", text: "Escapist vaults windows and pallets faster." },
          { label: "Scaling", text: "Higher tiers make chase vaults progressively faster." },
          { label: "Best use", text: "Chain vault routes to keep distance when The Void commits to chase." }
        ];
      case "fieldMedic":
        return [
          { label: "Passive", text: "Healer completes normal heals and close-range unbinding faster." },
          { label: "Scaling", text: "Higher tiers improve both direct healing and direct unbinding speed." },
          { label: "Best use", text: "Stabilize teammates faster when you are close enough to interact normally." }
        ];
      case "collectionBolt":
        return [
          { label: "Purpose", text: "Fire a bolt that collects loose orbs inside its pickup radius." },
          { label: "Scaling", text: "Higher tiers increase radius, range, and travel speed." },
          { label: "Special", text: "Max Level also collects orbs it passes through before landing." }
        ];
      case "doubleOrb":
        return [
          { label: "Purpose", text: "Turn normal orb pickups into bonus pickups for a short window." },
          { label: "Scaling", text: "Higher tiers improve chance, duration, and bonus-orb amount." }
        ];
      case "smokeDart":
        return [
          { label: "Purpose", text: "Create a void-smoke radius that blocks all vision between inside and outside." },
          { label: "Scaling", text: "Higher tiers create larger smoke that lasts longer." }
        ];
      case "voidSwirl":
        return [
          { label: "Purpose", text: "Drop a red swirl trap that slows The Void when he steps through it." },
          { label: "Scaling", text: "Higher tiers increase radius, uptime, slow strength, and slow duration." },
          { label: "Best use", text: "Place it behind you in chase, on pallet paths, or near smoke edges so The Void has to choose between losing speed or losing the route." }
        ];
      case "dashDart":
        return [
          { label: "Purpose", text: "Give Runners inside the radius a speed boost." },
          { label: "Scaling", text: "Higher tiers make the boost stronger and last longer." },
          { label: "Special", text: "Max Level also hides scratch marks while boosted." }
        ];
      case "swiftVault":
        return [
          { label: "Purpose", text: "Prime your next vault to trigger a sprint boost." },
          { label: "Scaling", text: "Higher tiers make the boost stronger and last longer." }
        ];
      case "healingDart":
        return [
          { label: "Tier 1", text: "Heals hit teammates from range. It does not unbind bound teammates." },
          { label: "Tier 2", text: "Adds ranged unbinding support for bound teammates." },
          { label: "Special", text: "Max Level instantly picks up downed Runners and grants brief i-frames." }
        ];
      case "nullRush":
        return [
          { label: "Purpose", text: "Surge forward to close distance in chase." },
          { label: "Scaling", text: "Higher tiers extend the rush and improve pressure." }
        ];
      case "redshiftOrbs":
        return [
          { label: "Purpose", text: "Corrupt loose orbs into slowdown hazards." },
          { label: "Scaling", text: "Higher tiers last longer and punish greedy routing harder." }
        ];
      case "voidReveal":
        return [
          { label: "Purpose", text: "Reveal all Runners for a short hunt window." },
          { label: "Scaling", text: "Higher tiers keep Runners revealed longer." }
        ];
      default:
        return [{ label: "Purpose", text: fallback }];
    }
  }

  function createPerkInfoModalRoot() {
    let modal = document.getElementById("perkInfoModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "perkInfoModal";
    modal.className = "perk-info-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="perk-info-backdrop" data-perk-info-close="true"></div>
      <section class="perk-info-dialog" role="dialog" aria-modal="true" aria-labelledby="perkInfoTitle">
        <button class="perk-info-close" type="button" data-perk-info-close="true" aria-label="Close perk info">×</button>
        <div class="perk-info-dialog-content" data-perk-info-content></div>
      </section>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function closePerkInfoModal() {
    const modal = document.getElementById("perkInfoModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  function openPerkInfoModal(perkId, role = "survivor") {
    const roleKey = normalizePerkRole(role);
    const perk = publicPerkById(perkId, roleKey);
    if (!perk) {
      toast("Could not find perk details. Extremely rude of it.", 2200);
      return;
    }

    const modal = createPerkInfoModalRoot();
    const content = modal.querySelector("[data-perk-info-content]");
    if (!content) return;

    const accent = perk.accent || (roleKey === "killer" ? "red" : "purple");
    modal.classList.remove("accent-yellow", "accent-purple", "accent-orange", "accent-green", "accent-red", "accent-gray", "accent-cyan");
    modal.classList.add(`accent-${accent}`);

    const level = accountPerkLevel(perk.id, roleKey);
    const maxLevel = perkMaxLevel(perk);
    const maxed = level >= maxLevel;
    const nextCost = perkNextCost(perk, level);
    const affordable = !!currentAccount && (currentAccount.orbBalance || 0) >= nextCost;
    const levels = perkLevels(perk);
    const iconSrc = perkInfoIconSrc(perk);
    const fallbackEmblem = perkFallbackEmblem(perk);

    content.replaceChildren();

    const header = document.createElement("div");
    header.className = `perk-info-header accent-${accent}`;
    header.innerHTML = `
      <span class="perk-info-icon perk-active-emblem" data-perk-fallback="${escapeHtml(fallbackEmblem)}">${iconSrc ? `<img src="${escapeHtml(iconSrc)}" alt="" aria-hidden="true" />` : `<span class="perk-icon-fallback" aria-hidden="true">${escapeHtml(fallbackEmblem)}</span>`}</span>
      <div>
        <span class="perk-info-kicker">${escapeHtml(perkTypeLabel(perk, roleKey))}</span>
        <h2 id="perkInfoTitle">${escapeHtml(perk.name || perk.id)}</h2>
        <p>${escapeHtml(perkCardDescription(perk))}</p>
      </div>
    `;

    const detail = document.createElement("section");
    detail.className = "perk-info-detail";
    const detailItems = perkInfoBulletList(perk);
    detail.innerHTML = `
      <h3>What it does</h3>
      <ul>${detailItems.map((entry) => `<li><b>${escapeHtml(entry.label)}:</b> ${escapeHtml(entry.text)}</li>`).join("")}</ul>
    `;

    const table = document.createElement("div");
    table.className = "perk-info-levels";
    for (let index = 0; index < levels.length; index += 1) {
      const row = levels[index];
      const rowLevel = Math.max(1, Math.floor(Number(row.level || index + 1)));
      const current = rowLevel === level;
      const owned = rowLevel <= level;
      const values = perkLevelValueList(row);
      const item = document.createElement("article");
      item.className = ["perk-info-level", owned ? "owned" : "", current ? "current" : "", row.hidesScratchMarks ? "special" : ""].filter(Boolean).join(" ");
      const body = values.map((entry) => `<span><b>${escapeHtml(entry.label)}</b>${escapeHtml(entry.value)}</span>`).join("");
      const levelBullets = perkLevelInfoBullets(perk, rowLevel);
      const bulletBody = levelBullets.map((entry) => `<li><b>${escapeHtml(entry.label)}:</b> ${escapeHtml(entry.text)}</li>`).join("");
      item.innerHTML = `
        <div class="perk-info-level-head">
          <strong>${rowLevel >= maxLevel ? "Max Level" : `Tier ${rowLevel}`}</strong>
          <small>${escapeHtml(perkLevelCostText(perk, row, index))}</small>
          ${current ? '<span class="perk-info-current-badge">Current level</span>' : ''}
        </div>
        <ul class="perk-info-level-copy">${bulletBody || `<li><b>Upgrade:</b> ${escapeHtml(perkLevelEnglish(perk, rowLevel))}</li>`}</ul>
        ${body ? `<div class="perk-info-level-values">${body}</div>` : ""}
      `;
      table.appendChild(item);
    }

    const actions = document.createElement("div");
    actions.className = "perk-info-actions";
    const status = document.createElement("p");
    status.textContent = level > 0 ? `Current level ${level}/${maxLevel}` : "Locked";
    const buyButton = document.createElement("button");
    buyButton.type = "button";
    buyButton.dataset.perkBuy = perk.id;
    buyButton.dataset.perkRole = roleKey;
    buyButton.dataset.perkInfoAction = "true";
    buyButton.disabled = maxed;
    buyButton.className = ["perk-info-buy-btn", affordable || maxed ? "" : "cant-afford"].filter(Boolean).join(" ");
    buyButton.textContent = maxed ? "Max level" : level <= 0 ? `Unlock · ${nextCost} orbs` : `Upgrade · ${nextCost} orbs`;
    actions.append(status, buyButton);

    content.append(header, detail, table, actions);
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function appendText(parent, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  function createPerkEmblem(perk) {
    const icon = document.createElement("span");
    icon.className = "perk-icon perk-active-emblem";
    icon.setAttribute("aria-hidden", "true");
    icon.dataset.perkFallback = perkFallbackEmblem(perk);
    const fallbackIcon = document.createElement("span");
    fallbackIcon.className = "perk-icon-fallback";
    fallbackIcon.textContent = icon.dataset.perkFallback;
    icon.appendChild(fallbackIcon);
    return icon;
  }

  function createPerkUpgradePanel({ title, copy, tone = "current" }) {
    const panel = document.createElement("section");
    panel.className = `perk-upgrade-panel ${tone}`;
    appendText(panel, "b", "perk-upgrade-label", title);
    appendText(panel, "p", "perk-upgrade-copy", copy);
    return panel;
  }

  function createPerkActionButton(perk, role, level, maxLevel, nextCost, maxed) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "perk-buy-btn";
    button.dataset.perkBuy = perk.id;
    button.dataset.perkRole = role;
    button.disabled = maxed;
    button.textContent = maxed ? "Max level" : level <= 0 ? `Unlock · ${nextCost} orbs` : `Upgrade · ${nextCost} orbs`;
    button.title = currentAccount ? button.textContent : "Login or Play as Guest to buy perks";
    return button;
  }

  function renderPerkShop() {
    const mounts = [...document.querySelectorAll("[data-perk-shop]")];
    if (!mounts.length) return;
    for (const mount of mounts) {
      const role = normalizePerkRole(mount.dataset.perkShop || "survivor");
      const classFilter = String(mount.dataset.perkClass || "").trim();
      const perks = shopPerks.filter((perk) => {
        if (normalizePerkRole(perk.role) !== role) return false;
        if (classFilter && String(perk.classId || "") !== classFilter) return false;
        return true;
      });
      const fallback = configuredPerksForRole(role).filter((perk) => {
        if (classFilter && String(perk.classId || "") !== classFilter) return false;
        return true;
      });
      const catalog = perks.length ? perks : fallback;
      mount.replaceChildren();
      if (!catalog.length) {
        const empty = document.createElement("p");
        empty.className = "perk-shop-empty";
        empty.textContent = "No perks found for this class yet.";
        mount.appendChild(empty);
        continue;
      }

      for (const catalogPerk of catalog) {
        const perk = publicPerkById(catalogPerk.id, role) || catalogPerk;
        const id = String(perk.id || "");
        const level = accountPerkLevel(id, role);
        const maxLevel = perkMaxLevel(perk);
        const nextCost = perkNextCost(perk, level);
        const maxed = level >= maxLevel;
        const affordable = !!currentAccount && (currentAccount.orbBalance || 0) >= nextCost;
        const previewLevel = level > 0 ? level : 1;
        const currentEffectText = perkLevelEnglish(perk, previewLevel);
        const nextEffectText = level > 0 && !maxed ? perkLevelEnglish(perk, level + 1) : "";
        const statusText = level > 0 ? (maxed ? "Max Level" : `Tier ${level}/${maxLevel}`) : "Locked";

        const card = document.createElement("article");
        card.className = `perk-card accent-${perk.accent || (role === "killer" ? "purple" : "cyan")}`;
        card.dataset.perkId = id;
        card.dataset.perkLevel = String(level);
        card.dataset.perkMaxLevel = String(maxLevel);
        card.dataset.perkRole = role;
        card.dataset.nextLevelText = nextEffectText;
        if (perk.classId) card.dataset.perkClass = String(perk.classId);
        card.classList.toggle("locked", level <= 0);
        card.classList.toggle("owned", level > 0);
        card.classList.toggle("maxed", maxed);
        card.classList.toggle("upgradeable", level > 0 && !maxed);
        card.classList.toggle("affordable", !maxed && affordable);
        card.classList.toggle("passive-perk", !!perk.passive);

        const header = document.createElement("header");
        header.className = "perk-card-top has-perk-info";
        const icon = createPerkEmblem(perk);
        const title = document.createElement("div");
        title.className = "perk-card-title";
        appendText(title, "strong", "", perk.name || id);
        appendText(title, "small", "", perkTypeLabel(perk, role));
        const status = appendText(document.createElement("span"), "i", "", statusText);
        status.parentElement.className = "perk-status-pill";
        const infoButton = document.createElement("button");
        infoButton.type = "button";
        infoButton.className = "perk-info-btn";
        infoButton.dataset.perkInfo = id;
        infoButton.dataset.perkRole = role;
        infoButton.setAttribute("aria-label", `View ${perk.name || id} perk details`);
        infoButton.textContent = "View More Details";
        const headerActions = document.createElement("div");
        headerActions.className = "perk-card-actions";
        headerActions.append(status.parentElement, infoButton);
        header.append(icon, title, headerActions);

        const body = document.createElement("div");
        body.className = "perk-card-body";
        const description = document.createElement("section");
        description.className = "perk-card-description";
        appendText(description, "b", "", "What it does");
        appendText(description, "p", "perk-summary", perkCardDescription(perk));

        const upgrades = document.createElement("div");
        upgrades.className = "perk-card-upgrades";
        upgrades.appendChild(createPerkUpgradePanel({
          title: level > 0 ? (maxed ? "Max Level" : "Current tier") : "Unlocks tier 1",
          copy: currentEffectText,
          tone: level > 0 ? "current" : "locked"
        }));
        if (nextEffectText) {
          upgrades.appendChild(createPerkUpgradePanel({
            title: level + 1 >= maxLevel ? "Next: Max Level" : `Next: Tier ${level + 1}`,
            copy: nextEffectText,
            tone: "next"
          }));
        }
        body.append(description, upgrades);

        const footer = document.createElement("footer");
        footer.className = "perk-card-footer";
        footer.append(createPerkLevelMeter(level, maxLevel), createPerkActionButton(perk, role, level, maxLevel, nextCost, maxed));

        card.append(header, body, footer);
        mount.appendChild(card);
      }
    }
  }

  if (typeof window !== "undefined") {
    window.RiftRunnerRenderPerkShop = renderPerkShop;
  }

  async function buyPerk(perkId, role = "survivor") {
    const id = String(perkId || "");
    const roleKey = normalizePerkRole(role || "survivor");
    if (!id) return false;
    if (!currentAccount || !authToken) {
      toast("Login or Play as Guest first to unlock perks.", 2600);
      return false;
    }
    const perk = publicPerkById(id, roleKey);
    const level = accountPerkLevel(id, roleKey);
    const cost = perkNextCost(perk, level);
    if ((currentAccount.orbBalance || 0) < cost) {
      toast(`Need ${cost} deposited orbs for ${perk?.name || "that perk"}.`, 2600);
      return false;
    }
    const payload = await authFetch("/api/perks/buy", { method: "POST", body: JSON.stringify({ perkId: id }) });
    applyAccountPayload(payload);
    socket?.emit("refreshAccount", { token: authToken || "" });
    const nextLevel = payload.perk?.level || Math.min(level + 1, perkMaxLevel(perk));
    toast(`${level <= 0 ? "Unlocked" : "Upgraded"} ${perk?.name || "perk"} to level ${nextLevel}.`, 1900);
    if (document.getElementById("perkInfoModal")?.classList?.contains("is-open")) {
      openPerkInfoModal(id, roleKey);
    }
    return true;
  }

  async function buyPerkFromButton(button) {
    const perkId = String(button?.dataset?.perkBuy || "");
    const role = normalizePerkRole(button?.dataset?.perkRole || "survivor");
    return buyPerk(perkId, role);
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

      for (const track of ["account", "runner", "void"]) {
        const item = accountProgressionTrack(track);
        const levelNodes = panel.querySelectorAll(`[data-account-level="${track}"]`);
        const xpNodes = panel.querySelectorAll(`[data-account-xp="${track}"]`);
        const progressNodes = panel.querySelectorAll(`[data-account-progress="${track}"]`);
        for (const node of levelNodes) node.textContent = String(item.level);
        for (const node of xpNodes) node.textContent = progressionXpLabel(track);
        for (const node of progressNodes) {
          node.style.setProperty("--account-level-progress", String(item.progress));
          node.title = progressionXpLabel(track);
        }
      }

      form?.classList.toggle("hidden", !!currentAccount);
      actions?.classList.toggle("hidden", !currentAccount);
      if (hint) {
        const accountTrack = accountProgressionTrack("account");
        hint.textContent = currentAccount
          ? `${lifetime} lifetime deposited orbs · Rift Level ${accountTrack.level}.`
          : "Login or Play as Guest to save orbs and XP.";
      }
    }

    // Backward-compatible fallback for any older DOM copy that does not have data attributes.
    const fallbackNames = [document.getElementById("authStatusName"), document.getElementById("compactAuthStatusName")].filter(Boolean);
    for (const el of fallbackNames) el.textContent = accountDisplayName();

    document.body.classList.toggle("has-riftrunner-account", !!currentAccount);
    syncRunnerClassUi();
    refreshSkinLockUi();
    renderPerkShop();
  }

  function syncLocalActorPerksFromAccount() {
    if (!myId || !currentAccount?.perks || !currentSnapshot?.actors) return;
    const localActor = currentSnapshot.actors.find((actor) => actor?.id === myId);
    if (localActor && (localActor.role === "killer" || localActor.role === "survivor")) {
      localActor.perkLevels = currentAccount.perks;
      if (localActor.role === "survivor") {
        localActor.runnerClass = normalizeRunnerClassId(currentAccount.selectedRunnerClass || selectedRunnerClass);
        localActor.runnerLevel = currentAccount.runnerLevel || currentAccount.progression?.runner?.level || localActor.runnerLevel || 1;
      }
    }
  }

  function applyAccountPayload(payload = {}) {
    if (Array.isArray(payload.skins)) shopSkins = payload.skins;
    if (Array.isArray(payload.perks)) shopPerks = payload.perks;
    if (payload.account?.selectedRunnerClass) selectedRunnerClass = normalizeRunnerClassId(payload.account.selectedRunnerClass);
    currentAccount = payload.account || null;
    syncLocalActorPerksFromAccount();
    syncAccountUi();

    const progression = payload.reward?.progression || null;
    if (progression?.score > 0) {
      const parts = [];
      if (progression.accountXp > 0) parts.push(`+${formatWholeNumber(progression.accountXp)} Rift XP`);
      if (progression.roleXp > 0) parts.push(`+${formatWholeNumber(progression.roleXp)} ${progression.role === "void" ? "Void" : "Runner"} XP`);
      const levelReward = Math.max(0, Math.floor(Number(progression.levelRewardOrbs || 0)));
      if (levelReward > 0) parts.push(`+${formatWholeNumber(levelReward)} level orbs`);
      if (parts.length) toast(parts.join(" · "), 3200);
    } else if (payload.reward?.orbsDeposited) {
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
      if (Array.isArray(shop.perks)) shopPerks = shop.perks;
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
      toast("Login or Play as Guest first to buy skins.", 2600);
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
    const tankLobby = currentLobbyState?.mode === "tanks";
    const showRunner = tankLobby || role === "survivor" || role === "ffa";
    const showVoid = !tankLobby && role === "killer";
    const showClasses = !tankLobby && role === "survivor";
    ui.lobbySkinPicker?.classList.toggle("hidden", !showRunner);
    ui.lobbySkinPicker?.setAttribute("aria-hidden", showRunner ? "false" : "true");
    ui.voidLobbySkinPicker?.classList.toggle("hidden", !showVoid);
    ui.voidLobbySkinPicker?.setAttribute("aria-hidden", showVoid ? "false" : "true");
    ui.runnerClassPanel?.classList.toggle("hidden", !showClasses);
    ui.runnerClassPanel?.setAttribute("aria-hidden", showClasses ? "false" : "true");
    syncRunnerClassUi();
  }

  function syncLobbyRoleButtons(role = selectedRole) {
    const lobbyRole = role === "spectator" ? "spectator" : role === "killer" ? "killer" : role === "ffa" ? "ffa" : "survivor";
    ui.beKillerBtn?.classList.toggle("selected", lobbyRole === "killer");
    ui.beSurvivorBtn?.classList.toggle("selected", lobbyRole === "survivor");
    ui.beFfaBtn?.classList.toggle("selected", lobbyRole === "ffa");
    ui.beSpectatorBtn?.classList.toggle("selected", lobbyRole === "spectator");
    setLobbySkinPickerVisibility(lobbyRole);
    if (ui.lobbyRoleMark) {
      ui.lobbyRoleMark.classList.toggle("killer", lobbyRole === "killer");
      ui.lobbyRoleMark.classList.toggle("survivor", lobbyRole === "survivor" || lobbyRole === "ffa");
      ui.lobbyRoleMark.classList.toggle("spectator", lobbyRole === "spectator");
      ui.lobbyRoleMark.setAttribute("aria-label", lobbyRole === "killer" ? "Playing as The Void" : lobbyRole === "spectator" ? "Joining as Spectator" : lobbyRole === "ffa" ? "Playing Free-For-All" : "Playing as Runner");
    }
  }

  function setSelectedRole(role) {
    selectedRole = role === "killer" ? "killer" : role === "ffa" ? "ffa" : "survivor";
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

  let menuPageTransitionTimer = 0;

  function prefersReducedPageMotion() {
    return typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function getMenuScreenElements() {
    return {
      menu: ui.menu,
      play: ui.playScreen,
      skins: ui.skinScreen,
      perks: ui.perksScreen,
      options: ui.optionsScreen,
      how: ui.howScreen,
      lobby: ui.lobbyScreen,
      end: ui.endScreen
    };
  }

  function clearMenuPageTransitions() {
    if (menuPageTransitionTimer) {
      clearTimeout(menuPageTransitionTimer);
      menuPageTransitionTimer = 0;
    }

    for (const screen of Object.values(getMenuScreenElements())) {
      screen?.classList.remove("screen-transition-in", "screen-transition-out");
    }
  }

  function applyMenuScreenVisibility(name, isGameScreen) {
    const screens = getMenuScreenElements();
    const nextElement = screens[name];
    const openScreens = Object.values(screens).filter((screen) => screen?.classList.contains("screen-open"));
    const shouldTransition = !isGameScreen
      && !prefersReducedPageMotion()
      && nextElement
      && openScreens.some((screen) => screen !== nextElement);

    clearMenuPageTransitions();

    for (const screen of Object.values(screens)) {
      if (!screen || screen === nextElement) continue;

      if (shouldTransition && screen.classList.contains("screen-open")) {
        screen.classList.remove("screen-open", "screen-transition-in");
        screen.classList.add("screen-transition-out");
      } else {
        screen.classList.remove("screen-open", "screen-transition-in", "screen-transition-out");
      }
    }

    if (nextElement) {
      nextElement.classList.remove("screen-transition-out");
      if (shouldTransition) nextElement.classList.add("screen-transition-in");
      nextElement.classList.add("screen-open");

      if (shouldTransition) {
        requestAnimationFrame(() => {
          nextElement.classList.remove("screen-transition-in");
        });
      }
    }

    if (shouldTransition) {
      menuPageTransitionTimer = setTimeout(() => {
        for (const screen of Object.values(screens)) screen?.classList.remove("screen-transition-out");
        menuPageTransitionTimer = 0;
      }, 260);
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

    const activeTankMode = isGameScreen && isTanksSnapshot(currentSnapshot);
    document.body.classList.toggle("is-game-screen", isGameScreen);
    document.body.classList.toggle("is-menu-screen", menuLike);
    document.body.classList.toggle("is-tank-mode", activeTankMode);
    setGameplayAudioActive(isGameScreen);
    setMenuAudioActive(menuLike, { restart: shouldRestartMenuMusic });
    applyMenuScreenVisibility(name, isGameScreen);
    ui.hud.classList.toggle("hidden", name !== "game" || activeTankMode);
    ui.survivorStatusHud?.classList.toggle("hidden", name !== "game" || activeTankMode);
    ui.bigGenCounter?.classList.toggle("hidden", name !== "game" || activeTankMode);
    ui.horrorFx?.classList.toggle("hidden", name !== "game" || activeTankMode);
    if (name !== "game" || activeTankMode) {
      clearTimeout(survivorHitImpactTimer);
      resetHorrorFxVisualState();
      dispatchHookIndicators([]);
      phaserScene?.resetArenaFloorVisuals?.();
    }
    if (name !== "game") {
      window.dispatchEvent(new CustomEvent("riftrunner:tank-hud", { detail: { visible: false } }));
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
    return String(currentAccount?.displayName || currentAccount?.username || "Player").trim().slice(0, 18) || "Player";
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
      <div class="match-announcement-sheen" aria-hidden="true"></div>
      <div class="match-announcement-rune" aria-hidden="true">
        <span class="match-announcement-rune-core"></span>
        <span class="match-announcement-rune-ring match-announcement-rune-ring-a"></span>
        <span class="match-announcement-rune-ring match-announcement-rune-ring-b"></span>
      </div>
      <div class="match-announcement-copy">
        <strong>${escapeHtml(title)}</strong>
        ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
      </div>
      <div class="match-announcement-bottom-line" aria-hidden="true"></div>
    `;
    root.appendChild(card);
    window.setTimeout(() => card.classList.add("leaving"), ANNOUNCEMENT_LIFETIME_MS - 520);
    window.setTimeout(() => card.remove(), ANNOUNCEMENT_LIFETIME_MS);
  }

  const seenMatchAnnouncementKeys = new Map();
  const MATCH_ANNOUNCEMENT_DEDUPE_MS = 4500;

  function pruneMatchAnnouncementKeys(now = performance.now()) {
    for (const [key, until] of seenMatchAnnouncementKeys) {
      if (until <= now) seenMatchAnnouncementKeys.delete(key);
    }
  }

  function markMatchAnnouncementKey(key) {
    if (!key) return false;
    const now = performance.now();
    pruneMatchAnnouncementKeys(now);
    if ((seenMatchAnnouncementKeys.get(key) || 0) > now) return false;
    seenMatchAnnouncementKeys.set(key, now + MATCH_ANNOUNCEMENT_DEDUPE_MS);
    return true;
  }

  function boundAnnouncementKey(survivorId, hookCount = 0) {
    return `bound:${survivorId || "unknown"}:${Number(hookCount || 0) || 0}`;
  }

  function pushBoundAnnouncement(survivorId, hookCount = 0) {
    if (!survivorId || survivorId === myId) return;
    if (!markMatchAnnouncementKey(boundAnnouncementKey(survivorId, hookCount))) return;
    const name = actorNameFromSnapshot(survivorId, "A Runner");
    pushMatchAnnouncement({
      kind: "hook",
      title: `${name} was bound`,
      detail: "They need a rescue."
    });
  }

  function announceMatchEvent(event) {
    if (!event || !event.type) return;

    if (event.type === "ffaKill") {
      const title = event.text || `${actorNameFromSnapshot(event.killerId, "Someone")} shot down ${actorNameFromSnapshot(event.survivorId, "someone")}`;
      if (!markMatchAnnouncementKey(`ffaKill:${event.killerId || "?"}:${event.survivorId || "?"}:${event.createdAt || "?"}`)) return;
      pushMatchAnnouncement({
        kind: "death",
        title,
        detail: `${event.killerKills || 0} / ${event.killLimit || 10} kills`
      });
      return;
    }

    if (event.type === "hooked") {
      pushBoundAnnouncement(event.survivorId, event.hookCount || 0);
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

  function isFfaSnapshot(snapshot = currentSnapshot) {
    return snapshot?.mode === "ffa" || snapshot?.objective?.mode === "ffa";
  }

  function isFfaActor(actor = getLocalPlayerData()) {
    return !!(actor && actor.role === "survivor" && (actor.gameMode === "ffa" || actor.lobbyRole === "ffa" || isFfaSnapshot()));
  }

  function isTanksActor(actor = getLocalPlayerData()) {
    return !!(actor && isTanksSnapshot());
  }

  function isTanksSnapshot(snapshot = currentSnapshot) {
    return !!(snapshot && (snapshot.mode === "tanks" || snapshot.objective?.mode === "tanks"));
  }

  function ffaVoidShooterAbility(actor = getLocalPlayerData()) {
    const cooldownRemaining = Math.max(0, Number(actor?.ffaShotCooldownRemaining || 0));
    return {
      id: "voidShooter",
      name: "Void Shot",
      shortName: "M1 Shot",
      cost: 0,
      summary: "Shoots one clean projectile. No splash. No mercy. Humans demanded this.",
      accent: "orange",
      cancel: false,
      disabled: false,
      passive: false,
      cooldown: 1,
      cooldownRemaining,
      ammo: null,
      maxAmmo: null,
      reloadRemaining: 0,
      fireLockoutRemaining: cooldownRemaining,
      available: cooldownRemaining <= 0,
      locked: false,
      level: 1,
      maxLevel: 1,
      duration: 0,
      inputType: "m1",
      shootAbility: true,
      testMode: false,
      testLevel: 0,
      active: false
    };
  }

  function runnerShootAbilityForActor(actor = getLocalPlayerData()) {
    if (!actor || actor.role !== "survivor" || actor.dead || actor.escaped || actor.hooked || actor.downed) return null;
    if (isTanksActor(actor)) return ffaVoidShooterAbility(actor);
    if (isFfaActor(actor)) return ffaVoidShooterAbility(actor);
    return getAbilityListForActor(actor).find((ability) => ability
      && ability.shootAbility
      // Intentionally do NOT require ability.available here.
      // When ammo is 0, the server still needs to receive the fire attempt so it can
      // create the same under-player chat bubble used by the chat wheel.
      && !ability.locked
      && !ability.disabled
      && !ability.passive
    ) || null;
  }

  function tryFireRunnerShootAbilityFromPointer(pointer, scene = phaserScene) {
    const me = getLocalPlayerData();
    if (!socket || !pointer || !scene || currentSnapshot?.phase !== "game") return false;
    const ability = runnerShootAbilityForActor(me);
    if (!ability) return false;
    const cam = scene.cameras?.main;
    const worldPoint = cam?.getWorldPoint
      ? cam.getWorldPoint(pointer.x, pointer.y)
      : { x: pointer.worldX, y: pointer.worldY };
    const targetX = Number(worldPoint?.x);
    const targetY = Number(worldPoint?.y);
    const hasTarget = Number.isFinite(targetX) && Number.isFinite(targetY);
    const angle = hasTarget
      ? Math.atan2(targetY - me.y, targetX - me.x)
      : input.angle;
    if (isTanksActor(me)) socket.emit("tankShoot", hasTarget ? { angle, targetX, targetY } : { angle });
    else if (isFfaActor(me)) socket.emit("ffaShoot", hasTarget ? { angle, targetX, targetY } : { angle });
    else socket.emit("runnerShootAbilityFire", hasTarget ? { id: ability.id, angle, targetX, targetY } : { id: ability.id, angle });
    return true;
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


  function configuredAbilityForActor(id, defs, actor, role) {
    const fallbackName = role === "survivor" ? "Runner Ability" : "Void Ability";
    const base = defs[id] || { id, name: fallbackName, shortName: "Ability", cost: 0, summary: "Spend orbs to bend the run.", cooldown: role === "survivor" ? 30 : 20 };
    const isCancel = !!base.cancel || id === "cancel" || id === "moreSoon";
    if (isCancel) return { ...base, cancel: true, locked: false, level: 0, maxLevel: 1 };
    if (base.disabled || base.passive) {
      return {
        ...base,
        disabled: true,
        passive: !!base.passive,
        locked: false,
        level: 0,
        maxLevel: 1,
        cost: 0,
        cooldown: 0,
        summary: base.summary || "Passive class bonus. No button press needed."
      };
    }

    const roleKey = normalizePerkRole(role);
    const testLevel = abilityTestingLevel(actor);
    const testingAbilities = testLevel > 0;

    if (roleKey === "survivor" && base.classAbility) {
      const perk = perkConfigById(base.id || id, roleKey) || publicPerkById(base.id || id, roleKey);
      const fallbackEffect = runnerClassAbilityLevelConfig(base, actor);
      const fallbackLevel = Math.max(1, Math.floor(Number(fallbackEffect?.level || 1)));
      const perkLevel = perk ? actorPerkLevel(actor, base.id || id, roleKey) : 0;
      const maxLevel = perk ? perkMaxLevel(perk) : Math.max(1, Array.isArray(base.levels) ? base.levels.length : 1);
      const forcedLevel = testingAbilities ? Math.min(maxLevel, testLevel) : 0;
      const level = forcedLevel || Math.max(1, Math.min(maxLevel, Math.floor(Number(perkLevel || fallbackLevel || 1))));
      const locked = false;
      const effect = perk
        ? (perkLevelConfig(perk, level) || fallbackEffect || perkLevelConfig(perk, 1))
        : fallbackEffect;
      const duration = Number(effect?.duration ?? effect?.boostDuration ?? base.duration ?? 0);
      const abilityCost = abilityCostForDisplay(base, effect, effect?.cost ?? perk?.abilityCost ?? base.cost ?? 0, testingAbilities);
      const cooldown = testingAbilities ? 0 : shortenedAbilityCooldown(effect?.cooldown ?? perk?.cooldown ?? base.cooldown ?? 30);
      const stat = locked ? "unlock in Perks"
        : effect?.label ? String(effect.label)
          : effect?.chance ? `${Math.round(Number(effect.chance) * 100)}% proc`
            : effect?.speedMultiplier ? `${Number(effect.speedMultiplier).toFixed(1)}x speed`
              : effect?.healProgress ? `${Math.round(Number(effect.healProgress) * 100)}% heal`
                : effect?.radius ? `${perkRadiusWord(effect.radius) || "Medium"} radius`
                  : duration ? formatSeconds(duration)
                    : "class ability";
      const levelLabel = locked ? "Locked" : `Lv ${level}/${maxLevel}`;
      return {
        ...base,
        ...(effect || {}),
        cost: abilityCost,
        cooldown,
        duration,
        level,
        maxLevel,
        locked,
        testMode: testingAbilities,
        testLevel,
        summary: `${testingAbilities ? `TEST LV ${testLevel} · ` : ""}${levelLabel} · ${stat}. ${perk?.summary || base.summary || "Class ability."}`
      };
    }

    const perk = perkConfigById(base.id || id, roleKey) || publicPerkById(base.id || id, roleKey);
    const level = actorPerkLevel(actor, base.id || id, roleKey);
    const maxLevel = perkMaxLevel(perk || {});
    const effect = level > 0 ? perkLevelConfig(perk, level) : null;
    const duration = Number(effect?.duration ?? base.duration ?? 0);
    const abilityCost = abilityCostForDisplay(base, effect, perk?.abilityCost ?? base.cost ?? 0, testingAbilities);
    const cooldown = testingAbilities ? 0 : shortenedAbilityCooldown(perk?.cooldown ?? base.cooldown ?? (role === "survivor" ? 30 : 20));
    const classGranted = roleKey === "survivor" && classGrantedPerkLevel(actor, base.id || id) > 0;
    const levelLabel = level > 0
      ? `${classGranted ? "Class" : "Lv"} ${level}/${maxLevel} · ${formatSeconds(duration)}`
      : "Locked · buy in Perks";
    return {
      ...base,
      cost: abilityCost,
      cooldown,
      duration,
      level,
      maxLevel,
      locked: !testingAbilities && level <= 0,
      testMode: testingAbilities,
      testLevel,
      summary: `${testingAbilities ? `TEST LV ${testLevel} · ` : ""}${levelLabel}. ${perk?.summary || base.summary || "Spend orbs to bend the run."}`
    };
  }

  function normalizeAbilityList(order, defs, actor, role) {
    const orbs = Math.max(0, Math.floor(actor?.dots || 0));
    const testLevel = abilityTestingLevel(actor);
    const testingAbilities = testLevel > 0;
    return order.slice(0, 4).map((id) => {
      const fallbackName = role === "survivor" ? "Runner Ability" : "Void Ability";
      const ability = configuredAbilityForActor(id, defs, actor, role);
      const isCancel = !!ability.cancel || id === "cancel" || id === "moreSoon";
      const disabled = !!ability.disabled || !!ability.passive;
      const cooldowns = role === "survivor" ? actor?.survivorAbilityCooldowns : actor?.voidAbilityCooldowns;
      const isShoot = role === "survivor" && isDartAbility(ability);
      const dartAmmo = Math.max(0, Math.floor(Number(actor?.runnerDartAmmo || 0)));
      const dartMaxAmmo = Math.max(1, Math.floor(Number(actor?.runnerDartMaxAmmo || 3)));
      const dartFireLockoutRemaining = Math.max(0, Number(actor?.runnerDartFireLockoutRemaining || actor?.runnerDartReloadRemaining || 0));
      const cooldownRemaining = (isCancel || disabled || testingAbilities)
        ? 0
        : isShoot
          ? dartFireLockoutRemaining
          : Math.max(0, Number(cooldowns?.[ability.id || id] || 0));
      const active = !!(actor && !isCancel && (
        (role === "killer" && ability.id === "nullRush" && (actor.voidSpeedBoost || 0) > 0) ||
        (role === "killer" && ability.id === "redshiftOrbs" && (currentSnapshot?.voidEffects?.redOrbs || 0) > 0) ||
        (role === "killer" && ability.id === "voidReveal" && (currentSnapshot?.voidEffects?.runnerReveal || 0) > 0) ||
        (role === "survivor" && ability.id === "riftLens" && (actor.riftLens || 0) > 0) ||
        (role === "survivor" && ability.id === "hourglass" && (actor.hourglass || 0) > 0) ||
        (role === "survivor" && ability.id === "speedBurst" && (actor.speedBurst || 0) > 0) ||
        (role === "survivor" && ability.id === "doubleOrb" && (actor.doubleOrb || 0) > 0) ||
        (role === "survivor" && ability.id === "swiftVault" && (actor.swiftVaultReady || 0) > 0) ||
        (role === "survivor" && ability.id === "dashDart" && (actor.dashBoost || 0) > 0)
      ));
      return {
        id: ability.id || id,
        name: ability.name || (isCancel ? "Cancel" : fallbackName),
        shortName: ability.shortName || ability.name || (isCancel ? "Cancel" : "Ability"),
        cost: isShoot ? 0 : Number(ability.cost || 0),
        summary: ability.summary || (isCancel ? "Close the wheel." : isShoot ? "Uses dart ammo instead of orbs." : "Spend orbs to bend the run."),
        accent: ability.accent || (isCancel ? "muted" : role === "survivor" ? "cyan" : "purple"),
        cancel: isCancel,
        disabled,
        passive: !!ability.passive,
        cooldown: Number(ability.cooldown || (role === "survivor" ? 30 : 20)),
        cooldownRemaining,
        ammo: isShoot ? dartAmmo : null,
        maxAmmo: isShoot ? dartMaxAmmo : null,
        reloadRemaining: 0,
        fireLockoutRemaining: isShoot ? dartFireLockoutRemaining : 0,
        available: isCancel || (!disabled && !ability.locked && (isShoot ? dartAmmo > 0 : orbs >= Number(ability.cost || 0)) && cooldownRemaining <= 0),
        locked: !!ability.locked,
        level: Math.max(0, Math.floor(Number(ability.level || 0))),
        maxLevel: Math.max(1, Math.floor(Number(ability.maxLevel || 4))),
        duration: Number(ability.duration || 0),
        inputType: ability.inputType || (ability.shootAbility ? "m1" : "q"),
        shootAbility: !!ability.shootAbility,
        testMode: testingAbilities && !isCancel && !disabled,
        testLevel,
        active
      };
    });
  }

  function getAbilityListForActor(actor = getLocalPlayerData()) {
    if (isTanksActor(actor)) return [ffaVoidShooterAbility(actor)];
    if (isFfaActor(actor)) return [ffaVoidShooterAbility(actor)];
    if (actor?.role === "survivor") return normalizeAbilityList(runnerClassWheelOrder(actor), SURVIVOR_ABILITIES, actor, "survivor");
    return normalizeAbilityList(VOID_ABILITY_ORDER, VOID_ABILITIES, actor, "killer");
  }

  function getAbilityWheelDetail(pointerEvent = null) {
    const me = getLocalPlayerData();
    const role = me?.role === "survivor" ? "survivor" : "killer";
    return {
      role,
      title: isFfaActor(me) ? "Void Shooter" : role === "survivor" ? "Runner abilities" : "Void abilities",
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

  function getQuickQAbilities(actor = getLocalPlayerData()) {
    return getAbilityListForActor(actor).filter((ability) => {
      if (!ability || ability.cancel || ability.passive || ability.disabled) return false;
      if (ability.inputType === "m1" || ability.shootAbility) return false;
      return ability.id !== "moreSoon";
    }).slice(0, QUICK_Q_ABILITY_SLOTS);
  }

  function triggerQuickQAbility(slotIndex) {
    const me = getLocalPlayerData();
    const ability = getQuickQAbilities(me)[slotIndex];
    if (!ability) return false;
    sendAbilitySelection({ id: ability.id });
    return true;
  }

  function sendAbilitySelection(selection) {
    let abilityId = String(selection?.id || selection || "");
    const me = getLocalPlayerData();
    if (Number.isInteger(selection?.index)) {
      abilityId = getAbilityListForActor(me)[selection.index]?.id || "";
    }
    const ability = getAbilityListForActor(me).find((item) => item.id === abilityId);
    if (!abilityId || abilityId === "cancel" || abilityId === "moreSoon" || ability?.disabled || ability?.passive || ability?.available === false || !socket || currentSnapshot?.phase !== "game") return;
    if (ability?.inputType === "m1" || ability?.shootAbility) {
      toast(`${ability.name || "Ability"} fires with M1 when ready.`, 1700);
      return;
    }
    if (me?.role === "survivor") socket.emit("survivorAbility", { id: abilityId });
    else if (me?.role === "killer") socket.emit("voidAbility", { id: abilityId });
  }

  function setupReactAbilityWheelBridge() {
    window.addEventListener("riftrunner:ability-submit", (event) => {
      sendAbilitySelection(event.detail || {});
    });
  }

  function dispatchAbilityHuds(snapshot = currentSnapshot) {
    const tankMode = isTanksSnapshot(snapshot);
    if (!snapshot || tankMode) {
      window.dispatchEvent(new CustomEvent("riftrunner:void-ability-hud", { detail: { visible: false, orbs: 0, effects: [], abilities: [] } }));
      window.dispatchEvent(new CustomEvent("riftrunner:runner-ability-hud", { detail: { visible: false, orbs: 0, effects: [], abilities: [] } }));
      if (tankMode && reactAbilityWheelOpen) closeReactAbilityWheel(false);
      return;
    }

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
        effects: voidEffects,
        abilities: isVoid ? getAbilityListForActor(me).filter((ability) => ability && !ability.cancel && !ability.passive && !ability.disabled) : []
      }
    }));

    const runnerEffects = [];
    if (isRunner && (me.riftLens || 0) > 0) runnerEffects.push({ id: "riftLens", label: "lens", time: me.riftLens });
    if (isRunner && (me.hourglass || 0) > 0) runnerEffects.push({ id: "hourglass", label: "hourglass", time: me.hourglass });
    if (isRunner && (me.speedBurst || 0) > 0) runnerEffects.push({ id: "speedBurst", label: "burst", time: me.speedBurst });
    if (isRunner && (me.doubleOrb || 0) > 0) runnerEffects.push({ id: "doubleOrb", label: "double orb", time: me.doubleOrb });
    if (isRunner && (me.swiftVaultReady || 0) > 0) runnerEffects.push({ id: "swiftVault", label: "swift vault", time: me.swiftVaultReady });
    if (isRunner && (me.dashBoost || 0) > 0) runnerEffects.push({ id: "dashBoost", label: "dash boost", time: me.dashBoost });
    if (isRunner && (me.nebulizerVaporTrail || 0) > 0) runnerEffects.push({ id: "vaporTrail", label: "vapor trail", time: me.nebulizerVaporTrail });
    window.dispatchEvent(new CustomEvent("riftrunner:runner-ability-hud", {
      detail: {
        visible: isRunner,
        orbs: isRunner && !isFfaActor(me) ? Math.max(0, Math.floor(me.dots || 0)) : 0,
        dartAmmo: isRunner && !isFfaActor(me) ? Math.max(0, Math.floor(me.runnerDartAmmo || 0)) : 0,
        dartMaxAmmo: isRunner && !isFfaActor(me) ? Math.max(1, Math.floor(me.runnerDartMaxAmmo || 3)) : 0,
        dartReloadRemaining: 0,
        dartFireLockoutRemaining: isRunner ? Math.max(0, Number(isFfaActor(me) ? me.ffaShotCooldownRemaining : me.runnerDartFireLockoutRemaining || 0)) : 0,
        effects: runnerEffects,
        abilities: isRunner ? getAbilityListForActor(me).filter((ability) => ability && !ability.cancel && !ability.passive && !ability.disabled) : []
      }
    }));

    if (reactAbilityWheelOpen && (isVoid || isRunner)) {
      dispatchAbilityWheelEvent("riftrunner:ability-update", {
        role: me.role === "survivor" ? "survivor" : "killer",
        title: isFfaActor(me) ? "Void Shooter" : me.role === "survivor" ? "Runner abilities" : "Void abilities",
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
    // Throttle mouse-angle packets so the socket stays stable.
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
    if (!hasManagedAudioSource(base)) {
      const fallbackName = options.fallbackName && options.fallbackName !== name ? String(options.fallbackName) : "";
      if (base?._voidriftPending && !base._voidriftMissing && options.retryWhenReady !== false) {
        const requestedAt = performance.now();
        base._voidriftPending.finally(() => {
          // SFX should feel immediate. A short retry catches sounds that are still
          // resolving from disk/network without playing ancient delayed footsteps later.
          if (performance.now() - requestedAt > 900) return;
          if (hasManagedAudioSource(base)) {
            playSfx(name, { ...options, retryWhenReady: false, fallbackName: "" });
          } else if (fallbackName) {
            playSfx(fallbackName, { ...options, retryWhenReady: false, fallbackName: "" });
          }
        });
      } else if (fallbackName) {
        playSfx(fallbackName, { ...options, retryWhenReady: false, fallbackName: "" });
      }
      return;
    }
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

    const volumeScale = Number.isFinite(Number(options.volumeScale)) ? clamp(Number(options.volumeScale), 0, 1.5) : 1;
    clip.volume = clamp((SFX.VOLUMES[name] || 0.75) * SFX.MASTER * volumeScale, 0, 1);
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

    const dartBoxRange = Math.max(range, Number(LOCAL_SFX_RANGE?.dartBoxCollect) || 420);
    for (const actor of actors) {
      if (!actor || actor.role !== "survivor" || !(actor.dartBoxProgress > 0.001) || !actor.dartBoxTargetId) continue;
      const linked = actor.id === localId || localData.dartBoxTargetId === actor.dartBoxTargetId;
      const d = Number.isFinite(lx) && Number.isFinite(ly) ? dist(lx, ly, actor.x || 0, actor.y || 0) : Infinity;
      const audible = linked || d <= dartBoxRange;
      if (!audible) continue;
      if (!best.active || best.healerCount <= 0 || d < best.distance) {
        best = { active: true, healerCount: 1, distance: d, linked };
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

  function localEventHasWallLineOfSight(event) {
    const me = getLocalVisualActor();
    const x = Number(event?.x);
    const y = Number(event?.y);
    if (!me?.current || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const scene = phaserScene;
    if (!scene || typeof scene.hasClearWallLineOfSight !== "function") return true;
    return scene.hasClearWallLineOfSight(me.current.x, me.current.y, x, y);
  }

  function distanceVolumeScale(distance, range, minScale = 0.18) {
    const d = Number(distance);
    const r = Number(range);
    const floor = clamp(Number(minScale), 0, 1);
    if (!Number.isFinite(d)) return floor;
    if (!Number.isFinite(r) || r <= 0) return 1;
    const t = clamp(1 - d / r, 0, 1);
    return clamp(floor + (1 - floor) * Math.pow(t, 1.18), floor, 1);
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

  const DASH_SFX_ABILITY_IDS = new Set(["nullRush", "speedBurst"]);
  const recentDashSfx = new Map();

  function dashSfxActorId(event) {
    return String(event?.actorId || event?.survivorId || event?.killerId || "");
  }

  function dashSfxAbilityId(event) {
    const abilityId = String(event?.abilityId || "");
    return DASH_SFX_ABILITY_IDS.has(abilityId) ? abilityId : "";
  }

  function shouldSkipDuplicateDashSfx(actorId, abilityId, windowMs = 320) {
    if (!actorId || !abilityId) return false;
    const key = `${actorId}:${abilityId}`;
    const now = performance.now();
    const last = Number(recentDashSfx.get(key) || 0);
    recentDashSfx.set(key, now);
    return now - last < windowMs;
  }

  function playLocalizedDashAbilitySfx(event) {
    if (!event) return;
    const abilityId = dashSfxAbilityId(event);
    if (!abilityId) return;
    const actorId = dashSfxActorId(event);
    const isDasher = actorId === myId;
    const d = distanceToLocalEvent(event);
    const range = Math.max(180, Number(LOCAL_SFX_RANGE.dash || 900));
    if (!isDasher && d > range) return;
    if (shouldSkipDuplicateDashSfx(actorId, abilityId)) return;
    playSfx("dash", { fallbackName: "speedBoost" });
  }

  function runnerProjectileImpactSfxName(event) {
    const projectileType = String(event?.projectileType || event?.abilityId || "");
    if (projectileType === "boost") return "dash";
    if (projectileType === "heal") return Number(event?.affected || 0) > 0 ? "healDartImpact" : "";
    if (projectileType === "smoke") return "smokeDartImpact";
    if (projectileType === "collect") return "collectMiss";
    return "";
  }

  function playLocalizedRunnerProjectileImpactSfx(event) {
    const sfxName = runnerProjectileImpactSfxName(event);
    if (!sfxName || !event) return;

    const actorId = String(event.actorId || event.survivorId || "runnerProjectile");
    const d = distanceToLocalEvent(event);
    const range = Math.max(520, Number(LOCAL_SFX_RANGE.runnerProjectileImpact || LOCAL_SFX_RANGE.dash || 900));
    const visibleRange = Math.max(range, Number(LOCAL_SFX_RANGE.runnerProjectileImpactVisible || range * 1.25));
    const isShooter = actorId === String(myId || "");
    const canSeeLanding = d <= visibleRange && localEventHasWallLineOfSight(event);

    if (!isShooter && d > range && !canSeeLanding) return;

    const keyId = `${actorId}:${sfxName}:${event.projectileType || event.abilityId}:${Math.round(Number(event.x) || 0)}:${Math.round(Number(event.y) || 0)}`;
    if (shouldSkipDuplicateDashSfx(keyId, sfxName, 260)) return;

    const minScale = clamp(Number(LOCAL_SFX_RANGE.runnerProjectileImpactMinVolumeScale ?? 0.18), 0.02, 0.65);
    const shooterMinScale = clamp(Number(LOCAL_SFX_RANGE.runnerProjectileImpactShooterMinVolumeScale ?? 0.46), 0.02, 0.85);
    let volumeScale = isShooter
      ? distanceVolumeScale(d, Math.max(range, visibleRange), shooterMinScale)
      : distanceVolumeScale(d, range, minScale);

    if (!isShooter && d > range && canSeeLanding) volumeScale = Math.max(minScale, 0.16);
    playSfx(sfxName, { volumeScale });
  }

  function playLocalizedDartBoxCollectedSfx(event) {
    if (!event) return;
    const actorId = String(event.survivorId || "dartBox");
    const affected = Array.isArray(event.affected) ? event.affected.map(String) : [];
    const isCollector = actorId === String(myId || "");
    const isAffected = affected.includes(String(myId || ""));
    const d = distanceToLocalEvent(event);
    const range = Math.max(520, Number(LOCAL_SFX_RANGE.dartBoxCollected || LOCAL_SFX_RANGE.runnerProjectileImpact || LOCAL_SFX_RANGE.dash || 900));
    const visibleRange = Math.max(range, Number(LOCAL_SFX_RANGE.dartBoxCollectedVisible || LOCAL_SFX_RANGE.runnerProjectileImpactVisible || range * 1.25));
    const canSeeLanding = d <= visibleRange && localEventHasWallLineOfSight(event);
    if (!isCollector && !isAffected && d > range && !canSeeLanding) return;

    const keyId = `${actorId}:dartBoxCollected:${event.boxId || "box"}:${Math.round(Number(event.x) || 0)}:${Math.round(Number(event.y) || 0)}`;
    if (shouldSkipDuplicateDashSfx(keyId, "dartBoxCollected", 260)) return;

    const minScale = clamp(Number(LOCAL_SFX_RANGE.dartBoxCollectedMinVolumeScale ?? LOCAL_SFX_RANGE.runnerProjectileImpactMinVolumeScale ?? 0.18), 0.02, 0.65);
    const linkedMinScale = clamp(Number(LOCAL_SFX_RANGE.dartBoxCollectedShooterMinVolumeScale ?? LOCAL_SFX_RANGE.runnerProjectileImpactShooterMinVolumeScale ?? 0.46), 0.02, 0.85);
    let volumeScale = (isCollector || isAffected)
      ? distanceVolumeScale(d, Math.max(range, visibleRange), linkedMinScale)
      : distanceVolumeScale(d, range, minScale);
    if (!isCollector && !isAffected && d > range && canSeeLanding) volumeScale = Math.max(minScale, 0.16);
    playSfx("collected", { fallbackName: "orbPickup", volumeScale });
  }

  function playShooterOnlyDartSfx(event) {
    if (!event || event.actorId !== myId) return;
    playSfx("shootDart");
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
    if (actor.hooked) return actor.unhookProgress > 0 ? "Being Rescued" : `Bound ${actor.hookCount || 1}/2`;
    if (actor.downed) {
      if (actor.healProgress > 0) return "Being Healed";
      return actor.hookProgress > 0 ? ((actor.hookCount || 0) >= 2 ? "Being Executed" : "Being Bound") : "Downed";
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
    if (actor.hooked) return actor.unhookProgress > 0 ? "rescue" : "bound";
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
    const speedBoost = me?.role === "survivor" && !me.dead && !me.escaped && !me.downed && !me.hooked
      ? ((Number(me.speedBurst || 0) > 0 || Number(me.dashBoost || 0) > 0) ? 1 : 0)
      : 0;
    return { terror, chase, blood, injured, voidStun, speedBoost };
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
    fxState.speedBoost = approachValue(
      fxState.speedBoost,
      raw.speedBoost || 0,
      dt,
      FX_SMOOTHING.SPEED_BOOST_RISE_PER_SECOND,
      FX_SMOOTHING.SPEED_BOOST_FALL_PER_SECOND
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
      fxState.speedBoost.toFixed(2),
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
    ui.horrorFx.style.setProperty("--speed-boost", fxState.speedBoost.toFixed(3));
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
      this.spaceBackdrop = null;
      this.spaceStarsFar = null;
      this.spaceStarsNear = null;
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
      this.smokeGraphics = null;
      this.actors = new Map();
      this.generatorSprites = new Map();
      this.localVisual = null;
      this.localServerTarget = null;
      this.particles = [];
      this.shockwaves = [];
      this.runnerProjectileVisuals = new Map();
      this.smokeCloudVisuals = new Map();
      this.recentRunnerProjectileImpacts = new Map();
      this.dartBoxVisuals = new Map();
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
      this.dartBoxVisuals?.clear();
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
      this.load.image(SPACE_VISUAL.BACKDROP_KEY, SPACE_VISUAL.BACKDROP_FILE);
      // No external rift/generator art is required. The original build tried to load /gen.svg,
      // and Vite helpfully returned index.html when the file was missing, which made Phaser
      // parse HTML as SVG and die with a useless XML error. Humanity marches on.
      // Rifts are drawn with Graphics in drawGenerator(), and create() still builds a small
      // fallback canvas texture for any rare texture lookup that asks for one.
    }

    create() {
      phaserScene = this;
      this.cameras.main.setBackgroundColor("#03040a");
      cameraZoomNow = CAMERA.BASE_ZOOM;
      this.currentCameraZoom = cameraZoomNow;
      this.targetCameraZoom = cameraZoomNow;
      this.cameras.main.setZoom(cameraZoomNow);
      this.createSpaceTextures();
      this.createSpaceBackdrop();
      // No fog RenderTexture anymore. Resize no longer allocates/rebuilds a GPU texture.
      this.grassLayer = null;
      this.worldGraphics = this.add.graphics().setDepth(1);
      this.dynamicGraphics = this.add.graphics().setDepth(3);
      this.generatorGraphics = this.add.graphics().setDepth(3.25);
      this.generatorDepositVisual = new Map();
      this.generatorDepositLastRaw = new Map();
      this.collectibleDotVisuals = new Map();
      this.dartBoxVisuals = new Map();
      this.collectibleDotsAnimating = false;
      this.scratchGraphics = this.add.graphics().setDepth(4);
      // Minimal visibility cone. One small Graphics object.
      // No RenderTexture, no masks, no layered feather pass. Just a cheap "what I can see" hint.
      this.flashlightGlowGraphics = this.add.graphics()
        .setDepth(LIGHTING.FOG_DEPTH - 1)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.chargeGraphics = this.add.graphics().setDepth(21);
      this.swipeGraphics = this.add.graphics().setDepth(22);
      this.smokeGraphics = this.add.graphics().setDepth(17);
      this.particleGraphics = this.add.graphics().setDepth(30);
      this.lastHookIndicatorSignature = "";
      this.swipes = [];
      this.recentHookIndicators = [];
      this.createGeneratorFallbackTexture();
      // Soft cone textures are intentionally not created here; vector alpha + object visibility is much cheaper.
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
          if (tryFireRunnerShootAbilityFromPointer(pointer, this)) {
            input.attackHeld = false;
            sendInput({}, true);
            return;
          }
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
      // No-op kept for old scene lifecycle callers; ground is drawn by the cheap static arena layer.
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

    createSpaceTextures() {
      const makeStarTexture = (key, size, count, color) => {
        if (this.textures.exists(key)) return;
        const tex = this.textures.createCanvas(key, size, size);
        const canvas = tex.getSourceImage();
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, size, size);

        for (let i = 0; i < count; i++) {
          const x = hash2(i * 31 + size, i * 17 + 7) * size;
          const y = hash2(i * 13 + 3, i * 43 + size) * size;
          const radius = 0.7 + hash2(i * 19 + 11, i * 29 + 5) * (key === SPACE_VISUAL.STAR_NEAR_KEY ? 1.8 : 1.1);
          const alpha = 0.28 + hash2(i * 23 + 2, i * 37 + 9) * 0.58;
          ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        tex.refresh();
      };

      makeStarTexture(SPACE_VISUAL.STAR_FAR_KEY, 384, LOW_POWER_MODE ? 46 : 78, [171, 190, 255]);
      makeStarTexture(SPACE_VISUAL.STAR_NEAR_KEY, 512, LOW_POWER_MODE ? 30 : 54, [230, 220, 255]);
    }

    createSpaceBackdrop() {
      const width = Math.max(1, this.scale?.width || window.innerWidth || 1280);
      const height = Math.max(1, this.scale?.height || window.innerHeight || 720);

      if (this.textures.exists(SPACE_VISUAL.BACKDROP_KEY)) {
        this.spaceBackdrop = this.add.tileSprite(0, 0, width, height, SPACE_VISUAL.BACKDROP_KEY)
          .setOrigin(0, 0)
          .setDepth(-70)
          .setAlpha(SPACE_VISUAL.BACKDROP_ALPHA)
          .setTint(0x9d84ff);
      }

      this.spaceStarsFar = this.add.tileSprite(0, 0, width, height, SPACE_VISUAL.STAR_FAR_KEY)
        .setOrigin(0, 0)
        .setDepth(-68)
        .setAlpha(SPACE_VISUAL.STAR_FAR_ALPHA)
        .setBlendMode(Phaser.BlendModes.SCREEN);

      this.spaceStarsNear = this.add.tileSprite(0, 0, width, height, SPACE_VISUAL.STAR_NEAR_KEY)
        .setOrigin(0, 0)
        .setDepth(-66)
        .setAlpha(SPACE_VISUAL.STAR_NEAR_ALPHA)
        .setBlendMode(Phaser.BlendModes.SCREEN);

      this.syncSpaceBackdrop(0);
    }

    syncSpaceBackdrop(time = 0) {
      const cam = this.cameras?.main;
      const view = cam?.worldView;
      if (!cam || !view) return;

      const layers = [this.spaceBackdrop, this.spaceStarsFar, this.spaceStarsNear].filter(Boolean);
      for (const layer of layers) {
        layer.setPosition(view.x, view.y);
        layer.setSize(Math.max(1, view.width), Math.max(1, view.height));
      }

      const zoom = Math.max(0.001, cam.zoom || CAMERA.BASE_ZOOM || 1);
      const baseZoom = Math.max(0.001, CAMERA.BASE_ZOOM || zoom);
      const zoomedIn = zoom > baseZoom + 0.01;
      const zoomParallaxScale = zoomedIn ? SPACE_VISUAL.ZOOMED_IN_PARALLAX_SCALE : 1;
      const zoomTileScale = zoomedIn
        ? Math.max(SPACE_VISUAL.ZOOM_COMPENSATION_MIN, Math.min(1, baseZoom / zoom))
        : 1;
      const cameraCenterX = Number.isFinite(view.centerX) ? view.centerX : cam.scrollX + view.width * 0.5;
      const cameraCenterY = Number.isFinite(view.centerY) ? view.centerY : cam.scrollY + view.height * 0.5;

      for (const layer of layers) {
        layer.tileScaleX = zoomTileScale;
        layer.tileScaleY = zoomTileScale;
      }

      if (this.spaceBackdrop) {
        this.spaceBackdrop.tilePositionX = cameraCenterX * SPACE_VISUAL.BACKDROP_PARALLAX_X * zoomParallaxScale + time * SPACE_VISUAL.BACKDROP_DRIFT_X;
        this.spaceBackdrop.tilePositionY = cameraCenterY * SPACE_VISUAL.BACKDROP_PARALLAX_Y * zoomParallaxScale + time * SPACE_VISUAL.BACKDROP_DRIFT_Y;
      }
      if (this.spaceStarsFar) {
        this.spaceStarsFar.tilePositionX = cameraCenterX * SPACE_VISUAL.STAR_FAR_PARALLAX_X * zoomParallaxScale + time * SPACE_VISUAL.STAR_FAR_DRIFT_X;
        this.spaceStarsFar.tilePositionY = cameraCenterY * SPACE_VISUAL.STAR_FAR_PARALLAX_Y * zoomParallaxScale + time * SPACE_VISUAL.STAR_FAR_DRIFT_Y;
      }
      if (this.spaceStarsNear) {
        this.spaceStarsNear.tilePositionX = cameraCenterX * SPACE_VISUAL.STAR_NEAR_PARALLAX_X * zoomParallaxScale + time * SPACE_VISUAL.STAR_NEAR_DRIFT_X;
        this.spaceStarsNear.tilePositionY = cameraCenterY * SPACE_VISUAL.STAR_NEAR_PARALLAX_Y * zoomParallaxScale + time * SPACE_VISUAL.STAR_NEAR_DRIFT_Y;
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
      this.floorEndgameActive = false;
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
      this.dartBoxVisuals?.clear();
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
    }

    resetArenaFloorVisuals() {
      this.floorEndgameActive = false;
      if (!this.map) return;
      this.rebuildGrassLayer();
      this.needsDynamicRedraw = true;
      this.lastDynamicKey = "";
    }

    rebuildOutOfBoundsBackdrop() {
      if (this.outOfBoundsGraphics) {
        this.outOfBoundsGraphics.destroy();
        this.outOfBoundsGraphics = null;
      }
      if (!this.map) return;

      // Static space coordinate marks around the arena. The moving backdrop is handled
      // by tile sprites; this layer just gives the void outside the map a little scale.
      const pad = 5200;
      const x = -pad;
      const y = -pad;
      const w = this.map.width + pad * 2;
      const h = this.map.height + pad * 2;
      const g = this.add.graphics().setDepth(-20).setScrollFactor(1, 1);
      this.outOfBoundsGraphics = g;
      this.drawStaticArenaGrid(g, x, y, w, h, 384, 0x3b2a74, 0.055);
      this.drawStaticArenaGrid(g, x, y, w, h, 1152, 0x6f58c9, 0.07);

      g.lineStyle(3, 0x8d6dff, 0.11);
      g.strokeRect(-32, -32, this.map.width + 64, this.map.height + 64);
      g.lineStyle(1, 0xd9ccff, 0.14);
      g.strokeRect(-9, -9, this.map.width + 18, this.map.height + 18);
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

    drawFloatingArenaBase(g, endgame = false) {
      if (!g || !this.map) return;
      const w = this.map.width;
      const h = this.map.height;
      const edge = endgame ? 0xff3b6a : 0x9f7cff;
      const inner = endgame ? 0xff9aac : 0x74ddff;

      g.fillStyle(0x000000, SPACE_VISUAL.FLOAT_SHADOW_ALPHA);
      g.fillRoundedRect(-76, 54, w + 152, h + 154, 42);
      g.fillStyle(0x1b0d3a, SPACE_VISUAL.EDGE_GLOW_ALPHA * 0.48);
      g.fillRoundedRect(-44, -44, w + 88, h + 88, 34);

      g.lineStyle(12, edge, SPACE_VISUAL.EDGE_GLOW_ALPHA * (endgame ? 1.1 : 1));
      g.strokeRoundedRect(-13, -13, w + 26, h + 26, 24);
      g.lineStyle(3, inner, endgame ? 0.26 : 0.22);
      g.strokeRoundedRect(4, 4, w - 8, h - 8, 18);

      const notch = 28;
      const pad = 22;
      g.lineStyle(2.5, 0xf1e8ff, endgame ? 0.22 : 0.17);
      g.beginPath();
      g.moveTo(pad, pad + notch); g.lineTo(pad, pad); g.lineTo(pad + notch, pad);
      g.moveTo(w - pad - notch, pad); g.lineTo(w - pad, pad); g.lineTo(w - pad, pad + notch);
      g.moveTo(w - pad, h - pad - notch); g.lineTo(w - pad, h - pad); g.lineTo(w - pad - notch, h - pad);
      g.moveTo(pad + notch, h - pad); g.lineTo(pad, h - pad); g.lineTo(pad, h - pad - notch);
      g.strokePath();
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
      this.drawFloatingArenaBase(g, endgame);
      g.fillStyle(endgame ? 0x120611 : 0x070913, 0.93);
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
        // Removed the old random crimson floor blobs so the arena background stays clean.
      } else {
        this.drawStaticArenaGrid(g, 0, 0, this.map.width, this.map.height, this.map.tile || 72, 0x172541, 0.32);
        this.drawStaticArenaGrid(g, 0, 0, this.map.width, this.map.height, (this.map.tile || 72) * 4, 0x315082, 0.18);
      }
    }

    rebuildFogTexture() {
      // Compatibility hook for older scene lifecycle callers. The current visibility system avoids rebuilding camera-sized RenderTextures.
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
      item.pickupAura?.destroy();
      item.boostAura?.destroy();
      item.reviveAura?.destroy();
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
      this.drawDartBoxes(g);
    }

    updateDartBoxVisuals(dt) {
      if (!this.dartBoxVisuals) this.dartBoxVisuals = new Map();
      const visibleBoxes = currentSnapshot?.dartBoxes || [];
      const seen = new Set();
      let animating = false;

      for (const box of visibleBoxes) {
        if (!box?.id || !Number.isFinite(box.x) || !Number.isFinite(box.y)) continue;
        seen.add(box.id);
        let visual = this.dartBoxVisuals.get(box.id);
        if (!visual) {
          visual = {
            id: box.id,
            x: box.x,
            y: box.y,
            alpha: 0,
            targetAlpha: 1,
            progress: 0,
            active: false,
            radius: Number(box.radius || 220),
            phase: hash2(Math.floor(box.x), Math.floor(box.y)) * Math.PI * 2,
            type: String(box.type || "dart")
          };
          this.dartBoxVisuals.set(box.id, visual);
          animating = true;
        }
        visual.x = lerp(visual.x, box.x, dampAlpha(12, dt));
        visual.y = lerp(visual.y, box.y, dampAlpha(12, dt));
        visual.progress = lerp(visual.progress || 0, Number(box.progress || 0), dampAlpha(14, dt));
        visual.active = !!box.active;
        visual.type = String(box.type || visual.type || "dart");
        visual.radius = Number(box.radius || visual.radius || 220);
        visual.targetAlpha = 1;
        if (visual.active || (visual.progress || 0) > 0.001) animating = true;
      }

      for (const [id, visual] of this.dartBoxVisuals.entries()) {
        if (!seen.has(id)) visual.targetAlpha = 0;
        const speed = visual.targetAlpha > visual.alpha ? DOT_FADE_VISUAL.IN_SPEED : DOT_FADE_VISUAL.OUT_SPEED;
        const next = lerp(visual.alpha, visual.targetAlpha, dampAlpha(speed, dt));
        if (Math.abs(next - visual.alpha) > 0.002) animating = true;
        visual.alpha = next;
        if (visual.targetAlpha <= 0 && visual.alpha <= DOT_FADE_VISUAL.REMOVE_ALPHA) {
          this.dartBoxVisuals.delete(id);
          animating = true;
        }
      }

      this.dartBoxesAnimating = animating;
      return animating;
    }

    drawDartBoxes(g) {
      if (!this.dartBoxVisuals?.size) return;
      for (const box of this.dartBoxVisuals.values()) this.drawDartBox(g, box);
    }

    drawDartBox(g, box) {
      if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) return;
      const alpha = clamp(box.alpha ?? 1, 0, 1);
      if (alpha <= 0.01) return;
      const now = performance.now();
      const pulse = 0.5 + Math.sin(now / 360 + (box.phase || 0)) * 0.5;
      const progress = clamp(box.progress || 0, 0, 1);
      const base = 15 + pulse * 2.4;
      const activeGlow = box.active || progress > 0.01;

      const isHealBox = String(box.type || "") === "heal";
      const outer = isHealBox ? 0x064e3b : 0x0f2c66;
      const mid = isHealBox ? 0x22c55e : 0x38bdf8;
      const core = isHealBox ? 0xdcfce7 : 0xdff9ff;
      const glow = isHealBox ? 0x86efac : 0x7dd3fc;
      // Blue cache for darts, green cache for heals.
      g.fillStyle(outer, (0.18 + pulse * 0.10) * alpha);
      g.fillCircle(box.x, box.y, base * 2.2);
      g.fillStyle(mid, (0.18 + pulse * 0.13) * alpha);
      g.fillCircle(box.x, box.y, base * 1.45);
      g.fillStyle(core, 0.92 * alpha);
      g.fillCircle(box.x, box.y, base * 0.52);
      g.fillStyle(glow, 0.74 * alpha);
      g.fillCircle(box.x, box.y, base * 0.88);
      g.fillStyle(0xffffff, 0.60 * alpha);
      g.fillCircle(box.x - base * 0.18, box.y - base * 0.20, base * 0.18);

      const shardCount = LOW_POWER_MODE ? 4 : 6;
      for (let i = 0; i < shardCount; i += 1) {
        const a = (Math.PI * 2 * i) / shardCount + now / (900 + i * 40) + (box.phase || 0);
        const r = base * (1.25 + (i % 2) * 0.18);
        const sx = box.x + Math.cos(a) * r;
        const sy = box.y + Math.sin(a) * r;
        this.drawRunnerProjectileStar(g, sx, sy, LOW_POWER_MODE ? 2.2 : 3.0, isHealBox ? (i % 2 ? 0x86efac : 0xdcfce7) : (i % 2 ? 0x7dd3fc : 0xe0faff), 0.25 * alpha, -a);
      }

      g.lineStyle(2, isHealBox ? 0x86efac : 0x93eaff, (0.42 + pulse * 0.22) * alpha);
      g.strokeCircle(box.x, box.y, base * 1.18);
      if (activeGlow) {
        const aoePulse = 0.5 + Math.sin(now / 520 + (box.phase || 0)) * 0.5;
        g.fillStyle(isHealBox ? 0x16a34a : 0x0ea5e9, (0.035 + aoePulse * 0.025) * alpha);
        g.fillCircle(box.x, box.y, Math.max(70, Number(box.radius || 220)));
        g.lineStyle(LOW_POWER_MODE ? 1.2 : 1.8, isHealBox ? 0x86efac : 0x7dd3fc, (0.18 + aoePulse * 0.18) * alpha);
        g.strokeCircle(box.x, box.y, Math.max(70, Number(box.radius || 220)));
        g.lineStyle(3, isHealBox ? 0xdcfce7 : 0xe0faff, 0.70 * alpha);
        g.beginPath();
        g.arc(box.x, box.y, base * 1.75, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
        g.strokePath();
      }
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
      const backLength = length * cfgNumber(perkEffectForActor(subject?.data, "hourglass", "survivor")?.backLengthMultiplier, LIGHTING.SURVIVOR_HOURGLASS_BACK_LENGTH_MULT);
      const backConeAngle = Math.min(Math.PI * 1.08, coneAngle * cfgNumber(perkEffectForActor(subject?.data, "hourglass", "survivor")?.backAngleMultiplier, LIGHTING.SURVIVOR_HOURGLASS_BACK_ANGLE_MULT));
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
        // Low-cost animated void portal using a few circles and rotating satellites.
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

    syncStateDrivenMatchAnnouncements(snapshot) {
      const actors = Array.isArray(snapshot?.actors) ? snapshot.actors : [];
      const nextState = new Map();
      for (const actor of actors) {
        if (!actor || actor.role !== "survivor" || !actor.id) continue;
        nextState.set(actor.id, {
          hooked: !!actor.hooked && !actor.dead && !actor.escaped,
          hookCount: Number(actor.hookCount || 0) || 0,
          dead: !!actor.dead,
          escaped: !!actor.escaped
        });
      }

      if (!this.lastMatchAnnouncementActorState) {
        this.lastMatchAnnouncementActorState = nextState;
        return;
      }

      for (const [id, state] of nextState) {
        const previous = this.lastMatchAnnouncementActorState.get(id);
        if (!previous) continue;
        const newlyBound = state.hooked && (!previous.hooked || previous.hookCount !== state.hookCount);
        if (newlyBound) pushBoundAnnouncement(id, state.hookCount);
      }
      this.lastMatchAnnouncementActorState = nextState;
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
      this.syncStateDrivenMatchAnnouncements(snapshot);
      this.updateHud(snapshot);
      const localActor = (snapshot.actors || []).find((a) => a.id === myId);
      if (!finalMatchResult && snapshot.phase === "game" && localActor?.role === "survivor" && localActor.escaped && !this.localEscapeScreenShown && activeScreenName === "game") {
        this.localEscapeScreenShown = true;
        showEscapedScreen(personalRunResult);
      }
      this.lastSnapshotAt = performance.now();
    }

    updateHud(snapshot) {
      const me = (snapshot.actors || []).find((a) => a.id === myId) || (snapshot.viewer?.id === myId ? snapshot.viewer : null);
      const now = performance.now();
      const tankMode = isTanksSnapshot(snapshot);
      if (tankMode) {
        document.body.classList.toggle("is-tank-mode", snapshot.phase === "game");
        ui.hud?.classList.add("hidden");
        ui.survivorStatusHud?.classList.add("hidden");
        ui.bigGenCounter?.classList.add("hidden");
        ui.horrorFx?.classList.add("hidden");
        dispatchAbilityHuds(snapshot);
        dispatchHookIndicators([]);
        resetHorrorFxVisualState();
        if (reactChatWheelOpen) closeReactChatWheel(false);
        if (reactAbilityWheelOpen) closeReactAbilityWheel(false);

        const tankHudPayload = { ...(snapshot.tank || {}), visible: snapshot.phase === "game" };
        const tankHudKey = JSON.stringify(tankHudPayload);
        if (tankHudKey !== this.lastTankHudKey || now - (this.lastTankHudAt || 0) > 120) {
          this.lastTankHudKey = tankHudKey;
          this.lastTankHudAt = now;
          window.dispatchEvent(new CustomEvent("riftrunner:tank-hud", { detail: tankHudPayload }));
        }
        this.lastTankHudActive = true;
        this.lastHudKey = "";
        return;
      }

      if (this.lastTankHudActive) {
        this.lastTankHudActive = false;
        this.lastTankHudKey = "";
        document.body.classList.remove("is-tank-mode");
        window.dispatchEvent(new CustomEvent("riftrunner:tank-hud", { detail: { visible: false } }));
      }

      if (!me) return;

      const objective = snapshot.objective || {};
      const ffaMode = snapshot?.mode === "ffa" || objective.mode === "ffa";
      const ffaScoreboard = Array.isArray(objective.scoreboard) ? objective.scoreboard : [];
      const ffaLeader = ffaScoreboard[0] || null;
      const myFfaScore = ffaScoreboard.find((entry) => entry.id === me.id) || { kills: me.kills || 0, deaths: me.deaths || 0, respawnRemaining: me.respawnRemaining || 0 };
      const ffaKillLimit = Number(objective.killLimit || snapshot.killLimit || 10);
      const done = ffaMode ? Number(myFfaScore.kills || 0) : (objective.doneGenerators ?? objective.completed ?? 0);
      const required = ffaMode ? ffaKillLimit : (objective.requiredGenerators ?? objective.required ?? objective.totalGenerators ?? objective.total ?? 0);
      const total = ffaMode ? ffaKillLimit : (objective.totalGenerators ?? objective.total ?? required);
      const escapeOpen = ffaMode ? false : (objective.escapeOpen ?? objective.gatesPowered ?? false);
      const hudKey = JSON.stringify({
        self: [me.id, me.role, me.lobbyRole, me.gameMode, me.skin, me.runnerClass, me.runnerLevel, me.health, me.dots, me.kills, me.deaths, me.respawnRemaining, me.ffaShotCooldownRemaining, me.injured, me.downed, me.hooked, me.dead, me.escaped, me.escapeProgress, me.escapeGateId, me.chase, me.hookProgress, me.healProgress, me.generatorKickTargetId, me.generatorKickProgress, me.voidStun, me.voidSpeedBoost],
        objective: [ffaMode, done, required, total, escapeOpen, ffaLeader?.id || null, ffaLeader?.kills || 0, ffaScoreboard.map((entry) => `${entry.id}:${entry.kills}:${entry.deaths}:${entry.dead ? 1 : 0}:${entry.respawnRemaining || 0}`).join("|")],
        survivors: (snapshot.actors || []).filter((a) => a.role === "survivor").map((a) => [a.id, a.lobbyRole, a.gameMode, a.health, a.dots, a.kills, a.deaths, a.respawnRemaining, a.injured, a.downed, a.hooked, a.dead, a.escaped, a.escapeProgress, a.escapeGateId, a.chase, a.hookProgress, a.healProgress, a.hookCount, a.chatText]),
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
      if (isTanksSnapshot(snapshot)) {
        window.dispatchEvent(new CustomEvent("riftrunner:tank-hud", {
          detail: snapshot.tank || {}
        }));
      }
      const hudRole = ffaMode ? "ffa" : me.role === "killer" ? "killer" : me.role === "spectator" ? "spectator" : "survivor";
      ui.hud.dataset.role = hudRole;
      applyRoleHudSkin(me, hudRole === "ffa" ? "survivor" : hudRole);
      ui.roleLabel.textContent = hudRole === "ffa" ? "Void Shooter" : hudRole === "killer" ? "The Void" : hudRole === "spectator" ? "Spectator" : `${runnerClassLabel(me.runnerClass)} Runner`;
      const shownDone = Math.min(done, required);
      const hudSummaryText = ffaMode
        ? `${shownDone} / ${required} kills${ffaLeader ? ` • Leader: ${ffaLeader.name || "Shooter"} ${ffaLeader.kills || 0}` : ""}`
        : `${shownDone} / ${required}${total > required ? ` (${total} on map)` : ""}`;
      if (ui.genText) ui.genText.textContent = hudSummaryText;
      if (ui.bigGenText) ui.bigGenText.textContent = `${shownDone} / ${required}`;
      ui.bigGenCounter?.classList.toggle("is-complete", required > 0 && shownDone >= required);
      const bigGenLabel = ui.bigGenCounter?.querySelector?.(".big-gen-copy span");
      if (bigGenLabel) bigGenLabel.textContent = ffaMode ? "Kills" : "Rifts sealed";
      if (ui.gateText) ui.gateText.textContent = ffaMode ? "FFA" : escapeOpen ? "Open" : "Sealed";
      let healthSummaryText = survivorStateLabel(me);
      if (ffaMode) {
        const respawn = Math.ceil(Number(myFfaScore.respawnRemaining || me.respawnRemaining || 0));
        if (me.dead || me.downed || respawn > 0) healthSummaryText = `Respawning ${Math.max(1, respawn)}s`;
        else if (me.injured || Number(me.health || 0) <= 1) healthSummaryText = `Injured • ${myFfaScore.kills || 0} kills`;
        else healthSummaryText = `Full health • ${myFfaScore.kills || 0} kills`;
      } else if (me.role === "killer") {
        const actors = snapshot.actors || [];
        const hookingTarget = actors.find((a) => a.id === me.hookActionTargetId);
        const readyTarget = actors.find((a) => a.id === me.hookReadyTargetId);
        if ((me.voidStun || 0) > 0) {
          healthSummaryText = `Stunned ${Math.ceil(me.voidStun || 0)}s`;
        } else if (hookingTarget) {
          const executing = me.hookActionType === "execute" || (hookingTarget.hookCount || 0) >= 2;
          healthSummaryText = `${executing ? "Executing" : "Binding"} ${hookingTarget.name || "runner"} ${Math.round((hookingTarget.hookProgress || 0) * 100)}%`;
        } else if (readyTarget) {
          const executeReady = (readyTarget.hookCount || 0) >= 2;
          healthSummaryText = `Hold E: ${executeReady ? "Execute" : "bind"} ${readyTarget.name || "Runner"}`;
        } else if (me.generatorKickTargetId) {
          healthSummaryText = `Kicking rift ${Math.round((me.generatorKickProgress || 0) * 100)}%`;
        } else {
          const kickable = (snapshot.map?.generators || []).some((gen) => !gen.done && !gen.kickLocked && (gen.progress || 0) > 0 && Math.hypot((me.x || 0) - gen.x, (me.y || 0) - gen.y) < 92);
          healthSummaryText = kickable ? "Hold E: Kick rift" : "The Void";
        }
      } else if (me.role === "spectator") {
        const targetId = this.resolveSpectateTargetId();
        const target = (snapshot.actors || []).find((a) => a.id === targetId);
        healthSummaryText = targetId === SPECTATE_OVERVIEW_ID
          ? "Spectating: Full Map Overview"
          : target
            ? `Spectating: ${target.name || (target.role === "killer" ? "The Void" : "Runner")}`
            : "Spectating";
      } else if (me.dead) {
        const target = (snapshot.actors || []).find((a) => a.id === this.resolveSpectateTargetId());
        healthSummaryText = target
          ? `Spectating: ${target.name || "Runner"}`
          : "Dead";
      }
      if (ui.healthText) ui.healthText.textContent = healthSummaryText;
      const fxActor = this.getPovSurvivorData() || me;
      updateHorrorFx(snapshot, fxActor, { terror: this.terrorBlend, chase: this.chaseBlend });
    }

    updateScratchGraphics(marks) {
      const g = this.scratchGraphics;
      g.clear();
      const serverTime = Number(currentSnapshot?.serverTime || 0);
      for (const mark of marks) {
        const remaining = Number.isFinite(Number(mark.expiresAt)) && serverTime > 0
          ? Number(mark.expiresAt) - serverTime
          : Number(mark.ttl || 0);
        if (remaining <= 0) continue;
        const alpha = clamp(remaining / SCRATCH_MARK_CLIENT_TTL, 0, 1) * 0.85;
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
      const pickupAura = this.add.graphics()
        .setDepth(isKiller ? 13.5 : 10.8)
        .setScrollFactor(1, 1)
        .setBlendMode(Phaser.BlendModes.SCREEN)
        .setVisible(false);
      const boostAura = this.add.graphics()
        .setDepth(isKiller ? 16 : 13.35)
        .setScrollFactor(1, 1)
        .setBlendMode(Phaser.BlendModes.SCREEN)
        .setVisible(false);
      const reviveAura = this.add.graphics()
        .setDepth(isKiller ? 16.2 : 13.75)
        .setScrollFactor(1, 1)
        .setBlendMode(Phaser.BlendModes.SCREEN)
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
        pickupAura,
        boostAura,
        reviveAura,
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
        data.reviveInvuln > 0 ? 1 : 0,
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

      const spinScale = clamp(performanceValue("heldOrbSpinScale", 1), 0, 1);
      const bobScale = clamp(performanceValue("heldOrbBobScale", 1), 0, 1);
      const orbitPhase = (item.dotOrbitPhase ?? 0) * spinScale;
      const represented = Math.max(1, SURVIVOR_DOT_MAX / Math.max(1, maxVisualDots));
      const visibleSlots = Math.max(1, Math.min(maxVisualDots, Math.ceil(display / represented)));
      const highCountScale = clamp(display / Math.max(1, SURVIVOR_DOT_MAX), 0.35, 1);
      const baseAlpha = bodyAlpha * (adaptivePerformance.mode === "ultra" ? 0.58 : 0.80);

      if (adaptivePerformance.mode !== "ultra") {
        const ringRadius = DOT_ORBIT_VISUAL.RADIUS_BASE + highCountScale * 6.5;
        const ringAlpha = DOT_ORBIT_VISUAL.RING_ALPHA * bodyAlpha * clamp(display / 6, 0.18, 1);
        const arcAlpha = DOT_ORBIT_VISUAL.RING_ARC_ALPHA * bodyAlpha * clamp(display / 8, 0.16, 1);
        const orbitSpin = orbitPhase * 0.72;
        const isCollector = normalizeRunnerClassId(item?.data?.runnerClass || "") === "orbCollector";

        if (isCollector) {
          // Collector magnet field: subtle gold pull field with brighter yellow accents.
          const gold = 0xfbbf24;
          const brightGold = 0xfde047;
          const softGold = 0xfff7c2;
          const pulse = 0.5 + Math.sin(orbitPhase * 1.55) * 0.5;
          const magneticAlpha = bodyAlpha * clamp(display / 8, 0.15, 1);

          body.lineStyle(LOW_POWER_MODE ? 0.46 : 0.62, softGold, 0.034 * magneticAlpha);
          body.strokeCircle(0, 0, ringRadius + 0.6);

          for (let i = 0; i < 3; i += 1) {
            const start = orbitSpin + i * Math.PI * 0.72 + Math.sin(orbitPhase * 0.42 + i) * 0.09;
            const span = Math.PI * (LOW_POWER_MODE ? 0.20 : 0.27);
            const r = ringRadius + (i - 1) * 1.7;
            body.lineStyle(LOW_POWER_MODE ? 0.9 : 1.16, i === 1 ? brightGold : gold, (0.075 + pulse * 0.05) * magneticAlpha);
            body.beginPath();
            body.arc(0, 0, r, start, start + span, false);
            body.strokePath();
          }

          if (!LOW_POWER_MODE) {
            for (let i = 0; i < 5; i += 1) {
              const a = orbitSpin * 1.08 + i * Math.PI * 0.58 + Math.sin(orbitPhase * 0.63 + i) * 0.16;
              const r = ringRadius + Math.sin(orbitPhase * 0.9 + i) * 2.4;
              const sx = Math.cos(a) * r;
              const sy = Math.sin(a) * r;
              body.fillStyle(i % 2 ? brightGold : gold, (0.075 + pulse * 0.04) * magneticAlpha);
              body.fillCircle(sx, sy, i % 2 ? 0.82 : 1.02);
            }
          }
        } else {
          body.lineStyle(LOW_POWER_MODE ? 0.45 : 0.6, glow, ringAlpha);
          body.strokeCircle(0, 0, ringRadius);
          body.lineStyle(LOW_POWER_MODE ? 0.75 : 0.95, accent, arcAlpha);
          body.beginPath();
          body.arc(0, 0, ringRadius + 1.2, orbitSpin, orbitSpin + Math.PI * 0.34, false);
          body.strokePath();
          body.beginPath();
          body.arc(0, 0, ringRadius - 1.5, orbitSpin + Math.PI * 1.16, orbitSpin + Math.PI * 1.52, false);
          body.strokePath();
          if (!LOW_POWER_MODE) {
            for (let i = 0; i < 3; i += 1) {
              const a = orbitSpin + i * Math.PI * 0.72 + Math.sin(orbitPhase * 0.7 + i) * 0.12;
              const r = ringRadius + (i % 2 ? -1.9 : 2.0);
              const sx = Math.cos(a) * r;
              const sy = Math.sin(a) * r;
              body.fillStyle(i % 2 ? glow : accent, DOT_ORBIT_VISUAL.RING_SPARK_ALPHA * bodyAlpha * clamp(display / 10, 0.12, 1));
              body.fillCircle(sx, sy, 0.9 + (i % 2) * 0.25);
            }
          }
        }
      }

      for (let i = 0; i < visibleSlots; i++) {
        const slotStart = i * represented;
        const fill = clamp((display - slotStart) / represented, 0, 1);
        if (fill <= 0.02) continue;

        // Slot angle uses maxVisualDots, not current held count, so existing orbs never jump
        // when a new one is collected. The new slot fades in instead of redistributing the ring.
        const slotRatio = i / Math.max(1, maxVisualDots);
        const orbitSpin = orbitPhase * (1.02 + (i % 5) * 0.025);
        const slotAngle = orbitSpin + slotRatio * Math.PI * 2 - Math.PI / 2;
        const localAngle = slotAngle - (playerAngle || 0);
        const lane = i % 3;
        const radius = DOT_ORBIT_VISUAL.RADIUS_BASE + lane * DOT_ORBIT_VISUAL.RADIUS_STEP + highCountScale * 4.5;
        const bob = Math.sin(orbitPhase * 2.25 + i * 0.83) * DOT_ORBIT_VISUAL.BOB * bobScale;
        const exitT = 1 - fill;
        const exitEase = exitT * exitT;
        const exitPush = exitEase * DOT_ORBIT_VISUAL.DEPOSIT_EXIT_PUSH;
        const orbitRadius = radius + bob + exitPush;
        const ox = Math.cos(localAngle) * orbitRadius;
        const oy = Math.sin(localAngle) * orbitRadius;
        const baseSize = i % 2 === 1 ? DOT_ORBIT_VISUAL.SIZE_PRIMARY : DOT_ORBIT_VISUAL.SIZE_SECONDARY;
        const pop = Math.sin(fill * Math.PI) * DOT_ORBIT_VISUAL.NEW_ORB_POP;
        const size = (baseSize + highCountScale * 0.95 + pop) * (0.68 + fill * 0.32);
        const alpha = baseAlpha * fill * fill;
        const color = i % 2 === 1 ? accent : glow;

        if (adaptivePerformance.mode !== "ultra") {
          const trailAngle = localAngle - 0.22 - (i % 4) * 0.015;
          const tx = Math.cos(trailAngle) * (orbitRadius - size * 0.2);
          const ty = Math.sin(trailAngle) * (orbitRadius - size * 0.2);
          body.lineStyle(Math.max(0.8, size * 0.46), color, DOT_ORBIT_VISUAL.TRAIL_ALPHA * alpha);
          body.lineBetween(tx, ty, ox, oy);
          body.fillStyle(color, alpha * 0.16);
          body.fillCircle(ox, oy, size * 2.15);
        }

        body.fillStyle(color, alpha);
        body.fillCircle(ox, oy, size);
        body.fillStyle(0xffffff, alpha * 0.48);
        body.fillCircle(ox - size * 0.28, oy - size * 0.28, Math.max(0.65, size * 0.32));
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

        // The Void: layered core. Skin palettes change silhouette details too,
        // because a "skin" that is only a recolor is barely a costume, it's accounting.

        // Keep the draw calls simple for stable performance.
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

      if ((data.reviveInvuln || 0) > 0 && !disabled && !data.hooked && !data.downed) {
        const shieldPulse = 0.5 + Math.sin(performance.now() / 105 + seed) * 0.5;
        item.outline.lineStyle(2.2, 0xf8fafc, 0.52 + shieldPulse * 0.28);
        item.outline.strokeCircle(0, 0, 28 + shieldPulse * 4);
        item.outline.lineStyle(1.2, 0x94a3b8, 0.34 + shieldPulse * 0.18);
        item.outline.strokeCircle(0, 0, 36 + shieldPulse * 7);
        item.body.fillStyle(0xffffff, 0.11 + shieldPulse * 0.05);
        item.body.fillCircle(0, 0, 21 + shieldPulse * 2);
      }

      this.drawHeldDotOrbits(item, item.body, bodyAlpha, accent, glow, item.current?.angle ?? 0);
    }

    drawReviveInvulnAura(item, data) {
      if (!item?.reviveAura || data?.role !== "survivor") return;
      const alphaBase = clamp(item.visionAlpha ?? 0, 0, 1);
      const active = (data.reviveInvuln || 0) > 0
        && !data.dead
        && !data.escaped
        && !data.hooked
        && !data.downed
        && alphaBase > ACTOR_VISION.MIN_VISIBLE_ALPHA;

      item.reviveAura.clear();
      item.reviveAura.setVisible(active);
      if (!active) return;

      const now = performance.now();
      const seed = hash2((data.id || "revive").length, (data.id || "r").charCodeAt(0) || 0);
      const pulse = 0.5 + Math.sin(now / 120 + seed * Math.PI * 2) * 0.5;
      const slow = 0.5 + Math.sin(now / 310 + seed) * 0.5;
      const radius = 30 + pulse * 5;

      item.reviveAura.setPosition(item.current.x, item.current.y);
      item.reviveAura.setRotation(0);
      item.reviveAura.fillStyle(0xffffff, alphaBase * (0.045 + slow * 0.035));
      item.reviveAura.fillCircle(0, 0, radius * 0.95);
      item.reviveAura.lineStyle(2.4, 0xf8fafc, alphaBase * (0.35 + pulse * 0.26));
      item.reviveAura.strokeCircle(0, 0, radius);
      item.reviveAura.lineStyle(1.1, 0x94a3b8, alphaBase * (0.22 + slow * 0.18));
      item.reviveAura.strokeCircle(0, 0, radius + 9 + slow * 3);
      for (let i = 0; i < 4; i += 1) {
        const angle = now / (260 + i * 34) + seed + i * Math.PI * 0.5;
        const px = Math.cos(angle) * (radius + 3 + (i % 2) * 4);
        const py = Math.sin(angle) * (radius * 0.78 + (i % 2) * 3);
        item.reviveAura.fillStyle(i % 2 ? 0xe2e8f0 : 0xffffff, alphaBase * (0.24 + pulse * 0.10));
        item.reviveAura.fillCircle(px, py, LOW_POWER_MODE ? 1.7 : 2.3);
      }
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

    drawOrbPickupAura(item, data) {
      if (!item?.pickupAura || data?.role !== "survivor") return;
      const alphaBase = clamp(item.visionAlpha ?? 0, 0, 1);
      const aura = orbPickupAuraForActor(data);
      const active = !!aura
        && !data.dead
        && !data.escaped
        && !data.hooked
        && !data.downed
        && alphaBase > ACTOR_VISION.MIN_VISIBLE_ALPHA;

      item.pickupAura.clear();
      item.pickupAura.setVisible(active);
      if (!active) return;

      const radius = Math.max(aura.baseRadius + 3, aura.radius);
      const now = performance.now();
      const pulse = 0.5 + Math.sin(now / 520 + (item.seed || 0)) * 0.5;

      item.pickupAura.setPosition(item.current.x, item.current.y);
      item.pickupAura.setRotation(0);

      if (aura.isCollector) {
        const spin = now / 1350 + (item.seed || 0) * 0.031;
        const gold = 0xfbbf24;
        const brightGold = 0xfde047;
        const softGold = 0xfff7c2;
        const fieldAlpha = alphaBase * clamp((aura.radius - aura.baseRadius) / Math.max(1, aura.baseRadius), 0.18, 0.55);

        // Collector field: brighter gold haze with broken magnetic arcs.
        item.pickupAura.fillStyle(brightGold, 0.013 * fieldAlpha);
        item.pickupAura.fillCircle(0, 0, radius + 4 + pulse * 2.5);
        item.pickupAura.fillStyle(gold, 0.011 * fieldAlpha);
        item.pickupAura.fillCircle(0, 0, radius - 1.5);

        item.pickupAura.lineStyle(adaptivePerformance.mode === "ultra" ? 0.72 : 0.92, softGold, 0.080 * fieldAlpha);
        item.pickupAura.strokeCircle(0, 0, radius + 0.5);

        const arcCount = LOW_POWER_MODE ? 3 : 5;
        for (let i = 0; i < arcCount; i += 1) {
          const start = spin + i * Math.PI * 0.64 + Math.sin(now / (760 + i * 45) + i) * 0.11;
          const span = Math.PI * (0.17 + (i % 2) * 0.065);
          const r = radius + (i % 3 - 1) * 2.6;
          const color = i % 3 === 1 ? brightGold : gold;
          const width = adaptivePerformance.mode === "ultra" ? 0.92 : 1.28;
          item.pickupAura.lineStyle(width, color, (0.16 + pulse * 0.06) * fieldAlpha);
          item.pickupAura.beginPath();
          item.pickupAura.arc(0, 0, r, start, start + span, false);
          item.pickupAura.strokePath();
        }

        if (!LOW_POWER_MODE && adaptivePerformance.mode !== "ultra") {
          for (let i = 0; i < 7; i += 1) {
            const a = -spin * 0.82 + i * Math.PI * 0.49 + Math.sin(now / (690 + i * 22) + i) * 0.13;
            const r = radius + Math.sin(now / (820 + i * 30) + i * 1.7) * 4.2;
            const size = i % 3 === 0 ? 1.26 : 0.94;
            item.pickupAura.fillStyle(i % 2 ? brightGold : gold, (0.10 + pulse * 0.045) * fieldAlpha);
            item.pickupAura.fillCircle(Math.cos(a) * r, Math.sin(a) * r, size);
          }
        }
        return;
      }

      const ringWidth = adaptivePerformance.mode === "ultra" ? Math.max(1.2, aura.lineWidth * 0.75) : aura.lineWidth;
      item.pickupAura.lineStyle(ringWidth, aura.color, alphaBase * aura.lineAlpha);
      item.pickupAura.strokeCircle(0, 0, radius);
    }

    drawDashBoostAura(item, data) {
      if (!item?.boostAura || data?.role !== "survivor") return;

      const alphaBase = clamp(item.visionAlpha ?? 0, 0, 1);
      const vaporTrailActive = (data.nebulizerVaporTrail || 0) > 0;
      const active = ((data.dashBoost || 0) > 0 || vaporTrailActive)
        && !data.dead
        && !data.escaped
        && !data.hooked
        && !data.downed
        && alphaBase > ACTOR_VISION.MIN_VISIBLE_ALPHA;

      item.boostAura.clear();
      item.boostAura.setVisible(active);
      if (!active) return;

      const now = performance.now();
      const seed = hash2((data.id || "dash").length, (data.id || "r").charCodeAt(0) || 0);
      const ultra = adaptivePerformance.mode === "ultra" || LOW_POWER_MODE;
      const points = ultra ? 8 : 12;
      const radius = ultra ? 29 : 33;
      const wobble = ultra ? 3.2 : 5.4;
      const rotation = now / (ultra ? 240 : 170) + seed * Math.PI * 2;
      const flicker = 0.72 + Math.sin(now / 58 + seed * 8) * 0.18;
      const outerAlpha = alphaBase * (ultra ? 0.34 : 0.48) * flicker;
      const coreAlpha = alphaBase * (ultra ? 0.48 : 0.70) * flicker;

      item.boostAura.setPosition(item.current.x, item.current.y);
      item.boostAura.setRotation(0);

      const coreColor = vaporTrailActive ? 0xa855f7 : 0xff9f1c;
      const outerColor = vaporTrailActive ? 0xd8b4fe : 0xffd27a;
      const sparkA = vaporTrailActive ? 0xc084fc : 0xffb347;
      const sparkB = vaporTrailActive ? 0x7c3aed : 0xff6b00;

      item.boostAura.lineStyle(ultra ? 2 : 2.6, coreColor, coreAlpha);
      item.boostAura.beginPath();
      for (let i = 0; i <= points; i += 1) {
        const t = i / points;
        const angle = rotation + t * Math.PI * 2;
        const jag = Math.sin(i * 2.45 + now / 72 + seed * 10) * wobble + (i % 2 ? wobble * 0.62 : -wobble * 0.36);
        const r = radius + jag;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) item.boostAura.moveTo(x, y);
        else item.boostAura.lineTo(x, y);
      }
      item.boostAura.strokePath();

      if (!ultra) {
        item.boostAura.lineStyle(1.1, outerColor, outerAlpha * 0.72);
        item.boostAura.beginPath();
        for (let i = 0; i <= points; i += 1) {
          const t = i / points;
          const angle = -rotation * 0.72 + t * Math.PI * 2;
          const jag = Math.cos(i * 2.15 + now / 94 + seed * 7) * (wobble * 0.62) + (i % 2 ? wobble * 0.32 : -wobble * 0.25);
          const r = radius + 7 + jag;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          if (i === 0) item.boostAura.moveTo(x, y);
          else item.boostAura.lineTo(x, y);
        }
        item.boostAura.strokePath();
      }

      const sparkCount = ultra ? 2 : 4;
      for (let i = 0; i < sparkCount; i += 1) {
        const angle = rotation * 1.35 + seed * 4 + i * (Math.PI * 2 / sparkCount) + Math.sin(now / 105 + i) * 0.22;
        const inner = radius - 7 + (i % 2) * 2;
        const outer = radius + 9 + ((i + 1) % 2) * 3;
        const kink = radius + (i % 2 ? 1 : -2);
        const ix = Math.cos(angle) * inner;
        const iy = Math.sin(angle) * inner;
        const kx = Math.cos(angle + 0.14) * kink;
        const ky = Math.sin(angle + 0.14) * kink;
        const ox = Math.cos(angle - 0.08) * outer;
        const oy = Math.sin(angle - 0.08) * outer;
        item.boostAura.lineStyle(ultra ? 1.3 : 1.7, i % 2 ? sparkA : sparkB, outerAlpha * (0.78 + (i % 2) * 0.22));
        item.boostAura.beginPath();
        item.boostAura.moveTo(ix, iy);
        item.boostAura.lineTo(kx, ky);
        item.boostAura.lineTo(ox, oy);
        item.boostAura.strokePath();
      }
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
      const vaporTrailActive = (data?.nebulizerVaporTrail || 0) > 0;
      if (!item || !data || data.role !== "survivor" || !((data.speedBurst || 0) > 0 || vaporTrailActive) || data.dead || data.escaped || data.downed || data.hooked) return;
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
      const color = vaporTrailActive ? 0xa855f7 : (data.health <= 1 || data.injured ? COLORS.survivorInjured : (skin?.color || COLORS.survivor));
      const alpha = performanceValue("survivorSpeedBurstTrailAlpha", LOW_POWER_MODE ? 0.24 : 0.36) * (vaporTrailActive ? 1.16 : 1);

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
        if (item.pickupAura) {
          item.pickupAura.clear();
          item.pickupAura.setVisible(false);
        }
        if (item.boostAura) {
          item.boostAura.clear();
          item.boostAura.setVisible(false);
        }
        if (item.reviveAura) {
          item.reviveAura.clear();
          item.reviveAura.setVisible(false);
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
        const outlineColor = showProgress ? progressColor : data.reviveInvuln > 0 ? 0xf8fafc : data.invuln > 0 ? 0xffffff : data.hooked ? 0xffc06a : skin.outline;
        const progressStep = Math.round(progress * (adaptivePerformance.mode === "ultra" ? 10 : 24));
        const dotKeyStep = adaptivePerformance.mode === "ultra" ? 2 : adaptivePerformance.mode === "low" ? 1 : 0.5;
        const dotVisualKey = Math.round((item.dotDisplay || 0) / dotKeyStep) * dotKeyStep;
        const survivorStateKey = `${data.skin || ""}:${data.health}:${data.injured ? 1 : 0}:${data.downed ? 1 : 0}:${data.hooked ? 1 : 0}:${data.dead ? 1 : 0}:${data.escaped ? 1 : 0}:${data.invuln > 0 ? 1 : 0}:${data.reviveInvuln > 0 ? 1 : 0}:${progressStep}:${dotVisualKey}`;
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
        this.drawReviveInvulnAura(item, data);
        this.drawOrbPickupAura(item, data);
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

    rememberRunnerProjectileImpact(projectileId) {
      if (!projectileId) return;
      const impacts = this.recentRunnerProjectileImpacts || (this.recentRunnerProjectileImpacts = new Map());
      impacts.set(String(projectileId), performance.now() + 900);
      if (impacts.size > 48) {
        const now = performance.now();
        for (const [id, until] of impacts) {
          if (until <= now || impacts.size > 48) impacts.delete(id);
        }
      }
    }

    recentlySawRunnerProjectileImpact(projectileId) {
      if (!projectileId) return false;
      const impacts = this.recentRunnerProjectileImpacts;
      if (!impacts) return false;
      const until = impacts.get(String(projectileId));
      if (!until) return false;
      if (until <= performance.now()) {
        impacts.delete(String(projectileId));
        return false;
      }
      return true;
    }

    playMissingRunnerProjectileImpactFx(visual) {
      if (!visual || String(visual.ownerId || "") !== String(myId || "")) return;
      if (this.recentlySawRunnerProjectileImpact(visual.id)) return;
      this.playRunnerProjectileImpactFx({
        type: "runnerProjectileExplode",
        x: visual.x,
        y: visual.y,
        actorId: visual.ownerId,
        survivorId: visual.ownerId,
        ownerId: visual.ownerId,
        projectileId: visual.id,
        abilityId: visual.abilityId || visual.type,
        projectileType: visual.type,
        radius: visual.radius || 96,
        affected: 0,
        collected: 0,
        reason: "clientFallback"
      });
    }

    playSharedImpactFx(event, color, options = {}) {
      if (!event || !Number.isFinite(Number(event.x)) || !Number.isFinite(Number(event.y))) return;
      const mode = adaptivePerformance.mode;
      const burstNormal = Math.max(0, Math.floor(cfgNumber(options.burstNormal, 24)));
      const burstLow = Math.max(0, Math.floor(cfgNumber(options.burstLow, 8)));
      const burstUltra = Math.max(0, Math.floor(cfgNumber(options.burstUltra, 0)));
      const burstCount = mode === "ultra" ? burstUltra : LOW_POWER_MODE ? burstLow : burstNormal;
      const burstLife = Math.max(50, cfgNumber(options.burstLife, LOW_POWER_MODE ? 115 : 170));
      if (burstCount > 0) this.burst(event.x, event.y, color, burstCount, burstLife);
      if (mode === "normal" && options.shockwave !== false) {
        this.addShockwave(
          event.x,
          event.y,
          options.ringColor ?? color,
          cfgNumber(options.shockwaveAlpha, 0.44),
          Math.max(24, cfgNumber(options.radius, 120))
        );
      }
    }

    playRunnerProjectileImpactFx(event) {
      this.rememberRunnerProjectileImpact(event?.projectileId);
      playLocalizedRunnerProjectileImpactSfx(event);
      const palette = this.runnerProjectilePalette(event.projectileType || event.abilityId);
      this.playSharedImpactFx(event, palette.mid, {
        ringColor: palette.ring,
        radius: Math.max(60, Number(event.radius || 110)),
        burstNormal: 24,
        burstLow: 8,
        burstUltra: 0,
        burstLife: LOW_POWER_MODE ? 115 : 170
      });
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
        if (event.type === "ffaKill") {
          playLocalizedHit(event);
          this.burst(event.x, event.y, 0xfb923c, adaptivePerformance.mode === "ultra" ? 4 : LOW_POWER_MODE ? 14 : 44, LOW_POWER_MODE ? 130 : 210);
          if (event.survivorId === myId) this.cameras.main.shake(LOW_POWER_MODE ? 170 : 230, (LOW_POWER_MODE ? 0.0042 : 0.0064) * performanceValue("shakeScale", 1));
        }
        if (event.type === "tankPlayerHit") {
          playLocalizedHit(event);
          this.burst(event.x, event.y, 0xff4444, LOW_POWER_MODE ? 8 : 20, 120);
          this.shockwaves.push({ x: event.x, y: event.y, radius: 8, maxRadius: 60, life: 0, ttl: 0.35, color: 0xff4444, alpha: 0.7 });
          if (event.playerId === myId) this.cameras.main.shake(140, 0.004 * performanceValue("shakeScale", 1));
        }
        if (event.type === "tankPlayerDeath") {
          playSfx("dead");
          this.burst(event.x, event.y, 0xff2200, LOW_POWER_MODE ? 20 : 55, 250);
          this.burst(event.x, event.y, 0xffaa00, LOW_POWER_MODE ? 10 : 30, 180);
          this.shockwaves.push({ x: event.x, y: event.y, radius: 12, maxRadius: 160, life: 0, ttl: 0.6, color: 0xff4400, alpha: 0.9 });
          this.shockwaves.push({ x: event.x, y: event.y, radius: 8, maxRadius: 100, life: 0, ttl: 0.4, color: 0xffcc00, alpha: 0.6 });
          if (event.playerId === myId) this.cameras.main.shake(280, 0.008 * performanceValue("shakeScale", 1));
        }
        if (event.type === "tankEnemyHit") {
          const hitColor = event.boss ? 0xffffff : 0x00ccff;
          this.burst(event.x, event.y, hitColor, LOW_POWER_MODE ? 8 : 24, 140);
          this.shockwaves.push({ x: event.x, y: event.y, radius: 8, maxRadius: event.boss ? 120 : 80, life: 0, ttl: 0.4, color: hitColor, alpha: 0.8 });
        }
        if (event.type === "tankEnemyDestroyed") {
          const destroyerId = String(event.killerId || event.ownerId || event.actorId || "");
          const killedByLocalBullet = destroyerId && destroyerId === String(myId || "")
            && event.source === "playerBullet"
            && event.ownerType === "player";
          if (killedByLocalBullet) {
            playSfx("enemyTankDie", {
              fallbackName: event.boss ? "gen" : "dead",
              volumeScale: event.boss ? 1.12 : 1
            });
          }
          const color = event.boss ? 0xffffff : (TANK_TIER_BULLET_COLORS[event.tier] || 0xffaa00);
          this.burst(event.x, event.y, color, LOW_POWER_MODE ? 18 : 46, 220);
          this.shockwaves.push({ x: event.x, y: event.y, radius: 10, maxRadius: event.boss ? 190 : 105, life: 0, ttl: 0.5, color, alpha: 0.82 });
        }
        if (event.type === "tankBossAbility") {
          const bossAbilityColors = {
            voidMines: 0xffdf57,
            mineRing: 0xffdf57,
            orbitMines: 0xff3b30,
            crossBurst: 0xf59e0b,
            armorDash: 0xffaa33,
            railSweep: 0xff3b30,
            splitVolley: 0xff6b6b,
            pinwheelRicochet: 0xc084fc,
            mirrorSplit: 0xb56bff,
            gravityWell: 0x8b5cf6
          };
          const color = bossAbilityColors[event.ability] || 0xffffff;
          this.burst(event.x, event.y, color, LOW_POWER_MODE ? 6 : 18, 120);
          this.shockwaves.push({ x: event.x, y: event.y, radius: 18, maxRadius: event.radius || 130, life: 0, ttl: 0.55, color, alpha: 0.42 });
        }
        if (event.type === "tankBossShockwave") {
          this.burst(event.x, event.y, 0xffffff, LOW_POWER_MODE ? 14 : 42, 260);
          this.shockwaves.push({ x: event.x, y: event.y, radius: 20, maxRadius: Math.max(160, event.radius || 260), life: 0, ttl: 0.62, color: 0xffffff, alpha: 0.92 });
          this.cameras.main.shake(LOW_POWER_MODE ? 120 : 220, (LOW_POWER_MODE ? 0.0025 : 0.0045) * performanceValue("shakeScale", 1));
        }
        if (event.type === "tankBossDefeated") {
          this.burst(event.x, event.y, 0xffffff, LOW_POWER_MODE ? 28 : 90, 320);
          this.burst(event.x, event.y, 0xc084fc, LOW_POWER_MODE ? 18 : 58, 260);
          this.shockwaves.push({ x: event.x, y: event.y, radius: 20, maxRadius: 260, life: 0, ttl: 0.85, color: 0xffffff, alpha: 0.95 });
        }
        if (event.type === "tankBulletBounce") {
          this.burst(event.x, event.y, 0xffffff, LOW_POWER_MODE ? 3 : 6, 40);
        }
        if (event.type === "tankMinePlaced") {
          this.burst(event.x, event.y, 0xffdf57, LOW_POWER_MODE ? 2 : 5, 35);
        }
        if (event.type === "tankMineExplode") {
          this.burst(event.x, event.y, 0xffaa00, LOW_POWER_MODE ? 12 : 36, 220);
          this.burst(event.x, event.y, 0xff3300, LOW_POWER_MODE ? 8 : 26, 190);
          this.shockwaves.push({ x: event.x, y: event.y, radius: 10, maxRadius: Math.max(80, event.radius || 80), life: 0, ttl: 0.45, color: 0xffaa00, alpha: 0.85 });
          this.cameras.main.shake(LOW_POWER_MODE ? 70 : 120, (LOW_POWER_MODE ? 0.0018 : 0.003) * performanceValue("shakeScale", 1));
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
        if (["hit", "death", "execute", "downed", "hooked", "unhooked", "ffaHit", "ffaKill"].includes(event.type)) {
          const heavy = event.type === "death" || event.type === "execute" || event.type === "downed" || event.type === "hooked" || event.type === "ffaKill";
          const hookBurstHidden = event.type === "hooked"
            && this.getPovSurvivorData()?.role === "killer"
            && !this.killerCanRevealWorldPoint(event.x, event.y);
          const isLocalSurvivorEvent = event.survivorId === myId;
          if (!hookBurstHidden && (adaptivePerformance.mode !== "ultra" || isLocalSurvivorEvent)) {
            const color = event.type === "unhooked" ? 0x75d5ff : event.type === "hooked" ? COLORS.hook : event.type === "ffaKill" ? 0xfb923c : COLORS.blood;
            const baseCount = event.type === "hooked" ? 52 : event.type === "execute" || event.type === "death" ? 62 : 38;
            const fxCount = adaptivePerformance.mode === "ultra" ? 5 : LOW_POWER_MODE ? Math.ceil(baseCount * 0.32) : baseCount;
            this.burst(event.x, event.y, color, fxCount, event.type === "unhooked" ? 140 : 220);
          }

          const shouldShakeForImpact = (event.type === "hit" || event.type === "downed" || event.type === "ffaHit") && isLocalSurvivorEvent;
          const shouldShakeForStateChange = ["death", "execute", "hooked", "ffaKill"].includes(event.type) && isLocalSurvivorEvent;
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
          playLocalizedDashAbilitySfx(event);
          const color = event.abilityId === "redshiftOrbs" ? 0xff3048 : event.abilityId === "voidReveal" ? 0xa78bfa : 0xcbd5e1;
          this.burst(event.x, event.y, color, adaptivePerformance.mode === "ultra" ? 0 : LOW_POWER_MODE ? 6 : 34, LOW_POWER_MODE ? 130 : 210);
          if (adaptivePerformance.mode === "normal") this.addShockwave(event.x, event.y, color, 0.55, event.radius || 155);
        }
        if (event.type === "survivorAbility") {
          playLocalizedDashAbilitySfx(event);
          const color = event.abilityId === "dashDart" || event.abilityId === "swiftVault" || event.abilityId === "speedBurst" ? 0xff9f1c
            : event.abilityId === "smokeDart" ? 0xa78bfa
              : event.abilityId === "voidSwirl" ? 0xef4444
              : event.abilityId === "healingDart" || event.abilityId === "healingPulse" ? 0x34d399
                : event.abilityId === "collectionBolt" || event.abilityId === "doubleOrb" || event.abilityId === "riftLens" ? 0xfbbf24
                  : event.abilityId === "hourglass" ? 0x67e8f9
                    : 0x7dd3fc;
          this.burst(event.x, event.y, color, adaptivePerformance.mode === "ultra" ? 0 : LOW_POWER_MODE ? 5 : 28, LOW_POWER_MODE ? 110 : 180);
          if (adaptivePerformance.mode === "normal") this.addShockwave(event.x, event.y, color, 0.42, event.abilityId === "healingPulse" || event.abilityId === "healingDart" ? (event.radius || 150) : event.abilityId === "collectionBolt" ? 92 : event.abilityId === "hourglass" ? 176 : 138);
        }
        if (event.type === "runnerProjectileFire") {
          playShooterOnlyDartSfx(event);
          const palette = this.runnerProjectilePalette(event.projectileType || event.abilityId);
          this.playSharedImpactFx(event, palette.mid, {
            ringColor: palette.ring,
            radius: 58,
            burstNormal: 12,
            burstLow: 4,
            burstUltra: 0,
            burstLife: LOW_POWER_MODE ? 90 : 135,
            shockwave: false
          });
        }
        if (event.type === "runnerProjectileExplode") this.playRunnerProjectileImpactFx(event);
        if (event.type === "redOrbSlow" && adaptivePerformance.mode !== "ultra") {
          this.burst(event.x, event.y, 0xff3048, LOW_POWER_MODE ? 4 : 18, 95);
        }
        if (event.type === "voidSwirlTriggered" && adaptivePerformance.mode !== "ultra") {
          this.burst(event.x, event.y, 0xef4444, LOW_POWER_MODE ? 7 : 26, 130);
          if (adaptivePerformance.mode === "normal") this.addShockwave(event.x, event.y, 0xff1f3a, 0.48, event.radius || 100);
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
        if (event.type === "dartBoxCollected") {
          playLocalizedDartBoxCollectedSfx(event);
          this.burst(event.x, event.y, 0x7dd3fc, adaptivePerformance.mode === "ultra" ? 4 : LOW_POWER_MODE ? 18 : 52, LOW_POWER_MODE ? 150 : 230);
          if (adaptivePerformance.mode !== "ultra") {
            this.addShockwave(event.x, event.y, 0x38bdf8, 0.58, Number(event.radius || 220));
            this.addShockwave(event.x, event.y, 0xe0faff, 0.28, Math.max(70, Number(event.radius || 220) * 0.55));
          }
        }
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
      this.syncSpaceBackdrop(time);
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
      this.updateDartBoxVisuals(dt);
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
      const serverVaultDuration = Number(data.vaultDuration || 0);
      const duration = Number.isFinite(serverVaultDuration) && serverVaultDuration > 0
        ? serverVaultDuration
        : vaultDurationForRole(data.role);
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
      } else if (Math.abs((playback.duration || duration) - duration) > 0.001) {
        playback.duration = duration;
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
      if (data.role === "survivor" && (data.speedBurst || 0) > 0 && !data.downed) speed *= cfgNumber(perkEffectForActor(data, "speedBurst", "survivor")?.speedMultiplier, LOCAL_SPEEDS.survivorSpeedBurstMult);
      if (data.role === "survivor" && (data.dashBoost || 0) > 0 && !data.downed) speed *= Math.max(1, cfgNumber(data.dashBoostMultiplier, 1.10));
      if (data.role === "survivor" && (data.orbSlow || data.voidSlow || 0) > 0) speed *= 0.58;
      if (data.role === "killer" && currentSnapshot?.objective?.voidBuffed) speed *= LOCAL_SPEEDS.killerEndgameMult;
      if (data.role === "killer" && (data.voidSpeedBoost || 0) > 0) speed *= cfgNumber(perkEffectForActor(data, "nullRush", "killer")?.speedMultiplier, 1.28);
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

    smokeCloudContainsPoint(cloud, x, y, padding = 0) {
      if (!cloud || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      const radius = Math.max(0, Number(cloud.radius || 0) + Number(padding || 0));
      if (radius <= 0) return false;
      return Math.hypot(Number(cloud.x || 0) - x, Number(cloud.y || 0) - y) <= radius;
    }

    smokeBlocksPointForSubject(subject, worldX, worldY, padding = 0) {
      if (!subject || this.isSpectatorOverviewMode()) return false;
      const clouds = Array.isArray(currentSnapshot?.smokeClouds) ? currentSnapshot.smokeClouds : [];
      if (!clouds.length) return false;
      const sourceX = subject.current?.x ?? subject.container?.x ?? 0;
      const sourceY = subject.current?.y ?? subject.container?.y ?? 0;
      const sourceClouds = clouds.filter((cloud) => this.smokeCloudContainsPoint(cloud, sourceX, sourceY, 2));
      if (sourceClouds.length) {
        return !sourceClouds.some((cloud) => this.smokeCloudContainsPoint(cloud, worldX, worldY, padding));
      }
      return clouds.some((cloud) => this.smokeCloudContainsPoint(cloud, worldX, worldY, padding));
    }

    smokeWallVisibilityFactor(item, subject) {
      if (!item || !subject) return 1;
      const samples = Array.isArray(item.samples) && item.samples.length
        ? item.samples
        : [{ x: item.centerX ?? (item.rect?.x || 0) + (item.rect?.w || 0) / 2, y: item.centerY ?? (item.rect?.y || 0) + (item.rect?.h || 0) / 2 }];
      let visible = 0;
      for (const sample of samples) {
        if (!this.smokeBlocksPointForSubject(subject, sample.x, sample.y, item.radius ? Math.min(10, item.radius * 0.08) : 0)) visible += 1;
      }
      return clamp(visible / Math.max(1, samples.length), 0, 1);
    }

    computeSinglePointVisionAlpha(worldX, worldY, subject) {
      if (!subject) return 0;
      const role = subject.data?.role || "survivor";
      const sourceX = subject.current?.x ?? subject.container?.x ?? 0;
      const sourceY = subject.current?.y ?? subject.container?.y ?? 0;
      const facing = subject.current?.angle ?? subject.container?.rotation ?? 0;
      if (this.smokeBlocksPointForSubject(subject, worldX, worldY, ACTOR_VISION.POINT_RADIUS * 0.35)) return 0;
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
      const backLength = length * cfgNumber(perkEffectForActor(subject?.data, "hourglass", "survivor")?.backLengthMultiplier, LIGHTING.SURVIVOR_HOURGLASS_BACK_LENGTH_MULT);
      const backAngle = Math.min(Math.PI * 1.08, coneAngle * cfgNumber(perkEffectForActor(subject?.data, "hourglass", "survivor")?.backAngleMultiplier, LIGHTING.SURVIVOR_HOURGLASS_BACK_ANGLE_MULT));
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
        if (this.smokeBlocksPointForSubject(subject, sample.x, sample.y, ACTOR_VISION.POINT_RADIUS * 0.25)) continue;
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
        } else if (isTanksSnapshot() && item.serverVisible) {
          // Tank Assault: server already grants global teammate visibility.
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
        if (item.pickupAura) item.pickupAura.setAlpha(alpha);
        if (item.boostAura) item.boostAura.setAlpha(alpha);
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

      if (this.isSpectatorOverviewMode() || isTanksSnapshot()) {
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
      const backLength = length * cfgNumber(perkEffectForActor(subject?.data, "hourglass", "survivor")?.backLengthMultiplier, LIGHTING.SURVIVOR_HOURGLASS_BACK_LENGTH_MULT);
      const backConeAngle = Math.min(Math.PI * 1.08, coneAngle * cfgNumber(perkEffectForActor(subject?.data, "hourglass", "survivor")?.backAngleMultiplier, LIGHTING.SURVIVOR_HOURGLASS_BACK_ANGLE_MULT));
      const nearRadius = role === "killer" ? WALL_VISION.KILLER_NEAR_RADIUS : WALL_VISION.SURVIVOR_NEAR_RADIUS;

      if (role !== "killer") this.killerWallVisionStableKey = "";
      if (role === "killer" && (LOW_POWER_MODE || adaptivePerformance.mode !== "normal") && !(currentSnapshot?.smokeClouds || []).length) {
        // Low-performance Void POV does not need per-frame wall fading math. The Void
        // should read the whole arena while local prediction gets the CPU budget. Smoke still
        // cuts vision, because fair play beats cheap wizard X-ray nonsense.
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
          } else {
            const smokeFactor = this.smokeWallVisibilityFactor(item, subject);
            if (smokeFactor <= 0.001) {
              item.targetAlpha = 0;
            } else if (role === "killer" || item.outerWall) {
              // Killer gets normal map readability. Survivors get the cone/near-bubble horror effect.
              // Smoke still walls off anything on the other side of the cloud.
              item.targetAlpha = smokeFactor;
            } else {
              const forwardAlpha = this.computeWallVisionAlpha(item, worldX, worldY, facing, length, coneAngle, nearRadius);
              const backAlpha = hourglassActive
                ? this.computeWallVisionAlpha(item, worldX, worldY, facing + Math.PI, backLength, backConeAngle, nearRadius)
                : 0;
              item.targetAlpha = Math.max(forwardAlpha, backAlpha) * smokeFactor;
            }
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
        if (item.data?.role === "survivor" && ((item.data?.speedBurst || 0) > 0 || (item.data?.dashBoost || 0) > 0 || (item.data?.nebulizerVaporTrail || 0) > 0)) {
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
        this.drawDashBoostAura(item, item.data);
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

    getTankFixedCameraZoom(map = currentSnapshot?.map || this.map) {
      const cam = this.cameras?.main;
      const viewW = Math.max(1, Number(this.scale?.width || cam?.width || window.innerWidth || 1280));
      const viewH = Math.max(1, Number(this.scale?.height || cam?.height || window.innerHeight || 720));
      const mapW = Math.max(1, Number(map?.width || this.map?.width || 1));
      const mapH = Math.max(1, Number(map?.height || this.map?.height || 1));
      const padding = Math.max(0, cfgNumber(GAMEPLAY_CONFIG.tanks?.cameraFitPadding, 44));
      const usableW = Math.max(64, viewW - padding * 2);
      const usableH = Math.max(64, viewH - padding * 2);
      const fitW = usableW / mapW;
      const fitH = usableH / mapH;
      const minZoom = Math.max(0.05, cfgNumber(GAMEPLAY_CONFIG.tanks?.cameraFitMinZoom, 0.25));
      const maxZoom = Math.max(minZoom, cfgNumber(GAMEPLAY_CONFIG.tanks?.cameraFitMaxZoom, 1.08));
      return clamp(Math.min(fitW, fitH), minZoom, maxZoom);
    }

    updateTankFixedCamera(mapOverride = null) {
      const cam = this.cameras.main;
      const map = mapOverride || currentSnapshot?.map || this.map;
      if (!cam || !map) return;
      const mapW = Math.max(1, Number(map.width || this.map?.width || 1));
      const mapH = Math.max(1, Number(map.height || this.map?.height || 1));
      const x = mapW / 2;
      const y = mapH / 2;
      const zoom = this.getTankFixedCameraZoom(map);

      this.cameraZoomPlan = {
        base: zoom,
        rawOffset: 0,
        clampedOffset: 0,
        zoom,
        modifiers: [{ id: "tankFixedMap", value: 0, absoluteZoom: zoom }]
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
      if (isTanksSnapshot()) {
        this.updateTankFixedCamera();
        return;
      }

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
      const dartBoxKey = (currentSnapshot?.dartBoxes || []).map((b) => `${b.id}:${Math.round((b.progress || 0) * 20)}`).join(",");
      return `${hookKey}#${gateKey}#${dotKey}#boxes:${dartBoxKey}#rifts:${this.riftsAreComplete() ? 1 : 0}`;
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
      const animatingDartBoxes = !!this.dartBoxesAnimating;
      const animatingHooks = (currentSnapshot?.map?.hooks || this.map?.hooks || []).some((hook) => hook && hook.active !== false);
      const animatingGates = (currentSnapshot?.map?.gates || this.map?.gates || []).some((gate) => gate && gate.open);
      const animated = animatingDots || animatingDartBoxes || animatingHooks || animatingGates;
      const interval = 1 / ((animatingDots || animatingDartBoxes) ? performanceValue("dotFadeFps", DOT_FADE_VISUAL.FPS) : (animatingHooks || animatingGates) ? Math.min(12, performanceValue("dynamicWorldFps", PERFORMANCE.DYNAMIC_WORLD_FPS) + 3) : performanceValue("dynamicWorldFps", PERFORMANCE.DYNAMIC_WORLD_FPS));
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

      if (this.isSpectatorOverviewMode() || isTanksSnapshot()) {
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
        const backLength = vlength * cfgNumber(perkEffectForActor(me.data, "hourglass", "survivor")?.backLengthMultiplier, LIGHTING.SURVIVOR_HOURGLASS_BACK_LENGTH_MULT);
        const backAngle = Math.min(Math.PI * 1.08, vangle * cfgNumber(perkEffectForActor(me.data, "hourglass", "survivor")?.backAngleMultiplier, LIGHTING.SURVIVOR_HOURGLASS_BACK_ANGLE_MULT));
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

    updateRunnerProjectileVisuals(rawProjectiles, dt) {
      const visuals = this.runnerProjectileVisuals || (this.runnerProjectileVisuals = new Map());
      const seen = new Set();
      const rawList = Array.isArray(rawProjectiles) ? rawProjectiles : [];
      const safeDt = Math.max(0, Math.min(0.05, Number(dt) || 0));

      for (const raw of rawList) {
        if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
        const id = String(raw.id || `${Math.round(raw.x)}:${Math.round(raw.y)}:${Math.round(raw.angle || 0)}`);
        seen.add(id);

        const angle = Number(raw.angle || 0);
        const vx = Math.cos(angle);
        const vy = Math.sin(angle);
        const speed = Math.max(900, Number(raw.speed || 1500));
        const rawX = Number(raw.x);
        const rawY = Number(raw.y);
        const projectileType = String(raw.type || raw.abilityId || "boost");
        const isFfaShotVisual = projectileType === "ffaShot" || projectileType === "voidShooter";
        let visual = visuals.get(id);

        if (!visual) {
          visual = {
            id,
            x: rawX,
            y: rawY,
            angle,
            vx,
            vy,
            speed,
            type: projectileType,
            abilityId: raw.abilityId || raw.type || null,
            ownerId: raw.ownerId || null,
            radius: raw.radius,
            trail: [{ x: rawX, y: rawY }]
          };
          visuals.set(id, visual);
        }

        const distanceToServer = Math.hypot(rawX - visual.x, rawY - visual.y);
        const snapDistance = isFfaShotVisual ? 560 : 210;
        if (distanceToServer > snapDistance) {
          visual.x = rawX;
          visual.y = rawY;
          visual.trail = [{ x: rawX, y: rawY }];
        } else {
          const correction = 1 - Math.exp(-safeDt * (isFfaShotVisual ? 34 : 24));
          visual.x += (rawX - visual.x) * correction;
          visual.y += (rawY - visual.y) * correction;
        }

        visual.angle = angle;
        visual.vx = Number.isFinite(vx) ? vx : 1;
        visual.vy = Number.isFinite(vy) ? vy : 0;
        visual.speed = speed;
        visual.type = projectileType || visual.type || "boost";
        visual.abilityId = raw.abilityId || visual.abilityId || visual.type;
        visual.ownerId = raw.ownerId || visual.ownerId || null;
        visual.radius = raw.radius;

        const maxLead = isFfaShotVisual
          ? Math.max(170, Math.min(440, speed * 0.06))
          : Math.max(36, Math.min(120, speed * 0.075));
        const currentLead = (visual.x - rawX) * visual.vx + (visual.y - rawY) * visual.vy;
        const travelStep = Math.min(speed * safeDt, Math.max(0, maxLead - currentLead));
        if (travelStep > 0) {
          visual.x += visual.vx * travelStep;
          visual.y += visual.vy * travelStep;
        }

        const trail = visual.trail || (visual.trail = []);
        const last = trail[trail.length - 1];
        if (!last || Math.hypot(visual.x - last.x, visual.y - last.y) >= 7) {
          trail.push({ x: visual.x, y: visual.y });
          const maxTrail = LOW_POWER_MODE ? 5 : 10;
          while (trail.length > maxTrail) trail.shift();
        }
      }

      for (const id of [...visuals.keys()]) {
        if (!seen.has(id)) {
          const visual = visuals.get(id);
          this.playMissingRunnerProjectileImpactFx(visual);
          visuals.delete(id);
        }
      }

      return [...visuals.values()];
    }

    runnerProjectilePalette(type = "boost") {
      const key = String(type || "boost");
      if (key === "smoke") return { outer: 0x1b1236, mid: 0x8b5cf6, core: 0xf5e9ff, ring: 0xc4b5fd };
      if (key === "collect") return { outer: 0x7c3f00, mid: 0xfbbf24, core: 0xfff7d1, ring: 0xfacc15 };
      if (key === "heal") return { outer: 0x064e3b, mid: 0x34d399, core: 0xd1fae5, ring: 0x6ee7b7 };
      if (key === "ffaShot" || key === "voidShooter") return { outer: 0x4c1d95, mid: 0xfb923c, core: 0xffedd5, ring: 0xf97316 };
      if (key === "boost") return { outer: 0x7c2d12, mid: 0xff9f1c, core: 0xffedd5, ring: 0xfb923c };
      return { outer: 0xff8b2b, mid: 0xffb347, core: 0xfff4c4, ring: 0xffc05a };
    }

    drawRunnerProjectileStar(g, x, y, size, color = 0xfff1b0, alpha = 0.72, rotation = 0) {
      if (!g || !Number.isFinite(x) || !Number.isFinite(y) || !(size > 0)) return;
      const outer = size;
      const inner = size * 0.42;
      g.fillStyle(color, alpha);
      g.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const angle = rotation + (Math.PI / 4) * i;
        const radius = i % 2 === 0 ? outer : inner;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillPath();
    }

    drawRunnerProjectileBubbleTrail(g, projectile, ultra) {
      if (!g || !projectile) return;
      const trail = Array.isArray(projectile.trail) ? projectile.trail : [];
      if (!trail.length) return;
      const trailCount = trail.length;
      const headBias = ultra ? 0.72 : 0.58;
      for (let i = 0; i < trailCount; i += 1) {
        const node = trail[i];
        if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        const t = (i + 1) / Math.max(1, trailCount);
        const fade = Math.max(0.08, t * headBias);
        const bubbleRadius = ultra ? (1.8 + t * 3.2) : LOW_POWER_MODE ? (2.2 + t * 4.2) : (2.8 + t * 5.4);

        const palette = this.runnerProjectilePalette(projectile.type);
        g.fillStyle(palette.outer, 0.08 + fade * 0.16);
        g.fillCircle(node.x, node.y, bubbleRadius * 1.65);
        g.fillStyle(palette.mid, 0.12 + fade * 0.28);
        g.fillCircle(node.x, node.y, bubbleRadius);
        g.fillStyle(palette.core, 0.18 + fade * 0.34);
        g.fillCircle(node.x - bubbleRadius * 0.24, node.y - bubbleRadius * 0.24, Math.max(0.8, bubbleRadius * 0.34));

        if (!ultra && (!LOW_POWER_MODE || i === trailCount - 1 || i % 2 === 0)) {
          const starAlpha = LOW_POWER_MODE ? (0.12 + fade * 0.16) : (0.18 + fade * 0.24);
          const starSize = LOW_POWER_MODE ? (1.6 + t * 1.4) : (2 + t * 1.9);
          const rotation = performance.now() / 320 + i * 0.7;
          this.drawRunnerProjectileStar(g, node.x + bubbleRadius * 0.42, node.y - bubbleRadius * 0.34, starSize, 0xfff0b2, starAlpha, rotation);
        }
      }
    }

    drawRunnerProjectile(g, projectile) {
      if (!g || !projectile || !Number.isFinite(projectile.x) || !Number.isFinite(projectile.y)) return;
      const angle = Number(projectile.angle || 0);
      const vx = Number.isFinite(projectile.vx) ? projectile.vx : Math.cos(angle);
      const vy = Number.isFinite(projectile.vy) ? projectile.vy : Math.sin(angle);
      const ultra = adaptivePerformance.mode === "ultra";
      const tail = ultra ? 42 : LOW_POWER_MODE ? 56 : 84;
      const tx = projectile.x - vx * tail;
      const ty = projectile.y - vy * tail;
      const midX = projectile.x - vx * (tail * 0.52);
      const midY = projectile.y - vy * (tail * 0.52);

      this.drawRunnerProjectileBubbleTrail(g, projectile, ultra);

      const palette = this.runnerProjectilePalette(projectile.type);
      const isSmoke = String(projectile.type || "") === "smoke";
      const now = performance.now();
      if (isSmoke) {
        const swirl = 0.82 + Math.sin(now / 90 + projectile.x * 0.012) * 0.18;
        const cometRadius = ultra ? 7.5 : LOW_POWER_MODE ? 9.5 : 12.5;
        const glowRadius = cometRadius * 1.9;
        g.lineStyle(LOW_POWER_MODE ? 5 : 7, palette.outer, ultra ? 0.10 : 0.16);
        g.lineBetween(tx, ty, projectile.x, projectile.y);
        g.lineStyle(LOW_POWER_MODE ? 2.8 : 4.0, palette.mid, ultra ? 0.20 : 0.34);
        g.lineBetween(midX, midY, projectile.x, projectile.y);

        for (let i = 0; i < (ultra ? 2 : LOW_POWER_MODE ? 3 : 5); i += 1) {
          const t = i / Math.max(1, (ultra ? 2 : LOW_POWER_MODE ? 3 : 5) - 1);
          const px = projectile.x - vx * (8 + i * 6) + Math.sin(now / (160 + i * 30) + i) * 2.4;
          const py = projectile.y - vy * (8 + i * 6) + Math.cos(now / (170 + i * 24) + i * 0.7) * 2.4;
          g.fillStyle(i % 2 === 0 ? 0xe9d5ff : 0xc4b5fd, 0.06 + (1 - t) * 0.12);
          g.fillCircle(px, py, cometRadius * (0.55 + (1 - t) * 0.45));
        }

        g.fillStyle(palette.outer, 0.20 * swirl);
        g.fillCircle(projectile.x - vx * 4, projectile.y - vy * 4, glowRadius);
        g.fillStyle(palette.mid, 0.30 * swirl);
        g.fillCircle(projectile.x, projectile.y, cometRadius * 1.15);
        g.fillStyle(0xf5e9ff, 0.88);
        g.fillCircle(projectile.x, projectile.y, cometRadius * 0.56);
        g.fillStyle(0xffffff, 0.44);
        g.fillCircle(projectile.x - vx * 1.4, projectile.y - vy * 1.4, Math.max(1.4, cometRadius * 0.18));
        return;
      }

      g.lineStyle(LOW_POWER_MODE ? 4 : 6, palette.outer, ultra ? 0.12 : 0.18);
      g.lineBetween(tx, ty, projectile.x, projectile.y);
      g.lineStyle(LOW_POWER_MODE ? 2.4 : 3.4, palette.mid, ultra ? 0.28 : 0.42);
      g.lineBetween(midX, midY, projectile.x, projectile.y);

      const flicker = 0.82 + Math.sin(now / 42 + projectile.x * 0.01) * 0.16;
      const coreRadius = ultra ? 4.5 : LOW_POWER_MODE ? 5.5 : 7;
      const shellRadius = ultra ? 8 : LOW_POWER_MODE ? 10 : 13;
      const ringRadius = ultra ? 11 : LOW_POWER_MODE ? 14 : 18;

      g.fillStyle(palette.outer, 0.22 * flicker);
      g.fillCircle(projectile.x - vx * 4, projectile.y - vy * 4, shellRadius);
      g.fillStyle(palette.mid, 0.68 * flicker);
      g.fillCircle(projectile.x, projectile.y, shellRadius * 0.82);
      g.fillStyle(palette.core, 0.98);
      g.fillCircle(projectile.x, projectile.y, coreRadius);
      g.fillStyle(0xffffff, 0.72);
      g.fillCircle(projectile.x - vx * 1.4, projectile.y - vy * 1.4, Math.max(1.2, coreRadius * 0.36));
      g.lineStyle(ultra ? 1.4 : 2.1, palette.ring, 0.84 * flicker);
      g.strokeCircle(projectile.x, projectile.y, ringRadius);
      if (!ultra) {
        this.drawRunnerProjectileStar(g, projectile.x + vx * 2.8, projectile.y + vy * 2.8, LOW_POWER_MODE ? 3.1 : 3.8, 0xffefb0, 0.34 + flicker * 0.18, now / 260);
      }
    }

    drawVoidSwirl(g, swirl) {
      if (!g || !swirl || !Number.isFinite(swirl.x) || !Number.isFinite(swirl.y)) return;
      const now = performance.now();
      const radius = Math.max(16, Number(swirl.radius || 72));
      const duration = Math.max(0.1, Number(swirl.duration || 6));
      const remaining = Math.max(0, Number(swirl.remaining || duration));
      const lifeRatio = clamp(remaining / duration, 0, 1);
      const fadeIn = clamp((duration - remaining) / 0.22, 0, 1);
      const alpha = Math.min(lifeRatio, fadeIn) * (LOW_POWER_MODE ? 0.68 : 0.88);
      if (alpha <= 0.01) return;
      const phase = now / (LOW_POWER_MODE ? 520 : 380) + hash2(Math.round(swirl.x), Math.round(swirl.y)) * Math.PI * 2;
      const pulse = 1 + Math.sin(now / 260 + phase) * 0.04;
      const r = radius * pulse;

      // Void Swirl is a trap spot, not an oval puddle. Everything here is drawn from circles.
      g.fillStyle(0x250207, alpha * 0.44);
      g.fillCircle(swirl.x, swirl.y, r * 1.02);
      g.fillStyle(0x4a0510, alpha * 0.26);
      g.fillCircle(swirl.x, swirl.y, r * 0.74);
      g.fillStyle(0x7f1d1d, alpha * 0.16);
      g.fillCircle(swirl.x, swirl.y, r * 0.46);

      const arms = LOW_POWER_MODE || adaptivePerformance.mode === "ultra" ? 3 : 4;
      for (let i = 0; i < arms; i += 1) {
        const spin = phase + i * (Math.PI * 2 / arms);
        const steps = LOW_POWER_MODE ? 12 : 18;
        g.lineStyle(i % 2 ? 2.1 : 2.8, i % 2 ? 0xfb7185 : 0xef4444, alpha * (i % 2 ? 0.52 : 0.68));
        g.beginPath();
        for (let s = 0; s <= steps; s += 1) {
          const t = s / steps;
          const a = spin + t * Math.PI * 1.42;
          const rr = r * (0.10 + t * 0.74);
          const x = swirl.x + Math.cos(a) * rr;
          const y = swirl.y + Math.sin(a) * rr;
          if (s === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokePath();
      }

      const ringAlpha = alpha * (0.30 + Math.sin(now / 180 + phase) * 0.09);
      g.lineStyle(LOW_POWER_MODE ? 1.4 : 2.0, 0xffccd5, ringAlpha);
      g.strokeCircle(swirl.x, swirl.y, r * 0.98);
      g.lineStyle(LOW_POWER_MODE ? 2 : 3, 0x7f1d1d, alpha * 0.32);
      g.strokeCircle(swirl.x, swirl.y, r * 0.66);

      if (!LOW_POWER_MODE && adaptivePerformance.mode === "normal") {
        for (let i = 0; i < 5; i += 1) {
          const a = phase * 1.3 + i * 1.31;
          const sparkR = r * (0.24 + (i % 3) * 0.16);
          const x = swirl.x + Math.cos(a) * sparkR;
          const y = swirl.y + Math.sin(a * 1.08) * sparkR;
          this.drawRunnerProjectileStar(g, x, y, 1.7 + (i % 2) * 0.7, i % 2 ? 0xffccd5 : 0xff4d6d, alpha * 0.34, -a);
        }
      }
    }

    drawVoidSwirls(g, swirls) {
      const list = Array.isArray(swirls) ? swirls : [];
      if (!g || !list.length) return;
      for (const swirl of list) this.drawVoidSwirl(g, swirl);
    }

    updateSmokeCloudVisuals(rawClouds, dt) {
      const visuals = this.smokeCloudVisuals || (this.smokeCloudVisuals = new Map());
      const seen = new Set();
      const safeDt = Math.max(0, Math.min(0.05, Number(dt) || 0));
      for (const raw of Array.isArray(rawClouds) ? rawClouds : []) {
        if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
        const id = String(raw.id || `${Math.round(raw.x)}:${Math.round(raw.y)}:${Math.round(raw.radius || 0)}`);
        seen.add(id);
        let visual = visuals.get(id);
        const radius = Math.max(12, Number(raw.radius || 120));
        const remaining = Math.max(0, Number(raw.remaining || 0));
        const duration = Math.max(0.1, Number(raw.duration || remaining || 1));
        if (!visual) {
          visual = {
            id,
            x: Number(raw.x),
            y: Number(raw.y),
            radius: radius * 0.35,
            targetRadius: radius,
            remaining,
            duration,
            viewerInside: !!raw.viewerInside,
            phase: Math.random() * Math.PI * 2
          };
          visuals.set(id, visual);
        }
        const lerp = 1 - Math.exp(-safeDt * 9);
        visual.x += (Number(raw.x) - visual.x) * lerp;
        visual.y += (Number(raw.y) - visual.y) * lerp;
        visual.radius += (radius - visual.radius) * lerp;
        visual.targetRadius = radius;
        visual.remaining = remaining;
        visual.duration = duration;
        visual.viewerInside = !!raw.viewerInside;
      }
      for (const id of [...visuals.keys()]) {
        if (!seen.has(id)) {
          const visual = visuals.get(id);
          this.playMissingRunnerProjectileImpactFx(visual);
          visuals.delete(id);
        }
      }
      return [...visuals.values()];
    }

    drawSmokeClouds(dt) {
      const g = this.smokeGraphics;
      if (!g) return;
      const clouds = this.updateSmokeCloudVisuals(currentSnapshot?.smokeClouds || [], dt);
      g.clear();
      this.lastSmokeHadClouds = clouds.length > 0;
      if (!clouds.length) return;
      const now = performance.now();
      for (const cloud of clouds) {
        const viewerInside = !!cloud.viewerInside;
        const lifeRatio = clamp(cloud.remaining / Math.max(0.1, cloud.duration), 0, 1);
        const fadeIn = clamp((cloud.duration - cloud.remaining) / 0.35, 0, 1);
        const strength = Math.min(lifeRatio, fadeIn);
        const alpha = viewerInside ? (0.18 + 0.14 * strength) : (0.40 + 0.24 * strength);
        const breathe = 1 + Math.sin(now / 920 + cloud.phase) * (viewerInside ? 0.010 : 0.016);
        const radius = cloud.radius * breathe;
        const ringPuffs = adaptivePerformance.mode === "ultra" ? 5 : LOW_POWER_MODE ? 6 : 8;
        const innerPuffs = adaptivePerformance.mode === "ultra" ? 3 : LOW_POWER_MODE ? 4 : 5;
        const emberCount = adaptivePerformance.mode === "ultra" ? 4 : LOW_POWER_MODE ? 5 : 8;
        const shellAlpha = viewerInside ? alpha * 0.16 : alpha * 0.30;
        const innerAlpha = viewerInside ? alpha * 0.08 : alpha * 0.15;

        // Main circular body: keep the cloud reading clearly as a round void planet.
        g.fillStyle(0x05030a, viewerInside ? alpha * 0.82 : alpha * 0.96);
        g.fillCircle(cloud.x, cloud.y, radius);
        g.fillStyle(0x13081e, viewerInside ? alpha * 0.10 : alpha * 0.38);
        g.fillCircle(cloud.x + radius * 0.05, cloud.y - radius * 0.03, radius * 0.86);
        g.fillStyle(0x3b1564, viewerInside ? alpha * 0.05 : alpha * 0.12);
        g.fillCircle(cloud.x - radius * 0.16, cloud.y + radius * 0.12, radius * 0.58);

        // Soft smoky ring around the outside so it still feels like a cloud instead of a flat disk.
        for (let i = 0; i < ringPuffs; i += 1) {
          const t = i / Math.max(1, ringPuffs);
          const angle = cloud.phase * 0.62 + Math.PI * 2 * t + now / (5200 + i * 73);
          const orbit = radius * (0.78 + (i % 2) * 0.05 + Math.sin(now / (1300 + i * 66) + i) * 0.014);
          const px = cloud.x + Math.cos(angle) * orbit;
          const py = cloud.y + Math.sin(angle * 1.02) * orbit * 0.96;
          const puffRadius = radius * (0.18 + (i % 3) * 0.020);
          const color = i % 3 === 0 ? 0xf5e9ff : i % 3 === 1 ? 0xc4b5fd : 0x1f1235;
          g.fillStyle(color, shellAlpha * (i % 2 === 0 ? 0.70 : 0.54));
          g.fillCircle(px, py, puffRadius);
        }

        // A few internal smoke pockets for motion, but keep them restrained and circular.
        for (let i = 0; i < innerPuffs; i += 1) {
          const angle = cloud.phase * 1.06 + now / (1900 + i * 120) + i * 1.24;
          const orbit = radius * (0.16 + i * 0.10);
          const px = cloud.x + Math.cos(angle) * orbit;
          const py = cloud.y + Math.sin(angle * 1.08) * orbit * 0.82;
          const puffRadius = radius * (0.14 - i * 0.012);
          const color = i % 2 ? 0x312e81 : 0x581c87;
          g.fillStyle(color, innerAlpha * (0.90 - i * 0.10));
          g.fillCircle(px, py, puffRadius);
        }

        // Gentle circular rim glow so the gameplay boundary is easy to read.
        g.lineStyle(adaptivePerformance.mode === "ultra" ? 1.1 : 1.5, 0xd8b4fe, viewerInside ? alpha * 0.06 : alpha * 0.14);
        g.strokeCircle(cloud.x, cloud.y, radius * 0.98);

        // Tiny star embers for the void vibe.
        for (let i = 0; i < emberCount; i += 1) {
          const angle = cloud.phase * 1.2 + i * 0.88 + now / (5600 + i * 55);
          const orbit = radius * (0.12 + ((i * 23) % 100) / 100 * 0.44);
          const px = cloud.x + Math.cos(angle) * orbit;
          const py = cloud.y + Math.sin(angle * 1.1) * orbit * 0.84;
          const starSize = adaptivePerformance.mode === "ultra" ? 0.55 : LOW_POWER_MODE ? 0.72 : 0.94;
          const starAlpha = (viewerInside ? alpha * 0.05 : alpha * 0.12) * (0.62 + (i % 3) * 0.13);
          const color = i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xe9d5ff : 0xc4b5fd;
          g.fillStyle(color, starAlpha);
          g.fillCircle(px, py, starSize);
        }
      }
    }


    updateParticles(dt) {
      const g = this.particleGraphics;
      if (!g) return;
      const visibleProjectiles = currentSnapshot?.runnerProjectiles || [];
      const visibleSwirls = currentSnapshot?.voidSwirls || [];
      const smokeClouds = currentSnapshot?.smokeClouds || [];
      const hasSmokeFx = smokeClouds.length > 0 || (this.smokeCloudVisuals?.size || 0) > 0;
      if (hasSmokeFx) {
        this.smokeRedrawTimer = (this.smokeRedrawTimer || 0) + dt;
        const smokeInterval = 1 / Math.max(1, performanceValue("smokeFps", LOW_POWER_MODE ? 14 : 24));
        if (this.smokeRedrawTimer >= smokeInterval) {
          this.drawSmokeClouds(this.smokeRedrawTimer);
          this.smokeRedrawTimer = 0;
        }
      } else if (this.smokeGraphics && (this.smokeLayerDirty || this.lastSmokeHadClouds)) {
        this.smokeGraphics.clear();
        this.lastSmokeHadClouds = false;
        this.smokeLayerDirty = false;
      }
      const hasTankFx = isTanksSnapshot() && (currentSnapshot?.tank?.enemies?.length > 0 || currentSnapshot?.tank?.bullets?.length > 0 || currentSnapshot?.tank?.mines?.length > 0);
      const hasFx = this.shockwaves.length > 0 || this.particles.length > 0 || visibleProjectiles.length > 0 || visibleSwirls.length > 0 || (this.runnerProjectileVisuals?.size || 0) > 0 || hasTankFx;
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
      const projectileVisuals = this.updateRunnerProjectileVisuals(visibleProjectiles, stepDt);
      this.drawVoidSwirls(g, visibleSwirls);
      for (const projectile of projectileVisuals) {
        this.drawRunnerProjectile(g, projectile);
      }
      if (isTanksSnapshot()) this.drawTankMode(g, stepDt);
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

  const TANK_TIER_SKINS = {
    husk: { dark: 0x140b06, base: 0x3a2414, mid: 0x6b4724, accent: 0xb78342, glow: 0xffc36a, size: 0.82 },
    shade: { dark: 0x080a0c, base: 0x20242a, mid: 0x4a525a, accent: 0x9aa3aa, glow: 0xd7dee5, size: 0.86 },
    bolt: { dark: 0x001112, base: 0x05363a, mid: 0x0f7375, accent: 0x23c7c9, glow: 0x8ffcff, size: 0.88 },
    sapper: { dark: 0x171000, base: 0x4a3500, mid: 0x8a6600, accent: 0xf2c84b, glow: 0xfff08a, size: 0.9 },
    charger: { dark: 0x160000, base: 0x420808, mid: 0x8a1717, accent: 0xff3b30, glow: 0xff8a80, size: 0.95 },
    sniper: { dark: 0x001208, base: 0x063516, mid: 0x137c3a, accent: 0x2ee86f, glow: 0x9dffbd, size: 0.92 },
    elite: { dark: 0x100018, base: 0x2e063f, mid: 0x64148a, accent: 0xbc4dff, glow: 0xefb5ff, size: 1 },
    phantom: { dark: 0x11141a, base: 0x38404c, mid: 0xa9b6c6, accent: 0xffffff, glow: 0xffffff, size: 0.96 },
    blackHunter: { dark: 0x020202, base: 0x070707, mid: 0x1b1b1b, accent: 0x3a3a3a, glow: 0xffffff, size: 1.02 },
    amberBoss: { dark: 0x1f1305, base: 0x7c3f12, mid: 0xd97706, accent: 0xfbbf24, glow: 0xffe08a, size: 1.05 },
    crimsonBoss: { dark: 0x260206, base: 0x7f0c18, mid: 0xdc2626, accent: 0xff7a7a, glow: 0xffb4b4, size: 1.06 },
    prismBoss: { dark: 0x15042c, base: 0x4c1d95, mid: 0x7c3aed, accent: 0xc084fc, glow: 0xf0abfc, size: 1.07 },
    voidBoss: { dark: 0x02030a, base: 0xf4f8ff, mid: 0xcfd7ff, accent: 0xffffff, glow: 0xffffff, size: 1.08 },
    // Backward aliases for old snapshots during hot reloads. Because stale state is immortal, apparently.
    wraith: { dark: 0x000814, base: 0x081830, mid: 0x1a3560, accent: 0x3388dd, glow: 0x66ccff, size: 0.9 },
    specter: { dark: 0x0a0014, base: 0x1a0830, mid: 0x3a1460, accent: 0x8822cc, glow: 0xcc66ff, size: 0.95 },
    abyss: { dark: 0x0a0000, base: 0x200808, mid: 0x441010, accent: 0xcc2222, glow: 0xff5544, size: 1.1 }
  };

  const TANK_TIER_BULLET_COLORS = {
    player: 0x00ccff,
    husk: 0xffc36a,
    shade: 0xd7dee5,
    bolt: 0x8ffcff,
    sapper: 0xffdf57,
    charger: 0xff4f4f,
    sniper: 0x9dffbd,
    elite: 0xd36bff,
    phantom: 0xffffff,
    blackHunter: 0xffffff,
    amberBoss: 0xfbbf24,
    crimsonBoss: 0xff4f4f,
    prismBoss: 0xc084fc,
    voidBoss: 0xffffff,
    wraith: 0x44aaff,
    specter: 0xcc44ff,
    abyss: 0xff3333
  };

  GameScene.prototype.drawTankMode = function(g, dt) {
    const snapshot = currentSnapshot;
    if (!snapshot || !snapshot.tank) return;
    const tank = snapshot.tank;

    if (!this.tankEnemyVisuals) this.tankEnemyVisuals = new Map();
    if (!this.tankBulletVisuals) this.tankBulletVisuals = new Map();

    const seenEnemies = new Set();
    for (const enemy of tank.enemies || []) {
      seenEnemies.add(enemy.id);
      let visual = this.tankEnemyVisuals.get(enemy.id);
      if (!visual) {
        visual = {
          x: enemy.x,
          y: enemy.y,
          aimAngle: enemy.aimAngle,
          dead: enemy.dead,
          deathAlpha: 1,
          tracks: [],
          lastTrackX: enemy.x,
          lastTrackY: enemy.y
        };
        this.tankEnemyVisuals.set(enemy.id, visual);
      }
      if (enemy.dead && !visual.dead) {
        visual.dead = true;
        visual.deathAlpha = 1;
      }
      if (!enemy.dead) {
        const lerp = 1 - Math.exp(-dt * 18);
        visual.x += (enemy.x - visual.x) * lerp;
        visual.y += (enemy.y - visual.y) * lerp;
        visual.aimAngle = enemy.aimAngle;
      }

      if (visual.dead) {
        visual.deathAlpha = Math.max(0, visual.deathAlpha - dt * 2.5);
        if (visual.deathAlpha <= 0) continue;
      }

      const skin = TANK_TIER_SKINS[enemy.tier] || TANK_TIER_SKINS.husk;
      const baseSize = (enemy.size || 30) * (skin.size || 1);
      const now = performance.now();
      const pulse = Math.sin(now / 220 + visual.x * 0.01) * 0.5 + 0.5;
      const introVisible = Math.max(0, Number(currentSnapshot?.matchStartFreezeRemaining || 0)) > 0.08;
      const stealthed = !!enemy.stealth && !visual.dead && !introVisible;
      const alpha = visual.dead ? visual.deathAlpha * 0.5 : (stealthed ? 0.055 + pulse * 0.025 : 1);
      const wobble = Math.sin(now / 160 + visual.y * 0.02) * 1.2;
      const coreR = baseSize * 0.7 + wobble;
      const isBoss = enemy.tier === "voidBoss" || (enemy.maxHealth || 0) > 0;

      if (enemy.leavesTracks) {
        visual.tracks = visual.tracks || [];
        const movedForTrack = Math.hypot(visual.x - (visual.lastTrackX ?? visual.x), visual.y - (visual.lastTrackY ?? visual.y));
        if (!introVisible && !visual.dead && movedForTrack > 9) {
          visual.tracks.push({ x: visual.x, y: visual.y, angle: visual.aimAngle || 0, life: 0, ttl: 2.2 });
          visual.lastTrackX = visual.x;
          visual.lastTrackY = visual.y;
          if (visual.tracks.length > 38) visual.tracks.splice(0, visual.tracks.length - 38);
        }
        for (let ti = visual.tracks.length - 1; ti >= 0; ti--) {
          const track = visual.tracks[ti];
          track.life += dt;
          if (track.life >= track.ttl) {
            visual.tracks.splice(ti, 1);
            continue;
          }
          const tAlpha = (1 - track.life / track.ttl) * 0.34;
          const sideX = Math.cos((track.angle || 0) + Math.PI / 2);
          const sideY = Math.sin((track.angle || 0) + Math.PI / 2);
          const fwdX = Math.cos(track.angle || 0);
          const fwdY = Math.sin(track.angle || 0);
          g.lineStyle(4, skin.glow, tAlpha);
          for (const side of [-1, 1]) {
            const cx = track.x + sideX * side * baseSize * 0.32;
            const cy = track.y + sideY * side * baseSize * 0.32;
            g.beginPath();
            g.moveTo(cx - fwdX * 7, cy - fwdY * 7);
            g.lineTo(cx + fwdX * 7, cy + fwdY * 7);
            g.strokePath();
          }
        }
      }

      if (stealthed) {
        if (pulse > 0.90) {
          g.lineStyle(1.5, skin.glow, 0.10 + (pulse - 0.9) * 0.6);
          g.strokeCircle(visual.x, visual.y, coreR * 0.75);
        }
        continue;
      }

      if (isBoss) {
        for (let ring = 0; ring < 4; ring++) {
          const ringPulse = Math.sin(now / (260 + ring * 70) + ring) * 0.5 + 0.5;
          g.lineStyle(2 - ring * 0.25, ring % 2 ? skin.accent : skin.glow, alpha * (0.18 - ring * 0.028 + ringPulse * 0.06));
          g.strokeCircle(visual.x, visual.y, coreR + 18 + ring * 15 + ringPulse * 8);
        }
        g.fillStyle(skin.glow, alpha * 0.08);
        g.fillCircle(visual.x, visual.y, coreR + 28 + pulse * 8);
      }

      g.fillStyle(skin.dark, alpha * 0.96);
      g.fillCircle(visual.x, visual.y, coreR + 5 + pulse * 1.5);
      g.fillStyle(skin.base, alpha * 0.92);
      g.fillCircle(visual.x - 1, visual.y + 1, coreR + 1);
      g.fillStyle(skin.mid, alpha * 0.8);
      g.fillCircle(visual.x - 3, visual.y - 2, coreR * 0.78);
      g.fillStyle(skin.accent, alpha * 0.5);
      g.fillCircle(visual.x + 3, visual.y + 2, coreR * 0.55);

      const orbCount = LOW_POWER_MODE ? 3 : 6;
      for (let i = 0; i < orbCount; i++) {
        const a = now / (500 + i * 47) + i * 1.5;
        const r = coreR * 0.6 + i * 2.5;
        const orbSize = 2.2 + (i % 3) * 0.8;
        const orbColor = i % 2 ? skin.glow : skin.accent;
        g.fillStyle(orbColor, alpha * (0.5 + pulse * 0.2));
        g.fillCircle(visual.x + Math.cos(a) * r, visual.y + Math.sin(a) * r, orbSize);
      }

      g.lineStyle(2, skin.glow, alpha * (0.4 + pulse * 0.25));
      g.strokeCircle(visual.x, visual.y, coreR + 2);
      g.lineStyle(1, skin.accent, alpha * 0.25);
      g.strokeCircle(visual.x, visual.y, coreR + 8 + pulse * 2);

      for (let i = 0; i < 3; i++) {
        const spikeAngle = visual.aimAngle + (i - 1) * 0.5 + Math.sin(now / 400 + i) * 0.1;
        const inner = coreR * 0.8;
        const outer = coreR + 10 + (i === 1 ? 6 : 0);
        g.lineStyle(1.5, skin.glow, alpha * 0.5);
        g.beginPath();
        g.moveTo(visual.x + Math.cos(spikeAngle) * inner, visual.y + Math.sin(spikeAngle) * inner);
        g.lineTo(visual.x + Math.cos(spikeAngle) * outer, visual.y + Math.sin(spikeAngle) * outer);
        g.strokePath();
      }

      if ((enemy.maxHealth || 0) > 0) {
        const healthPct = clamp((enemy.health || 0) / Math.max(1, enemy.maxHealth || 1), 0, 1);
        const barW = Math.max(136, baseSize * 2.45);
        const barH = 12;
        const barX = visual.x - barW / 2;
        const barY = visual.y - coreR - 34;
        g.fillStyle(0x02030a, alpha * 0.84);
        g.fillRoundedRect(barX - 2, barY - 2, barW + 4, barH + 4, 4);
        g.fillStyle(0x28103f, alpha * 0.95);
        g.fillRoundedRect(barX, barY, barW, barH, 3);
        g.fillStyle(skin.glow || 0xffffff, alpha * 0.95);
        g.fillRoundedRect(barX, barY, barW * healthPct, barH, 3);
        g.lineStyle(1.5, skin.glow || 0xffffff, alpha * 0.55);
        g.strokeRoundedRect(barX, barY, barW, barH, 3);

        if ((enemy.boss?.ability === "shockwave" || enemy.boss?.ability === "gravityWell") && !visual.dead) {
          const progress = clamp((enemy.boss.timer || 0) / Math.max(0.1, enemy.boss.duration || 1), 0, 1);
          const radius = Math.max(80, enemy.boss.radius || (enemy.boss.ability === "gravityWell" ? 330 : 260));
          g.lineStyle(enemy.boss.ability === "gravityWell" ? 3 : 4, skin.glow, alpha * (0.24 + progress * 0.42));
          g.strokeCircle(visual.x, visual.y, radius);
          g.lineStyle(2, skin.accent, alpha * (0.18 + progress * 0.32));
          g.strokeCircle(visual.x, visual.y, radius * (enemy.boss.ability === "gravityWell" ? 0.95 - progress * 0.35 : progress));
          g.lineStyle(1, skin.glow, alpha * 0.24);
          g.strokeCircle(visual.x, visual.y, Math.max(coreR + 18, radius * (0.35 + progress * 0.25)));
        } else if ((enemy.boss?.ability === "focusBarrage" || enemy.boss?.ability === "railSweep" || enemy.boss?.ability === "armorDash") && !visual.dead) {
          const telegraphLength = enemy.boss.ability === "armorDash" ? 360 : 300;
          g.lineStyle(enemy.boss.ability === "armorDash" ? 4 : 2, skin.glow, alpha * (enemy.boss.ability === "armorDash" ? 0.42 : 0.28));
          g.beginPath();
          g.moveTo(visual.x + Math.cos(visual.aimAngle) * (coreR + 8), visual.y + Math.sin(visual.aimAngle) * (coreR + 8));
          g.lineTo(visual.x + Math.cos(visual.aimAngle) * (coreR + telegraphLength), visual.y + Math.sin(visual.aimAngle) * (coreR + telegraphLength));
          g.strokePath();
        } else if ((enemy.boss?.ability === "starBurst" || enemy.boss?.ability === "spiralBloom" || enemy.boss?.ability === "crossBurst" || enemy.boss?.ability === "pinwheelRicochet" || enemy.boss?.ability === "mirrorSplit" || enemy.boss?.ability === "splitVolley") && !visual.dead) {
          const progress = clamp((enemy.boss.timer || 0) / Math.max(0.1, enemy.boss.duration || 1), 0, 1);
          g.lineStyle(2, skin.glow, alpha * 0.22);
          g.strokeCircle(visual.x, visual.y, coreR + 24 + Math.sin(now / 90) * 4);
          g.lineStyle(1.5, skin.accent, alpha * 0.2);
          g.strokeCircle(visual.x, visual.y, coreR + 42 + progress * 28);
          if (enemy.boss?.ability === "mirrorSplit") {
            const ghostR = 120;
            for (let i = 0; i < 4; i++) {
              const a = i * Math.PI / 2;
              g.fillStyle(skin.accent, alpha * 0.14);
              g.fillCircle(visual.x + Math.cos(a) * ghostR, visual.y + Math.sin(a) * ghostR, coreR * 0.32);
              g.lineStyle(1, skin.glow, alpha * 0.2);
              g.strokeCircle(visual.x + Math.cos(a) * ghostR, visual.y + Math.sin(a) * ghostR, coreR * 0.42);
            }
          }
        } else if ((enemy.boss?.ability === "voidMines" || enemy.boss?.ability === "mineRing" || enemy.boss?.ability === "orbitMines") && !visual.dead) {
          g.lineStyle(1.5, enemy.boss?.ability === "orbitMines" ? skin.glow : 0xffdf57, alpha * 0.3);
          g.strokeCircle(visual.x, visual.y, coreR + 54 + Math.sin(now / 120) * 5);
        }
      }

      if (visual.dead) {
        g.lineStyle(3, 0xff4400, visual.deathAlpha);
        const spread = baseSize * 0.6;
        g.beginPath();
        g.moveTo(visual.x - spread, visual.y - spread);
        g.lineTo(visual.x + spread, visual.y + spread);
        g.strokePath();
        g.beginPath();
        g.moveTo(visual.x + spread, visual.y - spread);
        g.lineTo(visual.x - spread, visual.y + spread);
        g.strokePath();
      }
    }

    for (const [id] of this.tankEnemyVisuals) {
      if (!seenEnemies.has(id)) {
        const v = this.tankEnemyVisuals.get(id);
        if (v && v.deathAlpha <= 0) this.tankEnemyVisuals.delete(id);
      }
    }

    for (const mine of tank.mines || []) {
      const tierSkin = TANK_TIER_SKINS[mine.ownerTier] || TANK_TIER_SKINS.sapper;
      const now = performance.now();
      const armed = mine.armed !== false;
      const pulse = armed ? (Math.sin(now / 120 + mine.x * 0.02) * 0.5 + 0.5) : 0.25;
      const r = Math.max(10, Math.min(24, (mine.radius || 36) * 0.42));
      g.fillStyle(0x080808, armed ? 0.82 : 0.45);
      g.fillCircle(mine.x, mine.y, r + 4 + pulse * 2);
      g.fillStyle(tierSkin.accent || 0xffdf57, armed ? 0.82 : 0.35);
      g.fillCircle(mine.x, mine.y, r);
      g.fillStyle(0xffffff, armed ? 0.55 + pulse * 0.2 : 0.2);
      g.fillCircle(mine.x, mine.y, Math.max(3, r * 0.28));
      g.lineStyle(1.5, tierSkin.glow || 0xffffff, armed ? 0.5 + pulse * 0.3 : 0.2);
      g.strokeCircle(mine.x, mine.y, Math.max(16, mine.radius || 36));
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i + now / 850;
        g.lineStyle(1, tierSkin.glow || 0xffffff, armed ? 0.4 : 0.18);
        g.beginPath();
        g.moveTo(mine.x + Math.cos(a) * (r + 2), mine.y + Math.sin(a) * (r + 2));
        g.lineTo(mine.x + Math.cos(a) * (r + 8), mine.y + Math.sin(a) * (r + 8));
        g.strokePath();
      }
    }

    const seenBullets = new Set();
    for (const bullet of tank.bullets || []) {
      seenBullets.add(bullet.id);
      let visual = this.tankBulletVisuals.get(bullet.id);
      if (!visual) {
        visual = { x: bullet.x, y: bullet.y, trail: [{ x: bullet.x, y: bullet.y }] };
        this.tankBulletVisuals.set(bullet.id, visual);
      }
      const lerp = 1 - Math.exp(-dt * 30);
      visual.x += (bullet.x - visual.x) * lerp;
      visual.y += (bullet.y - visual.y) * lerp;
      visual.trail.push({ x: visual.x, y: visual.y });
      if (visual.trail.length > 12) visual.trail.shift();

      const ownerTier = bullet.ownerType === "player" ? "player" : null;
      const bulletColor = ownerTier === "player" ? TANK_TIER_BULLET_COLORS.player : (TANK_TIER_BULLET_COLORS[bullet.ownerTier] || 0xffaa00);

      if (visual.trail.length > 2) {
        for (let i = 1; i < visual.trail.length; i++) {
          const alpha = (i / visual.trail.length) * 0.5;
          g.lineStyle(bullet.radius * 0.8, bulletColor, alpha);
          g.beginPath();
          g.moveTo(visual.trail[i - 1].x, visual.trail[i - 1].y);
          g.lineTo(visual.trail[i].x, visual.trail[i].y);
          g.strokePath();
        }
      }

      g.fillStyle(bulletColor, 1);
      g.fillCircle(visual.x, visual.y, bullet.radius);
      g.fillStyle(0xffffff, 0.7);
      g.fillCircle(visual.x, visual.y, bullet.radius * 0.5);

      if (bullet.bouncesRemaining > 0) {
        g.lineStyle(1, 0xffffff, 0.4);
        g.strokeCircle(visual.x, visual.y, bullet.radius + 3);
      }
    }

    for (const [id] of this.tankBulletVisuals) {
      if (!seenBullets.has(id)) this.tankBulletVisuals.delete(id);
    }
  };

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

  function showEscapedScreen(result = null) {
    if (finalMatchResult) {
      showFinalMatchScreen(finalMatchResult);
      return;
    }

    const canSpectate = canSpectateLiveTeammate();
    const finalActors = Array.isArray(result?.finalActors) ? result.finalActors : [];
    if (finalActors.length) renderFinalStats(finalActors);
    else if (ui.endStats) ui.endStats.innerHTML = "";

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
      showEscapedScreen(personalRunResult);
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

  function progressionStatItems(actor) {
    const progression = actor?.progression || null;
    if (!progression || Number(progression.score || 0) <= 0) return [];
    const roleLabel = progression.role === "void" || actor?.role === "killer" ? "Void XP" : "Runner XP";
    return [
      statItem("Rift XP", `+${formatWholeNumber(progression.accountXp || 0)}`),
      statItem(roleLabel, `+${formatWholeNumber(progression.roleXp || 0)}`)
    ];
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
      const isFfa = actor.gameMode === "ffa" || actor.lobbyRole === "ffa" || actor.role === "ffa";
      const state = isFfa
        ? "Void Shooter"
        : isVoid
          ? "The Void"
        : stats.escaped || actor.escaped
          ? "Escaped"
          : actor.dead
            ? "Dead"
            : actor.hooked
              ? "Bound"
              : actor.downed
                ? "Downed"
                : "Lost";
      const progressionItems = progressionStatItems(actor);
      const statHtml = isFfa
        ? [
            statItem("Kills", stats.kills || 0),
            statItem("Deaths", stats.deaths || 0),
            statItem("Shots fired", stats.shotsFired || 0),
            statItem("Hits", stats.shotHits || 0),
            statItem("Heal boxes", stats.healBoxes || 0)
          ].join("")
        : isVoid
          ? [
            statItem("Runners consumed", stats.deaths || 0),
            statItem("Binds", stats.hooks || 0),
            statItem("Downs", stats.downs || 0),
            statItem("Injures", stats.injures || 0),
            statItem("Rifts kicked", stats.riftsKicked || 0),
            statItem("Orbs stolen", stats.orbsStolen || 0),
            statItem("Orbs collected", stats.orbsCollected || 0),
            ...progressionItems
          ].join("")
        : [
            statItem("Orbs collected", stats.orbsCollected || 0),
            statItem("Orbs deposited", stats.orbsDeposited || 0),
            statItem("Void stuns", stats.voidStuns || 0),
            statItem("Heals", stats.teammatesHealed || 0),
            statItem("Rescues", stats.unhooks || 0),
            statItem("Escaped", (stats.escaped || actor.escaped) ? "Yes" : "No"),
            statItem("Chase total", formatStatSeconds(stats.chaseSeconds)),
            statItem("Longest chase", formatStatSeconds(stats.longestChase)),
            ...progressionItems
          ].join("");

      return `
        <article class="end-stat-card ${isVoid ? "is-void" : isFfa ? "is-ffa" : "is-runner"}${actor.id === myId ? " is-you" : ""}">
          <div class="end-stat-head">
            <div>
              <strong>${escapeHtml(actor.name || (isVoid ? "The Void" : isFfa ? "Void Shooter" : "Runner"))}</strong>
              <span>${escapeHtml(state)}${actor.id === myId ? " • You" : ""}</span>
            </div>
            <i>${escapeHtml(isVoid ? "VOID" : isFfa ? "FFA" : "RUNNER")}</i>
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
    const isFfaResult = winner === "ffa" || String(winner || "").startsWith("ffa:") || finalActors.some((actor) => actor.gameMode === "ffa" || actor.lobbyRole === "ffa" || actor.role === "ffa");
    const localSurvivor = me?.role === "survivor";
    const localEscaped = localSurvivor && !!me.escaped;
    const localPerished = localSurvivor && !localEscaped && !!escapedCount && (me.dead || me.hooked || me.downed);

    ui.spectateBtn?.classList.add("hidden");
    renderFinalStats(finalActors);

    if (isFfaResult) {
      const winningId = String(winner || "").startsWith("ffa:") ? String(winner).slice(4) : null;
      const champ = finalActors.find((actor) => actor.id === winningId) || [...finalActors].sort((a, b) => (b.stats?.kills || 0) - (a.stats?.kills || 0))[0];
      const won = champ?.id && champ.id === myId;
      if (ui.winnerText) ui.winnerText.textContent = won ? "You Win FFA" : `${champ?.name || "Void Shooter"} Wins FFA`;
      if (ui.reasonText) ui.reasonText.textContent = reason || "First to 10 kills wins.";
    } else if (localEscaped) {
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
    ui.menuPerksBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); renderPerkShop(); showScreen("perks"); });
    ui.menuOptionsBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("options"); });
    ui.menuHowBtn?.addEventListener("click", () => { ensureMenuAudioStarted(); showScreen("how"); });
    document.getElementById("menuTankAssaultBtn")?.addEventListener("click", () => {
      ensureMenuAudioStarted();
      socket.emit("createLobby", { role: "survivor", mode: "tanks", playerName: getName(), skin: skinForSelectedRole() });
    });
    ui.menuBackBtns?.forEach((btn) => {
      btn.addEventListener("click", () => showScreen(btn.dataset.screen || "menu"));
    });

    ui.roleBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        setSelectedRole(btn.dataset.role);
      });
    });

    ui.runnerClassBtns?.forEach((btn) => {
      btn.addEventListener("click", () => {
        setSelectedRunnerClass(btn.dataset.runnerClass || RUNNER_CLASS_DEFAULT_ID);
      });
    });

    ui.skinBtns.forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const ok = await buySkinFromButton(btn);
          if (!ok) return;
          setSelectedSkin(btn.dataset.skin || "blueSquare");
          const mine = currentLobbyState?.players?.find((p) => p.id === myId);
          if (socket && (mine?.role === "survivor" || mine?.role === "ffa")) {
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

    document.addEventListener("click", (event) => {
      const closeInfo = event.target?.closest?.("[data-perk-info-close]");
      if (closeInfo) {
        closePerkInfoModal();
        return;
      }

      const infoButton = event.target?.closest?.("[data-perk-info]");
      if (infoButton) {
        openPerkInfoModal(infoButton.dataset.perkInfo, infoButton.dataset.perkRole || "survivor");
        return;
      }

      const button = event.target?.closest?.("[data-perk-buy]");
      if (button) {
        buyPerkFromButton(button).catch((error) => toast(error.message || "Could not buy perk.", 2600));
        return;
      }

      const card = event.target?.closest?.("#perksScreen .perks-content .perk-card");
      if (card && !event.target?.closest?.("button, a, input, select, textarea, [role='button']")) {
        openPerkInfoModal(card.dataset.perkId, card.dataset.perkRole || "survivor");
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePerkInfoModal();
    });

    ui.quickJoinBtn.addEventListener("click", () => socket.emit("quickJoin", { role: selectedRole, playerName: getName(), skin: skinForSelectedRole(), runnerClass: selectedRunnerClass }));
    ui.createLobbyBtn.addEventListener("click", () => socket.emit("createLobby", { role: selectedRole, playerName: getName(), skin: skinForSelectedRole(), runnerClass: selectedRunnerClass }));
    ui.beSurvivorBtn.addEventListener("click", () => socket.emit("setRole", { role: "survivor", skin: selectedSkin, runnerClass: selectedRunnerClass }));
    ui.beKillerBtn.addEventListener("click", () => socket.emit("setRole", { role: "killer", skin: selectedVoidSkin }));
    ui.beFfaBtn?.addEventListener("click", () => socket.emit("setRole", { role: "ffa", skin: selectedSkin }));
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
      const isFfaLobby = lobby.mode === "ffa";
      const isTankLobby = lobby.mode === "tanks";
      const spectatorCount = Math.max(0, Math.floor(Number(lobby.spectators || 0)));
      const spectatorLabel = spectatorCount ? ` • ${spectatorCount} Spectator${spectatorCount === 1 ? "" : "s"}` : "";
      const phaseLabel = lobby.phase === "game" ? "In progress" : "Waiting";
      if (isTankLobby) {
        const tankPlayerCount = Math.max(0, Math.floor(Number(lobby.tankCount || lobby.survivors || 0)));
        left.innerHTML = `<strong>${escapeHtml(lobby.name)}</strong><small>Tank Assault • ${phaseLabel} • ${tankPlayerCount}/2 Runners${spectatorLabel}</small>`;
      } else if (isFfaLobby) {
        const ffaCount = Math.max(0, Math.floor(Number(lobby.ffaCount || 0)));
        const maxFfa = Math.max(1, Math.floor(Number(lobby.maxFfaPlayers || 5)));
        left.innerHTML = `<strong>${escapeHtml(lobby.name)}</strong><small>${escapeHtml(lobby.mapName || "Arena")} • Free-For-All • ${phaseLabel} • ${ffaCount}/${maxFfa} Void Shooters • First to ${escapeHtml(lobby.killLimit || 10)}${spectatorLabel}</small>`;
      } else {
        const voidCount = Number.isFinite(Number(lobby.killerCount)) ? Number(lobby.killerCount) : (lobby.killer ? 1 : 0);
        const voidLabel = `${voidCount} Void player${voidCount === 1 ? "" : "s"}`;
        left.innerHTML = `<strong>${escapeHtml(lobby.name)}</strong><small>${escapeHtml(lobby.mapName || "Map")} • ${phaseLabel} • ${lobby.survivors}/${lobby.maxSurvivors} Runners • ${voidLabel}${spectatorLabel}</small>`;
      }
      const actions = document.createElement("div");
      actions.className = "lobby-item-actions";
      const button = document.createElement("button");
      button.textContent = lobby.phase === "lobby" ? (isTankLobby ? "Join Tanks" : isFfaLobby ? "Join FFA" : "Join") : "In Run";
      button.disabled = lobby.phase !== "lobby";
      button.addEventListener("click", () => {
        const roleToJoin = isTankLobby ? "survivor" : isFfaLobby ? "ffa" : selectedRole === "ffa" ? "survivor" : selectedRole;
        socket.emit("joinLobby", { lobbyId: lobby.id, role: roleToJoin, playerName: getName(), skin: skinForSelectedRole(roleToJoin), runnerClass: selectedRunnerClass });
      });
      actions.append(button);
      item.append(left, actions);
      ui.lobbyList.appendChild(item);
    }
  }

  function renderLobbyState(state) {
    currentLobbyState = state;
    ui.playersList.innerHTML = "";

    const players = state.players || [];
    const mode = state.mode === "tanks" ? "tanks" : state.mode === "ffa" ? "ffa" : "standard";
    const isFfaLobby = mode === "ffa";
    const isTankLobby = mode === "tanks";
    ui.lobbyScreen?.classList.toggle("is-ffa-lobby", isFfaLobby);
    ui.lobbyScreen?.classList.toggle("is-tank-lobby", isTankLobby);
    const voidCount = players.filter((player) => player.role === "killer").length;
    const survivorCount = players.filter((player) => player.role === "survivor").length;
    const ffaCount = players.filter((player) => player.role === "ffa").length;
    const tankCount = isTankLobby ? survivorCount : 0;
    const maxSurvivors = Number.isFinite(Number(state.maxSurvivors)) ? Number(state.maxSurvivors) : 4;
    const maxFfaPlayers = Number.isFinite(Number(state.maxFfaPlayers)) ? Number(state.maxFfaPlayers) : 5;
    const requiredHumanPlayers = players.filter((player) => !player.isBot && player.role !== "spectator");
    const allRequiredHumansReady = requiredHumanPlayers.every((player) => !!player.ready);
    const canStartRun = isTankLobby
      ? allRequiredHumansReady && survivorCount >= 1 && survivorCount <= 2
      : isFfaLobby
        ? allRequiredHumansReady && ffaCount >= 2 && ffaCount <= maxFfaPlayers
        : allRequiredHumansReady && voidCount === 1 && survivorCount >= 1;
    const spectatorCount = players.filter((player) => player.role === "spectator").length;
    const statusLine = isTankLobby
      ? `${survivorCount}/2 Runners${spectatorCount ? ` • ${spectatorCount} Spectator${spectatorCount === 1 ? "" : "s"}` : ""}`
      : isFfaLobby
        ? `${ffaCount}/${maxFfaPlayers} Void Shooters • First to ${state.killLimit || 10}${spectatorCount ? ` • ${spectatorCount} Spectator${spectatorCount === 1 ? "" : "s"}` : ""}`
        : `${survivorCount}/${maxSurvivors} Runners • ${voidCount} Void player${voidCount === 1 ? "" : "s"}${spectatorCount ? ` • ${spectatorCount} Spectator${spectatorCount === 1 ? "" : "s"}` : ""}`;
    const subtitle = isTankLobby
      ? `${statusLine}. Co-op tank assault — survive 20 compact missions, then the Level 21 White Void boss.`
      : isFfaLobby
        ? `${statusLine}. No rifts. No orbs. Just fast little nightmare paintball.`
        : voidCount === 1
          ? `${statusLine}. Players ready up to start. Spectators are auto-ready and optional.`
          : `${statusLine}. The run needs exactly 1 Void. Spectators are auto-ready and optional.`;
    const lobbySubtitle = document.getElementById("lobbySubtitle");
    if (lobbySubtitle) lobbySubtitle.textContent = subtitle;

    const renderPlayerRow = (player) => {
      const item = document.createElement("div");
      const isKiller = player.role === "killer";
      const isFfa = player.role === "ffa";
      const isSpectator = player.role === "spectator";
      item.className = `player-item ${isKiller ? "is-killer" : isSpectator ? "is-spectator" : isFfa ? "is-ffa" : "is-survivor"}${player.id === myId ? " is-you" : ""}${player.isBot ? " is-bot" : ""}`;

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
      roleName.textContent = `${isTankLobby && !isSpectator ? "Tank" : isKiller ? "The Void" : isSpectator ? "Spectator" : isFfa ? "Void Shooter" : "Runner"}${player.isBot ? " bot" : ""}`;

      const dot = document.createElement("span");
      dot.className = "player-dot";
      dot.textContent = "•";

      const skin = document.createElement("span");
      const skinName = isKiller ? getVoidSkin(player.skin).label : isSpectator ? "Watching only" : getSurvivorSkin(player.skin).label;
      skin.className = "player-skin-name";
      skin.title = skinName;
      skin.textContent = skinName;

      if (!isTankLobby && !isKiller && !isSpectator && !isFfa) {
        const classDot = document.createElement("span");
        classDot.className = "player-dot";
        classDot.textContent = "•";
        const runnerClass = document.createElement("span");
        runnerClass.className = `player-class-name class-${normalizeRunnerClassId(player.runnerClass)}`;
        runnerClass.textContent = runnerClassLabel(player.runnerClass);
        runnerClass.title = `${runnerClassLabel(player.runnerClass)} class`;
        meta.append(roleName, dot, skin, classDot, runnerClass);
      } else if (isFfa) {
        const classDot = document.createElement("span");
        classDot.className = "player-dot";
        classDot.textContent = "•";
        const shooterClass = document.createElement("span");
        shooterClass.className = "player-class-name class-void-shooter";
        shooterClass.textContent = "Void Shooter";
        meta.append(roleName, dot, skin, classDot, shooterClass);
      } else {
        meta.append(roleName, dot, skin);
      }
      summary.append(name, meta);

      const ready = document.createElement("small");
      const isReady = player.role === "spectator" || player.isBot || !!player.ready;
      ready.className = `player-ready ${isReady ? "is-ready" : ""}${isSpectator ? " is-spectator-ready" : ""}`;
      ready.textContent = isSpectator ? "Auto Ready" : isReady ? "Ready" : "Not ready";

      const rowActions = document.createElement("div");
      rowActions.className = "player-row-actions";
      rowActions.appendChild(ready);

      if (player.isBot) {
        const kick = document.createElement("button");
        kick.className = "bot-kick-btn";
        kick.type = "button";
        kick.textContent = "Kick";
        kick.title = `Kick ${player.name || "bot"}`;
        kick.addEventListener("click", () => socket.emit("removeBot", { botId: player.id }));
        rowActions.appendChild(kick);
      }

      item.append(emblem, summary, rowActions);
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
    const ffaPlayers = players.filter((player) => player.role === "ffa");
    const spectatorPlayers = players.filter((player) => player.role === "spectator");
    if (isTankLobby) {
      appendPlayerGroup("Tank pilots", `${tankCount}/2`, "survivor-group tank-group", survivorPlayers);
    } else if (isFfaLobby) {
      appendPlayerGroup("Void Shooters", `${ffaPlayers.length}/${maxFfaPlayers}`, "survivor-group ffa-group", ffaPlayers);
    } else {
      appendPlayerGroup("Void player", `${voidPlayers.length} selected`, "void-group", voidPlayers);
      appendPlayerGroup("Runners", `${survivorPlayers.length}/${maxSurvivors}`, "survivor-group", survivorPlayers);
    }
    if (spectatorPlayers.length) appendPlayerGroup("Spectators", `${spectatorPlayers.length} watching`, "spectator-group", spectatorPlayers);
    const mine = players.find((p) => p.id === myId);
    const iAmSpectator = mine?.role === "spectator";
    if (mine?.role === "killer" || mine?.role === "survivor" || mine?.role === "ffa") setSelectedRole(mine.role);
    else if (iAmSpectator) syncLobbyRoleButtons("spectator");
    if ((mine?.role === "survivor" || mine?.role === "ffa") && SURVIVOR_SKINS[mine.skin]) {
      setSelectedSkin(mine.skin);
      selectedRunnerClass = normalizeRunnerClassId(mine.runnerClass || selectedRunnerClass);
      syncRunnerClassUi({ preferAccount: false });
    } else if (mine?.role === "killer") {
      setSelectedVoidSkin(mine.skin);
    }
    ui.readyBtn.textContent = iAmSpectator ? "Spectator Ready" : mine?.ready ? "Unready" : "Ready";
    ui.readyBtn.dataset.readyState = iAmSpectator ? "spectator" : mine?.ready ? "unready" : "ready";
    ui.readyBtn.disabled = !!iAmSpectator;
    ui.readyBtn.title = iAmSpectator ? "Spectators are always ready and do not count toward starting the run." : "Toggle ready status.";
    ui.beKillerBtn.disabled = !!iAmSpectator || state.mode === "ffa" || isTankLobby;
    ui.beSurvivorBtn.disabled = !!iAmSpectator || state.mode === "ffa" || isTankLobby;
    if (ui.beFfaBtn) ui.beFfaBtn.disabled = !!iAmSpectator || state.mode !== "ffa" || isTankLobby;
    if (ui.beSpectatorBtn) {
      ui.beSpectatorBtn.disabled = !!iAmSpectator;
      ui.beSpectatorBtn.title = iAmSpectator
        ? "You are already joining this lobby as an auto-ready spectator."
        : "Join this lobby as a spectator. You will load into the run without controlling a character.";
    }
    ui.addBotSurvivorBtn.disabled = isFfaLobby || isTankLobby;
    ui.addBotKillerBtn.disabled = isFfaLobby || isTankLobby;
    setLobbySkinPickerVisibility(iAmSpectator ? "spectator" : selectedRole);
    if (ui.startBtn) {
      ui.startBtn.disabled = !canStartRun;
      ui.startBtn.textContent = isTankLobby ? "Start Tanks" : isFfaLobby ? "Start FFA" : "Start Run";
      ui.startBtn.title = canStartRun
        ? (isTankLobby ? "Start Tank Assault." : isFfaLobby ? "Start the Free-For-All. First Void Shooter to 10 kills wins." : "Start the run. Spectators will load in watching instead of playing.")
        : (isTankLobby ? "Need 1-2 tank pilots and every playable human ready." : isFfaLobby ? "Need at least 2 Void Shooters and every playable human ready." : "Need exactly 1 Void, at least 1 Runner, and every playable human ready. Spectators are optional and do not block the match.");
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
      if (e.code === "Quote") {
        e.preventDefault();
        if (!e.repeat && socket?.connected) socket.emit("toggleAbilityTestMode");
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
      const quickSlotMatch = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
      if (quickSlotMatch && activeScreenName === "game") {
        const slotIndex = Number(quickSlotMatch[1]) - 1;
        if (getQuickQAbilities().length > slotIndex) {
          e.preventDefault();
          if (!e.repeat) triggerQuickQAbility(slotIndex);
          return;
        }
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
    const syncBotDebugPreference = (enabled = null) => {
      if (!socket?.connected) return;
      const stored = (() => {
        try { return window.localStorage?.getItem("riftrunnerBotDebug") === "1"; }
        catch (_) { return false; }
      })();
      socket.emit("setBotDebug", { enabled: enabled === null ? stored : !!enabled });
    };
    window.addEventListener("riftrunner:bot-debug-toggle", (event) => {
      syncBotDebugPreference(!!event.detail?.enabled);
    });
    socket.on("connect", () => syncBotDebugPreference());
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
    socket.on("abilityTestModeChanged", (payload = {}) => {
      const level = Math.max(0, Math.min(3, Math.floor(Number(payload.level || 0))));
      toast(payload.enabled ? `Ability testing Lv ${level}: all perks unlocked, costs/cooldowns zero.` : "Ability testing OFF: normal purchases, costs, and cooldowns restored.", 2400);
      const me = getLocalPlayerData();
      if (me) {
        me.abilityTestMode = !!payload.enabled;
        me.abilityTestLevel = level;
      }
      dispatchAbilityHuds(currentSnapshot);
    });
    socket.on("scoreGain", (payload) => pushScoreGain(payload));
    socket.on("lobbyList", renderLobbyList);
    socket.on("joinedLobby", () => showScreen("lobby"));
    socket.on("lobbyState", renderLobbyState);
    socket.on("gameStarted", (map) => {
      currentSnapshot = null;
      personalRunResult = null;
      finalMatchResult = null;
      resetHorrorFxVisualState();
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
        if (map?.mode === "tanks") {
          phaserScene.updateTankFixedCamera?.(map);
        } else {
          cameraZoomNow = CAMERA.BASE_ZOOM;
          phaserScene.currentCameraZoom = cameraZoomNow;
          phaserScene.targetCameraZoom = cameraZoomNow;
          phaserScene.cameras?.main?.setZoom(cameraZoomNow);
        }
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

    socket.on("tankLevelStart", (mapData) => {
      if (phaserScene && mapData) {
        const lockSeconds = Math.max(0, Number(mapData.startFreezeSeconds || GAMEPLAY_CONFIG.tanks?.startFreezeSeconds || IMMERSION.MATCH_START_LOCK_SECONDS || 2));
        phaserScene.matchStartFreezeRemaining = lockSeconds;
        phaserScene.matchStartFreezeDuration = Math.max(0.001, lockSeconds);
        phaserScene.matchStartInputLockUntil = performance.now() + lockSeconds * 1000;
        clearMovementInputOnly();
        phaserScene.loadMap(mapData);
        phaserScene.updateTankFixedCamera?.(mapData);
        phaserScene.tankEnemyVisuals = new Map();
        phaserScene.tankBulletVisuals = new Map();
      }
    });

    socket.on("personalRunEnded", (payload = {}) => {
      if (payload?.status !== "escaped") return;
      personalRunResult = {
        status: "escaped",
        reason: payload.reason || "You slipped through the void. The run is still alive.",
        finalActors: Array.isArray(payload.finalActors) ? payload.finalActors : []
      };
      if (phaserScene) phaserScene.localEscapeScreenShown = true;
      if (!finalMatchResult) showEscapedScreen(personalRunResult);
    });
    socket.on("abilityAudio", (event = {}) => {
      if (!event || event.type !== "dash") return;
      playLocalizedDashAbilitySfx(event);
    });

    function mergeActorDeltas(previousActors = [], nextActors = []) {
      if (!Array.isArray(nextActors)) return Array.isArray(previousActors) ? previousActors : [];
      if (!Array.isArray(previousActors) || !previousActors.length) return nextActors;
      const previousById = new Map(previousActors.filter((actor) => actor?.id).map((actor) => [actor.id, actor]));
      return nextActors.map((actor) => {
        if (!actor?.id) return actor;
        const previous = previousById.get(actor.id);
        return previous ? { ...previous, ...actor } : actor;
      });
    }

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
      if (currentSnapshot) {
        snapshot.map = { ...(currentSnapshot.map || {}), ...(snapshot.map || {}) };
        snapshot.actors = ("actors" in snapshot)
          ? mergeActorDeltas(currentSnapshot.actors || [], snapshot.actors || [])
          : (currentSnapshot.actors || []);
        if (!("collectibleDots" in snapshot)) snapshot.collectibleDots = currentSnapshot.collectibleDots || [];
        if (!("dartBoxes" in snapshot)) snapshot.dartBoxes = currentSnapshot.dartBoxes || [];
        if (!("runnerProjectiles" in snapshot)) snapshot.runnerProjectiles = currentSnapshot.runnerProjectiles || [];
        if (!("smokeClouds" in snapshot)) snapshot.smokeClouds = currentSnapshot.smokeClouds || [];
        if (!("voidSwirls" in snapshot)) snapshot.voidSwirls = currentSnapshot.voidSwirls || [];
        const viewerCanSeeScratchMarks = snapshot?.viewer?.role === "killer" || (snapshot?.viewer?.spectating && snapshot?.viewer?.spectateTargetId === SPECTATE_OVERVIEW_ID);
        if (!viewerCanSeeScratchMarks) snapshot.scratchMarks = [];
        else if (!("scratchMarks" in snapshot)) snapshot.scratchMarks = currentSnapshot.scratchMarks || [];
      }
      currentSnapshot = snapshot;
      updateMatchPauseOverlay(snapshot);
      if (phaserScene) phaserScene.applySnapshot(snapshot);
    });
    socket.on("matchEnded", ({ winner, reason, escapedCount = 0, totalSurvivors = 0, finalActors = [] }) => {
      finalMatchResult = { winner, reason, escapedCount, totalSurvivors, finalActors };
      if (phaserScene) phaserScene.localEscapeScreenShown = true;
      currentSnapshot = { ...(currentSnapshot || {}), paused: false, canPause: false };
      updateMatchPauseOverlay(currentSnapshot);
      if (phaserScene) {
        phaserScene.spectateTargetId = null;
        phaserScene.lastSpectateEmitId = "";
        phaserScene.resetArenaFloorVisuals?.();
      }
      resetHorrorFxVisualState();
      setMusicTargets({ layer1: 0, layer2: 0, layer3: 0 });
      showFinalMatchScreen(finalMatchResult);
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
