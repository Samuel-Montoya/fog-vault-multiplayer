// Editable map file for Voidrift.
// Keep rows roughly rectangular. Short rows are padded with floor.
//
// Legend:
// X = wall / stone block
// + = vault window, placed inside wall runs like XXX+XXX or X above/below
// - = horizontal pallet, best used between walls like XX-XX
// | = vertical pallet, best used between walls above/below it
// G = possible rift/generator spawn point. The server randomly picks active rifts each match.
//     Default active count is requiredGenerators + 2, clamped to available G tiles.
//     Example: requiredGenerators: 5 => 7 active rifts. requiredGenerators: 7 => 9 active rifts.
//     Optional override: spawnedGenerators: 9 or spawnedGenerators: "all".
// P = survivor spawn
// K = killer spawn
// E = exit gate
// . = floor

const GAME_MAPS = {
  active: "bloodyard",

  bloodyard: {
    name: "Bloodyard T-Walls",
    tile: 72,
    requiredGenerators: 5,
    rows: [
      "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "X..P...............................P....X",
      "X.......................................X",
      "X....G.....XX-XX...XXXXXXXXX........G...X",
      "X..E...................X.............E..X",
      "X......................X..G.............X",
      "X.....XXX.XXX....G.....X................X",
      "X.....X.....X..........XXXXXXXX.........X",
      "X.....X.....X.................X.........X",
      "X.....+..G..X.................|.........X",
      "X.....X.....X.....XX-XX.......X.........X",
      "X.....X.....X.................X.........X",
      "X.....XXX.XXX........E..................X",
      "X...............X........X..............X",
      "X...............X........X..............X",
      "X..PG.....XXXXXXXXXXX....XXXX+XXXX......X",
      "X...............X........X...........G..X",
      "X...............X........X..............X",
      "X.....XX-XX..............XX-XX..........X",
      "X.......................................X",
      "X...........X.XXXXX...............XXXX..X",
      "X...........X.....X...............X.....X",
      "X...........|.....+.......G.......+.....X",
      "X.....G.....X.....X...............X..K..X",
      "X...........XXXXX.X...............XXXX..X",
      "X..P..E....................E.G..........X",
      "X.......................................X",
	  "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
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
