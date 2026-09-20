import { useEffect } from "react";

import BlackHoleHeroSectionDemo from "@/components/demo";
import { AssemblyScreen } from "./ui/screens/AssemblyScreen";
import { FlightScreen } from "./ui/screens/FlightScreen";
import { DebriefScreen } from "./ui/screens/DebriefScreen";
import { useAppStore } from "./ui/store";
import { loadWeatherSnapshot } from "./sim/orbital/weather";

export function App() {
  const screen = useAppStore((s) => s.screen);
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
    <>
      {screen === "assembly" && (
        <main className="landing-shell">
          <BlackHoleHeroSectionDemo />
          <section
            id="launch-lab"
            aria-label="APOGEE mission simulator"
            className="scroll-mt-0"
          >
            <AssemblyScreen />
          </section>
        </main>
      )}
      {screen === "flight" && <FlightScreen />}
      {screen === "debrief" && <DebriefScreen />}
    </>
  );
}
