/**
 * Accessibility/effects settings: reduced motion, low effects, mute.
 * Persisted locally.
 */

import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "../store";

export function SettingsToggle() {
  const { settings, setSettings } = useAppStore(
    useShallow((s) => ({ settings: s.settings, setSettings: s.setSettings })),
  );
  return (
    <div className="settings">
      <label className="setting">
        <input
          type="checkbox"
          checked={settings.reducedMotion}
          onChange={(e) => setSettings({ reducedMotion: e.target.checked })}
        />
        Reduced motion
      </label>
      <label className="setting">
        <input
          type="checkbox"
          checked={settings.lowEffects}
          onChange={(e) => setSettings({ lowEffects: e.target.checked })}
        />
        Low effects
      </label>
      <label className="setting">
        <input
          type="checkbox"
          checked={settings.muted}
          onChange={(e) => setSettings({ muted: e.target.checked })}
        />
        Mute
      </label>
    </div>
  );
}
