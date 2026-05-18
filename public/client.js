/* global io, Phaser */
(() => {
  "use strict";

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

  // Lighting knobs. The map is drawn at normal readable brightness. A black fog
  // RenderTexture sits above it, then the local player's flashlight erases that fog.
  // Inside the cone you see the real map, not a white overlay and not a black void.
  const LIGHTING = {
    MAP_DARKNESS: 0.38,          // 0 = no fog, 0.85 = very dark outside vision
    SURVIVOR_LENGTH: 880,
    SURVIVOR_ANGLE: Math.PI / 2.05,
    KILLER_LENGTH: 1080,
    KILLER_ANGLE: Math.PI / 1.62,
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
    FLICKER_STRENGTH: LOW_POWER_MODE ? 0.018 : 0.038,
    FLICKER_SPEED: LOW_POWER_MODE ? 5.0 : 7.5,
    FOG_DEPTH: 900,
    // World-space padding around the current camera view. The fog layer is
    // bigger than the viewport so zooming in/out does not require resizing it
    // every frame, which was causing the flashlight to drift and the client to hitch.
    FOG_VIEW_PADDING: 240
  };

  const MUSIC = {
    MASTER: 0.55,
    MENU_MASTER: 0.28,
    FADE: 0.065,
    MENU: "/menu.mp3",
    LAYERS: ["/layer_1.mp3", "/layer_2.mp3", "/layer_3.mp3"]
  };

  const SFX = {
    MASTER: 0.72,
    FILES: {
      hooked: "/hooked.mp3",
      dead: "/dead.mp3",
      gen: "/gen.mp3",
      swing: "/swing.ogg",
      windowVault: "/window_vault.ogg",
      palletVault: "/pallet_vault.ogg",
      injured: "/injured.ogg"
    },
    VOLUMES: {
      hooked: 0.82,
      dead: 0.9,
      gen: 0.76,
      swing: 0.42,
      windowVault: 0.34,
      palletVault: 0.76,
      injured: 0.8
    }
  };

  // Client-only fear tuning. This does not change hitboxes or movement on the server.
  // It just makes the camera and overlay behave like the chase is pulling you inward.
  const IMMERSION = {
    BASE_ZOOM: 1,
    // Camera zoom is back, but kept small and smoothed so chase feels intense
    // without forcing Phaser to violently rescale the whole scene in one frame.
    TERROR_ZOOM: LOW_POWER_MODE ? 0.025 : 0.04,
    CHASE_ZOOM: 0.66,
    // Killer-only attack pressure. Holding M1 subtly pushes the camera in,
    // and a real server-confirmed swing gives a tiny punch. Small numbers on purpose.
    KILLER_M1_HOLD_ZOOM: LOW_POWER_MODE ? 0.045 : 0.085,
    KILLER_M1_PULSE_ZOOM: LOW_POWER_MODE ? 0.035 : 0.065,
    ZOOM_SMOOTHING: LOW_POWER_MODE ? 4.8 : 6.8,
    CHASE_IN_LERP: 0.055,
    CHASE_OUT_LERP: 0.04,
    TERROR_LERP: 0.07,
    BREATH_SWAY: 4,
    CHASE_SWAY: 5,
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
  const GENERATOR_COLLISION_SIZE = 54;

  const PERFORMANCE = {
    // Expensive world UI is redrawn at fixed rates instead of every network snapshot.
    // Lower these if a very weak laptop is still wheezing. Raise them if you want
    // smoother generator bars / scratch marks at the cost of more Graphics work.
    DYNAMIC_WORLD_FPS: LOW_POWER_MODE ? 4 : 7,
    // Generator bars update on their own cheap layer. Full-map redraws should not
    // happen just because somebody is holding E. Humanity may survive this one.
    GENERATOR_FPS: LOW_POWER_MODE ? 4 : 6,
    SCRATCH_DRAW_FPS: LOW_POWER_MODE ? 6 : 8,
    MAX_PARTICLES: LOW_POWER_MODE ? 28 : 58,
    MAX_SHOCKWAVES: LOW_POWER_MODE ? 3 : 6
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
    survivorWalk: 170,
    survivorSprint: 285,
    survivorBoost: 350,
    killer: 310,
    killerRecoveryMult: 0.28,
    killerLungeMult: 1.22,
    downedCrawl: 62,
    survivorSize: 30,
    killerSize: 38
  };

  const COLORS = {
    floorA: 0x090a10,
    floorB: 0x05060a,
    grassLine: 0x1d2440,
    blood: 0xf04444,
    hook: 0x9ca3af,
    hookIron: 0x02030a,
    downed: 0xf87171,
    wall: 0x171827,
    wallDark: 0x070810,
    wallLight: 0x2e3150,
    window: 0x38bdf8,
    pallet: 0x38bdf8,
    palletDark: 0x6366f1,
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

  const SURVIVOR_DOT_MAX = 10;

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
        normal: ["Let's do a generator.", "I'm so scared...", "Here he comes!", "What was that?!"],
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
    mainMenuBtn: document.getElementById("mainMenuBtn"),
    mobileControls: document.getElementById("mobileControls")
  };

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
    volumes: [0, 0, 0]
  };

  function setMenuAudioActive(active, options = {}) {
    audio.menuActive = !!active;
    const menu = audio.menu;
    if (!menu) return;

    menu.volume = MUSIC.MENU_MASTER;

    if (!audio.menuActive) {
      menu.pause();
      return;
    }

    if (options.restart) {
      try { menu.currentTime = 0; } catch (_) { /* Some browsers get precious about media time. */ }
    }

    menu.play().catch(() => {
      // Browser autoplay rules may block this until the first click/key press.
      // Keep menuActive true so the unlock listener below can start it immediately.
    });
  }

  function ensureMenuAudioStarted(options = {}) {
    if (!audio.menuActive || !audio.menu) return;
    audio.menu.volume = MUSIC.MENU_MASTER;
    if (options.restart) {
      try { audio.menu.currentTime = 0; } catch (_) { /* ignore */ }
    }
    audio.menu.play().catch(() => null);
  }

  function setGameplayAudioActive(active) {
    audio.gameActive = !!active;
    if (!audio.gameActive) {
      audio.targets = [0, 0, 0];
      audio.volumes = [0, 0, 0];
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

  function sendInput(oneShot = {}, force = false) {
    if (!socket || !myId) return;
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
    audio.menu.volume = MUSIC.MENU_MASTER;
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

  function setMusicTargets(music) {
    const m = music || { layer1: 0.06, layer2: 0, layer3: 0 };
    audio.targets[0] = clamp((m.layer1 || 0) * MUSIC.MASTER, 0, 0.34);
    audio.targets[1] = clamp((m.layer2 || 0) * MUSIC.MASTER, 0, 0.34);
    audio.targets[2] = clamp((m.layer3 || 0) * MUSIC.MASTER, 0, 0.34);
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

  function playSfx(name) {
    const base = audio.sfx?.[name];
    if (!base) return;
    const clip = base.cloneNode(true);
    clip.loop = false;
    clip.volume = clamp((SFX.VOLUMES[name] || 0.75) * SFX.MASTER, 0, 1);
    clip.play().catch(() => {
      // Browser autoplay rules can still block if the user has not interacted yet.
      // Once they click or press a key, future effects will play. Naturally, browsers need consent to scream.
    });
  }

  function playLocalizedSwing(event) {
    if (!phaserScene || !event) return;
    const me = phaserScene.actors?.get(myId);
    if (!me) return;
    const isKillerSwinging = event.actorId === myId;
    const d = dist(me.current.x, me.current.y, event.x || 0, event.y || 0);
    // Killer hears their own swing. Survivors only hear it when the blade is uncomfortably close.
    if (isKillerSwinging || d <= 390) playSfx("swing");
  }

  function survivorStateLabel(actor) {
    if (actor.dead) return "Dead";
    if (actor.escaped) return "Escaped";
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

  function renderSurvivorStatusHud(snapshot) {
    if (!ui.survivorStatusHud) return;
    const survivors = (snapshot.actors || [])
      .filter((actor) => actor.role === "survivor")
      .sort((a, b) => {
        if (a.id === myId) return -1;
        if (b.id === myId) return 1;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

    ui.survivorStatusHud.innerHTML = survivors.map((actor) => {
      const state = survivorStateLabel(actor);
      const name = escapeHtml(actor.name || "Survivor");
      const you = actor.id === myId ? '<span class="survivor-you">You</span>' : "";
      const dotsHeld = Math.min(SURVIVOR_DOT_MAX, actor.dots || 0);
      const depositText = actor.dotDepositTargetId ? ` • feeding ${Math.round((actor.dotDepositProgress || 0) * 100)}%` : "";
      return `
        <div class="${survivorCardClass(actor)}">
          <div class="survivor-portrait" aria-hidden="true"></div>
          <div class="survivor-meta">
            <div class="survivor-name-row"><span class="survivor-name">${name}</span>${you}</div>
            <div class="survivor-state">${escapeHtml(state)}</div>
            <div class="survivor-dots" aria-label="Collectible dots">${dotsHeld} / ${SURVIVOR_DOT_MAX}${depositText}</div>
          </div>
          <div class="survivor-action">${escapeHtml(actionLabel(actor))}</div>
        </div>`;
    }).join("") || '<div class="survivor-status-card dead"><div class="survivor-portrait"></div><div class="survivor-meta"><div class="survivor-name">No survivors</div><div class="survivor-state">Empty trial</div></div><div class="survivor-action">void</div></div>';
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
      this.lastHudKey = "";
      this.lastHudRenderAt = 0;
      this.lastFogWidth = 0;
      this.lastFogHeight = 0;
      this.lastSnapshotAt = 0;
      this.renderedMapKey = "";
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
      this.lastMoveDirX = 0;
      this.lastMoveDirY = 0;
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
      this.scale.on("resize", () => this.rebuildFogTexture());
      this.grassLayer = null;
      this.worldGraphics = this.add.graphics().setDepth(1);
      this.dynamicGraphics = this.add.graphics().setDepth(3);
      this.generatorGraphics = this.add.graphics().setDepth(3.25);
      this.generatorDepositVisual = new Map();
      this.generatorDepositLastRaw = new Map();
      this.scratchGraphics = this.add.graphics().setDepth(4);
      // Kept only as a cheap fallback container. The actual beam glow is now a pre-baked
      // soft sprite, because per-frame triangle drawing made the cone edge look harsh.
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
      this.createLightTextures();
      this.lightConeMask = this.make.image({ x: 0, y: 0, key: "softFlashlightCone", add: false })
        .setOrigin(0, 0.5);
      this.lightAuraMask = this.make.image({ x: 0, y: 0, key: "softFlashlightAura", add: false })
        .setOrigin(0.5, 0.5);
      this.flashlightBloomImage = this.add.image(0, 0, "softFlashlightBloom")
        .setOrigin(0, 0.5)
        .setDepth(LIGHTING.FOG_DEPTH - 1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false);
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
      this.needsDynamicRedraw = true;
      this.needsGeneratorRedraw = true;
      this.localVisual = null;
      this.localServerTarget = null;
    }

    rebuildOutOfBoundsBackdrop() {
      if (this.outOfBoundsGraphics) {
        this.outOfBoundsGraphics.destroy();
        this.outOfBoundsGraphics = null;
      }
      if (!this.map) return;

      // Ultra-cheap world backdrop. One dark rectangle, no dots, no grid, no orbit lines.
      // Keeps the horror theme cheap to render while keeping the map/game objects visible.
      const pad = 5200;
      const x = -pad;
      const y = -pad;
      const w = this.map.width + pad * 2;
      const h = this.map.height + pad * 2;
      const g = this.add.graphics().setDepth(-20).setScrollFactor(1, 1);
      this.outOfBoundsGraphics = g;
      g.fillStyle(0x03040a, 1);
      g.fillRect(x, y, w, h);
    }

    rebuildGrassLayer() {
      if (this.grassLayer) {
        this.grassLayer.destroy();
        this.grassLayer = null;
      }
      if (!this.map) return;

      // Ultra-cheap playable floor. One dark rectangle, no patches, stains, dots, or edge washes.
      // Walls, windows, pallets, hooks, gens, actors, and fog still render above it.
      const g = this.add.graphics()
        .setDepth(0)
        .setScrollFactor(1, 1);

      this.grassLayer = g;
      g.fillStyle(0x090a10, 1);
      g.fillRect(0, 0, this.map.width, this.map.height);
    }

    rebuildFogTexture() {
      if (this.fogRT) {
        this.fogRT.destroy();
        this.fogRT = null;
      }
      if (!this.map) return;

      // The fog is a camera-window-sized world-space RenderTexture. It moves with
      // the camera in world coordinates, while the cone/aura are erased using local
      // positions inside that texture. That keeps the light anchored to the player
      // during zoom without repainting a full-map texture every frame.
      const cam = this.cameras.main;
      const pad = LIGHTING.FOG_VIEW_PADDING;
      const viewW = Math.ceil((cam.width || this.scale.width || window.innerWidth) + pad * 2);
      const viewH = Math.ceil((cam.height || this.scale.height || window.innerHeight) + pad * 2);
      this.lastFogWidth = viewW;
      this.lastFogHeight = viewH;
      this.fogRT = this.add.renderTexture(0, 0, viewW, viewH)
        .setOrigin(0, 0)
        .setDepth(LIGHTING.FOG_DEPTH)
        .setScrollFactor(1, 1);
      this.fogRT.fill(0x000000, LIGHTING.MAP_DARKNESS);
    }

    clearGeneratorSprites() {
      for (const sprite of this.generatorSprites.values()) sprite.destroy();
      this.generatorSprites.clear();
      this.generatorGraphics?.clear();
    }

    clearActors() {
      for (const actor of this.actors.values()) actor.container.destroy();
      this.actors.clear();
    }

    drawStaticWorld() {
      if (!this.map) return;
      const g = this.worldGraphics;
      g.clear();

      // Background is intentionally blank and dark now. Do not draw tile noise,
      // dots, stains, patches, or decorative floor cells here. Walls/windows only.
      for (const wall of this.map.walls || []) this.drawWall(g, wall);
      for (const win of this.map.windows || []) this.drawWindow(g, win);
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

      for (const pallet of currentSnapshot.map?.pallets || this.map.pallets || []) {
        this.drawPallet(g, pallet);
      }

      // Generator sprites/bars live on their own layer now. Redrawing every pallet,
      // gate, and hook because a progress bar moved was the lag monster wearing a nametag.
      this.syncGeneratorSprites(currentSnapshot.map?.generators || this.map.generators || []);
      for (const gate of currentSnapshot.map?.gates || this.map.gates || []) this.drawGate(g, gate);
      for (const hook of currentSnapshot.map?.hooks || this.map.hooks || []) this.drawHook(g, hook);
      for (const dot of currentSnapshot.collectibleDots || []) this.drawCollectibleDot(g, dot);
    }

    drawCollectibleDot(g, dot) {
      if (!dot || !Number.isFinite(dot.x) || !Number.isFinite(dot.y)) return;
      const pulse = 0.5 + Math.sin(performance.now() / 320 + hash2(Math.floor(dot.x), Math.floor(dot.y)) * Math.PI * 2) * 0.5;
      g.fillStyle(COLORS.collectibleDot, 0.18 + pulse * 0.14);
      g.fillCircle(dot.x, dot.y, 11 + pulse * 2.5);
      g.fillStyle(COLORS.collectibleDotGlow, 0.9);
      g.fillCircle(dot.x, dot.y, 4.5 + pulse * 1.2);
      g.lineStyle(2, 0xfff7d6, 0.45 + pulse * 0.25);
      g.strokeCircle(dot.x, dot.y, 7 + pulse * 1.5);
    }

    drawGeneratorLayer() {
      if (!this.map || !currentSnapshot || !this.generatorGraphics) return;
      const generators = currentSnapshot.map?.generators || this.map.generators || [];
      this.syncGeneratorSprites(generators);
      const g = this.generatorGraphics;
      g.clear();
      for (const gen of generators) this.drawGenerator(g, gen);
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
      const pulse = 0.5 + Math.sin((this.time?.now || performance.now()) * 0.007) * 0.5;

      // Hook state is now a red outlined tile, no hook prop. The square is the danger.
      g.fillStyle(0x7a0505, 0.10 + pulse * 0.06);
      g.fillRect(x + 3, y + 3, tile - 6, tile - 6);
      g.lineStyle(6, 0xff2e2e, 0.78 + pulse * 0.18);
      g.strokeRect(x + 3, y + 3, tile - 6, tile - 6);
      g.lineStyle(2, 0xffc0a8, 0.34 + pulse * 0.22);
      g.strokeRect(x + 12, y + 12, tile - 24, tile - 24);
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

    drawGenerator(g, gen) {
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
      g.fillStyle(0x41536e, shadowAlpha);
      g.fillEllipse(gen.x, gen.y + 32, 78, 18);

      if (repairing || depositing || kicking) {
        const auraSize = 39 + pulse * 7;
        const auraColor = kicking ? GENERATOR_VISUAL.KICK_GLOW_COLOR : depositing ? COLORS.collectibleDot : 0x31a9ff;
        g.fillStyle(auraColor, kicking ? 0.055 : depositing ? 0.065 : 0.045);
        g.fillCircle(gen.x, gen.y, auraSize + 15);
        g.lineStyle(3, auraColor, kicking ? 0.46 : depositing ? 0.44 : 0.32);
        g.strokeCircle(gen.x, gen.y, auraSize);
      }

      // Main .io-style objective cell. The little bubbles sell “machine/objective”
      // without bringing back the old industrial generator sprite.
      g.fillStyle(0xffffff, 0.94);
      g.fillCircle(gen.x, gen.y, 34);
      g.lineStyle(4, rimColor, 0.95);
      g.strokeCircle(gen.x, gen.y, 34);
      g.fillStyle(coreColor, gen.done ? 0.92 : depositing ? 0.88 : 0.80);
      g.fillCircle(gen.x, gen.y, 22 + pulse * (repairing || depositing ? 2.2 : 0.8));
      g.fillStyle(0xffffff, 0.26);
      g.fillCircle(gen.x - 9, gen.y - 10, 8);
      g.fillStyle(0x111827, 0.10);
      g.fillCircle(gen.x + 8, gen.y + 9, 5);

      const orbitR = 39;
      for (let i = 0; i < 5; i++) {
        const seed = hash2(Math.floor(gen.x / 7) + i * 13, Math.floor(gen.y / 7) + i * 17);
        const angle = seed * Math.PI * 2 + (repairing || depositing ? now / 1250 : 0) + i * 1.18;
        const dotSize = 3.2 + (i % 2) * 1.5;
        g.fillStyle(depositing ? COLORS.collectibleDot : i % 2 ? 0x31a9ff : 0xa772ff, gen.done ? 0.26 : depositing ? 0.66 : 0.52);
        g.fillCircle(gen.x + Math.cos(angle) * orbitR, gen.y + Math.sin(angle) * orbitR, dotSize);
      }

      if (showProgress) {
        const ringR = 44;
        g.lineStyle(5, 0xdce7f5, 0.82);
        g.strokeCircle(gen.x, gen.y, ringR);
        const progressColor = gen.done ? 0x4de283 : kicking ? GENERATOR_VISUAL.KICK_GLOW_COLOR : depositing ? COLORS.collectibleDot : repairing ? 0x31a9ff : 0xa772ff;
        if (progress > 0.002) {
          g.lineStyle(6, progressColor, 0.98);
          g.beginPath();
          g.arc(gen.x, gen.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
          g.strokePath();
        }
      }

      if (kicking) {
        const kickProgress = clamp(gen.kickProgress || 0, 0, 1);
        g.lineStyle(3, GENERATOR_VISUAL.KICK_GLOW_COLOR, 0.95);
        g.beginPath();
        g.arc(gen.x, gen.y, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * kickProgress, false);
        g.strokePath();
      }

      if (depositing && smoothedDeposit > 0.002) {
        const depositArc = smoothedDeposit >= GENERATOR_VISUAL.DEPOSIT_FULL_SNAP ? 1 : smoothedDeposit;
        g.lineStyle(4, COLORS.collectibleDotGlow, 0.92);
        g.beginPath();
        g.arc(gen.x, gen.y, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * depositArc, false);
        g.strokePath();
      }

      if (gen.done && showProgress) {
        g.lineStyle(3, 0x4de283, 0.55 + pulse * 0.20);
        g.strokeCircle(gen.x, gen.y, 56 + pulse * 4);
      }
    }

    drawGate(g, gate) {
      const x = gate.x - 34;
      const y = gate.y - 34;
      g.lineStyle(5, gate.open ? 0x86ff76 : COLORS.gate, 0.95);
      g.strokeRoundedRect(x, y, 68, 68, 12);
      g.fillStyle(gate.open ? 0x87ff8a : 0x342414, gate.open ? 0.22 : 0.6);
      g.fillRoundedRect(x + 8, y + 8, 52, 52, 9);
    }

    applySnapshot(snapshot) {
      currentSnapshot = snapshot;
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
      this.handleEvents(snapshot.events || []);
      this.updateHud(snapshot);
      this.lastSnapshotAt = performance.now();
    }

    updateHud(snapshot) {
      const me = (snapshot.actors || []).find((a) => a.id === myId);
      if (!me) return;

      const now = performance.now();
      const objective = snapshot.objective || {};
      const hudKey = JSON.stringify({
        self: [me.id, me.role, me.health, me.dots, me.injured, me.downed, me.hooked, me.dead, me.escaped, me.chase, me.hookProgress, me.healProgress, me.generatorKickTargetId, me.generatorKickProgress],
        objective: [objective.doneGenerators, objective.requiredGenerators, objective.totalGenerators, objective.escapeOpen],
        survivors: (snapshot.actors || []).filter((a) => a.role === "survivor").map((a) => [a.id, a.health, a.dots, a.injured, a.downed, a.hooked, a.dead, a.escaped, a.chase, a.hookProgress, a.healProgress, a.hookCount]),
        dots: (snapshot.collectibleDots || []).map((d) => d.id).join(",")
      });
      if (hudKey === this.lastHudKey && now - this.lastHudRenderAt < 180) return;
      this.lastHudKey = hudKey;
      this.lastHudRenderAt = now;
      renderSurvivorStatusHud(snapshot);
      ui.roleLabel.textContent = me.role === "killer" ? "Killer" : "Survivor";
      ui.controlsLabel.textContent = me.role === "killer"
        ? "WASD move • Mouse aim • M1 attack/lunge • Space vault/break • hold E hook/execute/kick gen • hold R chat"
        : "WASD move • Shift sprint • Mouse flashlight • Space vault/drop • collect dots, stand near gens to deposit • hold E heal/escape • hold R chat";
      const done = snapshot.objective?.doneGenerators ?? 0;
      const required = snapshot.objective?.requiredGenerators ?? snapshot.objective?.totalGenerators ?? 0;
      const total = snapshot.objective?.totalGenerators ?? required;
      const shownDone = Math.min(done, required);
      ui.genText.textContent = `${shownDone} / ${required}${total > required ? ` (${total} on map)` : ""}`;
      if (ui.bigGenText) ui.bigGenText.textContent = `${shownDone} / ${required}`;
      ui.bigGenCounter?.classList.toggle("is-complete", required > 0 && shownDone >= required);
      ui.gateText.textContent = snapshot.objective?.escapeOpen ? "Open" : "Closed";
      if (me.role === "killer") {
        const actors = snapshot.actors || [];
        const hookingTarget = actors.find((a) => a.id === me.hookActionTargetId);
        const readyTarget = actors.find((a) => a.id === me.hookReadyTargetId);
        if (hookingTarget) {
          const executing = me.hookActionType === "execute" || (hookingTarget.hookCount || 0) >= 2;
          ui.healthText.textContent = `${executing ? "Executing" : "Hooking"} ${hookingTarget.name || "survivor"} ${Math.round((hookingTarget.hookProgress || 0) * 100)}%`;
        } else if (readyTarget) {
          const executeReady = (readyTarget.hookCount || 0) >= 2;
          ui.healthText.textContent = `Hold E: ${executeReady ? "Execute" : "hook"} ${readyTarget.name || "survivor"}`;
        } else if (me.generatorKickTargetId) {
          ui.healthText.textContent = `Kicking generator ${Math.round((me.generatorKickProgress || 0) * 100)}%`;
        } else {
          const kickable = (snapshot.map?.generators || []).some((gen) => !gen.done && !gen.kickLocked && (gen.progress || 0) > 0 && Math.hypot((me.x || 0) - gen.x, (me.y || 0) - gen.y) < 92);
          ui.healthText.textContent = kickable ? "Hold E: Kick generator" : "Killer";
        }
      } else ui.healthText.textContent = survivorStateLabel(me);
      updateHorrorFx(snapshot, me, { terror: this.terrorBlend, chase: this.chaseBlend });
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

    updateActorTargets(actors) {
      const seen = new Set();
      for (const data of actors) {
        seen.add(data.id);
        let item = this.actors.get(data.id);
        if (!item || item.role !== data.role) {
          if (item) {
            item.container.destroy();
            item.nameText?.destroy();
            item.chatText?.destroy();
          }
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
        const isVisible = data.visible !== false || data.id === myId;
        item.container.setVisible(true);
        item.container.setAlpha(isVisible ? 1 : 0);
        item.nameText.setText(data.name || "");
        item.nameText.setVisible(isVisible && data.id !== myId);
        if (item.chatText) {
          item.chatText.setText(data.chatText || "");
          item.chatText.setVisible(isVisible && !!data.chatText);
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
        }
      }

      for (const [id, item] of this.actors.entries()) {
        if (!seen.has(id)) {
          item.container.destroy();
          item.nameText?.destroy();
          item.chatText?.destroy();
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
        const wobble = Math.sin(now / 145) * 1.2;
        const coreR = 18.5 + wobble + angry * 2.8;

        item.body.fillStyle(0x07020f, 0.96);
        item.body.fillCircle(0, 0, coreR + 2);
        item.body.fillStyle(0x32105f, 0.86);
        item.body.fillCircle(-4, -2, coreR * 0.82);
        item.body.fillStyle(0x7c3aed, 0.36 + angry * 0.22);
        item.body.fillCircle(5, 3, coreR * 0.68);
        item.body.fillStyle(0x000000, 0.54);
        item.body.fillCircle(3, -5, coreR * 0.40);

        for (let i = 0; i < 7; i++) {
          const seed = i * 1.731;
          const a = now / (620 + i * 55) + seed;
          const r = 11 + i * 2.15 + Math.sin(now / 220 + i) * 2.0;
          const size = 4.4 + (i % 3) * 1.8 + angry * 1.4;
          const color = i % 2 ? 0x8b5cf6 : 0x111827;
          item.body.fillStyle(color, i % 2 ? 0.62 : 0.72);
          item.body.fillCircle(Math.cos(a) * r, Math.sin(a * 1.13) * r, size);
        }

        item.outline.lineStyle(2, 0xd8b4fe, 0.48 + angry * 0.34);
        item.outline.strokeCircle(0, 0, 23 + angry * 2);
        item.outline.lineStyle(1, 0x4c1d95, 0.70);
        item.outline.strokeCircle(0, 0, 28 + Math.sin(now / 190) * 1.5 + angry * 3);
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
      } else {
        item.body.fillStyle(fillColor, bodyAlpha);
        item.body.fillCircle(0, 0, r);
        item.outline.lineStyle(2, outlineColor, outlineAlpha);
        item.outline.strokeCircle(0, 0, r + 3);
      }

      this.drawHeldDotOrbits(item, item.body, bodyAlpha, accent, glow, item.current?.angle ?? 0);
    }

    styleActor(item, data) {
      if (data.role === "killer") {
        const charging = data.attackState === "charging";
        const attacking = data.attacking || data.attackState === "quick" || data.attackState === "lunge";
        this.drawActorShape(item, data, COLORS.killer, 1, 0xd8b4fe, attacking ? 1 : 0.84);
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
        this.drawActorShape(item, data, data.dead ? 0x555555 : color, disabled ? 0.45 : 1, outlineColor, showProgress || data.invuln > 0 || data.hooked ? 1 : 0.82);
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
        if (event.type === "execute" || event.type === "death") playSfx("dead");
        if (event.type === "genDone") playSfx("gen");
        if (event.type === "hit" || event.type === "downed") playSfx("injured");
        if (event.type === "vault" && event.actorId === myId) playSfx(event.vaultType === "pallet" ? "palletVault" : "windowVault");
        if (["hit", "death", "execute", "downed", "hooked", "unhooked"].includes(event.type)) {
          const color = event.type === "unhooked" ? 0x75d5ff : event.type === "hooked" ? COLORS.hook : COLORS.blood;
          const heavy = event.type === "death" || event.type === "execute" || event.type === "downed" || event.type === "hooked";
          this.burst(event.x, event.y, color, event.type === "hooked" ? 52 : event.type === "execute" || event.type === "death" ? 62 : 38, event.type === "unhooked" ? 140 : 220);
          this.cameras.main.shake(heavy ? 210 : 110, heavy ? 0.0055 : 0.0032);
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
        if (event.type === "palletDrop") this.burst(event.x, event.y, COLORS.pallet, 16, 130);
        if (event.type === "palletBreak" || event.type === "palletBreakStart") this.burst(event.x, event.y, 0xffc36a, 18, 150);
        if (event.type === "killerStun") this.burst(event.x, event.y, 0xfff1a8, 30, 110);
        if (event.type === "escape") {
          this.burst(event.x, event.y, 0x9eff91, 36, 150);
          this.addShockwave(event.x, event.y, 0x9eff91);
        }
        if (event.type === "healDone") this.burst(event.x, event.y, 0x8dff9a, 24, 120);
        if (event.type === "dotPickup") this.burst(event.x, event.y, COLORS.collectibleDot, 10, 95);
        if (event.type === "dotDeposit") {
          this.burst(event.x, event.y, COLORS.collectibleDotGlow, 18, 110);
          this.addShockwave(event.x, event.y, COLORS.collectibleDot);
        }
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

    addShockwave(x, y, color = 0xffffff) {
      this.shockwaves.push({ x, y, color, life: 0, ttl: 0.72, radius: 8 });
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

    update(time, deltaMs) {
      const dt = Math.min(0.04, deltaMs / 1000);
      updateMusic();
      this.updateAimAngle();
      this.predictLocal(dt);
      this.updateActorDisplays(dt);
      this.updateImmersion(dt);
      this.updateCamera(dt);
      this.maybeDrawDynamicWorld(dt);
      this.maybeDrawGeneratorLayer(dt);
      this.maybeUpdateScratchGraphics(dt);
      this.drawLighting();
      this.drawHookIndicators();
      this.drawChatWheel();
      this.drawChargeIndicators(dt);
      this.drawSwipes(dt);
      this.updateParticles(dt);

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
      const me = this.localServerTarget?.data || this.actors.get(myId)?.data;
      const levels = getThreatLevels(currentSnapshot, me);
      const chaseRate = levels.chase ? IMMERSION.CHASE_IN_LERP : IMMERSION.CHASE_OUT_LERP;
      this.chaseBlend = lerp(this.chaseBlend, levels.chase, chaseRate);
      this.terrorBlend = lerp(this.terrorBlend, levels.terror, IMMERSION.TERROR_LERP);
      this.breathPhase += dt * (1.25 + this.terrorBlend * 2.1 + this.chaseBlend * 2.5);
      this.lightFlickerPhase += dt * LIGHTING.FLICKER_SPEED;
      this.heartbeatPulse = Math.max(0, this.heartbeatPulse - dt * 3.8);
      this.killerM1Pulse = Math.max(0, (this.killerM1Pulse || 0) - dt * 5.5);

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
      const item = this.actors.get(myId);
      if (!item) return;
      const cam = this.cameras.main;
      const x = item.container.x;
      const y = item.container.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const localData = item.data || item.current || item.target || null;
      const killerCharging = localData?.role === "killer" && localData.attackState === "charging";
      const killerM1Hold = localData?.role === "killer" && (input.attackHeld || killerCharging) ? 1 : 0;
      const attackZoom = killerM1Hold * IMMERSION.KILLER_M1_HOLD_ZOOM
        + (this.killerM1Pulse || 0) * IMMERSION.KILLER_M1_PULSE_ZOOM;
      const targetZoom = clamp(
        IMMERSION.BASE_ZOOM
          + this.terrorBlend * IMMERSION.TERROR_ZOOM
          + this.chaseBlend * IMMERSION.CHASE_ZOOM
          + attackZoom,
        IMMERSION.BASE_ZOOM,
        IMMERSION.BASE_ZOOM
          + IMMERSION.TERROR_ZOOM
          + IMMERSION.CHASE_ZOOM
          + IMMERSION.KILLER_M1_HOLD_ZOOM
          + IMMERSION.KILLER_M1_PULSE_ZOOM
      );
      const zoomAlpha = dampAlpha(IMMERSION.ZOOM_SMOOTHING, dt);
      const nextZoom = lerp(cam.zoom || IMMERSION.BASE_ZOOM, targetZoom, zoomAlpha);
      if (Math.abs((cam.zoom || IMMERSION.BASE_ZOOM) - nextZoom) > 0.0004) {
        cam.setZoom(nextZoom);
      }

      const moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const moveY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const moveLen = Math.hypot(moveX, moveY);

      if (moveLen > 0.001) {
        const nx = moveX / moveLen;
        const ny = moveY / moveLen;
        const prevLen = Math.hypot(this.lastMoveDirX || 0, this.lastMoveDirY || 0);
        const directionDelta = prevLen > 0.001
          ? Math.hypot(nx - this.lastMoveDirX, ny - this.lastMoveDirY)
          : 0;

        // Direction changes create a small target offset, not an instant camera jump.
        // The actual camera eases toward this target below, then the target fades out.
        if (prevLen > 0.001 && directionDelta >= IMMERSION.DIRECTION_CHANGE_THRESHOLD) {
          this.cameraSwayTargetX = nx * IMMERSION.DIRECTION_SWAY_IMPULSE;
          this.cameraSwayTargetY = ny * IMMERSION.DIRECTION_SWAY_IMPULSE;
          const targetLen = Math.hypot(this.cameraSwayTargetX, this.cameraSwayTargetY);
          if (targetLen > IMMERSION.DIRECTION_SWAY_MAX) {
            const scale = IMMERSION.DIRECTION_SWAY_MAX / targetLen;
            this.cameraSwayTargetX *= scale;
            this.cameraSwayTargetY *= scale;
          }
        }

        this.lastMoveDirX = nx;
        this.lastMoveDirY = ny;
      } else {
        this.lastMoveDirX = 0;
        this.lastMoveDirY = 0;
        this.cameraSwayTargetX = 0;
        this.cameraSwayTargetY = 0;
      }

      const targetDecay = dampAlpha(IMMERSION.DIRECTION_SWAY_TARGET_DECAY, dt);
      this.cameraSwayTargetX = lerp(this.cameraSwayTargetX || 0, 0, targetDecay);
      this.cameraSwayTargetY = lerp(this.cameraSwayTargetY || 0, 0, targetDecay);

      const smoothRate = moveLen > 0.001
        ? IMMERSION.DIRECTION_SWAY_SMOOTHING
        : IMMERSION.DIRECTION_SWAY_IDLE_SMOOTHING;
      const smooth = dampAlpha(smoothRate, dt);
      this.cameraSwayX = lerp(this.cameraSwayX || 0, this.cameraSwayTargetX || 0, smooth);
      this.cameraSwayY = lerp(this.cameraSwayY || 0, this.cameraSwayTargetY || 0, smooth);

      // Keep the local player centered even at map corners. Phaser's black
      // background fills outside the map. Small direction-change sway is visual only.
      cam.centerOn(x + this.cameraSwayX, y + this.cameraSwayY);
    }

    getDynamicWorldKey() {
      const map = currentSnapshot?.map || this.map;
      if (!map) return "";
      const palletKey = (map.pallets || []).map((p) => `${p.id}:${p.state}:${p.broken ? 1 : 0}`).join("|");
      const hookKey = (map.hooks || []).map((h) => `${h.id}:${h.active ? 1 : 0}:${h.survivorId || ""}`).join("|");
      const gateKey = (map.gates || []).map((g) => `${g.id}:${g.open ? 1 : 0}`).join("|");
      const dotKey = (currentSnapshot?.collectibleDots || []).map((d) => d.id).join(",");
      return `${palletKey}#${hookKey}#${gateKey}#${dotKey}`;
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
      const interval = 1 / PERFORMANCE.DYNAMIC_WORLD_FPS;
      if (!this.needsDynamicRedraw && this.dynamicRedrawTimer < interval) return;
      if (this.dynamicRedrawTimer < interval) return;
      const key = this.getDynamicWorldKey();
      if (key !== this.lastDynamicKey || this.needsDynamicRedraw) {
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
        }
      }

      return animating;
    }

    maybeDrawGeneratorLayer(dt) {
      const depositAnimating = this.updateGeneratorDepositVisuals(dt);
      this.generatorRedrawTimer += dt;
      const interval = 1 / PERFORMANCE.GENERATOR_FPS;

      if (depositAnimating) {
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

    drawLighting() {
      const me = this.actors.get(myId);
      const cam = this.cameras.main;
      const pad = LIGHTING.FOG_VIEW_PADDING;
      const viewW = Math.ceil((cam.width || this.scale.width || window.innerWidth) + pad * 2);
      const viewH = Math.ceil((cam.height || this.scale.height || window.innerHeight) + pad * 2);

      if (!this.fogRT || this.lastFogWidth !== viewW || this.lastFogHeight !== viewH) {
        this.rebuildFogTexture();
        if (!this.fogRT) return;
      }

      // Anchor the fog layer in world space around the current camera viewport.
      // Do not multiply by camera zoom here. Phaser applies the camera transform to
      // the RenderTexture, so local fog coordinates stay in the same world units as
      // actors, walls, windows, and pallets.
      const zoom = Math.max(0.001, cam.zoom || 1);
      const visibleW = (cam.width || this.scale.width || window.innerWidth) / zoom;
      const visibleH = (cam.height || this.scale.height || window.innerHeight) / zoom;
      const viewX = cam.scrollX;
      const viewY = cam.scrollY;
      const fogX = viewX - pad;
      const fogY = viewY - pad;
      this.fogRT.setPosition(fogX, fogY);
      this.fogRT.clear();
      this.fogRT.fill(0x000000, LIGHTING.MAP_DARKNESS);
      this.flashlightGlowGraphics?.clear();
      this.flashlightBloomImage?.setVisible(false);

      if (!me || !this.lightConeMask || !this.lightAuraMask) return;

      const role = me.data?.role || "survivor";
      const length = role === "killer" ? LIGHTING.KILLER_LENGTH : LIGHTING.SURVIVOR_LENGTH;
      const angle = role === "killer" ? LIGHTING.KILLER_ANGLE : LIGHTING.SURVIVOR_ANGLE;
      const worldX = me.container.x;
      const worldY = me.container.y;
      const facing = me.container.rotation || 0;
      const localX = worldX - fogX;
      const localY = worldY - fogY;

      // If the player has somehow left the fog window, skip erasing this frame instead
      // of drawing at a bad coordinate. The window is padded, so this should only happen
      // during resize/camera edge cases.
      if (localX < -64 || localY < -64 || localX > viewW + 64 || localY > viewH + 64) return;

      const flicker = 1 - LIGHTING.FLICKER_STRENGTH * 0.5
        + Math.sin(this.lightFlickerPhase) * LIGHTING.FLICKER_STRENGTH * 0.35
        + Math.sin(this.lightFlickerPhase * 2.37) * LIGHTING.FLICKER_STRENGTH * 0.15;
      const xScale = (length * flicker) / LIGHTING.CONE_TEXTURE_WIDTH;
      const angleScale = Math.tan(angle / 2) / Math.tan(LIGHTING.CONE_BASE_HALF_ANGLE);

      this.lightAuraMask
        .setPosition(localX, localY)
        .setRotation(0)
        .setScale((LIGHTING.AURA_RADIUS * 2 * (0.96 + flicker * 0.04)) / 512)
        .setAlpha(LIGHTING.AURA_ALPHA);

      this.lightConeMask
        .setPosition(localX, localY)
        .setRotation(facing)
        .setScale(xScale, xScale * angleScale)
        .setAlpha(clamp(0.98 + flicker * 0.06, 0.92, 1));

      // Visible flashlight bloom. Use one pre-baked soft sprite instead of several hard-edged
      // Graphics triangles. One additive sprite is cheaper and blends far better.
      if (this.flashlightBloomImage) {
        const bloomLength = length * 0.86 * flicker;
        const bloomYScale = (Math.tan(angle / 2) / Math.tan(LIGHTING.CONE_BASE_HALF_ANGLE)) * 1.06;
        this.flashlightBloomImage
          .setVisible(true)
          .setPosition(worldX, worldY)
          .setRotation(facing)
          .setScale(bloomLength / LIGHTING.CONE_TEXTURE_WIDTH, (bloomLength / LIGHTING.CONE_TEXTURE_WIDTH) * bloomYScale)
          .setAlpha(role === "killer" ? 0.55 : 0.86);
      }
      this.fogRT.erase(this.lightAuraMask);
      this.fogRT.erase(this.lightConeMask);
    }


    drawHookIndicators() {
      const g = this.hookIndicatorGraphics;
      if (!g) return;
      g.clear();
      if (!currentSnapshot || !this.actors.has(myId)) return;

      const me = this.actors.get(myId)?.data;
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
        const radius = wave.radius + t * 120;
        g.lineStyle(3, wave.color, (1 - t) * 0.62);
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

  function setupUI() {
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
      left.innerHTML = `<strong>${escapeHtml(lobby.name)}</strong><small>${escapeHtml(lobby.mapName || "Map")} • ${lobby.survivors}/${lobby.maxSurvivors} survivors • ${lobby.killer ? "killer taken" : "killer open"}</small>`;
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
      const skin = player.role === "survivor" ? getSurvivorSkin(player.skin).label : "Killer Circle";
      item.innerHTML = `<div><strong>${escapeHtml(player.name)}${player.id === myId ? " (You)" : ""}</strong><small>${player.role}${player.isBot ? " bot" : ""} • ${escapeHtml(skin)}</small></div><small>${player.ready ? "Ready" : "Not ready"}</small>`;
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
      if (phaserScene) phaserScene.loadMap(map);
      showScreen("game");
      ensureAudioStarted();
    });
    socket.on("snapshot", (snapshot) => {
      if (snapshot?.seq && currentSnapshot?.seq && snapshot.seq <= currentSnapshot.seq) return;
      currentSnapshot = snapshot;
      if (phaserScene) phaserScene.applySnapshot(snapshot);
    });
    socket.on("matchEnded", ({ winner, reason }) => {
      ui.winnerText.textContent = winner === "killer" ? "Killer Wins" : "Survivors Win";
      ui.reasonText.textContent = reason || "Match ended.";
      setMusicTargets({ layer1: 0, layer2: 0, layer3: 0 });
      showScreen("end");
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
