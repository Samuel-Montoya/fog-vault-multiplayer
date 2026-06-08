// Tank Co-op maps for Void Tanks mode.
// Uses the same tile grid strategy as maps.js.
//
// Legend:
// X = wall / indestructible block
// . = floor
// S = player tank spawn
// 1 = Husk enemy spawn (tier 1 - stationary, slow fire, 1 bounce)
// 2 = Shade enemy spawn (tier 2 - slow patrol, medium fire, 1 bounce)
// 3 = Wraith enemy spawn (tier 3 - medium speed, pursues, evades, 1 bounce)
// 4 = Specter enemy spawn (tier 4 - fast, aggressive, ricochet shots, 2 bounces)
// 5 = Abyss enemy spawn (tier 5 - fast rush, rapid direct fire, 0 bounces)

const TANK_MAPS = {
  levels: [
    // ─── LEVEL 1: "Hollow Chamber" ──────────────────────────────────────
    // Small arena, 3 Husks, simple wall layout. Tutorial feel.
    {
      name: "Hollow Chamber",
      level: 1,
      tile: 72,
      rows: [
        "XXXXXXXXXXXXXXXXXXXXXXX",
        "X...........1.........X",
        "X.....................X",
        "X....XXX.......XXX....X",
        "X....X...........X....X",
        "X....X...........X....X",
        "X....XXX.......XXX....X",
        "X.....................X",
        "X..S......1..........X",
        "X.....................X",
        "X......XX...XX........X",
        "X......X.....X........X",
        "X......X.....X........X",
        "X......XX...XX........X",
        "X.....................X",
        "X..........1..........X",
        "X.....................X",
        "X..S..................X",
        "XXXXXXXXXXXXXXXXXXXXXXX"
      ]
    },

    // ─── LEVEL 2: "Shattered Corridor" ──────────────────────────────────
    // Medium arena, 2 Husks + 2 Shades. Introduces moving enemies.
    {
      name: "Shattered Corridor",
      level: 2,
      tile: 72,
      rows: [
        "XXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "X......1........2.........X",
        "X.........................X",
        "X...XXXX....XXXX....XXXX..X",
        "X...X..............X......X",
        "X...X......XX......X......X",
        "X...X......XX......X......X",
        "X...X..............X......X",
        "X...XXXX....XXXX....XXXX..X",
        "X.........................X",
        "X..S......................X",
        "X.........................X",
        "X...XXXX....XXXX....XXXX..X",
        "X...X..............X......X",
        "X...X......XX......X......X",
        "X...X......XX......X......X",
        "X...X..............X......X",
        "X...XXXX....XXXX....XXXX..X",
        "X.........................X",
        "X..S..........1.......2...X",
        "X.........................X",
        "XXXXXXXXXXXXXXXXXXXXXXXXXXX"
      ]
    },

    // ─── LEVEL 3: "Void Labyrinth" ─────────────────────────────────────
    // Larger arena, 1 Husk + 3 Wraiths. Enemies that chase and dodge.
    {
      name: "Void Labyrinth",
      level: 3,
      tile: 72,
      rows: [
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "X.....3.......................X",
        "X.........XX...XX.............X",
        "X.........X.....X............X",
        "X..XXX....X.....X....XXX.....X",
        "X..X......X.....X......X.....X",
        "X..X......XX...XX......X.....X",
        "X..X.......................X..X",
        "X..XXX.......XXX.......XXX...X",
        "X.............................X",
        "X..S..........................X",
        "X.............................X",
        "X.......XX.........XX........X",
        "X.......X...........X........X",
        "X.......X....1......X........X",
        "X.......X...........X........X",
        "X.......XX.........XX........X",
        "X.............................X",
        "X..S..........................X",
        "X.............................X",
        "X..XXX.......XXX.......XXX...X",
        "X..X.......................X..X",
        "X..X......XX...XX......X.....X",
        "X..X......X.....X......X.....X",
        "X..XXX....X.....X....XXX.....X",
        "X.........X.....X............X",
        "X.........XX...XX.......3....X",
        "X......................3......X",
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
      ]
    },

    // ─── LEVEL 4: "Specter's Gauntlet" ─────────────────────────────────
    // Complex arena, 2 Wraiths + 2 Specters. Ricochet-shooting enemies.
    {
      name: "Specter's Gauntlet",
      level: 4,
      tile: 72,
      rows: [
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "X.....4...........................X",
        "X.............................4...X",
        "X.....XX.......XX.......XX........X",
        "X.....X.........X.........X.......X",
        "X.....X.........X.........X.......X",
        "X.....XX.......XX.......XX........X",
        "X.................................X",
        "X..XXXX...XXX.......XXX...XXXX....X",
        "X..X.........................X....X",
        "X..X....XX.....XXX.....XX...X....X",
        "X..X....X...............X...X....X",
        "X..X....X...............X...X....X",
        "X..X....XX.....XXX.....XX...X....X",
        "X..X.........................X....X",
        "X..XXXX...XXX.......XXX...XXXX....X",
        "X.................................X",
        "X..S..............................X",
        "X.................................X",
        "X.....XX..XX.........XX..XX.......X",
        "X.....X....X.........X....X.......X",
        "X.....X....X.........X....X.......X",
        "X.....XX..XX.........XX..XX.......X",
        "X.................................X",
        "X..S...........3...........3......X",
        "X.................................X",
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
      ]
    },

    // ─── LEVEL 5: "The Abyss" ───────────────────────────────────────────
    // Large arena, 2 Specters + 2 Abyss. All-out assault, fast enemies.
    {
      name: "The Abyss",
      level: 5,
      tile: 72,
      rows: [
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "X.......5.........................5.X",
        "X...................................X",
        "X....XXXX......XXXXXX......XXXX.....X",
        "X....X..........X..........X........X",
        "X....X..........X..........X........X",
        "X....X..........X..........X........X",
        "X....XXXX......XXXXXX......XXXX.....X",
        "X...................................X",
        "X.......XX..XX.......XX..XX.........X",
        "X.......X....X.......X....X.........X",
        "X.......X....X.......X....X.........X",
        "X.......XX..XX.......XX..XX.........X",
        "X...................................X",
        "X..S................................X",
        "X...................................X",
        "X......XXXX..XXXXXXXX..XXXX.........X",
        "X......X..................X..........X",
        "X......X......XXXX......X...........X",
        "X......X......X..X......X...........X",
        "X......X......X..X......X...........X",
        "X......X......XXXX......X...........X",
        "X......X..................X..........X",
        "X......XXXX..XXXXXXXX..XXXX.........X",
        "X...................................X",
        "X..S................................X",
        "X...................................X",
        "X.......XX..XX.......XX..XX.........X",
        "X.......X....X.......X....X.........X",
        "X.......X....X.......X....X.........X",
        "X.......XX..XX.......XX..XX.........X",
        "X...................................X",
        "X......4...................4.........X",
        "X...................................X",
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
      ]
    }
  ]
};

if (typeof window !== "undefined") {
  window.TANK_MAPS = TANK_MAPS;
}

if (typeof module !== "undefined") {
  module.exports = TANK_MAPS;
}
