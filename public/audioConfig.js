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

    // Menu music file.
    menu: "/menu.mp3",

    // Layered match music. layer_3 restarts from the beginning when chase starts.
    layers: [
      "/layer_1.mp3",
      "/layer_2.mp3",
      "/layer_3.mp3"
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

    // Sound effect file paths. Put these files in your public folder.
    files: {
      hooked: "/hooked.mp3",
      dead: "/dead.mp3",
      gen: "/gen.mp3",
      riftsComplete: "/rifts_complete.mp3",
      swing: "/swing.ogg",
      windowVault: "/window_vault.ogg",
      palletVault: "/pallet_vault.ogg",
      palletDrop: "/pallet_drop.mp3",
      palletStun: "/pallet_stun.mp3",
      injured: "/injured.ogg",
      orbPickup: "/orb_pickup.mp3",
      orbDeposit: "/orb_deposit.mp3",
      buttonClick: "/button_click.mp3",
      playerSpeak: "/player_speak.mp3"
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
      palletStun: 0.72,
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
      palletStun: [0.82, 0.90, 1.0, 1.10, 1.22],
      orbPickup: [0.9, 0.96, 1.0, 1.08, 1.16, 1.25, 1.34],
      buttonClick: [0.92, 0.97, 1.0, 1.05, 1.11, 1.18],
      playerSpeak: [0.88, 0.94, 1.0, 1.07, 1.15, 1.24],
	  gen: [0.92, 0.97, 1.0, 1.05, 1.11, 1.18]
    },

    // Distance in world pixels for nearby-only sounds.
    localRange: {
      swing: 315,
      hit: 440,
      palletStun: 300
    }
  }
};
