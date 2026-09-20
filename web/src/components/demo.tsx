"use client";

import { useEffect, useState } from "react";

import { BlackHoleHeroSection } from "@/components/ui/blackhole-hero-section";

function useNarrow(query = "(max-width: 767px)") {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);

  return narrow;
}

const principles = [
  {
    number: "01",
    title: "Shape the vehicle",
    copy: "Balance propellant, thrust, staging, and payload before committing to the ascent.",
  },
  {
    number: "02",
    title: "Fly the trajectory",
    copy: "Watch guidance, weather, and orbital mechanics turn every design choice into motion.",
  },
  {
    number: "03",
    title: "Read the outcome",
    copy: "Trace the evidence after flight and learn which decision changed the mission.",
  },
];

export default function BlackHoleHeroSectionDemo() {
  const narrow = useNarrow();

  return (
    <>
      <section id="top" className="relative min-h-[100svh] w-full border-b border-white/10">
        <BlackHoleHeroSection
          focus={narrow ? [0.5, 0.76] : [0.72, 0.46]}
          scrim={narrow ? "top" : "left"}
          scrimStrength={0.9}
          distance={24}
          elevation={narrow ? -7 : -5.5}
          fov={narrow ? 58 : 42}
          glow={narrow ? 0.85 : 1}
          steps={narrow ? 200 : 300}
          resolution={narrow ? 0.6 : 0.7}
        >
          <div className="mx-auto flex h-full min-h-[100svh] w-full max-w-[1600px] flex-col px-6 sm:px-10 lg:px-20">
            <header className="flex items-center justify-between border-b border-white/10 py-5 text-white">
              <a
                href="#top"
                aria-label="APOGEE home"
                className="text-sm font-semibold tracking-[0.28em]"
              >
                APOGEE
              </a>
              <nav aria-label="Landing page" className="flex items-center gap-5 text-xs text-white/60 sm:gap-8">
                <a className="transition hover:text-white" href="#physics">
                  The mission
                </a>
                <a className="transition hover:text-white" href="#launch-lab">
                  Launch lab
                </a>
              </nav>
            </header>

            <div className="flex flex-1 items-start pt-16 md:items-center md:pt-0">
              <div className="max-w-[36rem] pb-24 md:pb-8">
                <p className="mb-5 text-[0.68rem] font-semibold uppercase tracking-[0.34em] text-orange-300/80">
                  Orbital mission simulator
                </p>
                <h1 className="text-[2.8rem] font-light leading-[1.02] tracking-[-0.04em] text-white sm:text-6xl lg:text-[4.75rem]">
                  Light does not
                  <br />
                  leave here
                </h1>

                <p className="mt-6 max-w-md text-[0.95rem] leading-relaxed text-white/60 md:mt-7 md:text-base">
                  Gravity writes every trajectory. Build a launch vehicle, fly it
                  through a living solar system, and see where your decisions lead.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3 md:mt-10">
                  <a
                    href="#launch-lab"
                    className="rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:ring-offset-2 focus:ring-offset-black"
                  >
                    Enter launch lab
                  </a>
                  <a
                    href="#physics"
                    className="rounded-full border border-white/20 px-6 py-3 text-sm text-white/80 transition hover:border-white/40 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60"
                  >
                    Explore the mission
                  </a>
                </div>
              </div>
            </div>

            <a
              href="#physics"
              className="absolute bottom-7 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[0.62rem] uppercase tracking-[0.28em] text-white/40 transition hover:text-white/70 md:flex"
            >
              Scroll to explore
              <span aria-hidden="true" className="h-8 w-px bg-gradient-to-b from-white/50 to-transparent" />
            </a>
          </div>
        </BlackHoleHeroSection>
      </section>

      <section id="physics" className="relative overflow-hidden bg-[#05070a] px-6 py-24 text-white sm:px-10 md:py-32 lg:px-20">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-400/70 to-transparent" />
        <div className="mx-auto max-w-[1440px]">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-24">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.34em] text-orange-300/80">
                From first principles
              </p>
              <h2 className="mt-5 max-w-lg text-4xl font-light leading-tight tracking-[-0.035em] sm:text-5xl">
                The mission is a chain of consequences.
              </h2>
            </div>
            <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3">
              {principles.map((principle) => (
                <article key={principle.number} className="bg-[#090c11] p-7 sm:min-h-64">
                  <span className="font-mono text-xs text-orange-300/70">{principle.number}</span>
                  <h3 className="mt-16 text-lg font-medium">{principle.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/50">{principle.copy}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-20 flex flex-col justify-between gap-6 border-t border-white/10 pt-8 sm:flex-row sm:items-end">
            <p className="max-w-2xl text-lg leading-relaxed text-white/55">
              APOGEE keeps the controls close to the physics: change one variable,
              launch again, and build intuition from the difference.
            </p>
            <a
              href="#launch-lab"
              className="w-fit border-b border-orange-300/70 pb-1 text-sm text-orange-100 transition hover:border-orange-200 hover:text-white"
            >
              Configure your vehicle ↓
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
