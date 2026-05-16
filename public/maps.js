// Editable map file for Fog Vault Multiplayer.
// Keep rows roughly rectangular. Short rows are padded with floor.
//
// Legend:
// X = wall / stone block
// + = vault window, placed inside wall runs like XXX+XXX or X above/below
// - = horizontal pallet, best used between walls like XX-XX
// | = vertical pallet, best used between walls above/below it
// G = generator
// P = survivor spawn
// K = killer spawn
// E = exit gate
// . = floor

const GAME_MAPS = {
  active: "bloodyard",

  bloodyard: {
    name: "Bloodyard T-Walls",
    tile: 72,
    requiredGenerators: "all",
    rows: [
      "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "X..P.....P.............................EX",
      "X..................................G....X",
      "X....G.............XXXXXXXXX............X",
      "X......................X................X",
      "X..........XX-XX.......X................X",
      "X......................X................X",
      "X.....XXX.XXX..........XXXXXXXX.........X",
      "X.....X.....X.................X.........X",
      "X.....+..G..X.................|.........X",
      "X.....X.....X.................X....G....X",
      "X.....XXX.XXX.....XX-XX.......X.........X",
      "X.......................................X",
      "X...............X........X..............X",
      "X...............X........X..............X",
      "X.........XXXXXXXXXXX....XXXX+XXXX......X",
      "X...............X........X..............X",
      "X.....G.........X........X.........G....X",
      "X.........XX-XX..........XX-XX..........X",
      "X.......................................X",
      "X...........XXXXXXX...............XXXX..X",
      "X...........X.....X...............X.....X",
      "X...........|.....+......G........+.....X",
      "X.....G.....X.....X...............X..K..X",
      "X...........XXXXXXX...............XXXX..X",
      "X.......................................X",
      "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    ]
  },

  tinyTest: {
    name: "Tiny Test Loop",
    tile: 78,
    requiredGenerators: "all",
    rows: [
      "XXXXXXXXXXXXXXXXXXXX",
      "XP.....P...........EX",
      "X.....XXXX+XXXX.....X",
      "X........X..........X",
      "X..G.....X....G.....X",
      "X.....XX-XX.........X",
      "X...................X",
      "X.........K.........X",
      "XXXXXXXXXXXXXXXXXXXX"
    ]
  }
};

if (typeof window !== "undefined") {
  window.GAME_MAPS = GAME_MAPS;
}

if (typeof module !== "undefined") {
  module.exports = GAME_MAPS;
}
