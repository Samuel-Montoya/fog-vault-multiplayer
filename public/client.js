/* global io, Phaser */
(() => {
  "use strict";

  // Lighting knobs. The map is drawn at normal readable brightness. A black fog
  // RenderTexture sits above it, then the local player's flashlight erases that fog.
  // Inside the cone you see the real map, not a white overlay and not a black void.
  const LIGHTING = {
    MAP_DARKNESS: 0.8,          // 0 = no fog, 0.85 = very dark outside vision
    SURVIVOR_LENGTH: 700,
    SURVIVOR_ANGLE: Math.PI / 2.25,
    KILLER_LENGTH: 980,
    KILLER_ANGLE: Math.PI / 1.7,
    CONE_TEXTURE_WIDTH: 1024,
    CONE_TEXTURE_HEIGHT: 1024,
    CONE_BASE_HALF_ANGLE: Math.atan(0.52),
    AURA_ALPHA: 0.72,
    AURA_RADIUS: 145,
    // Tiny flicker keeps the flashlight alive without turning it into a disco lawsuit.
    FLICKER_STRENGTH: 0.055,
    FLICKER_SPEED: 7.5,
    FOG_DEPTH: 900
  };

  const MUSIC = {
    MASTER: 0.55,
    FADE: 0.065,
    LAYERS: ["/layer_1.mp3", "/layer_2.mp3", "/layer_3.mp3"]
  };

  const SFX = {
    MASTER: 0.72,
    FILES: {
      hooked: "/hooked.mp3",
      dead: "/dead.mp3",
      gen: "/gen.mp3",
      swing: "/swing.mp3",
      windowVault: "/window_vault.ogg",
      palletVault: "/pallet_vault.ogg",
      injured: "/injured.ogg"
    },
    VOLUMES: {
      hooked: 0.82,
      dead: 0.9,
      gen: 0.76,
      swing: 0.72,
      windowVault: 0.72,
      palletVault: 0.76,
      injured: 0.8
    }
  };

  // Client-only fear tuning. This does not change hitboxes or movement on the server.
  // It just makes the camera and overlay behave like the chase is pulling you inward.
  const IMMERSION = {
    BASE_ZOOM: 1,
    TERROR_ZOOM: 0.018,
    CHASE_ZOOM: 0.3,
    ZOOM_LERP: 0.055,
    CHASE_IN_LERP: 0.075,
    CHASE_OUT_LERP: 0.04,
    TERROR_LERP: 0.07,
    BREATH_SWAY: 5,
    CHASE_SWAY: 100,
    HEARTBEAT_MIN_INTERVAL: 0.32,
    HEARTBEAT_MAX_INTERVAL: 0.88,
    // Chase shake tuned way down. Fear good. Nausea bad. Somehow this took versions to learn.
    HEARTBEAT_SHAKE_BASE: 0.00045,
    HEARTBEAT_SHAKE_CHASE: 0.00105,
    CHASE_START_SHAKE_DURATION: 95,
    CHASE_START_SHAKE_INTENSITY: 0.00135,
    TUNNEL_MAX: 0.72
  };

  // Keep this matched with server.js. Client uses it only for local prediction
  // so walking into generators does not feel like rubber-band soup.
  const GENERATOR_COLLISION_SIZE = 54;

  // Visual generator tuning. Put your actual SVG at public/gen.svg.
  // The fallback canvas texture below keeps the game from collapsing if the file is missing,
  // because browsers are apparently dramatic about absent art assets.
  const GROUND_VISUAL = {
    TEXTURE_KEY: "grassTileTexture",
    TILE_SIZE: 72,
    BASE: "#1f2f1d",
    BASE_DARK: "#172416",
    BLADE_A: "rgba(92, 132, 70, 0.34)",
    BLADE_B: "rgba(47, 83, 43, 0.42)",
    FLOWER: "rgba(180, 160, 95, 0.12)"
  };

  const WALL_VISUAL = {
    BRICK_WIDTH: 54,
    BRICK_HEIGHT: 24,
    MORTAR: 0x211e1c,
    MORTAR_ALPHA: 0.58,
    EDGE_ALPHA: 0.34,
    HIGHLIGHT_ALPHA: 0.12
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
    KICK_GLOW_COLOR: 0xff4b4b
  };

  const HOOK_INDICATOR = {
    // Survivor-only edge bubble that points toward hooked teammates.
    // Raise EDGE_PADDING if your HUD overlaps the screen border.
    EDGE_PADDING: 66,
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
    floorA: 0x21331f,
    floorB: 0x182718,
    grassLine: 0x4f7242,
    blood: 0x7b1010,
    hook: 0x91613a,
    hookIron: 0x1b1512,
    downed: 0x8f2020,
    wall: 0x5c4d43,
    wallDark: 0x2b211d,
    wallLight: 0x8a7569,
    window: 0xd2d6ca,
    pallet: 0xb57a3c,
    palletDark: 0x5e321d,
    gen: 0xb0b7a8,
    gate: 0xc2a055,
    survivor: 0x75d5ff,
    survivorInjured: 0xff6868,
    killer: 0xd93434,
    text: 0xf2efea,
    scratch: 0xff3535
  };

  const SURVIVOR_SKINS = {
    blueSquare: { id: "blueSquare", label: "Blue Square", shape: "square", color: 0x75d5ff, outline: 0xf7fbff },
    yellowStar: { id: "yellowStar", label: "Yellow Star", shape: "star", color: 0xffd94a, outline: 0xfff2a8 },
    purplePentagon: { id: "purplePentagon", label: "Purple Pentagon", shape: "pentagon", color: 0x9b6dff, outline: 0xe7d9ff }
  };

  function getSurvivorSkin(id) {
    return SURVIVOR_SKINS[id] || SURVIVOR_SKINS.blueSquare;
  }

  const ui = {
    menu: document.getElementById("menu"),
    lobbyScreen: document.getElementById("lobbyScreen"),
    endScreen: document.getElementById("endScreen"),
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
    mainMenuBtn: document.getElementById("mainMenuBtn")
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
    layers: [],
    sfx: {},
    targets: [0, 0, 0],
    volumes: [0, 0, 0]
  };

  function showScreen(name) {
    ui.menu.classList.toggle("screen-open", name === "menu");
    ui.lobbyScreen.classList.toggle("screen-open", name === "lobby");
    ui.endScreen.classList.toggle("screen-open", name === "end");
    ui.hud.classList.toggle("hidden", name !== "game");
    ui.survivorStatusHud?.classList.toggle("hidden", name !== "game");
    ui.bigGenCounter?.classList.toggle("hidden", name !== "game");
    ui.horrorFx?.classList.toggle("hidden", name !== "game");
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
    if (audio.ready || audio.tried) return;
    audio.tried = true;
    const plays = audio.layers.map((a) => {
      a.currentTime = 0;
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
      return `
        <div class="${survivorCardClass(actor)}">
          <div class="survivor-portrait" aria-hidden="true"></div>
          <div class="survivor-meta">
            <div class="survivor-name-row"><span class="survivor-name">${name}</span>${you}</div>
            <div class="survivor-state">${escapeHtml(state)}</div>
            <div class="survivor-health-line"><span class="survivor-health-fill"></span></div>
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

  function updateHorrorFx(snapshot, me, smoothed = null) {
    if (!ui.horrorFx) return;
    const raw = getThreatLevels(snapshot, me);
    const terror = smoothed?.terror ?? raw.terror;
    const chase = smoothed?.chase ?? raw.chase;
    const blood = raw.blood;
    const tunnel = clamp(chase * IMMERSION.TUNNEL_MAX + terror * 0.22 + blood * 0.18, 0, 1);
    const pulseSpeed = `${Math.round(980 - terror * 330 - chase * 210)}ms`;

    ui.horrorFx.style.setProperty("--terror", terror.toFixed(3));
    ui.horrorFx.style.setProperty("--chase", chase.toFixed(3));
    ui.horrorFx.style.setProperty("--blood", blood.toFixed(3));
    ui.horrorFx.style.setProperty("--tunnel", tunnel.toFixed(3));
    ui.horrorFx.style.setProperty("--pulse-speed", pulseSpeed);
    document.body.classList.toggle("in-chase", raw.chase > 0);
    document.body.classList.toggle("is-injured", !!raw.injured);
  }

  class GameScene extends Phaser.Scene {
    constructor() {
      super("GameScene");
      this.map = null;
      this.worldGraphics = null;
      this.dynamicGraphics = null;
      this.scratchGraphics = null;
      this.fogRT = null;
      this.lightConeMask = null;
      this.lightAuraMask = null;
      this.particleGraphics = null;
      this.actors = new Map();
      this.generatorSprites = new Map();
      this.localVisual = null;
      this.localServerTarget = null;
      this.particles = [];
      this.shockwaves = [];
      this.inputTimer = 0;
      this.lastSnapshotAt = 0;
      this.renderedMapKey = "";
      this.chaseBlend = 0;
      this.terrorBlend = 0;
      this.heartbeatTimer = 0;
      this.heartbeatPulse = 0;
      this.breathPhase = 0;
      this.lastRawChase = false;
      this.lightFlickerPhase = 0;
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
      this.cameras.main.setBackgroundColor("#050505");
      this.createGrassTexture();
      this.grassLayer = null;
      this.worldGraphics = this.add.graphics().setDepth(1);
      this.dynamicGraphics = this.add.graphics().setDepth(3);
      this.scratchGraphics = this.add.graphics().setDepth(4);
      this.chargeGraphics = this.add.graphics().setDepth(21);
      this.swipeGraphics = this.add.graphics().setDepth(22);
      this.particleGraphics = this.add.graphics().setDepth(30);
      this.hookIndicatorGraphics = this.add.graphics()
        .setDepth(2500)
        .setScrollFactor(0, 0);
      this.swipes = [];
      this.createGeneratorFallbackTexture();
      this.createLightTextures();
      this.lightConeMask = this.make.image({ x: 0, y: 0, key: "softFlashlightCone", add: false })
        .setOrigin(0, 0.5);
      this.lightAuraMask = this.make.image({ x: 0, y: 0, key: "softFlashlightAura", add: false })
        .setOrigin(0.5, 0.5);
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
      if (this.textures.exists(GROUND_VISUAL.TEXTURE_KEY)) return;

      const size = GROUND_VISUAL.TILE_SIZE;
      const tex = this.textures.createCanvas(GROUND_VISUAL.TEXTURE_KEY, size, size);
      const canvas = tex.getSourceImage();
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, size, size);

      const grad = ctx.createRadialGradient(size * 0.35, size * 0.25, 4, size / 2, size / 2, size * 0.78);
      grad.addColorStop(0, GROUND_VISUAL.BASE);
      grad.addColorStop(1, GROUND_VISUAL.BASE_DARK);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      // One texture tile equals one ASCII map tile. Draw blades across the full cell,
      // including edges, so the ground reads as a continuous grass field instead of
      // a tiny repeated postage stamp.
      for (let i = 0; i < 150; i++) {
        const x = Math.floor(hash2(i, 91) * (size + 14)) - 7;
        const y = Math.floor(hash2(i, 143) * (size + 14)) - 7;
        const len = 6 + hash2(i, 197) * 18;
        const lean = -6 + hash2(i, 233) * 12;
        ctx.strokeStyle = i % 3 === 0 ? GROUND_VISUAL.BLADE_A : GROUND_VISUAL.BLADE_B;
        ctx.lineWidth = hash2(i, 271) > 0.82 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + lean * 0.45, y - len * 0.52, x + lean, y - len);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

      for (let i = 0; i < 18; i++) {
        const x = Math.floor(hash2(i, 401) * size);
        const y = Math.floor(hash2(i, 433) * size);
        ctx.fillStyle = GROUND_VISUAL.FLOWER;
        ctx.beginPath();
        ctx.arc(x, y, 1.3 + hash2(i, 467) * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Soft vignette per tile avoids the repeating texture looking too sterile.
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, 0, size, 3);
      ctx.fillRect(0, 0, 3, size);

      tex.refresh();
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

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dx = Math.max(0, x);
            const dy = y - originY;
            const halfWidth = Math.max(10, dx * tanBase);
            const edgeRatio = Math.abs(dy) / halfWidth;
            const i = (y * w + x) * 4;
            if (edgeRatio > 1 || dx <= 0) continue;

            const radial = dx / w;
            const centerGlow = 1 - smoothstep(0.52, 1.0, radial);
            const edgeFade = 1 - smoothstep(0.55, 1.0, edgeRatio);
            const noseFade = smoothstep(0.0, 0.08, radial);
            const alpha = clamp(centerGlow * edgeFade * noseFade, 0, 1);

            data[i] = 255;
            data[i + 1] = 255;
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
        grad.addColorStop(0, "rgba(255,255,255,0.95)");
        grad.addColorStop(0.45, "rgba(255,255,255,0.38)");
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
      this.rebuildGrassLayer();
      this.drawStaticWorld();
      this.drawDynamicWorld();
      this.rebuildFogTexture();
      this.clearGeneratorSprites();
      this.clearActors();
      this.localVisual = null;
      this.localServerTarget = null;
    }

    rebuildGrassLayer() {
      if (this.grassLayer) {
        this.grassLayer.destroy();
        this.grassLayer = null;
      }
      if (!this.map) return;
      this.grassLayer = this.add.tileSprite(0, 0, this.map.width, this.map.height, GROUND_VISUAL.TEXTURE_KEY)
        .setOrigin(0, 0)
        .setDepth(0)
        .setScrollFactor(1, 1);
      this.grassLayer.tilePositionX = 0;
      this.grassLayer.tilePositionY = 0;
    }

    rebuildFogTexture() {
      if (this.fogRT) {
        this.fogRT.destroy();
        this.fogRT = null;
      }
      if (!this.map) return;
      this.fogRT = this.add.renderTexture(0, 0, this.map.width, this.map.height)
        .setOrigin(0, 0)
        .setDepth(LIGHTING.FOG_DEPTH)
        .setScrollFactor(1, 1);
      this.fogRT.fill(0x000000, LIGHTING.MAP_DARKNESS);
    }

    clearGeneratorSprites() {
      for (const sprite of this.generatorSprites.values()) sprite.destroy();
      this.generatorSprites.clear();
    }

    clearActors() {
      for (const actor of this.actors.values()) actor.container.destroy();
      this.actors.clear();
    }

    drawStaticWorld() {
      if (!this.map) return;
      const g = this.worldGraphics;
      g.clear();
      const tile = this.map.tile || 72;
      const cols = Math.ceil(this.map.width / tile);
      const rows = Math.ceil(this.map.height / tile);

      // The actual ground is a static world-space tileSprite. These translucent
      // stains sit above it, so the camera can move without the grass texture sliding.
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const n = hash2(x, y);
          g.fillStyle(n > 0.62 ? 0x31452a : 0x0b120b, n > 0.62 ? 0.08 : 0.05);
          g.fillRect(x * tile, y * tile, tile, tile);
        }
      }

      // Old blood stains, cracks, and dirt. Charming, if your idea of charm is tetanus.
      for (let i = 0; i < 180; i++) {
        const x = hash2(i, 7) * this.map.width;
        const y = hash2(i, 19) * this.map.height;
        const r = 8 + hash2(i, 31) * 30;
        const isBlood = hash2(i, 43) > 0.76;
        g.fillStyle(isBlood ? COLORS.blood : 0x171614, isBlood ? 0.22 : 0.18);
        g.fillEllipse(x, y, r * 1.8, r);
      }

      for (const wall of this.map.walls || []) this.drawWall(g, wall);
      for (const win of this.map.windows || []) this.drawWindow(g, win);
    }

    drawWall(g, wall) {
      const base = COLORS.wall;
      const dark = COLORS.wallDark;
      const light = COLORS.wallLight;
      const brickW = WALL_VISUAL.BRICK_WIDTH;
      const brickH = WALL_VISUAL.BRICK_HEIGHT;

      // Fill every wall as part of one continuous masonry surface. No heavy per-tile
      // outline, so adjacent X tiles read like connected ruins instead of Lego blocks.
      const shade = 0.95 + hash2(Math.floor(wall.x / brickW), Math.floor(wall.y / brickH)) * 0.08;
      g.fillStyle(shade > 1 ? brighten(base, 0.05) : base, 1);
      g.fillRect(wall.x, wall.y, wall.w, wall.h);

      g.fillStyle(dark, 0.18);
      g.fillRect(wall.x, wall.y + wall.h - 5, wall.w, 5);
      g.fillStyle(light, WALL_VISUAL.HIGHLIGHT_ALPHA);
      g.fillRect(wall.x, wall.y, wall.w, 4);

      // Mortar lines are aligned to world coordinates, not to each tile. This makes
      // brick seams continue across neighboring wall pieces.
      g.lineStyle(1, WALL_VISUAL.MORTAR, WALL_VISUAL.MORTAR_ALPHA);
      const yStart = Math.floor(wall.y / brickH) * brickH;
      for (let yy = yStart; yy <= wall.y + wall.h; yy += brickH) {
        const y = clamp(yy, wall.y, wall.y + wall.h);
        g.beginPath();
        g.moveTo(wall.x, y);
        g.lineTo(wall.x + wall.w, y);
        g.strokePath();
      }

      const xStart = Math.floor(wall.x / brickW) * brickW;
      for (let yy = yStart; yy < wall.y + wall.h; yy += brickH) {
        const row = Math.floor(yy / brickH);
        const offset = row % 2 ? brickW / 2 : 0;
        for (let xx = xStart - offset; xx <= wall.x + wall.w; xx += brickW) {
          const x = clamp(xx, wall.x, wall.x + wall.w);
          const y1 = clamp(yy, wall.y, wall.y + wall.h);
          const y2 = clamp(yy + brickH, wall.y, wall.y + wall.h);
          if (y2 <= y1 + 2) continue;
          g.beginPath();
          g.moveTo(x, y1);
          g.lineTo(x, y2);
          g.strokePath();
        }
      }

      // Only a soft outer lip now, not a box around every single wall tile.
      g.lineStyle(2, dark, WALL_VISUAL.EDGE_ALPHA);
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
      const pad = 2;
      const probe = {
        x: wall.x + dx * (wall.w / 2 + pad) + pad,
        y: wall.y + dy * (wall.h / 2 + pad) + pad,
        w: wall.w - pad * 2,
        h: wall.h - pad * 2
      };
      return (this.map?.walls || []).some((other) => other !== wall && rectsOverlap(probe, other));
    }

    drawWindow(g, win) {
      g.fillStyle(0x393a35, 1);
      g.fillRect(win.x, win.y, win.w, win.h);
      g.lineStyle(4, COLORS.window, 0.9);
      const cx = win.x + win.w / 2;
      const cy = win.y + win.h / 2;
      if (win.orientation === "horizontal") {
        g.beginPath();
        g.moveTo(win.x + 10, cy);
        g.lineTo(win.x + win.w - 10, cy);
        g.strokePath();
      } else {
        g.beginPath();
        g.moveTo(cx, win.y + 10);
        g.lineTo(cx, win.y + win.h - 10);
        g.strokePath();
      }
      g.fillStyle(0xeff6ff, 0.18);
      g.fillRect(win.x + 8, win.y + 8, win.w - 16, win.h - 16);
    }

    drawDynamicWorld() {
      if (!this.map || !currentSnapshot) return;
      const g = this.dynamicGraphics;
      g.clear();

      for (const pallet of currentSnapshot.map?.pallets || this.map.pallets || []) {
        if (pallet.broken || pallet.state === "broken") {
          g.lineStyle(3, COLORS.palletDark, 0.5);
          g.beginPath();
          g.moveTo(pallet.x + 10, pallet.y + 12);
          g.lineTo(pallet.x + pallet.w - 12, pallet.y + pallet.h - 9);
          g.moveTo(pallet.x + 14, pallet.y + pallet.h - 12);
          g.lineTo(pallet.x + pallet.w - 10, pallet.y + 11);
          g.strokePath();
          continue;
        }
        const dropped = pallet.state === "dropped";
        g.fillStyle(dropped ? COLORS.palletDark : COLORS.pallet, 1);
        if (pallet.orientation === "horizontal") {
          const h = dropped ? pallet.h : pallet.h * 0.35;
          const y = dropped ? pallet.y : pallet.y + pallet.h * 0.325;
          g.fillRoundedRect(pallet.x + 4, y, pallet.w - 8, h, 5);
          this.drawPalletSlats(g, pallet.x + 6, y + 4, pallet.w - 12, h - 8, true);
        } else {
          const w = dropped ? pallet.w : pallet.w * 0.35;
          const x = dropped ? pallet.x : pallet.x + pallet.w * 0.325;
          g.fillRoundedRect(x, pallet.y + 4, w, pallet.h - 8, 5);
          this.drawPalletSlats(g, x + 4, pallet.y + 6, w - 8, pallet.h - 12, false);
        }
      }

      const generators = currentSnapshot.map?.generators || this.map.generators || [];
      this.syncGeneratorSprites(generators);
      for (const gen of generators) this.drawGenerator(g, gen);
      for (const gate of currentSnapshot.map?.gates || this.map.gates || []) this.drawGate(g, gate);
      for (const hook of currentSnapshot.map?.hooks || this.map.hooks || []) this.drawHook(g, hook);
    }

    drawPalletSlats(g, x, y, w, h, horizontal) {
      g.lineStyle(2, 0x2b180f, 0.7);
      const count = 4;
      for (let i = 1; i < count; i++) {
        if (horizontal) {
          const xx = x + (w / count) * i;
          g.beginPath();
          g.moveTo(xx, y);
          g.lineTo(xx, y + h);
          g.strokePath();
        } else {
          const yy = y + (h / count) * i;
          g.beginPath();
          g.moveTo(x, yy);
          g.lineTo(x + w, yy);
          g.strokePath();
        }
      }
    }


    drawHook(g, hook) {
      if (!hook || hook.active === false) return;
      const x = hook.x;
      const y = hook.y;
      g.lineStyle(7, COLORS.hookIron, 0.95);
      g.beginPath();
      g.moveTo(x, y + 32);
      g.lineTo(x, y - 34);
      g.lineTo(x + 22, y - 50);
      g.strokePath();
      g.lineStyle(4, COLORS.hook, 0.98);
      g.beginPath();
      g.arc(x + 23, y - 39, 14, Math.PI * 0.15, Math.PI * 1.35);
      g.strokePath();
      g.fillStyle(COLORS.blood, 0.42);
      g.fillCircle(x + 20, y - 21, 5);
      g.lineStyle(2, 0x000000, 0.55);
      g.strokeCircle(x, y + 36, 16);
    }

    getGeneratorTextureKey() {
      return this.textures.exists(GENERATOR_VISUAL.TEXTURE_KEY)
        ? GENERATOR_VISUAL.TEXTURE_KEY
        : GENERATOR_VISUAL.FALLBACK_KEY;
    }

    syncGeneratorSprites(generators) {
      const currentIds = new Set(generators.map((gen) => String(gen.id)));
      for (const [id, sprite] of this.generatorSprites.entries()) {
        if (!currentIds.has(id)) {
          sprite.destroy();
          this.generatorSprites.delete(id);
        }
      }

      const textureKey = this.getGeneratorTextureKey();
      for (const gen of generators) {
        const id = String(gen.id);
        let sprite = this.generatorSprites.get(id);
        if (!sprite) {
          sprite = this.add.image(gen.x, gen.y, textureKey)
            .setOrigin(0.5, 0.5)
            .setDepth(2.75)
            .setDisplaySize(GENERATOR_VISUAL.SIZE, GENERATOR_VISUAL.SIZE);
          this.generatorSprites.set(id, sprite);
        }

        if (sprite.texture?.key !== textureKey) sprite.setTexture(textureKey);
        sprite.setPosition(gen.x, gen.y);
        sprite.setDisplaySize(GENERATOR_VISUAL.SIZE, GENERATOR_VISUAL.SIZE);
        sprite.setAlpha(gen.done ? 1 : 0.95);
        sprite.setTint(gen.done ? GENERATOR_VISUAL.DONE_TINT : GENERATOR_VISUAL.WORKING_TINT);
      }
    }

    drawGenerator(g, gen) {
      const progress = clamp(gen.progress || 0, 0, 1);
      const repairing = !gen.done && Array.isArray(gen.activeRepairers) && gen.activeRepairers.length > 0;
      const kicking = !gen.done && !!gen.beingKicked;
      const barW = GENERATOR_VISUAL.BAR_WIDTH;
      const barH = GENERATOR_VISUAL.BAR_HEIGHT;
      const x = gen.x - barW / 2;
      const y = gen.y + GENERATOR_VISUAL.BAR_Y_OFFSET;

      // Small shadow/contact patch so the SVG feels planted on the map instead of floating.
      g.fillStyle(0x000000, 0.28);
      g.fillEllipse(gen.x, gen.y + 35, GENERATOR_VISUAL.SIZE * 0.78, 17);

      if (repairing || kicking) {
        const pulse = 0.5 + Math.sin(performance.now() / (kicking ? 95 : 135)) * 0.5;
        const color = kicking ? GENERATOR_VISUAL.KICK_GLOW_COLOR : GENERATOR_VISUAL.REPAIR_GLOW_COLOR;
        g.lineStyle(kicking ? 4 : 3, color, kicking ? 0.9 : 0.68);
        g.strokeCircle(gen.x, gen.y, GENERATOR_VISUAL.SIZE * (0.55 + pulse * 0.12));
        g.fillStyle(color, kicking ? 0.10 : 0.08);
        g.fillCircle(gen.x, gen.y, GENERATOR_VISUAL.SIZE * (0.62 + pulse * 0.10));
      }

      g.fillStyle(0x0b0b0a, 0.84);
      g.fillRoundedRect(x, y, barW, barH, 4);
      g.fillStyle(gen.done ? 0x76ff72 : kicking ? GENERATOR_VISUAL.KICK_GLOW_COLOR : repairing ? GENERATOR_VISUAL.REPAIR_GLOW_COLOR : COLORS.gate, 0.98);
      g.fillRoundedRect(x, y, Math.max(0, barW * progress), barH, 4);
      g.lineStyle(2, gen.done ? 0xafffa9 : kicking ? 0xff9a9a : repairing ? 0xffe3a2 : 0x000000, gen.done ? 0.65 : 0.72);
      g.strokeRoundedRect(x, y, barW, barH, 4);

      if (kicking) {
        const kickW = barW * clamp(gen.kickProgress || 0, 0, 1);
        g.lineStyle(3, GENERATOR_VISUAL.KICK_GLOW_COLOR, 0.95);
        g.strokeRoundedRect(x, y + 13, Math.max(4, kickW), barH, 4);
      }

      if (gen.done) {
        g.lineStyle(3, 0x9eff93, 0.72);
        g.strokeCircle(gen.x, gen.y, GENERATOR_VISUAL.SIZE * 0.49);
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
      this.drawDynamicWorld();
      this.updateScratchGraphics(snapshot.scratchMarks || []);
      this.updateActorTargets(snapshot.actors || []);
      this.handleEvents(snapshot.events || []);
      this.updateHud(snapshot);
      this.lastSnapshotAt = performance.now();
    }

    updateHud(snapshot) {
      const me = (snapshot.actors || []).find((a) => a.id === myId);
      renderSurvivorStatusHud(snapshot);
      if (!me) return;
      ui.roleLabel.textContent = me.role === "killer" ? "Killer" : "Survivor";
      ui.controlsLabel.textContent = me.role === "killer"
        ? "WASD move • Mouse aim • M1 attack/lunge • Space vault/break • hold E hook/execute/kick gen"
        : "WASD move • Shift sprint • Mouse flashlight • Space vault/drop • hold E heal/repair/escape";
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
        g.lineStyle(3, COLORS.scratch, alpha);
        g.beginPath();
        g.moveTo(mark.x - Math.cos(a) * len * 0.5, mark.y - Math.sin(a) * len * 0.5);
        g.lineTo(mark.x + Math.cos(a) * len * 0.5, mark.y + Math.sin(a) * len * 0.5);
        g.strokePath();
      }
    }

    updateActorTargets(actors) {
      const seen = new Set();
      for (const data of actors) {
        seen.add(data.id);
        let item = this.actors.get(data.id);
        if (!item || item.role !== data.role) {
          if (item) item.container.destroy();
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
      const nameText = this.add.text(0, 34, data.name || "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        fontStyle: "800",
        color: "#f2efea",
        stroke: "#000000",
        strokeThickness: 3
      }).setOrigin(0.5, 0);
      container.add([outline, body, facing, healBarBg, healBar, nameText]);
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
        data,
        current: { x: data.x || 0, y: data.y || 0, angle: data.angle || 0 },
        target: { x: data.x || 0, y: data.y || 0, angle: data.angle || 0 }
      };
    }

    drawActorShape(item, data, fillColor, fillAlpha, outlineColor, outlineAlpha) {
      item.body.clear();
      item.outline.clear();
      item.body.fillStyle(fillColor, fillAlpha);
      item.outline.lineStyle(2, outlineColor, outlineAlpha);

      if (data.role === "killer") {
        item.body.fillCircle(0, 0, 19);
        item.outline.strokeCircle(0, 0, 22);
        return;
      }

      const skin = getSurvivorSkin(data.skin);
      if (skin.shape === "star") {
        const points = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 20 : 9;
          const a = -Math.PI / 2 + i * Math.PI / 5;
          points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
        }
        item.body.beginPath();
        item.outline.beginPath();
        points.forEach((p, i) => {
          if (i === 0) { item.body.moveTo(p.x, p.y); item.outline.moveTo(p.x, p.y); }
          else { item.body.lineTo(p.x, p.y); item.outline.lineTo(p.x, p.y); }
        });
        item.body.closePath();
        item.outline.closePath();
        item.body.fillPath();
        item.outline.strokePath();
        return;
      }

      if (skin.shape === "pentagon") {
        const points = [];
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
          points.push({ x: Math.cos(a) * 20, y: Math.sin(a) * 20 });
        }
        item.body.beginPath();
        item.outline.beginPath();
        points.forEach((p, i) => {
          if (i === 0) { item.body.moveTo(p.x, p.y); item.outline.moveTo(p.x, p.y); }
          else { item.body.lineTo(p.x, p.y); item.outline.lineTo(p.x, p.y); }
        });
        item.body.closePath();
        item.outline.closePath();
        item.body.fillPath();
        item.outline.strokePath();
        return;
      }

      item.body.fillRect(-15, -15, 30, 30);
      item.outline.strokeRect(-17, -17, 34, 34);
    }

    styleActor(item, data) {
      if (data.role === "killer") {
        const charging = data.attackState === "charging";
        const attacking = data.attacking || data.attackState === "quick" || data.attackState === "lunge";
        const fillColor = data.recovery > 0 ? 0x8d2020 : attacking ? 0xff4545 : charging ? 0xf06c35 : COLORS.killer;
        const outlineColor = attacking ? 0xfff0d0 : data.recovery > 0 ? 0xffb0b0 : 0xf7e5e5;
        this.drawActorShape(item, data, fillColor, 1, outlineColor, attacking ? 1 : 0.8);
        item.facing.setFillStyle(0xffe2e2, attacking ? 0.7 : data.recovery > 0 ? 0.22 : charging ? 0.58 : 0.42);
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
        }
        if (event.type === "hooked") playSfx("hooked");
        if (event.type === "execute" || event.type === "death") playSfx("dead");
        if (event.type === "genDone") playSfx("gen");
        if (event.type === "hit") playSfx("injured");
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
        type: event.type || "quick"
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
      if (this.shockwaves.length > 16) this.shockwaves.splice(0, this.shockwaves.length - 16);
    }

    burst(x, y, color, count, speed) {
      for (let i = 0; i < count; i++) {
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
      this.drawLighting();
      this.drawHookIndicators();
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

      const targetZoom = IMMERSION.BASE_ZOOM + this.terrorBlend * IMMERSION.TERROR_ZOOM + this.chaseBlend * IMMERSION.CHASE_ZOOM + this.heartbeatPulse * 0.008;
      cam.setZoom(lerp(cam.zoom || 1, targetZoom, IMMERSION.ZOOM_LERP));

      // Hard-follow camera: always keep the local player dead-center, even at map corners.
      // The camera is allowed to show outside the map; Phaser's black background fills that area.
      cam.centerOn(x, y);
    }

    drawLighting() {
      const me = this.actors.get(myId);
      if (!this.map || !this.fogRT) return;

      this.fogRT.clear();
      this.fogRT.fill(0x000000, LIGHTING.MAP_DARKNESS);

      if (!me || !this.lightConeMask || !this.lightAuraMask) return;

      const role = me.data?.role || "survivor";
      const length = role === "killer" ? LIGHTING.KILLER_LENGTH : LIGHTING.SURVIVOR_LENGTH;
      const angle = role === "killer" ? LIGHTING.KILLER_ANGLE : LIGHTING.SURVIVOR_ANGLE;
      const x = me.container.x;
      const y = me.container.y;
      const facing = me.container.rotation || 0;

      const flicker = 1 - LIGHTING.FLICKER_STRENGTH * 0.5
        + Math.sin(this.lightFlickerPhase) * LIGHTING.FLICKER_STRENGTH * 0.35
        + Math.sin(this.lightFlickerPhase * 2.37) * LIGHTING.FLICKER_STRENGTH * 0.15;
      const xScale = (length * flicker) / LIGHTING.CONE_TEXTURE_WIDTH;
      const angleScale = Math.tan(angle / 2) / Math.tan(LIGHTING.CONE_BASE_HALF_ANGLE);

      this.lightAuraMask
        .setPosition(x, y)
        .setRotation(0)
        .setScale((LIGHTING.AURA_RADIUS * 2 * (0.96 + flicker * 0.04)) / 512)
        .setAlpha(LIGHTING.AURA_ALPHA);

      this.lightConeMask
        .setPosition(x, y)
        .setRotation(facing)
        .setScale(xScale, xScale * angleScale)
        .setAlpha(clamp(0.94 + flicker * 0.06, 0.9, 1));

      // Erase darkness from the fog layer. This reveals the normally rendered map below.
      // That means the flashlight area is normal-bright, not painted white. Revolutionary, apparently.
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

      const hookedSurvivors = (currentSnapshot.actors || []).filter((actor) => {
        return actor.role === "survivor"
          && actor.id !== myId
          && actor.hooked
          && !actor.dead
          && !actor.escaped
          && Number.isFinite(actor.x)
          && Number.isFinite(actor.y);
      });

      if (!hookedSurvivors.length) return;

      const cam = this.cameras.main;
      const viewW = cam.width;
      const viewH = cam.height;
      const centerX = viewW / 2;
      const centerY = viewH / 2;
      const edgePadding = 56;
      const onScreenPadding = 92;
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
        const mainColor = danger ? 0xff3d3d : COLORS.hook;
        const ringAlpha = danger ? 0.78 : 0.62;
        const r = 20 + pulse * 3;

        // Direction pointer, slightly outside the bubble.
        const arrowX = x + dx * 24;
        const arrowY = y + dy * 24;
        const tangentX = -dy;
        const tangentY = dx;
        g.fillStyle(mainColor, 0.82);
        g.fillTriangle(
          arrowX + dx * 10,
          arrowY + dy * 10,
          arrowX - dx * 8 + tangentX * 7,
          arrowY - dy * 8 + tangentY * 7,
          arrowX - dx * 8 - tangentX * 7,
          arrowY - dy * 8 - tangentY * 7
        );

        g.fillStyle(0x120807, 0.86);
        g.fillCircle(x, y, 23);
        g.lineStyle(3, mainColor, ringAlpha);
        g.strokeCircle(x, y, r);
        g.lineStyle(1, 0xffffff, 0.22);
        g.strokeCircle(x, y, 15);

        // Tiny hook glyph drawn with graphics, because adding a text pool for one icon is how madness starts.
        g.lineStyle(4, mainColor, 0.95);
        g.beginPath();
        g.moveTo(x - 4, y + 9);
        g.lineTo(x - 4, y - 10);
        g.lineTo(x + 7, y - 15);
        g.strokePath();
        g.lineStyle(3, 0xf7e7d6, 0.88);
        g.beginPath();
        g.arc(x + 7, y - 6, 8, Math.PI * 0.05, Math.PI * 1.36);
        g.strokePath();

        // Small urgency pips for hook count.
        const hookCount = clamp(actor.hookCount || 1, 1, 2);
        for (let i = 0; i < hookCount; i++) {
          g.fillStyle(mainColor, 0.92);
          g.fillCircle(x - 5 + i * 10, y + 16, 2.5);
        }
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
      type: Phaser.WEBGL,
      parent: "gameWrap",
      backgroundColor: "#050505",
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: window.innerWidth,
        height: window.innerHeight
      },
      render: {
        antialias: true,
        pixelArt: false,
        roundPixels: false
      },
      scene: [GameScene]
    });
    window.__fogVaultGame = game;
  }

  function setupUI() {
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

  function setupKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
      ensureAudioStarted();
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
      if (e.code === "KeyW" || e.code === "ArrowUp") input.up = false;
      if (e.code === "KeyS" || e.code === "ArrowDown") input.down = false;
      if (e.code === "KeyA" || e.code === "ArrowLeft") input.left = false;
      if (e.code === "KeyD" || e.code === "ArrowRight") input.right = false;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.sprint = false;
      if (e.code === "KeyE") input.repair = false;
      sendInput({}, true);
    });
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
      ensureAudioStarted();
      showScreen("game");
    });
    socket.on("snapshot", (snapshot) => {
      currentSnapshot = snapshot;
      if (phaserScene) phaserScene.applySnapshot(snapshot);
    });
    socket.on("matchEnded", ({ winner, reason }) => {
      ui.winnerText.textContent = winner === "killer" ? "Killer Wins" : "Survivors Win";
      ui.reasonText.textContent = reason || "Match ended.";
      setMusicTargets({ layer1: 0.02, layer2: 0, layer3: 0 });
      showScreen("end");
    });
  }

  function start() {
    setupAudio();
    setupUI();
    setupKeyboard();
    setupSockets();
    bootPhaser();
    document.addEventListener("pointerdown", ensureAudioStarted, { once: true });
  }

  start();
})();
