(function attachRiftrunnerChats(root) {
  const RIFTRUNNER_CHATS = {
    chatWheel: {
      survivor: {
        normal: [
          "Let's feed a rift.",
          "Stay close.",
          "The Void is nearby.",
          "What was that...?"
        ],
        chase: [
          "The Void is on me!",
          "Run!",
          "AHHHHH!",
          "Please, leave me alone..."
        ],
        injured: [
          "I need healing...",
          "Hold still near me.",
          "Follow me.",
          "Over here."
        ],
        downed: [
          "Pick me up!",
          "I need help...",
          "I'm down!",
          "This isn't good..."
        ],
        hooked: [
          "Grab me!",
          "Hurry, he's gone!",
          "The Void is here...",
          "Now's your chance!"
        ]
      },
      killer: [
        "I will consume you.",
        "Run while you can.",
        "I'll be back...",
        "What the...?!"
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
        "The rifts are calling, again...",
        "If I survive this, I'm taking a nap in orbit, forever.",
        "Stay bright. Stay alive.",
        "I should probably stop glowing and start moving."
      ],
      orbFull: [
        "I have too many orbs...",
        "I should deposit these.",
        "I can't pick any more up.",
        "I'm getting full..."
      ],
      hit: [
        "Ouch...!",
        "That really hurt.",
        "Okay, rude.",
        "I don't have any bones...",
        "That was unnecessary.",
        "Ugh, right in the orbit.",
        "Personal space, please."
      ],
      hitWithOrbs: [
        "My orbs!",
        "Not the orbs!",
        "I was using those!",
        "Great, there goes my stash.",
        "My precious space orbs!"
      ],
      downed: [
        "I got got...",
        "You got me...",
        "Finally...",
        "This is fine.",
        "Tell my orbs I loved them.",
        "I meant to lie down.",
        "Okay, geez.",
        "I regret several decisions."
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
