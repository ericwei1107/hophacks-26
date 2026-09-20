/**
 * Single place that knows where the Python-exported golden fixtures live on
 * disk (see ../../../../../export_fixtures.py). Every fixture is checked
 * against EXPECTED_MODEL_VERSION as soon as it's loaded, so a shape change
 * on the Python side fails here with a clear message instead of surfacing
 * as a confusing assertion failure deep inside a parity test.
 */
import correctionsJson from "../../../../../fixtures/corrections.json";
import missionsJson from "../../../../../fixtures/missions.json";
import perturbedJson from "../../../../../fixtures/perturbed_cases.json";
import weatherJson from "../../../../../fixtures/reference_weather.json";
import scalarsJson from "../../../../../fixtures/scalar_helpers.json";

/**
 * Bump this alongside MODEL_VERSION in export_fixtures.py whenever the
 * exported shape (not just the values) changes.
 */
const EXPECTED_MODEL_VERSION = "1.0.0";

interface FixtureEnvelope {
  fixture: string;
  model_version: string;
  generator: string;
  payload: unknown;
}

function checkVersion(data: unknown): void {
  const envelope = data as FixtureEnvelope;
  if (envelope.model_version !== EXPECTED_MODEL_VERSION) {
    throw new Error(
      `fixture "${envelope.fixture}" has model_version "${envelope.model_version}", ` +
        `expected "${EXPECTED_MODEL_VERSION}". Regenerate with ` +
        `'python export_fixtures.py', or bump EXPECTED_MODEL_VERSION in fixtures.ts ` +
        `if this version change is intentional.`,
    );
  }
}

for (const fixture of [correctionsJson, missionsJson, perturbedJson, weatherJson, scalarsJson]) {
  checkVersion(fixture);
}

export function loadFixture<T>(data: unknown): T {
  return data as T;
}

export { correctionsJson, missionsJson, perturbedJson, weatherJson, scalarsJson };
