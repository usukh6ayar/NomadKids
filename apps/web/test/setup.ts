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
  /*
   * Storage is per-origin and every test file shares one, so a draft or a
   * selected child written by one test would still be there for the next. That
   * is the kind of leak that makes a suite pass in order and fail alone.
   */
  window.localStorage?.clear?.();
  window.sessionStorage?.clear?.();
});

/**
 * A real `localStorage`.
 *
 * ★ `window.localStorage` here is a plain `{}` — not jsdom's `Storage`, and not
 * missing either. `typeof window.localStorage` is `"object"` while `getItem`,
 * `setItem` and `clear` are all `undefined`, so a feature-detect on the object
 * passes and the first method call throws.
 *
 * Two things in the product write to it — `lib/selected-child.tsx` and
 * `lib/use-form-draft.ts` — and both wrap access in `try`/`catch` because
 * Safari in private mode throws on it. That is what has been hiding this:
 * every persisted value in every test has been silently discarded, and the
 * tests still passed because the catch is doing its job.
 *
 * Persistence that cannot be tested is persistence nobody will notice
 * breaking, so this installs a working one rather than mocking per-file. The
 * guard is on a *method* rather than on the object, which is the check that
 * would have caught this in the first place.
 */
if (typeof window.localStorage?.getItem !== "function") {
  /*
   * ★ Stored values are OWN properties; the methods live on a prototype.
   *
   * That is how the real `Storage` is shaped, and `flows.test.tsx` depends on
   * it: "stores no credential in localStorage or sessionStorage" asserts
   * `Object.keys({ ...localStorage })` is empty, and a spread copies own
   * enumerable properties only. A polyfill carrying `getItem` and friends as
   * own keys reports six of them and fails a test that is about credentials.
   *
   * Worth noting what that test was until now: `localStorage` was an object
   * that could not be written to, so the assertion could not fail whatever the
   * app did. It starts checking something real here.
   */
  const proto = {
    getItem(this: Record<string, string>, key: string): string | null {
      const k = String(key);
      return Object.prototype.hasOwnProperty.call(this, k) ? this[k]! : null;
    },
    setItem(this: Record<string, string>, key: string, value: string): void {
      this[String(key)] = String(value);
    },
    removeItem(this: Record<string, string>, key: string): void {
      delete this[String(key)];
    },
    clear(this: Record<string, string>): void {
      for (const k of Object.keys(this)) delete this[k];
    },
    key(this: Record<string, string>, index: number): string | null {
      return Object.keys(this)[index] ?? null;
    },
  };

  // `length` is defined separately: an accessor in an object literal cannot
  // declare a `this` parameter (TS2784), and every method above needs one
  // because the values live on the instance rather than in a closure.
  Object.defineProperty(proto, "length", {
    get(this: Record<string, string>) {
      return Object.keys(this).length;
    },
  });

  for (const name of ["localStorage", "sessionStorage"] as const) {
    if (typeof window[name]?.getItem === "function") continue;
    Object.defineProperty(window, name, {
      configurable: true,
      value: Object.create(proto) as Storage,
    });
  }
}

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
