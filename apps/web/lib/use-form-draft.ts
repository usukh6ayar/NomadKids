"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A form's typed text, kept across a reload, a Back button and a killed tab.
 *
 * ★ This exists because the observation form is the one screen where losing
 * input is unrecoverable.
 *
 * `docs/REDESIGN_BRIEF.md` §4.4 states the guarantee — "The form autosaves a
 * draft. Losing a written observation to a tapped Back button is the worst
 * failure this screen can have" — and repeats it as constraint 13. The screen
 * held its fields in `useState` alone, so every one of those failures lost
 * several paragraphs a teacher had just written. The brief said any redesign
 * must "keep that guarantee"; there was none to keep.
 *
 * ★★ `localStorage`, not `sessionStorage`.
 *
 * The failure being defended against is the tab going away — a phone
 * discarding a backgrounded tab is the common one, and it takes
 * `sessionStorage` with it. `localStorage` survives it, which is the whole
 * point.
 *
 * ★★★ It is deliberately NOT a general form-state library.
 *
 * It restores a flat object of strings and booleans and nothing else. A draft
 * that can hold arbitrary structures is a draft that can restore a shape the
 * form no longer has, and the failure mode there — a form that throws on mount
 * for one user and cannot be cleared without devtools — is worse than the data
 * loss it set out to prevent. `isPlainDraft` rejects anything else.
 *
 * ★★★★ Reading and writing are two exports, not one hook.
 *
 * The restore has to happen in the `useState` initialiser of every field, which
 * runs *before* a hook taking those fields as an argument could be called. One
 * combined hook would have to restore in an effect instead — painting the empty
 * form first and filling it a frame later, which reads as the draft being lost
 * and then found. `readDraft` is a plain function for exactly that reason.
 */

/** A draft this old is not offered back. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Writes are debounced by this much — one write per pause, not per keystroke. */
const WRITE_DELAY_MS = 500;

/** The shape a draft may take. Flat, and only these two primitives. */
export type DraftValues = Record<string, string | boolean>;

interface Stored<T> {
  /** When the draft was last written, for expiry. */
  savedAt: number;
  values: T;
}

/**
 * Only strings and booleans, and only one level deep.
 *
 * ★ Guards the *read*, not the write. What is in `localStorage` was put there
 * by a previous version of this code, by another tab, or by hand — none of
 * which this build controls. A draft failing this check is discarded silently,
 * because the alternative is a form that cannot render.
 */
function isPlainDraft(value: unknown): value is DraftValues {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string" || typeof v === "boolean");
}

/**
 * The stored draft for `key`, or `null` if there is none, it has expired, or it
 * is not a shape this build understands.
 *
 * Call it from a `useState` initialiser so it runs once, on the client, before
 * the first paint.
 */
export function readDraft<T extends DraftValues>(key: string): T | null {
  // Safari in private mode throws on `localStorage` access rather than
  // returning null, and a throw here is the form failing to mount.
  try {
    if (typeof window === "undefined") return null;

    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Stored<unknown>>;
    if (typeof parsed?.savedAt !== "number" || !isPlainDraft(parsed.values)) return null;

    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed.values as T;
  } catch {
    return null;
  }
}

/**
 * Writes `values` back to `key` as they change, and hands back a `clear` to
 * call once the real save has succeeded.
 *
 * The hook does not own the fields — the caller does, in the `useState` it
 * already had. This persists what it is given and stays out of the way.
 */
export function useDraftAutosave<T extends DraftValues>(
  /** Unique per form *and* per subject — one child's draft must not open on another's. */
  key: string,
  values: T,
  /** Skips writing entirely. Used while the form is not yet ready to own a draft. */
  enabled = true,
): { clear: () => void; resume: () => void } {
  /*
   * `cleared` latches. Once the form has really saved, later renders must not
   * write the (now stale) field values back out — the fields are reset a tick
   * after the mutation resolves, and without this latch that reset would be
   * persisted as a fresh empty draft over the one just cleared.
   */
  const cleared = useRef(false);

  const clear = useCallback(() => {
    cleared.current = true;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to do: the draft is already unreachable to the user.
    }
  }, [key]);

  /**
   * Starts drafting again after a `clear`.
   *
   * ★ Needed because the latch is permanent by design. A form that stays
   * mounted and is reused — the observation screen's "Дахин бичих", which
   * blanks the fields for a second observation about the same child — would
   * otherwise have autosave silently dead for every observation after the
   * first, which is the failure this hook exists to prevent, arriving later.
   */
  const resume = useCallback(() => {
    cleared.current = false;
  }, []);

  // A new key is a different subject — the latch must not carry across.
  useEffect(() => {
    cleared.current = false;
  }, [key]);

  const serialised = JSON.stringify(values);

  useEffect(() => {
    if (!enabled || cleared.current) return;

    /*
     * ★ An all-empty draft is not written, and an existing one is removed.
     *
     * Otherwise merely opening the form and leaving leaves a draft behind, and
     * the next visit announces a restore that put nothing on screen.
     */
    const isEmpty = Object.values(values).every((v) => v === "" || v === false);

    const timer = setTimeout(() => {
      /*
       * ★ Re-checked here, not only above.
       *
       * `clear()` can land while this timer is already armed — which is the
       * ordinary case, not a rare one: the teacher types, presses Хадгалах
       * within the debounce window, and the POST succeeds. Guarding only at
       * schedule time let that pending write fire *after* the clear and put
       * the just-saved text back, so the next visit offered a draft of an
       * observation that had already been filed.
       *
       * The effect's own cleanup does not cover it: `values` has not changed
       * by then, so the dependencies are identical, the effect never re-runs
       * and the timer is never cleared.
       */
      if (cleared.current) return;

      try {
        if (isEmpty) window.localStorage.removeItem(key);
        else
          window.localStorage.setItem(
            key,
            JSON.stringify({ savedAt: Date.now(), values } satisfies Stored<T>),
          );
      } catch {
        // A full or unavailable store costs the draft, never the form.
      }
    }, WRITE_DELAY_MS);

    return () => clearTimeout(timer);
    // `serialised` stands in for `values`, deliberately. The object is rebuilt
    // by the caller every render, so listing it here would re-arm the timer on
    // every render rather than on every change. Its JSON is computed in the
    // same render, so the closure over `values` cannot be stale.
  }, [serialised, key, enabled]);

  return { clear, resume };
}
