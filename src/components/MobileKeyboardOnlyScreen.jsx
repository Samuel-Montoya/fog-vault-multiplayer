import "../styles/mobile_keyboard.css"

export default function MobileKeyboardOnlyScreen() {
  return (
    <main className="keyboard-only-screen" aria-labelledby="keyboardOnlyTitle">
      <div className="keyboard-only-card">
        <div className="keyboard-only-mark" aria-hidden="true">⌨</div>
        <p className="keyboard-only-eyebrow">RiftRunner</p>
        <h1 id="keyboardOnlyTitle">Just for Mouse and Keyboard!</h1>
        <p>This game is built for desktop browser play.</p>
      </div>
    </main>
  )
}
