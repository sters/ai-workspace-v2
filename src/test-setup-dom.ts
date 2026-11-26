// DOM-only setup, preloaded on top of test-setup.ts for components/ and hooks/ alone.
// The node tests keep Bun's own fetch, Request and Response, which happy-dom replaces.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, expect } from "bun:test";

GlobalRegistrator.register();

// Imported after registering: Testing Library reads `document` when it loads.
const matchers = await import("@testing-library/jest-dom/matchers");
const { cleanup } = await import("@testing-library/react");

expect.extend(matchers);
afterEach(cleanup);
