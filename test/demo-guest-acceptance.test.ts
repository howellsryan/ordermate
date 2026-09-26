// Vitest is configured to discover test/**/*.test.ts. Import the browser-only
// guest demo suites here so demo parity is part of the canonical CI test run.
import "../src/client/demo-acceptance.test";
import "../src/client/demo-sme-flow.test";
