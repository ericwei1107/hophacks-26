/**
 * The simulation is the single source of truth and must stay renderer-free:
 * no DOM, no React, no three.js, no renderer or UI imports. This is what makes
 * it safe to drive either the three.js or the Unity launch view from the same
 * frames. The check is structural, so adding such an import fails the build
 * rather than quietly coupling the sim to a renderer.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PURE_ROOTS = ["src/sim", "src/domain", "src/protocol"];

const FORBIDDEN = [
  { pattern: /from\s+["']three/, label: "three.js" },
  { pattern: /from\s+["']@react-three\//, label: "@react-three" },
  { pattern: /from\s+["']react["']/, label: "react" },
  { pattern: /from\s+["']react-dom/, label: "react-dom" },
  { pattern: /from\s+["']zustand/, label: "zustand" },
  { pattern: /\.\.\/ui\//, label: "the ui layer" },
  { pattern: /\.\.\/renderers\//, label: "the renderers layer" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out;
}

describe("simulation purity", () => {
  it("imports no DOM, React, three.js or UI code", () => {
    const offenders: string[] = [];
    for (const root of PURE_ROOTS) {
      for (const file of walk(root)) {
        if (file.includes("__tests__")) {
          continue;
        }
        const source = readFileSync(file, "utf8");
        for (const { pattern, label } of FORBIDDEN) {
          if (pattern.test(source)) {
            offenders.push(`${file} imports ${label}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("covers every pure root", () => {
    for (const root of PURE_ROOTS) {
      expect(walk(root).length).toBeGreaterThan(0);
    }
  });
});
