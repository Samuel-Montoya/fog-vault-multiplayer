// public/audioConfig.js
// Edit this file to tune music, sound-effect volumes, audio files, pitch variety, and local sound ranges.
// Volume values are 0.0 to 1.0. Pitch/playback values: 1.0 = normal, below 1 = lower, above 1 = higher.
// This file must be loaded before client.js in index.html.

window.GAME_AUDIO_CONFIG = {
  music: {
    // Overall match music volume multiplier.
    master: 0.55,

    // Per-layer match music volume multipliers.
    // Use these to adjust chase music without changing the whole soundtrack.
    // layer3 is the main chase layer.
    layerVolumes: {
      layer1: 1.0,
      layer2: 1.0,
      layer3: 0.6
    },

    // Main menu music volume multiplier.
    menuMaster: 0.14,

    // How quickly music layers fade toward their target volume. Higher = faster fades.
    fade: 0.065,

    // Menu music file. Put this in public/sfx.
    menu: "/sfx/menu.mp3",

    // Layered match music. Put these in public/sfx. layer_3 restarts from the beginning when chase starts.
    layers: [
      "/sfx/layer_1.mp3",
      "/sfx/layer_2.mp3",
      "/sfx/layer_3.mp3"
    ],

    // Layer 3 stays normal unless the local survivor is injured.
    // 1.0 = normal, above 1 = higher pitch/faster tempo.
    layer3NormalPlaybackRate: 1.0,
    layer3InjuredPlaybackRate: 1.04
  },

  sfx: {
    // Overall SFX volume multiplier.
    master: 0.72,

    // Toggle randomized pitch variation for hook/window vault/orb pickup sounds.
    // Rift/orb deposit pitch is separate and ALWAYS ramps upward per deposit.
    enablePitchVariation: true,

    // Sound effect file paths. Put these files in public/sfx.
    files: {
      hooked: "/sfx/hooked.mp3",
      dead: "/sfx/dead.mp3",
      gen: "/sfx/gen.mp3",
      riftsComplete: "/sfx/rifts_complete.mp3",
      swing: "/sfx/swing.ogg",
      windowVault: "/sfx/window_vault.ogg",
      palletVault: "/sfx/pallet_vault.ogg",
      palletDrop: "/sfx/pallet_drop.mp3",
      voidStun: "/sfx/void_stun.mp3",
      palletStun: "/sfx/void_stun.mp3",
      injured: "/sfx/injured.ogg",
      orbPickup: "/sfx/orb_pickup.mp3",
      orbDeposit: "/sfx/orb_deposit.mp3",
      buttonClick: "/sfx/button_click.mp3",
      playerSpeak: "/sfx/player_speak.mp3"
    },

    // Per-sound volume before the global SFX master multiplier is applied.
    volumes: {
      hooked: 0.82,
      dead: 0.55,
      gen: 0.85,
      riftsComplete: 0.86,
      swing: 0.42,
      windowVault: 0.66,
      palletVault: 0.76,
      palletDrop: 0.23,
      voidStun: 0.82,
      palletStun: 0.82,
      injured: 0.8,
      orbPickup: 0.68,
      orbDeposit: 0.72,
      buttonClick: 0.13,
      playerSpeak: 0.18
    },

    // Pitch variation lists. Used only when enablePitchVariation is true.
    // Add any SFX key here and client.js will automatically apply pitch variation for that sound.
    // The game randomly picks one value and avoids repeating the same one twice.
    // Example: swing: [0.9, 0.96, 1.0, 1.08, 1.16, 1.25, 1.34]
    pitchSteps: {
      hooked: [0.84, 0.92, 1.0, 1.09, 1.18, 1.28],
      swing: [0.9, 0.96, 1.0, 1.08, 1.16, 1.25, 1.34],
      windowVault: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
      palletVault: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
      palletDrop: [0.86, 0.94, 1.0, 1.08, 1.17, 1.26],
      voidStun: [0.78, 0.86, 0.94, 1.0, 1.08],
      palletStun: [0.78, 0.86, 0.94, 1.0, 1.08],
      orbPickup: [0.9, 0.96, 1.0, 1.08, 1.16, 1.25, 1.34],
      buttonClick: [0.92, 0.97, 1.0, 1.05, 1.11, 1.18],
      playerSpeak: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
	  gen: [0.92, 0.97, 1.0, 1.05, 1.11, 1.18]
    },

    // Distance in world pixels for nearby-only sounds.
    localRange: {
      swing: 315,
      hit: 440,
      palletStun: 300,
      voidStun: 360
    }
  }
};
