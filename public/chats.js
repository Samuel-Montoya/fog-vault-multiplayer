(function attachRiftrunnerChats(root) {
  const RIFTRUNNER_CHATS = {
    chatWheel: {
      survivor: {
        normal: [
          "Feed this rift.",
          "Stay close.",
          "Void nearby.",
          "I heard something."
        ],
        chase: [
          "Void on me.",
          "Keep moving!",
          "I need distance.",
          "Do not come here."
        ],
        injured: [
          "I need healing.",
          "Hold still near me.",
          "I need cover.",
          "Over here."
        ],
        downed: [
          "Pick me up.",
          "I need help.",
          "I am down.",
          "Not ideal."
        ],
        hooked: [
          "Get me down.",
          "I need a rescue.",
          "Void is close.",
          "Hurry."
        ]
      },
      killer: [
        "I hear you.",
        "Run while you can.",
        "The dark is moving.",
        "You are close."
      ]
    },
    automatic: {
      voidEscape: [
        "I'm almost out!",
        "The void is opening...",
        "Hold on, I'm slipping through!",
        "I can see the other side!",
        "Almost home...",
        "Don't close on me now...",
        "My planet better have snacks."
      ],
      matchStartRunner: [
        "I need to get back to my planet...",
        "I have to restore our galaxy.",
        "It's my time to shine!",
        "Okay... don't panic. Definitely don't panic.",
        "The rifts are calling again.",
        "If I survive this, I am taking a nap in orbit.",
        "Stay bright. Stay alive.",
        "I should probably stop glowing and start moving."
      ],
      orbFull: [
        "I have too many orbs...",
        "I should deposit these",
        "I can't pick any more up.",
        "I'm getting full..."
      ],
      hit: [
        "Ouch...!",
        "That really hurt.",
        "Okay, rude.",
        "My bones have notes.",
        "That was unnecessary.",
        "I felt that in my orbit.",
        "Personal space, please."
      ],
      hitWithOrbs: [
        "My orbs!",
        "Not the orbs!",
        "I was using those!",
        "Great, there goes my stash.",
        "My precious space marbles!"
      ],
      downed: [
        "I got got...",
        "You got me...",
        "Finally...",
        "This is fine.",
        "Tell my orbs I loved them.",
        "I meant to lie down.",
        "Okay, dramatic.",
        "I regret several decisions.",
        "The floor and I are friends now."
      ],
      downedWithOrbsExtra: [
        "There go the orbs...",
        "I was saving those..."
      ]
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = RIFTRUNNER_CHATS;
  root.RIFTRUNNER_CHATS = RIFTRUNNER_CHATS;
  if (root.window) root.window.RIFTRUNNER_CHATS = RIFTRUNNER_CHATS;
})(typeof globalThis !== "undefined" ? globalThis : this);
