const CONFIG = require("../shared/config.js");
const { uid } = require("./utils.js");
const { Game, ROLE } = require("./game.js");

class LobbyManager {
  constructor(io) {
    this.io = io;
    this.lobbies = new Map();
    this.socketToLobby = new Map();
    this.nextLobbyNumber = 1;
  }

  createLobby() {
    const id = uid("lobby");
    const lobby = {
      id,
      name: `Open Lobby ${this.nextLobbyNumber++}`,
      createdAt: Date.now(),
      game: null
    };
    lobby.game = new Game(lobby, this.io);
    this.lobbies.set(id, lobby);
    this.broadcastLobbyList();
    return lobby;
  }

  list() {
    return [...this.lobbies.values()].map((lobby) => ({
      id: lobby.id,
      name: lobby.name,
      state: lobby.game.state,
      players: lobby.game.actors.size,
      survivors: lobby.game.survivors().length,
      killer: !!lobby.game.killer(),
      maxSurvivors: CONFIG.lobby.maxSurvivors
    }));
  }

  broadcastLobbyList() {
    this.io.emit("lobbyList", this.list());
  }

  attach(socket) {
    socket.on("requestLobbies", () => this.broadcastLobbyList());
    socket.on("createLobby", (payload = {}) => this.joinLobby(socket, this.createLobby().id, payload.name));
    socket.on("joinLobby", ({ lobbyId, name } = {}) => this.joinLobby(socket, lobbyId, name));
    socket.on("leaveLobby", () => this.leaveLobby(socket));
    socket.on("chooseRole", ({ role } = {}) => this.chooseRole(socket, role));
    socket.on("addBot", ({ role } = {}) => this.addBot(socket, role));
    socket.on("startGame", () => this.startGame(socket));
    socket.on("restartLobby", () => this.restartLobby(socket));
    socket.on("input", (input) => this.handleInput(socket, input));
    socket.on("disconnect", () => this.leaveLobby(socket, true));

    if (!this.lobbies.size) this.createLobby();
    socket.emit("lobbyList", this.list());
  }

  getLobbyForSocket(socket) {
    const lobbyId = this.socketToLobby.get(socket.id);
    return lobbyId ? this.lobbies.get(lobbyId) : null;
  }

  joinLobby(socket, lobbyId, name = "Player") {
    let lobby = this.lobbies.get(lobbyId);
    if (!lobby) lobby = this.createLobby();
    this.leaveLobby(socket);
    socket.join(lobby.id);
    this.socketToLobby.set(socket.id, lobby.id);
    const actor = lobby.game.addHuman(socket.id, String(name || "Player").slice(0, 20));
    socket.emit("joinedLobby", { lobbyId: lobby.id, selfId: actor.id });
    this.io.to(lobby.id).emit("lobbyState", this.lobbyState(lobby));
    this.broadcastLobbyList();
  }

  leaveLobby(socket, disconnected = false) {
    const lobby = this.getLobbyForSocket(socket);
    if (!lobby) return;
    socket.leave(lobby.id);
    lobby.game.removeHuman(socket.id);
    this.socketToLobby.delete(socket.id);
    if (!disconnected) socket.emit("leftLobby");
    if (!lobby.game.actors.size && this.lobbies.size > 1) this.lobbies.delete(lobby.id);
    else this.io.to(lobby.id).emit("lobbyState", this.lobbyState(lobby));
    this.broadcastLobbyList();
  }

  chooseRole(socket, role) {
    const lobby = this.getLobbyForSocket(socket);
    if (!lobby) return;
    const result = lobby.game.setRole(socket.id, role === ROLE.KILLER ? ROLE.KILLER : ROLE.SURVIVOR);
    socket.emit("notice", result.ok ? "Role updated." : result.reason);
    this.io.to(lobby.id).emit("lobbyState", this.lobbyState(lobby));
    this.broadcastLobbyList();
  }

  addBot(socket, role) {
    const lobby = this.getLobbyForSocket(socket);
    if (!lobby || lobby.game.state !== "lobby") return;
    const bot = lobby.game.addBot(role === ROLE.KILLER ? ROLE.KILLER : ROLE.SURVIVOR);
    socket.emit("notice", bot ? `Added ${bot.name}.` : "No slot available for that bot.");
    this.io.to(lobby.id).emit("lobbyState", this.lobbyState(lobby));
    this.broadcastLobbyList();
  }

  startGame(socket) {
    const lobby = this.getLobbyForSocket(socket);
    if (!lobby) return;
    if (!lobby.game.killer()) lobby.game.addBot(ROLE.KILLER);
    if (!lobby.game.survivors().length) lobby.game.addBot(ROLE.SURVIVOR);
    lobby.game.start();
    this.io.to(lobby.id).emit("lobbyState", this.lobbyState(lobby));
    this.broadcastLobbyList();
  }

  restartLobby(socket) {
    const lobby = this.getLobbyForSocket(socket);
    if (!lobby) return;
    lobby.game.state = "lobby";
    lobby.game.winner = null;
    lobby.game.message = "Waiting for players";
    this.io.to(lobby.id).emit("lobbyState", this.lobbyState(lobby));
    this.broadcastLobbyList();
  }

  handleInput(socket, input) {
    const lobby = this.getLobbyForSocket(socket);
    if (!lobby) return;
    lobby.game.updateInput(socket.id, input || {});
  }

  lobbyState(lobby) {
    return {
      id: lobby.id,
      name: lobby.name,
      state: lobby.game.state,
      winner: lobby.game.winner,
      message: lobby.game.message,
      actors: [...lobby.game.actors.values()].map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        isBot: a.isBot,
        healthState: a.healthState,
        hookCount: a.hookCount
      }))
    };
  }

  tick(dt) {
    for (const lobby of this.lobbies.values()) lobby.game.tick(dt);
  }

  sendSnapshots() {
    for (const lobby of this.lobbies.values()) {
      if (lobby.game.state !== "playing" && lobby.game.state !== "ended") continue;
      for (const actor of lobby.game.actors.values()) {
        if (!actor.socketId) continue;
        const socket = this.io.sockets.sockets.get(actor.socketId);
        if (socket) socket.emit("snapshot", lobby.game.snapshotFor(actor));
      }
      this.io.to(lobby.id).emit("lobbyState", this.lobbyState(lobby));
    }
  }
}

module.exports = { LobbyManager };
