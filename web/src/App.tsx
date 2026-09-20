import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import BlackHoleHeroSectionDemo from "@/components/demo";
import { AssemblyScreen } from "./ui/screens/AssemblyScreen";
import { FlightScreen } from "./ui/screens/FlightScreen";
import { DebriefScreen } from "./ui/screens/DebriefScreen";
import { useAppStore } from "./ui/store";
import { loadWeatherSnapshot } from "./sim/orbital/weather";

export function App() {
  const setWeather = useAppStore((s) => s.setWeather);

  // Load space weather once at startup (live NOAA, else reference snapshot).
  useEffect(() => {
    let cancelled = false;
    loadWeatherSnapshot().then((snapshot) => {
      if (!cancelled) {
        setWeather(snapshot);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setWeather]);

  return (
    <Routes>
      <Route path="/" element={<main className="landing-shell"><BlackHoleHeroSectionDemo /></main>} />
      <Route path="/lab" element={<LaunchLab />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LaunchLab() {
  const screen = useAppStore((s) => s.screen);
  return (
    <main aria-label="APOGEE mission simulator">
      {screen === "assembly" && <AssemblyScreen />}
      {screen === "flight" && <FlightScreen />}
      {screen === "debrief" && <DebriefScreen />}
    </main>
  );
}
