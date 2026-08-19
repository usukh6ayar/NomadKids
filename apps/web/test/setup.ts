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
