(() => {
  const socket = io();
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const ui = {
    menu: document.getElementById("menu"),
    lobbyScreen: document.getElementById("lobbyScreen"),
    endScreen: document.getElementById("endScreen"),
    hud: document.getElementById("hud"),
    playerName: document.getElementById("playerName"),
    lobbyList: document.getElementById("lobbyList"),
    lobbyTitle: document.getElementById("lobbyTitle"),
    playersList: document.getElementById("playersList"),
    quickJoinBtn: document.getElementById("quickJoinBtn"),
    createLobbyBtn: document.getElementById("createLobbyBtn"),
    beSurvivorBtn: document.getElementById("beSurvivorBtn"),
    beKillerBtn: document.getElementById("beKillerBtn"),
    readyBtn: document.getElementById("readyBtn"),
    startBtn: document.getElementById("startBtn"),
    leaveBtn: document.getElementById("leaveBtn"),
    backToLobbyBtn: document.getElementById("backToLobbyBtn"),
    mainMenuBtn: document.getElementById("mainMenuBtn"),
    roleLabel: document.getElementById("roleLabel"),
    controlsLabel: document.getElementById("controlsLabel"),
    genText: document.getElementById("genText"),
    gateText: document.getElementById("gateText"),
    healthText: document.getElementById("healthText"),
    winnerText: document.getElementById("winnerText"),
    reasonText: document.getElementById("reasonText"),
    toast: document.getElementById("toast")
  };

  let selectedRole = "survivor";
  let myId = null;
  let currentLobby = null;
  let fullMap = null;
  let snapshot = null;
  const visualActors = new Map();
  let width = 0;
  let height = 0;
  let dpr = 1;
  let camera = { x: 0, y: 0 };
  let mouse = { x: 0, y: 0 };
  let keys = new Set();
  let actionQueued = false;
  let attackQueued = false;
  let lastFrame = performance.now();
  const particles = [];
  const screenShake = { time: 0, amount: 0 };

  const audio = {
    started: false,
    tracks: {},
    wanted: { layer1: 0.35, layer2: 0, layer3: 0 }
  };

  const colors = {
    survivor: "#72d4ff",
    survivorInjured: "#ff7272",
    killer: "#ff3434",
    wall: "#4b4b50",
    window: "#d7b35f",
    pallet: "#9f552e",
    palletDropped: "#b58148",
    generator: "#ead673",
    gate: "#80ffa6"
  };

  function showScreen(name) {
    ui.menu.classList.remove("screen-open");
    ui.lobbyScreen.classList.remove("screen-open");
    ui.endScreen.classList.remove("screen-open");
    ui.hud.classList.add("hidden");
    if (name === "menu") ui.menu.classList.add("screen-open");
    if (name === "lobby") ui.lobbyScreen.classList.add("screen-open");
    if (name === "end") ui.endScreen.classList.add("screen-open");
    if (name === "game") ui.hud.classList.remove("hidden");
  }

  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.remove("hidden");
    clearTimeout(ui.toast._t);
    ui.toast._t = setTimeout(() => ui.toast.classList.add("hidden"), 2600);
  }

  function getName() {
    return ui.playerName.value.trim() || "Player";
  }

  function resize() {
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  document.querySelectorAll(".role-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRole = btn.dataset.role;
      document.querySelectorAll(".role-btn").forEach((b) => b.classList.toggle("selected", b === btn));
    });
  });

  ui.quickJoinBtn.addEventListener("click", () => socket.emit("quickJoin", { role: selectedRole, playerName: getName() }));
  ui.createLobbyBtn.addEventListener("click", () => socket.emit("createLobby", { role: selectedRole, playerName: getName() }));
  ui.beSurvivorBtn.addEventListener("click", () => socket.emit("setRole", { role: "survivor" }));
  ui.beKillerBtn.addEventListener("click", () => socket.emit("setRole", { role: "killer" }));
  ui.readyBtn.addEventListener("click", () => {
    const mine = currentLobby?.players?.find((p) => p.id === myId);
    socket.emit("setReady", { ready: !mine?.ready });
  });
  ui.startBtn.addEventListener("click", () => socket.emit("startGame"));
  ui.leaveBtn.addEventListener("click", () => {
    socket.emit("leaveLobby");
    currentLobby = null;
    snapshot = null;
    visualActors.clear();
    showScreen("menu");
  });
  ui.backToLobbyBtn.addEventListener("click", () => {
    socket.emit("backToLobby");
    showScreen("lobby");
  });
  ui.mainMenuBtn.addEventListener("click", () => {
    socket.emit("leaveLobby");
    currentLobby = null;
    snapshot = null;
    visualActors.clear();
    showScreen("menu");
  });

  window.addEventListener("keydown", (e) => {
    const code = e.code;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) e.preventDefault();
    keys.add(code);
    if (code === "Space") actionQueued = true;
  });

  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener("mousedown", (e) => {
    startAudio();
    if (e.button === 0) attackQueued = true;
  });
  window.addEventListener("pointerdown", startAudio, { once: true });
  window.addEventListener("keydown", startAudio, { once: true });

  socket.on("hello", ({ id }) => { myId = id; });
  socket.on("toast", ({ message }) => toast(message));
  socket.on("lobbyList", renderLobbyList);
  socket.on("joinedLobby", () => showScreen("lobby"));
  socket.on("lobbyState", (state) => {
    currentLobby = state;
    renderLobbyState(state);
    if (state.phase === "lobby") showScreen("lobby");
  });
  socket.on("gameStarted", (map) => {
    fullMap = map;
    snapshot = null;
    visualActors.clear();
    particles.length = 0;
    showScreen("game");
  });
  socket.on("snapshot", (s) => {
    snapshot = s;
    if (!fullMap && s.map) fullMap = { ...s.map, walls: [], windows: [] };
    primeVisualActors(s.actors || []);
    processEvents(s.events || []);
    updateHud();
  });
  socket.on("matchEnded", ({ winner, reason }) => {
    ui.winnerText.textContent = winner === "killer" ? "Killer Wins" : "Survivors Win";
    ui.reasonText.textContent = reason;
    showScreen("end");
  });

  function renderLobbyList(list) {
    if (!list.length) {
      ui.lobbyList.className = "lobby-list empty";
      ui.lobbyList.textContent = "No open lobbies yet. Civilization remains lonely.";
      return;
    }
    ui.lobbyList.className = "lobby-list";
    ui.lobbyList.innerHTML = "";
    list.forEach((lobby) => {
      const item = document.createElement("div");
      item.className = "lobby-item";
      const disabled = lobby.phase !== "lobby";
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(lobby.name)}</strong>
          <span class="meta">${escapeHtml(lobby.mapName)} · ${lobby.survivors}/${lobby.maxSurvivors} survivors · ${lobby.killer ? "killer taken" : "killer open"} · ${lobby.phase}</span>
        </div>
        <button ${disabled ? "disabled" : ""}>Join</button>
      `;
      item.querySelector("button").addEventListener("click", () => socket.emit("joinLobby", { lobbyId: lobby.id, role: selectedRole, playerName: getName() }));
      ui.lobbyList.appendChild(item);
    });
  }

  function renderLobbyState(state) {
    ui.lobbyTitle.textContent = state.name;
    ui.playersList.innerHTML = "";
    state.players.forEach((p) => {
      const item = document.createElement("div");
      item.className = "player-item";
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(p.name)}${p.id === myId ? " (you)" : ""}</strong>
          <span class="meta">${p.id.slice(0, 5)}</span>
        </div>
        <div class="badge-row">
          <span class="badge ${p.role}">${p.role}</span>
          ${p.ready ? `<span class="badge ready">ready</span>` : ""}
        </div>
      `;
      ui.playersList.appendChild(item);
    });
    const mine = state.players.find((p) => p.id === myId);
    ui.readyBtn.textContent = mine?.ready ? "Unready" : "Ready";
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[c]));
  }

  function localActor() {
    return snapshot?.actors?.find((a) => a.id === myId && a.visible);
  }

  function actorForRender(actor) {
    const v = visualActors.get(actor.id);
    return v ? { ...actor, x: v.x, y: v.y, angle: v.angle } : actor;
  }

  function localRenderActor() {
    const me = localActor();
    return me ? actorForRender(me) : me;
  }

  function angleLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function primeVisualActors(actors) {
    for (const actor of actors) {
      if (!actor.visible || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) {
        visualActors.delete(actor.id);
        continue;
      }
      if (!visualActors.has(actor.id)) {
        visualActors.set(actor.id, {
          x: actor.x, y: actor.y, angle: actor.angle || 0,
          targetX: actor.x, targetY: actor.y, targetAngle: actor.angle || 0
        });
      } else {
        const v = visualActors.get(actor.id);
        v.targetX = actor.x;
        v.targetY = actor.y;
        v.targetAngle = actor.angle || 0;
      }
    }
  }

  function updateVisualActors(dt) {
    if (!snapshot?.actors) return;
    const seen = new Set();
    const alpha = Math.min(1, dt * 18);
    for (const actor of snapshot.actors) {
      if (!actor.visible || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) continue;
      seen.add(actor.id);
      let v = visualActors.get(actor.id);
      if (!v) {
        v = { x: actor.x, y: actor.y, angle: actor.angle || 0, targetX: actor.x, targetY: actor.y, targetAngle: actor.angle || 0 };
        visualActors.set(actor.id, v);
      }
      v.targetX = actor.x;
      v.targetY = actor.y;
      v.targetAngle = actor.angle || 0;
      const jump = Math.hypot(v.targetX - v.x, v.targetY - v.y);
      if (jump > 240) {
        v.x = v.targetX;
        v.y = v.targetY;
        v.angle = v.targetAngle;
      } else {
        v.x += (v.targetX - v.x) * alpha;
        v.y += (v.targetY - v.y) * alpha;
        v.angle = angleLerp(v.angle, v.targetAngle, alpha);
      }
    }
    for (const id of visualActors.keys()) {
      if (!seen.has(id)) visualActors.delete(id);
    }
  }

  function sendInput() {
    const me = localRenderActor();
    let angle = 0;
    if (me) angle = Math.atan2(mouse.y + camera.y - me.y, mouse.x + camera.x - me.x);
    const role = me?.role;
    socket.emit("input", {
      up: keys.has("KeyW") || keys.has("ArrowUp"),
      down: keys.has("KeyS") || keys.has("ArrowDown"),
      left: keys.has("KeyA") || keys.has("ArrowLeft"),
      right: keys.has("KeyD") || keys.has("ArrowRight"),
      sprint: keys.has("ShiftLeft") || keys.has("ShiftRight"),
      repair: keys.has("KeyE"),
      action: actionQueued || keys.has("Space") || keys.has("KeyE"),
      attack: role === "killer" && attackQueued,
      angle
    });
    actionQueued = false;
    attackQueued = false;
  }
  setInterval(sendInput, 1000 / 60);

  function updateHud() {
    const me = localActor();
    if (!me || !snapshot) return;
    ui.roleLabel.textContent = me.role === "killer" ? "Killer" : "Survivor";
    ui.controlsLabel.textContent = me.role === "killer"
      ? "WASD move · M1 attack · Space/E vault or break pallet · no sprint, because cardio has limits"
      : "WASD move · Shift sprint · Space vault/drop pallet · E repair/vault/escape";
    ui.genText.textContent = `${snapshot.objective.doneGenerators} / ${snapshot.objective.totalGenerators}`;
    ui.gateText.textContent = snapshot.objective.escapeOpen ? "Open" : "Closed";
    if (me.role === "killer") ui.healthText.textContent = "Killer";
    else if (me.dead) ui.healthText.textContent = "Dead";
    else if (me.escaped) ui.healthText.textContent = "Escaped";
    else ui.healthText.textContent = me.health >= 2 ? "Healthy" : "Injured";
    audio.wanted = snapshot.music || audio.wanted;
  }

  function processEvents(events) {
    for (const evt of events) {
      if (evt.type === "hit" || evt.type === "death") {
        burst(evt.x, evt.y, evt.type === "death" ? 42 : 26, "blood");
        shake(evt.type === "death" ? 0.45 : 0.25, evt.type === "death" ? 12 : 8);
        beep(90, 0.08, "sawtooth", 0.08);
      }
      if (evt.type === "vault") burst(evt.x, evt.y, 12, "dust");
      if (evt.type === "palletDrop" || evt.type === "palletBreak") {
        burst(evt.x, evt.y, 22, "wood");
        shake(0.2, 6);
        beep(evt.type === "palletBreak" ? 120 : 170, 0.06, "square", 0.05);
      }
      if (evt.type === "genDone") {
        burst(evt.x, evt.y, 32, "spark");
        beep(620, 0.08, "triangle", 0.08);
      }
      if (evt.type === "killerStun") shake(0.32, 10);
    }
  }

  function burst(x, y, count, kind) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 230;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        ttl: 0.35 + Math.random() * 0.55,
        life: 0,
        size: 2 + Math.random() * 5,
        kind
      });
    }
  }

  function shake(time, amount) {
    screenShake.time = Math.max(screenShake.time, time);
    screenShake.amount = Math.max(screenShake.amount, amount);
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life > particles[i].ttl) particles.splice(i, 1);
    }
    screenShake.time = Math.max(0, screenShake.time - dt);
  }

  let audioContext = null;
  function startAudio() {
    if (audio.started) return;
    audio.started = true;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      ["layer_1", "layer_2", "layer_3"].forEach(loadTrack);
    } catch (_) {}
  }

  async function loadTrack(name) {
    try {
      const el = new Audio(`/${name}.mp3`);
      el.loop = true;
      el.volume = 0;
      el.preload = "auto";
      await el.play();
      audio.tracks[name] = el;
    } catch (_) {
      audio.tracks[name] = null;
    }
  }

  function updateAudio(dt) {
    const targets = {
      layer_1: audio.wanted.layer1 ?? 0.35,
      layer_2: audio.wanted.layer2 ?? 0,
      layer_3: audio.wanted.layer3 ?? 0
    };
    for (const [key, vol] of Object.entries(targets)) {
      const el = audio.tracks[key];
      if (!el) continue;
      el.volume += (vol - el.volume) * Math.min(1, dt * 4.5);
    }
  }

  function beep(freq, duration, type, gainValue) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = gainValue;
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + duration);
  }

  function sx(x) { return x - camera.x; }
  function sy(y) { return y - camera.y; }

  function updateCamera() {
    const me = localRenderActor();
    if (!me || !snapshot?.map) return;
    camera.x = clamp(me.x - width / 2, 0, Math.max(0, snapshot.map.width - width));
    camera.y = clamp(me.y - height / 2, 0, Math.max(0, snapshot.map.height - height));
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    if (!snapshot || !fullMap) {
      drawEmpty();
      return;
    }

    updateCamera();
    ctx.save();
    if (screenShake.time > 0) {
      const amt = screenShake.amount * (screenShake.time / 0.45);
      ctx.translate((Math.random() - 0.5) * amt, (Math.random() - 0.5) * amt);
    }

    drawGround();
    drawMapObjects();
    drawScratchMarks();
    drawActors();
    drawParticles();
    drawFog();
    drawMinimap();
    ctx.restore();
  }

  function drawEmpty() {
    ctx.fillStyle = "#070707";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.font = "700 20px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Join or create an open lobby to begin.", width / 2, height / 2);
  }

  function drawGround() {
    const tile = 64;
    const startX = Math.floor(camera.x / tile) * tile;
    const startY = Math.floor(camera.y / tile) * tile;
    ctx.fillStyle = "#151412";
    ctx.fillRect(0, 0, width, height);
    for (let y = startY; y < camera.y + height + tile; y += tile) {
      for (let x = startX; x < camera.x + width + tile; x += tile) {
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const v = n - Math.floor(n);
        ctx.fillStyle = v > 0.52 ? "#191814" : "#11110f";
        ctx.fillRect(sx(x), sy(y), tile, tile);
        ctx.fillStyle = "rgba(92, 61, 45, .12)";
        ctx.fillRect(sx(x + (v * 34) % tile), sy(y + (v * 57) % tile), 18, 4);
      }
    }
  }

  function drawMapObjects() {
    const map = snapshot.map;
    for (const w of fullMap.walls || []) drawWall(w);
    for (const w of fullMap.windows || []) drawWindow(w);
    for (const p of map.pallets || []) drawPallet(p);
    for (const g of map.generators || []) drawGenerator(g);
    for (const gate of map.gates || []) drawGate(gate);
  }

  function drawWall(w) {
    const x = sx(w.x), y = sy(w.y);
    ctx.fillStyle = colors.wall;
    ctx.fillRect(x, y, w.w, w.h);
    ctx.strokeStyle = "rgba(0,0,0,.5)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w.w - 2, w.h - 2);
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    for (let yy = y + 14; yy < y + w.h; yy += 18) {
      ctx.beginPath();
      ctx.moveTo(x + 4, yy);
      ctx.lineTo(x + w.w - 4, yy);
      ctx.stroke();
    }
    for (let xx = x + 18; xx < x + w.w; xx += 26) {
      ctx.beginPath();
      ctx.moveTo(xx, y + 4);
      ctx.lineTo(xx, y + w.h - 4);
      ctx.stroke();
    }
  }

  function drawWindow(w) {
    const x = sx(w.x), y = sy(w.y);
    ctx.fillStyle = "rgba(40,34,28,.9)";
    ctx.fillRect(x, y, w.w, w.h);
    ctx.fillStyle = colors.window;
    if (w.orientation === "horizontal") ctx.fillRect(x + 4, y + w.h / 2 - 5, w.w - 8, 10);
    else ctx.fillRect(x + w.w / 2 - 5, y + 4, 10, w.h - 8);
    ctx.strokeStyle = "rgba(255,231,160,.45)";
    ctx.strokeRect(x + 5, y + 5, w.w - 10, w.h - 10);
  }

  function drawPallet(p) {
    if (p.broken) return;
    const x = sx(p.x), y = sy(p.y);
    ctx.save();
    ctx.translate(x + p.w / 2, y + p.h / 2);
    if (p.orientation === "vertical") ctx.rotate(Math.PI / 2);
    if (p.state === "upright") {
      ctx.fillStyle = colors.pallet;
      ctx.fillRect(-p.w / 2 + 8, -8, p.w - 16, 16);
      ctx.fillStyle = "rgba(255,255,255,.15)";
      ctx.fillRect(-p.w / 2 + 10, -6, p.w - 20, 3);
    } else {
      ctx.fillStyle = colors.palletDropped;
      ctx.fillRect(-p.w / 2 + 4, -14, p.w - 8, 28);
      for (let i = -2; i <= 2; i++) {
        ctx.fillStyle = i % 2 ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.10)";
        ctx.fillRect(i * 14 - 4, -14, 5, 28);
      }
    }
    ctx.restore();
  }

  function drawGenerator(g) {
    const x = sx(g.x), y = sy(g.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = g.done ? "#fff2a4" : "#5f4e37";
    ctx.fillRect(-20, -24, 40, 48);
    ctx.fillStyle = g.done ? "#4cff8a" : "#d8a84f";
    ctx.fillRect(-16, 16, 32 * g.progress, 5);
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.strokeRect(-20, -24, 40, 48);
    if (g.activeRepairers?.length) {
      ctx.strokeStyle = "rgba(255,232,120,.7)";
      ctx.beginPath();
      ctx.arc(0, 0, 34 + Math.sin(performance.now() / 90) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGate(g) {
    const x = sx(g.x), y = sy(g.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = g.open ? colors.gate : "#692323";
    ctx.lineWidth = 6;
    ctx.strokeRect(-25, -36, 50, 72);
    ctx.fillStyle = g.open ? "rgba(128,255,166,.2)" : "rgba(128,0,0,.2)";
    ctx.fillRect(-21, -32, 42, 64);
    ctx.restore();
  }

  function drawScratchMarks() {
    for (const s of snapshot.scratchMarks || []) {
      ctx.save();
      ctx.translate(sx(s.x), sy(s.y));
      ctx.rotate(s.angle);
      ctx.globalAlpha = Math.max(0, Math.min(1, s.ttl / 3.5));
      ctx.strokeStyle = "rgba(255,40,40,.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawActors() {
    for (const raw of snapshot.actors || []) {
      if (!raw.visible || raw.dead || raw.escaped) continue;
      const actor = actorForRender(raw);
      if (actor.role === "killer") drawKiller(actor);
      else drawSurvivor(actor);
    }
  }

  function drawSurvivor(a) {
    const x = sx(a.x), y = sy(a.y);
    const size = 30;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a.angle || 0);
    ctx.shadowColor = a.injured ? "rgba(255,60,60,.75)" : "rgba(113,208,255,.7)";
    ctx.shadowBlur = a.invuln > 0 ? 20 : 8;
    ctx.fillStyle = a.injured ? colors.survivorInjured : colors.survivor;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.fillRect(2, -5, 13, 10);
    ctx.restore();
    drawName(a, x, y - 30);
  }

  function drawKiller(a) {
    const x = sx(a.x), y = sy(a.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a.angle || 0);
    const pulse = Math.sin(performance.now() / 100) * 3;
    ctx.shadowColor = "rgba(255,30,30,.8)";
    ctx.shadowBlur = 22;
    ctx.fillStyle = colors.killer;
    ctx.beginPath();
    ctx.arc(0, 0, 20 + pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,0,0,.22)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 115, -0.34, 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    drawName(a, x, y - 34);
  }

  function drawName(a, x, y) {
    ctx.font = "700 12px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,.65)";
    ctx.fillText(a.name, x + 1, y + 1);
    ctx.fillStyle = "rgba(255,255,255,.86)";
    ctx.fillText(a.name, x, y);
  }

  function drawParticles() {
    for (const p of particles) {
      const alpha = 1 - p.life / p.ttl;
      if (p.kind === "blood") ctx.fillStyle = `rgba(165, 0, 0, ${alpha})`;
      else if (p.kind === "spark") ctx.fillStyle = `rgba(255, 226, 105, ${alpha})`;
      else if (p.kind === "wood") ctx.fillStyle = `rgba(160, 95, 50, ${alpha})`;
      else ctx.fillStyle = `rgba(170, 150, 120, ${alpha})`;
      ctx.fillRect(sx(p.x), sy(p.y), p.size, p.size);
    }
  }

  function drawFog() {
    const me = localRenderActor();
    if (!me || !snapshot?.map) return;

    const isKiller = me.role === "killer";
    const length = isKiller ? 940 : 700;
    const angleSize = isKiller ? Math.PI / 1.65 : Math.PI / 2.35;
    const auraRadius = isKiller ? 235 : 180;
    const outsideFog = isKiller ? 0.38 : 0.50;
    const px = sx(me.x), py = sy(me.y);
    const a = me.angle || 0;
    const left = a - angleSize / 2;
    const right = a + angleSize / 2;

    // Soft global fog. Keep the map readable outside vision instead of turning the whole thing into spilled ink.
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${outsideFog})`;
    ctx.fillRect(0, 0, width, height);

    // Cut a bright local aura and flashlight cone out of the fog.
    ctx.globalCompositeOperation = "destination-out";

    const aura = ctx.createRadialGradient(px, py, 8, px, py, auraRadius);
    aura.addColorStop(0, "rgba(255,255,255,1)");
    aura.addColorStop(0.55, "rgba(255,255,255,.82)");
    aura.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(px, py, auraRadius, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(px, py, 35, px, py, length);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,.92)");
    grad.addColorStop(0.76, "rgba(255,255,255,.48)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(left) * length, py + Math.sin(left) * length);
    ctx.arc(px, py, length, left, right);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Add actual light color back on top after the mask. This prevents the cone from being technically clear but visually dead.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const warm = ctx.createRadialGradient(px, py, 40, px, py, length);
    warm.addColorStop(0, isKiller ? "rgba(255,80,60,.18)" : "rgba(255,238,188,.24)");
    warm.addColorStop(0.48, isKiller ? "rgba(255,30,20,.10)" : "rgba(255,220,150,.15)");
    warm.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = warm;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(left) * length, py + Math.sin(left) * length);
    ctx.arc(px, py, length, left, right);
    ctx.closePath();
    ctx.fill();

    const closeGlow = ctx.createRadialGradient(px, py, 5, px, py, auraRadius * 0.9);
    closeGlow.addColorStop(0, isKiller ? "rgba(255,40,35,.18)" : "rgba(255,245,210,.18)");
    closeGlow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = closeGlow;
    ctx.beginPath();
    ctx.arc(px, py, auraRadius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMinimap() {
    const map = snapshot.map;
    const w = 170, h = 120, pad = 16;
    const x = width - w - pad, y = height - h - pad;
    const sxm = w / map.width, sym = h / map.height;
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "rgba(0,0,0,.58)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.15)";
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    for (const wall of fullMap.walls || []) ctx.fillRect(x + wall.x * sxm, y + wall.y * sym, Math.max(1, wall.w * sxm), Math.max(1, wall.h * sym));
    for (const raw of snapshot.actors || []) {
      if (!raw.visible || raw.dead || raw.escaped) continue;
      const actor = actorForRender(raw);
      ctx.fillStyle = actor.role === "killer" ? colors.killer : colors.survivor;
      ctx.fillRect(x + actor.x * sxm - 2, y + actor.y * sym - 2, 4, 4);
    }
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.04, (now - lastFrame) / 1000);
    lastFrame = now;
    updateParticles(dt);
    updateVisualActors(dt);
    updateAudio(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
