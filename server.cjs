const path = require("path");
const { startRiftRunnerServer } = require("./server/game/engine.cjs");

startRiftRunnerServer({ rootDir: __dirname }).catch((error) => {
  console.error("Failed to start Riftrunner server", error);
  process.exit(1);
});
