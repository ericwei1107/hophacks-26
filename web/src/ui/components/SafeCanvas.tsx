/**
 * Canvas wrapper that renders a readable non-3D error state when WebGL is
 * unavailable. The simulation itself is unaffected (it runs headless in the
 * worker), so build controls and telemetry readouts still work.
 */

import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import type { ComponentProps } from "react";

import { isWebGLAvailable } from "../webgl";

export function SafeCanvas({
  children,
  fallback,
  ...props
}: ComponentProps<typeof Canvas> & { fallback?: ReactNode }) {
  if (!isWebGLAvailable()) {
    return (
      <div className="webgl-fallback">
        {fallback ?? (
          <div className="webgl-message">
            <h2>3D view unavailable</h2>
            <p>
              WebGL is not available in this browser or is disabled. The
              simulation still runs — build controls and telemetry readouts
              remain fully functional.
            </p>
          </div>
        )}
      </div>
    );
  }
  return <Canvas {...props}>{children}</Canvas>;
}
