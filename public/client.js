/* global io, Phaser */
(() => {
  "use strict";

  // Lighting knobs. The map is drawn at normal readable brightness. A black fog
  // RenderTexture sits above it, then the local player's flashlight erases that fog.
  // Inside the cone you see the real map, not a white overlay and not a black void.
  const LIGHTING = {
    MAP_DARKNESS: 0.62,          // 0 = no fog, 0.85 = very dark outside vision
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
      gen: "/gen.mp3"
    },
    VOLUMES: {
      hooked: 0.82,
      dead: 0.9,
      gen: 0.76
    }
  };

  // Client-only fear tuning. This does not change hitboxes or movement on the server.
  // It just makes the camera and overlay behave like the chase is pulling you inward.
  const IMMERSION = {
    BASE_ZOOM: 1,
    TERROR_ZOOM: 0.018,
    CHASE_ZOOM: 0.075,
    ZOOM_LERP: 0.055,
    CHASE_IN_LERP: 0.075,
    CHASE_OUT_LERP: 0.04,
    TERROR_LERP: 0.07,
    BREATH_SWAY: 5,
    CHASE_SWAY: 7,
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
    BAR_Y_OFFSET: 48
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
    floorA: 0x272820,
    floorB: 0x22251f,
    grassLine: 0x393b30,
    blood: 0x7b1010,
    hook: 0x91613a,
    hookIron: 0x1b1512,
    downed: 0x8f2020,
    wall: 0x57514b,
    wallDark: 0x272522,
    wallLight: 0x7a7067,
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

  const ui = {
    menu: document.getElementById("menu"),
    lobbyScreen: document.getElementById("lobbyScreen"),
    endScreen: document.getElementById("endScreen"),
    playerName: document.getElementById("playerName"),
    roleBtns: [...document.querySelectorAll(".role-btn")],
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
  let currentLobbyState = null;
  let currentSnapshot = null;
  let phaserScene = null;
  let lastInputPayload = "";
  let toastTimer = null;

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
    audio.targets[0] = clamp((m.layer1 || 0) * MUSIC.MASTER, 0, 0.25);
    audio.targets[1] = clamp((m.layer2 || 0) * MUSIC.MASTER, 0, 0.25);
    audio.targets[2] = clamp((m.layer3 || 0) * MUSIC.MASTER, 0, 0.25);
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
      this.worldGraphics = this.add.graphics().setDepth(1);
      this.dynamicGraphics = this.add.graphics().setDepth(3);
      this.scratchGraphics = this.add.graphics().setDepth(4);
      this.chargeGraphics = this.add.graphics().setDepth(21);
      this.swipeGraphics = this.add.graphics().setDepth(22);
      this.particleGraphics = this.add.graphics().setDepth(30);
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
      this.cameras.main.setBounds(0, 0, map.width, map.height);
      this.renderedMapKey = "";
      this.drawStaticWorld();
      this.drawDynamicWorld();
      this.rebuildFogTexture();
      this.clearGeneratorSprites();
      this.clearActors();
      this.localVisual = null;
      this.localServerTarget = null;
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

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const base = (x + y) % 2 ? COLORS.floorA : COLORS.floorB;
          const n = hash2(x, y);
          g.fillStyle(n > 0.5 ? brighten(base, 0.06) : base, 1);
          g.fillRect(x * tile, y * tile, tile, tile);

          g.lineStyle(1, COLORS.grassLine, 0.24);
          const bladeCount = 4 + Math.floor(n * 5);
          for (let i = 0; i < bladeCount; i++) {
            const bx = x * tile + ((hash2(x * 11 + i, y * 7) * tile) | 0);
            const by = y * tile + ((hash2(x * 5, y * 13 + i) * tile) | 0);
            g.beginPath();
            g.moveTo(bx, by);
            g.lineTo(bx + 4, by - 9);
            g.strokePath();
          }
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
      g.fillStyle(base, 1);
      g.fillRect(wall.x, wall.y, wall.w, wall.h);
      g.lineStyle(3, dark, 0.95);
      g.strokeRect(wall.x + 1.5, wall.y + 1.5, wall.w - 3, wall.h - 3);

      const brickH = Math.max(12, Math.floor(wall.h / 4));
      for (let yy = wall.y; yy < wall.y + wall.h; yy += brickH) {
        const offset = Math.floor((yy / brickH) % 2) ? wall.w * 0.24 : 0;
        g.lineStyle(1, dark, 0.75);
        g.beginPath();
        g.moveTo(wall.x, yy);
        g.lineTo(wall.x + wall.w, yy);
        g.strokePath();
        for (let xx = wall.x - offset; xx < wall.x + wall.w; xx += wall.w / 2) {
          g.beginPath();
          g.moveTo(xx, yy);
          g.lineTo(xx, Math.min(yy + brickH, wall.y + wall.h));
          g.strokePath();
        }
      }
      g.lineStyle(2, light, 0.18);
      g.beginPath();
      g.moveTo(wall.x + 6, wall.y + 8);
      g.lineTo(wall.x + wall.w - 8, wall.y + 5);
      g.strokePath();
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
      const barW = GENERATOR_VISUAL.BAR_WIDTH;
      const barH = GENERATOR_VISUAL.BAR_HEIGHT;
      const x = gen.x - barW / 2;
      const y = gen.y + GENERATOR_VISUAL.BAR_Y_OFFSET;

      // Small shadow/contact patch so the SVG feels planted on the map instead of floating.
      g.fillStyle(0x000000, 0.28);
      g.fillEllipse(gen.x, gen.y + 35, GENERATOR_VISUAL.SIZE * 0.78, 17);

      g.fillStyle(0x0b0b0a, 0.84);
      g.fillRoundedRect(x, y, barW, barH, 4);
      g.fillStyle(gen.done ? 0x76ff72 : COLORS.gate, 0.98);
      g.fillRoundedRect(x, y, Math.max(0, barW * progress), barH, 4);
      g.lineStyle(2, gen.done ? 0xafffa9 : 0x000000, gen.done ? 0.65 : 0.55);
      g.strokeRoundedRect(x, y, barW, barH, 4);

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
        ? "WASD move • Mouse aim • M1 attack/lunge • Space vault/break • hold E hook/execute downed survivor"
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
        } else {
          ui.healthText.textContent = "Killer";
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
          if (!this.localVisual || dist(this.localVisual.x, this.localVisual.y, data.x, data.y) > 180) {
            this.localVisual = { x: data.x, y: data.y, angle: data.angle, role: data.role };
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
      const body = isKiller
        ? this.add.circle(0, 0, 19, COLORS.killer, 1)
        : this.add.rectangle(0, 0, 30, 30, COLORS.survivor, 1);
      const outline = isKiller
        ? this.add.circle(0, 0, 22).setStrokeStyle(2, 0xf7e5e5, 0.8)
        : this.add.rectangle(0, 0, 34, 34).setStrokeStyle(2, 0xf7fbff, 0.75);
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
      container.add([body, outline, facing, healBarBg, healBar, nameText]);
      return {
        role: data.role,
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

    styleActor(item, data) {
      if (data.role === "killer") {
        const charging = data.attackState === "charging";
        const attacking = data.attacking || data.attackState === "quick" || data.attackState === "lunge";
        item.body.setFillStyle(data.recovery > 0 ? 0x8d2020 : attacking ? 0xff4545 : charging ? 0xf06c35 : COLORS.killer, 1);
        item.outline.setStrokeStyle(2, attacking ? 0xfff0d0 : data.recovery > 0 ? 0xffb0b0 : 0xf7e5e5, attacking ? 1 : 0.8);
        item.facing.setFillStyle(0xffe2e2, attacking ? 0.7 : data.recovery > 0 ? 0.22 : charging ? 0.58 : 0.42);
      } else {
        let color = data.health <= 1 || data.injured ? COLORS.survivorInjured : COLORS.survivor;
        if (data.downed) color = COLORS.downed;
        if (data.hooked) color = COLORS.hook;
        const disabled = data.dead || data.escaped;
        item.body.setFillStyle(data.dead ? 0x555555 : color, disabled ? 0.45 : 1);
        const downedHealProgress = data.downed && data.healProgress > 0 ? data.healProgress : 0;
        const progress = data.hooked ? (data.unhookProgress || 0) : data.downed ? (downedHealProgress || data.hookProgress || 0) : (data.healProgress || 0);
        const showProgress = progress > 0 && !data.dead && !data.escaped;
        const executing = data.downed && (data.hookCount || 0) >= 2 && data.hookProgress > 0;
        const progressColor = data.hooked ? 0x75d5ff : downedHealProgress ? 0x8dff9a : executing ? 0xff4040 : data.downed ? 0xffb36b : 0x8dff9a;
        item.outline.setStrokeStyle(2, showProgress ? progressColor : data.invuln > 0 ? 0xffffff : data.hooked ? 0xffc06a : 0xf7fbff, showProgress || data.invuln > 0 || data.hooked ? 1 : 0.75);
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
        if (event.type === "swipe" || event.type === "swing") this.addSwipeIndicator(event);
        if (event.type === "hooked") playSfx("hooked");
        if (event.type === "execute" || event.type === "death") playSfx("dead");
        if (event.type === "genDone") playSfx("gen");
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
        x: event.x,
        y: event.y,
        angle: event.angle || 0,
        range: event.range || 82,
        arc: event.arc || Math.PI * 0.58,
        ttl: Math.max(0.12, event.duration || 0.24),
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
        const activeT = s.startup > 0 ? clamp((s.life - s.startup) / Math.max(0.001, s.ttl - s.startup), 0, 1) : clamp(s.life / s.ttl, 0, 1);
        const windup = s.life < s.startup;
        const alpha = windup
          ? (0.16 + 0.20 * (s.life / Math.max(0.001, s.startup)))
          : (1 - activeT) * (s.type === "lunge" ? 0.50 : 0.40);
        const points = [{ x: s.x, y: s.y }];
        const steps = 18;
        for (let n = 0; n <= steps; n++) {
          const t = n / steps;
          const a = s.angle - s.arc / 2 + s.arc * t;
          // Slightly rounded edge so the swipe reads like a weapon arc, not a math homework wedge.
          const edgePulse = 0.92 + Math.sin(t * Math.PI) * 0.08;
          points.push({
            x: s.x + Math.cos(a) * s.range * edgePulse,
            y: s.y + Math.sin(a) * s.range * edgePulse
          });
        }
        g.fillStyle(windup ? 0xff9f57 : 0xffd7bd, alpha * (windup ? 0.22 : 0.45));
        g.fillPoints(points, true, true);
        g.lineStyle(windup ? 2 : 4, windup ? 0xffbd7a : 0xfff0df, alpha);
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
      const worldX = pointer.x + cam.scrollX;
      const worldY = pointer.y + cam.scrollY;
      const me = this.localVisual || this.localServerTarget;
      if (me) input.angle = Math.atan2(worldY - me.y, worldX - me.x);
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

      const targetZoom = IMMERSION.BASE_ZOOM + this.terrorBlend * IMMERSION.TERROR_ZOOM + this.chaseBlend * IMMERSION.CHASE_ZOOM + this.heartbeatPulse * 0.018;
      cam.setZoom(lerp(cam.zoom || 1, targetZoom, IMMERSION.ZOOM_LERP));

      const zoom = cam.zoom || 1;
      const viewportW = cam.width / zoom;
      const viewportH = cam.height / zoom;
      const swayPower = this.terrorBlend * IMMERSION.BREATH_SWAY + this.chaseBlend * IMMERSION.CHASE_SWAY;
      const swayX = Math.sin(this.breathPhase * 1.7) * swayPower + Math.sin(this.breathPhase * 3.1) * swayPower * 0.28;
      const swayY = Math.cos(this.breathPhase * 1.35) * swayPower * 0.7 + this.heartbeatPulse * (6 + this.chaseBlend * 8);

      const targetX = x - viewportW / 2 + swayX;
      const targetY = y - viewportH / 2 + swayY;
      const follow = 0.15 + this.chaseBlend * 0.035;
      cam.scrollX = lerp(cam.scrollX, targetX, follow);
      cam.scrollY = lerp(cam.scrollY, targetY, follow);
      cam.scrollX = clamp(cam.scrollX, 0, Math.max(0, (this.map?.width || cam.width) - viewportW));
      cam.scrollY = clamp(cam.scrollY, 0, Math.max(0, (this.map?.height || cam.height) - viewportH));
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

    ui.quickJoinBtn.addEventListener("click", () => socket.emit("quickJoin", { role: selectedRole, playerName: getName() }));
    ui.createLobbyBtn.addEventListener("click", () => socket.emit("createLobby", { role: selectedRole, playerName: getName() }));
    ui.beSurvivorBtn.addEventListener("click", () => socket.emit("setRole", { role: "survivor" }));
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
      item.innerHTML = `<div><strong>${escapeHtml(player.name)}${player.id === myId ? " (You)" : ""}</strong><small>${player.role}${player.isBot ? " bot" : ""}</small></div><small>${player.ready ? "Ready" : "Not ready"}</small>`;
      ui.playersList.appendChild(item);
    }
    const mine = state.players?.find((p) => p.id === myId);
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
