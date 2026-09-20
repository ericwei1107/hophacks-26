import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzeLaunchedPayload, pythonBackendAvailable } from "../pythonBackend";
import { referenceSnapshot } from "../../sim/orbital/weather";

afterEach(() => {
  vi.unstubAllGlobals();
});

const handoff = {
  modelVersion: "test",
  payloadDryMassKg: 4000,
  payloadPropellantKg: 1000,
  achievedPerigeeKm: 190,
  achievedApogeeKm: 210,
  achievedInclinationDeg: 5,
  stage2PropellantRemainingKg: 800,
  weather: referenceSnapshot(),
  seed: 7,
};

describe("pythonBackendAvailable", () => {
  it("is true when /api/health reports the python backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, backend: "python" }),
      }),
    );
    await expect(pythonBackendAvailable()).resolves.toBe(true);
  });

  it("is false when the proxy has nothing to talk to", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(pythonBackendAvailable()).resolves.toBe(false);
  });
});

describe("analyzeLaunchedPayload", () => {
  it("posts the parking-orbit handoff to /api/analyze", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ source: "python", explanations: ["ok"], insights: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await analyzeLaunchedPayload(handoff, { runs: 20, sensitivityRuns: 10 });
    expect(report.source).toBe("python");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/analyze");
    const body = JSON.parse(String(init.body));
    expect(body.handoff.payloadDryMassKg).toBe(4000);
    expect(body.handoff.payloadPropellantKg).toBe(1000);
    expect(body.runs).toBe(20);
  });
});
