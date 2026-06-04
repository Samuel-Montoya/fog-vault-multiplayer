function registerSocketHandlers(context) {
  const {
    io,
    maxConnections: MAX_CONNECTIONS,
    maxSurvivors: MAX_SURVIVORS,
    lobbies,
    socketToLobby,
    serverMetrics,
    matchStartFreezeSeconds: MATCH_START_FREEZE_SECONDS,
    getMapListForClient,
    getDefaultMapId,
    getLobbySummary,
    allowSocketEvent,
    createLobby,
    joinLobby,
    joinSpectatorLobby,
    leaveCurrentLobby,
    canChangeRole,
    sanitizeSkin,
    sanitizeVoidSkin,
    normalizeRunnerClassId,
    accountService,
    touchLobby,
    broadcastLobbyState,
    broadcastLobbyList,
    addBotToLobby,
    removeBotFromLobby,
    startGame,
    canSocketControlPause,
    setMatchPaused,
    toggleAbilityTestMode,
    isSpectateOverviewId,
    spectateOverviewId: SPECTATE_OVERVIEW_ID,
    isSpectatableActorForViewer,
    resetInput,
    applyVoidAbility,
    applySurvivorAbility,
    fireRunnerShootAbility,
    fireRallyDart,
    getChatWheelMessagesForActor,
    setActorChat,
    nowMs
  } = context;

  function tokenFromSocket(socket) {
    if (socket.data.authTokenOverride) return String(socket.data.authTokenOverride);
    const authToken = socket.handshake?.auth?.token;
    if (authToken) return String(authToken);
    const header = String(socket.handshake?.headers?.authorization || "");
    if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
    return "";
  }

  async function loadSocketAccount(socket) {
    if (!accountService?.authAvailable?.()) {
      socket.data.account = null;
      return null;
    }
    const account = await accountService.getAccountFromToken(tokenFromSocket(socket));
    socket.data.account = account || null;
    return socket.data.account;
  }

  function accountPayload(account = null, extra = {}) {
    return {
      ok: true,
      account: account || null,
      skins: accountService?.publicCatalog ? accountService.publicCatalog() : [],
      perks: accountService?.publicPerkCatalog ? accountService.publicPerkCatalog() : [],
      runnerClasses: accountService?.publicRunnerClassCatalog ? accountService.publicRunnerClassCatalog() : [],
      ...extra
    };
  }

  function skinForSocket(socket, role, skin) {
    const roleKey = role === "killer" ? "void" : role === "survivor" ? "runner" : "spectator";
    if (roleKey === "spectator") return "spectatorEye";
    const sanitized = roleKey === "void" ? sanitizeVoidSkin(skin) : sanitizeSkin(skin);
    if (!accountService?.authAvailable?.() || !accountService?.sanitizeOwnedSkin) return sanitized;
    return accountService.sanitizeOwnedSkin(socket.data.account, roleKey, sanitized);
  }

  async function refreshLobbyAccountState(lobby) {
    if (!lobby || !accountService?.authAvailable?.()) return;
    const tasks = [];

    for (const player of lobby.players.values()) {
      if (!player || player.isBot || player.role === "spectator") continue;
      const playerSocket = io.sockets?.sockets?.get?.(player.id);
      if (!playerSocket) continue;

      tasks.push(loadSocketAccount(playerSocket).then((account) => {
        player.accountId = account?.id || null;
        player.perkLevels = account?.perks || null;
        player.runnerClass = player.role === "survivor" ? normalizeRunnerClassId?.(player.runnerClass || account?.selectedRunnerClass) : null;
        player.runnerLevel = account?.runnerLevel || account?.progression?.runner?.level || player.runnerLevel || 1;
        player.skin = skinForSocket(playerSocket, player.role, player.skin);

        const liveActor = lobby.game?.actors?.get?.(player.id);
        if (liveActor && !liveActor.isBot) {
          liveActor.accountId = player.accountId;
          liveActor.perkLevels = player.perkLevels;
          liveActor.runnerClass = player.runnerClass;
          liveActor.runnerLevel = player.runnerLevel;
          liveActor.skin = player.skin;
        }

        playerSocket.emit("accountState", accountPayload(account));
      }).catch((error) => {
        console.warn("[auth] lobby account refresh failed", player.id, error.message || error);
      }));
    }

    await Promise.all(tasks);
  }

  io.use((socket, next) => {
    loadSocketAccount(socket).then(() => next()).catch((error) => {
      console.warn("[auth] socket account load failed", error.message || error);
      socket.data.account = null;
      next();
    });
  });


  io.on("connection", (socket) => {
    if (io.engine.clientsCount > MAX_CONNECTIONS) {
      socket.emit("toast", { type: "error", message: "Server is full right now. Try again in a bit." });
      socket.disconnect(true);
      return;
    }

    socket.data.connectedAt = nowMs();
    socket.emit("hello", { id: socket.id, maps: getMapListForClient(), activeMapId: getDefaultMapId() });
    socket.emit("accountState", accountPayload(socket.data.account));
    socket.emit("lobbyList", [...lobbies.values()].map(getLobbySummary));

    socket.on("setBotDebug", ({ enabled } = {}) => {
      const next = !!enabled;
      socket.data.botDebugEnabled = next;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      const player = lobby?.players?.get(socket.id);
      if (player && !player.isBot) player.botDebugEnabled = next;
      const liveActor = lobby?.game?.actors?.get?.(socket.id);
      if (liveActor && !liveActor.isBot) liveActor.botDebugEnabled = next;
    });

    socket.on("refreshAccount", ({ token } = {}) => {
      if (typeof token === "string") socket.data.authTokenOverride = token;
      loadSocketAccount(socket).then((account) => {
        const lobby = lobbies.get(socketToLobby.get(socket.id));
        const player = lobby?.players?.get(socket.id);
        if (player && !player.isBot) {
          player.accountId = account?.id || null;
          player.perkLevels = account?.perks || null;
          player.runnerClass = player.role === "survivor" ? normalizeRunnerClassId?.(player.runnerClass || account?.selectedRunnerClass) : null;
          player.runnerLevel = account?.runnerLevel || account?.progression?.runner?.level || player.runnerLevel || 1;
          player.skin = skinForSocket(socket, player.role, player.skin);
          const liveActor = lobby?.game?.actors?.get?.(socket.id);
          if (liveActor && !liveActor.isBot) {
            liveActor.perkLevels = account?.perks || null;
            liveActor.runnerClass = player.runnerClass;
            liveActor.runnerLevel = player.runnerLevel;
          }
          if (lobby.phase === "lobby") broadcastLobbyState(lobby);
        }
        socket.emit("accountState", accountPayload(account));
      }).catch((error) => {
        socket.emit("toast", { type: "error", message: error.message || "Could not refresh account." });
      });
    });

    socket.on("createLobby", ({ name, role, playerName, skin, mapId, runnerClass } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      try {
        const lobby = createLobby(name, mapId);
        joinLobby(socket, lobby, role, playerName, skinForSocket(socket, role, skin), runnerClass || socket.data.account?.selectedRunnerClass);
      } catch (error) {
        console.error("Failed to create lobby", error);
        socket.emit("toast", { type: "error", message: error.message || "Failed to create lobby." });
      }
    });

    socket.on("joinLobby", ({ lobbyId, role, playerName, skin, runnerClass } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(String(lobbyId || ""));
      if (!lobby) {
        socket.emit("toast", { type: "error", message: "Lobby not found." });
        return;
      }
      joinLobby(socket, lobby, role, playerName, skinForSocket(socket, role, skin), runnerClass || socket.data.account?.selectedRunnerClass);
    });

    socket.on("spectateLobby", ({ lobbyId, playerName } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(String(lobbyId || ""));
      if (!lobby) {
        socket.emit("toast", { type: "error", message: "Lobby not found." });
        return;
      }
      joinSpectatorLobby(socket, lobby, playerName);
    });

    socket.on("quickJoin", ({ role, playerName, skin, mapId, runnerClass } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      try {
        const available = [...lobbies.values()].filter((l) => l.phase === "lobby");
        const roleValue = role === "killer" ? "killer" : "survivor";
        const lobby = available.find((l) => {
          const players = [...l.players.values()];
          if (roleValue === "killer") return true;
          return players.filter((p) => p.role === "survivor").length < MAX_SURVIVORS;
        }) || createLobby("Open Lobby", mapId);
        joinLobby(socket, lobby, roleValue, playerName, skinForSocket(socket, roleValue, skin), runnerClass || socket.data.account?.selectedRunnerClass);
      } catch (error) {
        console.error("Failed to quick join", error);
        socket.emit("toast", { type: "error", message: error.message || "Failed to quick join." });
      }
    });

    socket.on("leaveLobby", () => {
      if (!allowSocketEvent(socket, "lobby")) return;
      leaveCurrentLobby(socket);
    });

    socket.on("setRole", ({ role, skin, runnerClass } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || lobby.phase !== "lobby") return;
      const player = lobby.players.get(socket.id);
      if (!player) return;

      const nextRole = role === "spectator" ? "spectator" : role === "killer" ? "killer" : "survivor";

      if (player.role === "spectator" && nextRole !== "spectator") {
        socket.emit("toast", { type: "info", message: "Spectators cannot switch into a playable role from this lobby." });
        return;
      }

      if (!canChangeRole(lobby, player, nextRole)) {
        socket.emit("toast", { type: "error", message: nextRole === "killer" ? "Could not select The Void." : nextRole === "spectator" ? "Could not join as spectator." : "Runner slots are full." });
        return;
      }

      player.role = nextRole;
      player.runnerClass = nextRole === "survivor" ? normalizeRunnerClassId?.(runnerClass || player.runnerClass || socket.data.account?.selectedRunnerClass) : null;
      player.runnerLevel = socket.data.account?.runnerLevel || socket.data.account?.progression?.runner?.level || player.runnerLevel || 1;
      // If the player picked a survivor skin before switching back from killer,
      // preserve that choice instead of silently resetting them to blue square.
      player.skin = skinForSocket(socket, nextRole, skin || player.skin);
      player.ready = nextRole === "spectator";
      if (nextRole === "spectator") {
        socket.emit("toast", { type: "info", message: "Joined as Spectator. You will load into the run watching only." });
      }
      touchLobby(lobby);
      broadcastLobbyState(lobby);
      broadcastLobbyList();
    });

    socket.on("setRunnerClass", ({ runnerClass } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || lobby.phase !== "lobby") return;
      const player = lobby.players.get(socket.id);
      if (!player || player.role !== "survivor") return;
      player.runnerClass = normalizeRunnerClassId?.(runnerClass || socket.data.account?.selectedRunnerClass);
      player.ready = false;
      touchLobby(lobby);
      broadcastLobbyState(lobby);
    });

    socket.on("setSkin", ({ skin } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || lobby.phase !== "lobby") return;
      const player = lobby.players.get(socket.id);
      if (!player || (player.role !== "survivor" && player.role !== "killer")) return;
      player.skin = skinForSocket(socket, player.role, skin);
      player.ready = false;
      touchLobby(lobby);
      broadcastLobbyState(lobby);
    });

    socket.on("setReady", ({ ready } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || lobby.phase !== "lobby") return;
      const player = lobby.players.get(socket.id);
      if (!player) return;
      if (player.role === "spectator") {
        player.ready = true;
        socket.emit("toast", { type: "info", message: "Spectators are always ready and do not affect match start." });
        broadcastLobbyState(lobby);
        return;
      }
      player.ready = !!ready;
      touchLobby(lobby);
      broadcastLobbyState(lobby);
    });

    socket.on("addBot", ({ role } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby) return;
      const result = addBotToLobby(lobby, role);
      if (!result.ok) {
        socket.emit("toast", { type: "error", message: result.message });
        return;
      }
      broadcastLobbyState(lobby);
      broadcastLobbyList();
    });

    socket.on("removeBot", ({ botId } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby) return;
      const result = removeBotFromLobby(lobby, botId);
      if (!result.ok) {
        socket.emit("toast", { type: "error", message: result.message });
        return;
      }
      broadcastLobbyState(lobby);
      broadcastLobbyList();
    });

    socket.on("startGame", async () => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || lobby.phase !== "lobby") return;
      await refreshLobbyAccountState(lobby);
      if (lobby.phase !== "lobby") return;
      startGame(lobby);
    });

    socket.on("togglePauseMatch", () => {
      if (!allowSocketEvent(socket, "action")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby?.game || lobby.game.phase !== "game") return;
      if (!canSocketControlPause(lobby, socket.id)) {
        socket.emit("toast", { type: "error", message: "Only the host can pause the match." });
        return;
      }
      setMatchPaused(lobby, socket.id, !lobby.game.paused);
    });

    socket.on("setMatchPaused", ({ paused } = {}) => {
      if (!allowSocketEvent(socket, "action")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby?.game || lobby.game.phase !== "game") return;
      if (!canSocketControlPause(lobby, socket.id)) {
        socket.emit("toast", { type: "error", message: "Only the host can pause the match." });
        return;
      }
      setMatchPaused(lobby, socket.id, !!paused);
    });

    socket.on("spectate", (payload = {}) => {
      if (!allowSocketEvent(socket, "action")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
      const viewer = lobby.game.actors.get(socket.id);
      if (!viewer || (viewer.role !== "spectator" && !(viewer.role === "survivor" && (viewer.dead || viewer.escaped)))) return;
      const targetId = String(payload.targetId || "");
      if (viewer.role === "spectator" && isSpectateOverviewId(targetId)) {
        viewer.spectateTargetId = SPECTATE_OVERVIEW_ID;
        viewer.x = lobby.game.map?.width ? lobby.game.map.width / 2 : viewer.x;
        viewer.y = lobby.game.map?.height ? lobby.game.map.height / 2 : viewer.y;
        viewer.angle = 0;
        return;
      }
      const target = lobby.game.actors.get(targetId);
      if (!isSpectatableActorForViewer(viewer, target)) return;
      viewer.spectateTargetId = targetId;
      viewer.x = target.x;
      viewer.y = target.y;
      viewer.angle = target.angle || 0;
    });

    socket.on("input", (input = {}) => {
      if (!allowSocketEvent(socket, "input")) return;
      serverMetrics.inputsReceived += 1;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || !lobby.game) return;
      const actor = lobby.game.actors.get(socket.id);
      if (!actor || actor.role === "spectator") return;
      if (actor.role === "survivor" && actor.dead) return;
      if (lobby.game.paused) {
        resetInput(actor.input);
        if (Number.isFinite(input.angle)) actor.input.angle = input.angle;
        return;
      }
      if ((lobby.game.time || 0) < (lobby.game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS)) {
        resetInput(actor.input);
        // Let aim update during the intro so the camera/flashlight can settle naturally,
        // but do not allow movement, attacks, vaults, healing, or deposits yet.
        if (Number.isFinite(input.angle)) actor.input.angle = input.angle;
        return;
      }
      if (actor.role === "killer" && (actor.voidStun || 0) > 0) {
        resetInput(actor.input);
        if (Number.isFinite(input.angle)) actor.input.angle = input.angle;
        return;
      }

      actor.input.up = !!input.up;
      actor.input.down = !!input.down;
      actor.input.left = !!input.left;
      actor.input.right = !!input.right;
      actor.input.sprint = actor.role === "survivor" && !!input.sprint;
      actor.input.repair = !!input.repair;
      actor.input.action = actor.input.action || !!input.action;
      actor.input.actionDir = ["up", "down", "left", "right"].includes(input.actionDir)
        ? input.actionDir
        : null;
      if (actor.role === "killer") {
        actor.input.attack = actor.input.attack || !!input.attack;
        actor.input.attackHeld = !!input.attackHeld;
        actor.input.attackReleased = actor.input.attackReleased || !!input.attackReleased;
      }
      if (Number.isFinite(input.angle)) actor.input.angle = input.angle;
    });

    const emitDashAbilityAudio = (lobby, actor, abilityId) => {
      const id = String(abilityId || "");
      if (id !== "nullRush" && id !== "speedBurst") return;
      if (!lobby?.id || !actor) return;
      io.to(lobby.id).emit("abilityAudio", {
        type: "dash",
        x: actor.x,
        y: actor.y,
        actorId: actor.id,
        survivorId: actor.role === "survivor" ? actor.id : null,
        killerId: actor.role === "killer" ? actor.id : null,
        abilityId: id,
        createdAt: lobby.game?.time || 0
      });
    };

    socket.on("voidAbility", (payload = {}) => {
      if (!allowSocketEvent(socket, "action")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
      const actor = lobby.game.actors.get(socket.id);
      const result = applyVoidAbility(lobby.game, actor, payload.id);
      if (result.ok) emitDashAbilityAudio(lobby, actor, payload.id);
      else socket.emit("toast", { type: "error", message: result.message || "The Void cannot use that." });
    });

    socket.on("survivorAbility", (payload = {}) => {
      if (!allowSocketEvent(socket, "action")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
      const actor = lobby.game.actors.get(socket.id);
      const result = applySurvivorAbility(lobby.game, actor, payload.id);
      if (result.ok) emitDashAbilityAudio(lobby, actor, payload.id);
      else socket.emit("toast", { type: "error", message: result.message || "Runner ability cannot be used." });
    });

    socket.on("toggleAbilityTestMode", () => {
      if (!allowSocketEvent(socket, "action")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      const result = typeof toggleAbilityTestMode === "function"
        ? toggleAbilityTestMode(lobby, socket.id)
        : { ok: false, message: "Ability test mode is not wired in." };
      if (result.message) {
        socket.emit("toast", {
          type: result.ok ? "info" : "error",
          message: result.message
        });
      } else if (!result.ok) {
        socket.emit("toast", { type: "error", message: "Ability test mode could not be changed." });
      }
    });

    socket.on("runnerShootAbilityFire", (payload = {}) => {
      if (!allowSocketEvent(socket, "action")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
      const actor = lobby.game.actors.get(socket.id);
      const result = typeof fireRunnerShootAbility === "function"
        ? fireRunnerShootAbility(lobby.game, actor, payload)
        : { ok: false, message: "Runner projectile ability is not ready." };
      if (!result.ok) socket.emit("toast", { type: "error", message: result.message || "Runner projectile ability cannot be fired." });
    });

    socket.on("rallyDartFire", (payload = {}) => {
      if (!allowSocketEvent(socket, "action")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
      const actor = lobby.game.actors.get(socket.id);
      const result = typeof fireRallyDart === "function"
        ? fireRallyDart(lobby.game, actor, payload)
        : { ok: false, message: "Rally Dart is not ready." };
      if (!result.ok) socket.emit("toast", { type: "error", message: result.message || "Rally Dart cannot be fired." });
    });

    socket.on("chatWheel", (payload = {}) => {
      if (!allowSocketEvent(socket, "chat")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
      const actor = lobby.game.actors.get(socket.id);
      if (!actor || actor.dead || actor.escaped) return;
      const messages = getChatWheelMessagesForActor(actor);
      const index = Number.isInteger(payload.index) ? payload.index : Math.floor(Number(payload.index));
      if (!Number.isInteger(index) || index < 0 || index >= messages.length) return;
      setActorChat(actor, messages[index], lobby.game);
    });

    socket.on("backToLobby", () => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby) return;
      if (lobby.phase === "ended") {
        lobby.phase = "lobby";
        lobby.game = null;
        touchLobby(lobby);
        for (const p of lobby.players.values()) p.ready = p.role === "spectator" || p.isBot;
        broadcastLobbyState(lobby);
        broadcastLobbyList();
      }
    });

    socket.on("disconnect", () => leaveCurrentLobby(socket));
  });
}

module.exports = { registerSocketHandlers };
