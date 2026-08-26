import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Web test setup.
 *
 * The API is stubbed at `fetch`, not at the query-hook level. Mocking a hook
 * would prove the mock works; stubbing `fetch` exercises the real client, the
 * real Zod parsing and the real error mapping — which is where the bugs that
 * matter actually live.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom implements neither, and Radix and the shell both use them.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom implements no part of the Pointer Events capture API. Radix's Select
// calls `hasPointerCapture` while tracking a pointer across its trigger and
// listbox, which throws — not "returns false" — when the method is entirely
// absent.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

// jsdom has no layout engine and never implements this either — Radix's
// Select calls it to keep the highlighted item in view as it changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
