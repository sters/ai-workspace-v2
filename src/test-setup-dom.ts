// DOM-only setup, loaded on top of test-setup.ts by the `dom` project alone.
// The matchers pull in jsdom-dependent code, and the `node` project's 135 files
// have no document to assert against.
import "@testing-library/jest-dom/vitest";
