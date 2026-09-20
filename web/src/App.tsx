import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAppStore } from "./ui/store";
import { loadWeatherSnapshot } from "./sim/orbital/weather";

const BlackHoleHeroSectionDemo = lazy(() => import("@/components/demo"));
const AssemblyScreen = lazy(() =>
  import("./ui/screens/AssemblyScreen").then((module) => ({ default: module.AssemblyScreen })),
);
const FlightScreen = lazy(() =>
  import("./ui/screens/FlightScreen").then((module) => ({ default: module.FlightScreen })),
);
const DebriefScreen = lazy(() =>
  import("./ui/screens/DebriefScreen").then((module) => ({ default: module.DebriefScreen })),
);

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

  useEffect(() => {
    const flush = () => useAppStore.getState().persistBuild();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  return (
    <Suspense fallback={<main className="landing-shell">Loading…</main>}>
      <Routes>
        <Route path="/" element={<main className="landing-shell"><BlackHoleHeroSectionDemo /></main>} />
        <Route path="/lab" element={<LaunchLab />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function LaunchLab() {
  const screen = useAppStore((s) => s.screen);
  return (
    <main aria-label="APOGEE mission simulator">
      <Suspense fallback={<p className="dim small">Loading lab…</p>}>
        {screen === "assembly" && <AssemblyScreen />}
        {screen === "flight" && <FlightScreen />}
        {screen === "debrief" && <DebriefScreen />}
      </Suspense>
    </main>
  );
}
