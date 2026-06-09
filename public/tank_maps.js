// Tank Assault maps.
// Compact toy-block arenas inspired by Wii Play: Tanks!.
//
// Layout rules:
// - Levels 1-20 are built around the Wii Tanks mission flow: safe player spawn, open edge driving lanes,
//   central cover islands, and enemies introduced in roughly the same order.
// - Internal walls are kept at least two floor tiles away from the outer border so the edge never becomes
//   a cheap one-tile squeeze lane.
//
// Legend:
// X = wall / indestructible block
// . = floor
// S = player tank spawn
// 1 = Brown Husk      - stationary cannon, slow ricochet shell
// 2 = Gray Shade      - slow defensive mover, single shell
// 3 = Teal Bolt       - slow rocket shooter, fast direct shots
// 4 = Yellow Sapper   - quick mine layer, light cannon
// 5 = Red Charger     - aggressive multi-shot hunter
// 6 = Green Sniper    - stationary ricochet specialist
// 7 = Purple Elite    - fast hunter, mines, high pressure
// 8 = White Phantom   - evasive flanker, fast shots, leaves almost no mercy
// B = White Void Boss  - level 21 roguelite boss, health bar, rotating abilities

const TANK_MAPS = {
  levels: [
    {
      name: 'Mission 01 - Brown Across The Room',
      level: 1,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X.................X",
        "X.................X",
        "X..............1..X",
        "X.................X",
        "X......XXXXX......X",
        "X.................X",
        "X.................X",
        "X.................X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 02 - First Gray',
      level: 2,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X.................X",
        "X..............2..X",
        "X........X........X",
        "X........X........X",
        "X......XXXXX......X",
        "X........X........X",
        "X........X........X",
        "X.................X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 03 - Zigzag Lesson',
      level: 3,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X..............1..X",
        "X.................X",
        "X....XXXXXX...2...X",
        "X.....X...........X",
        "X.....X...........X",
        "X.....X...........X",
        "X.......XXXXXX....X",
        "X.................X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 04 - Corner Cannons',
      level: 4,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X.............1...X",
        "X...............2.X",
        "X.................X",
        "X.....XX...XX.....X",
        "X.....XXXXXXX.....X",
        "X.....XX...XX.....X",
        "X.............1...X",
        "X.................X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 05 - Rocket Debut',
      level: 5,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X..............3..X",
        "X.................X",
        "X...........XXX...X",
        "X.......XXX.......X",
        "X.......XXX.......X",
        "X.......XXX....2..X",
        "X...........XXX...X",
        "X.................X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 06 - Rocket Hall',
      level: 6,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X..............3..X",
        "X.................X",
        "X...XXXXXXXX.X....X",
        "X............X.2..X",
        "X............X....X",
        "X............X....X",
        "X...XXXXXXXX.X....X",
        "X..............3..X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 07 - Crossfire Room',
      level: 7,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X............3..3.X",
        "X.................X",
        "X.....XXX.........X",
        "X.....XXXX........X",
        "X........X.....2..X",
        "X........XXXX.....X",
        "X.........XXX.....X",
        "X.............1...X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 08 - Mine Introduction',
      level: 8,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X..............4..X",
        "X.................X",
        "X....XXX...XXX....X",
        "X.............3...X",
        "X.......XXX.......X",
        "X.................X",
        "X....XXX...XXX.4..X",
        "X.................X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 09 - Mine Trap',
      level: 9,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X.............4...X",
        "X...............2.X",
        "X...XX.......XX...X",
        "X...XX.......XX...X",
        "X......XXXXX......X",
        "X..............4..X",
        "X...XX.......XX...X",
        "X...XX......2XX...X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 10 - Red Debut',
      level: 10,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X..............5..X",
        "X.................X",
        "X...XXX...........X",
        "X......XXXXX......X",
        "X......XXXXX..2...X",
        "X......XXXXX......X",
        "X...........XXX...X",
        "X.................X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 11 - Mixed Practice',
      level: 11,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X............3..2.X",
        "X.................X",
        "X......X...X......X",
        "X......X...X......X",
        "X......XXXXX...4..X",
        "X......X...X......X",
        "X......X...X......X",
        "X.............5...X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 12 - First Greens',
      level: 12,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X..............6..X",
        "X.................X",
        "X....XXXXXXXXX....X",
        "X........X.....5..X",
        "X........X........X",
        "X........X........X",
        "X....XXXXXXXXX....X",
        "X..............6..X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 13 - Yellow Teal Split',
      level: 13,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X............3..3.X",
        "X.................X",
        "X....XX.....XX....X",
        "X....XX.....XX....X",
        "X....XX.....XX.4..X",
        "X.................X",
        "X.......XXX.......X",
        "X.......XXX...4...X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 14 - Red Green Corridors',
      level: 14,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X...........6...6.X",
        "X.................X",
        "X....X.......X....X",
        "X....X.......X.5..X",
        "X....XXXXXXXXX....X",
        "X....X.......X....X",
        "X....X.......X....X",
        "X....X.......X5...X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 15 - Purple Debut',
      level: 15,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X..............7..X",
        "X.................X",
        "X.....XXX..XXX....X",
        "X.....XXX..XXX....X",
        "X..............6..X",
        "X.................X",
        "X.....XXX..XXX....X",
        "X.....XXX..XXX5...X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 16 - Bounce Channels',
      level: 16,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X............6..7.X",
        "X.................X",
        "X...XXXXX.XXXXX...X",
        "X........X........X",
        "X........X.....3..X",
        "X........X........X",
        "X...XXXXX.XXXXX...X",
        "X..............6..X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 17 - Center Corridor',
      level: 17,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X.............6.6.X",
        "X.......X.X.......X",
        "X.......X.X.......X",
        "X.......X.X....7..X",
        "X...XXXXX.XXXXXX..X",
        "X.......X.X.......X",
        "X.......X.X.......X",
        "X.......X.X....6..X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 18 - Rocket Crossfire',
      level: 18,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X............3..6.X",
        "X.................X",
        "X...XXX.....XXX...X",
        "X...XXX.....XXX...X",
        "X.......XXX....4..X",
        "X............3....X",
        "X...XXX.....XXX...X",
        "X...XXX.....XXX.7.X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 19 - Purple Minefield',
      level: 19,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X...........7..7..X",
        "X.................X",
        "X....XXX...XXX....X",
        "X..............4..X",
        "X......XXXXX......X",
        "X.............6...X",
        "X....XXX...XXX....X",
        "X..............7..X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 20 - White Open Field',
      level: 20,
      tile: 56,
      rows: [
        "XXXXXXXXXXXXXXXXXXX",
        "X.................X",
        "X...........8...8.X",
        "X.................X",
        "X........XX.......X",
        "X......XX..XX..7..X",
        "X......XX..XX.....X",
        "X......XX..XX..4..X",
        "X........XX.......X",
        "X.............8...X",
        "X.................X",
        "X..SS.............X",
        "XXXXXXXXXXXXXXXXXXX"
      ]
    },
    {
      name: 'Mission 21 - White Void',
      level: 21,
      tile: 56,
      boss: true,
      rows: [
        "XXXXXXXXXXXXXXXXXXXXXXX",
        "X.....................X",
        "X.....................X",
        "X.....................X",
        "X.....................X",
        "X....XXX.......XXX....X",
        "X....XXX.......XXX....X",
        "X.....................X",
        "X.......XXXBXXX.......X",
        "X.....................X",
        "X....XXX.......XXX....X",
        "X....XXX.......XXX....X",
        "X.....................X",
        "X.....................X",
        "X.....................X",
        "X....S...........S....X",
        "XXXXXXXXXXXXXXXXXXXXXXX"
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
