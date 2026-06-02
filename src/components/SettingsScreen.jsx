import ScreenHeader from "./ScreenHeader"
import "../styles/settings.css"

export default function OptionsScreen() {
  return (
    <div id="optionsScreen" className="screen io-screen">
      <div className="void-card wide-menu-card full-menu-card settings-card">
        <ScreenHeader
          eyebrow="calibration"
          title="Settings"
        />
        <div className="option-list">
          <div className="option-card audio-option-card featured-option">
            <div className="option-icon audio-icon" aria-hidden="true" />
            <div>
              <strong>Audio</strong>
              <span>Set the menu music level before the next run.</span>
            </div>
            <div className="volume-control">
              <label htmlFor="menuMusicVolumeSlider">
                <span>Main menu volume</span>
                <b id="menuMusicVolumeValue">14%</b>
              </label>
              <input id="menuMusicVolumeSlider" type="range" min="0" max="100" step="1" defaultValue="14" aria-label="Main menu music volume" />
            </div>
            <button id="menuMusicToggleBtnOptions" className="menu-music-toggle" type="button" aria-pressed="false">Menu music on</button>
          </div>
        </div>
      </div>
    </div>
  )
}
