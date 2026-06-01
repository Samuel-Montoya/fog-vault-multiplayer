const { performance } = require("perf_hooks");

function startGameLoops({
  lobbies,
  io,
  serverMetrics,
  tickRate,
  snapshotRate,
  updateGame,
  buildSnapshotFor,
  recordTickDuration
}) {
  const gameTickDt = 1 / tickRate;
  const gameTickMs = 1000 / tickRate;
  const maxStepsPerFrame = 2;
  const panicFrameMs = 250;
  let lastGameTickAt = performance.now();
  let gameTickAccumulator = 0;
  let lastTickWasSlow = false;

  function sendSnapshots() {
    for (const lobby of lobbies.values()) {
      if (!lobby.game) continue;
      lobby.game.snapshotSeq = (lobby.game.snapshotSeq || 0) + 1;
      for (const socketId of lobby.players.keys()) {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) continue;
        // If a client is already backed up, skip this frame instead of piling JSON
        // into the transport queue. The next volatile snapshot will catch them up.
        if (socket.conn?.transport && socket.conn.transport.writable === false) {
          serverMetrics.snapshotsSkipped += 1;
          continue;
        }
        socket.compress(false).volatile.emit("snapshot", buildSnapshotFor(lobby, socketId));
        serverMetrics.snapshotsSent += 1;
      }
      if (lobby.game.events.length) lobby.game.events.length = 0;
    }
  }

  function runGameTickFrame() {
    const frameStarted = performance.now();
    const now = frameStarted;
    let elapsedMs = now - lastGameTickAt;
    lastGameTickAt = now;

    // Realtime games should not simulate a backlog after a CPU spike. Catch-up bursts
    // create the exact stop/go movement hitch that makes bots look possessed. Drop the
    // backlog and resume from the newest state instead.
    if (elapsedMs > panicFrameMs || lastTickWasSlow) {
      gameTickAccumulator = 0;
      elapsedMs = Math.min(elapsedMs, gameTickMs * maxStepsPerFrame);
    }

    let elapsed = Math.max(0, Math.min(0.08, elapsedMs / 1000));
    gameTickAccumulator += elapsed;

    let steps = 0;
    while (gameTickAccumulator >= gameTickDt && steps < maxStepsPerFrame) {
      for (const lobby of lobbies.values()) updateGame(lobby, gameTickDt);
      gameTickAccumulator -= gameTickDt;
      steps++;
    }

    if (steps >= maxStepsPerFrame) {
      // Never let one overloaded frame make the next frame do even more work.
      gameTickAccumulator = Math.min(gameTickAccumulator, gameTickDt * 0.5);
    }

    const duration = performance.now() - frameStarted;
    lastTickWasSlow = duration > gameTickMs * 1.5;
    recordTickDuration(duration);
  }

  const tickInterval = setInterval(runGameTickFrame, gameTickMs);
  const snapshotInterval = setInterval(sendSnapshots, 1000 / snapshotRate);
  return { tickInterval, snapshotInterval, sendSnapshots, runGameTickFrame };
}

module.exports = { startGameLoops };
