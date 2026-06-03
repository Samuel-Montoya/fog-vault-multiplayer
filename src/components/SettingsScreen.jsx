import ScreenHeader from "./ScreenHeader"
import "../styles/settings.css"

const SETTINGS_GROUPS = [
  {
    key: "audio",
    className: "audio-option-card featured-option",
    iconClassName: "audio-icon",
    title: "Audio",
    copy: "Set the menu music level before the next run.",
    control: {
      type: "range",
      id: "menuMusicVolumeSlider",
      valueId: "menuMusicVolumeValue",
      label: "Main menu volume",
      defaultValue: "14",
      min: "0",
      max: "100",
      step: "1"
    },
    toggle: {
      id: "menuMusicToggleBtnOptions",
      label: "Menu music on"
    }
  }
]

function VolumeControl({ control }) {
  return control?.type === "range" ? (
    <div className="volume-control">
      <label htmlFor={control.id}>
        <span>{control.label}</span>
        <b id={control.valueId}>{control.defaultValue}%</b>
      </label>
      <input
        id={control.id}
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        defaultValue={control.defaultValue}
        aria-label={control.label}
      />
    </div>
  ) : null
}

function SettingsOption({ option }) {
  return (
    <div className={`option-card ${option.className}`}>
      <div className={`option-icon ${option.iconClassName}`} aria-hidden="true" />
      <div>
        <strong>{option.title}</strong>
        <span>{option.copy}</span>
      </div>
      <VolumeControl control={option.control} />
      {option.toggle ? (
        <button id={option.toggle.id} className="menu-music-toggle" type="button" aria-pressed="false">
          {option.toggle.label}
        </button>
      ) : null}
    </div>
  )
}

export default function OptionsScreen() {
  return (
    <div id="optionsScreen" className="screen io-screen">
      <div className="void-card wide-menu-card full-menu-card settings-card">
        <ScreenHeader eyebrow="calibration" title="Settings" />
        <div className="option-list">
          {SETTINGS_GROUPS.map((option) => (
            <SettingsOption option={option} key={option.key} />
          ))}
        </div>
      </div>
    </div>
  )
}
