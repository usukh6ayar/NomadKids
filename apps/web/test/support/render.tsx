import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen, type RenderResult } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import { SessionProvider } from "@/lib/auth/session";
import { SelectedChildProvider } from "@/lib/selected-child";
import { ToastProvider } from "@/components/ui/toast";
import type { Role } from "@kinder/contracts";

/**
 * Test rendering.
 *
 * ★ `fetch` is stubbed, not the query hooks.
 *
 * Mocking `useQuery` would prove the mock works. Stubbing the network exercises
 * `apiFetch`, the Zod parsing and the problem+json error mapping — which is
 * where the failures that reach users come from: a response shape that drifted,
 * a null the schema said was required, a 404 rendered as a crash.
 */

export const ROUTER = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

/** Route parameters the component under test will read. */
export let mockParams: Record<string, string> = {};
export function setParams(params: Record<string, string>) {
  mockParams = params;
}

export let mockSearchParams = new URLSearchParams();
export function setSearchParams(params: string) {
  mockSearchParams = new URLSearchParams(params);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ROUTER,
  useParams: () => mockParams,
  useSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
}));

/**
 * The route the component under test believes it is on.
 *
 * Needed by anything that renders navigation: an active state is a comparison
 * against the current path, and a helper pinned to "/" can only ever prove that
 * nothing is active.
 */
export let mockPathname = "/";
export function setPathname(pathname: string) {
  mockPathname = pathname;
}

export interface RouteStub {
  /** Matched against the path after `/v1`, by `startsWith`. */
  path: string;
  status?: number;
  body?: unknown;
  method?: string;
}

/**
 * Installs a fetch stub.
 *
 * Unmatched requests resolve as **404 problem+json** rather than throwing: an
 * unexpected call should exercise the app's not-found handling, not blow up the
 * test with a network error that masks what the component actually did.
 */
export function stubApi(routes: RouteStub[]) {
  const calls: {
    url: string;
    method: string;
    body?: unknown;
    /** Lower-cased, so an assertion cannot pass or fail on header casing. */
    headers: Record<string, string>;
  }[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.replace(/^.*\/v1/, "");

    let parsedBody: unknown;
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    } else if (init?.body) {
      parsedBody = init.body;
    }

    calls.push({ url: path, method, body: parsedBody, headers: lowerCased(init?.headers) });

    const route = routes.find(
      (r) => path.startsWith(r.path) && (!r.method || r.method.toUpperCase() === method),
    );

    if (!route) {
      return jsonResponse(404, {
        type: "about:blank",
        title: "Олдсонгүй",
        status: 404,
        requestId: "test",
      });
    }

    const status = route.status ?? 200;
    return jsonResponse(status, route.body ?? null);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function lowerCased(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;

  if (headers instanceof Headers) {
    headers.forEach((value, key) => (out[key.toLowerCase()] = value));
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key!.toLowerCase()] = value!;
  } else {
    for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  }

  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** A session payload for `/auth/me`. */
export function sessionFor(roles: Role[], userId = "11111111-1111-4111-8111-111111111111") {
  return {
    user: {
      id: userId,
      username: "test",
      lastName: "Тест",
      firstName: "Хэрэглэгч",
      email: null,
      phone: null,
    },
    memberships: roles.map((role, index) => ({
      id: `22222222-2222-4222-8222-00000000000${index}`,
      kindergartenId: "33333333-3333-4333-8333-333333333333",
      role,
    })),
    csrfToken: "test-csrf",
  };
}

/**
 * Drives `components/ui/field.tsx`'s `Select` — a Radix listbox, not a native
 * `<select>`. Radix only mounts `role="option"` elements while the popup is
 * open, so — unlike `userEvent.selectOptions` on a native select — this has
 * to open the trigger first and wait for the option to appear before clicking
 * it, rather than setting the value directly.
 */
export async function selectOption(
  user: UserEvent,
  label: RegExp | string,
  optionName: RegExp | string,
): Promise<void> {
  // `findBy`, not `getBy`: the trigger itself may not exist yet — the form
  // it belongs to can still be behind a loading skeleton.
  await user.click(await screen.findByLabelText(label));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

export function renderWithProviders(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      // No retries in tests: a retried 404 turns a fast assertion into a
      // multi-second wait for the same outcome.
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  /*
   * ★ `ToastProvider` is here, in the same order as `app/providers.tsx`.
   *
   * `useToast` falls back to a no-op outside a provider, so omitting it would
   * not crash — it would silently make every toast assertion unprovable while
   * the tests still passed. Wrapping with the real provider means a test that
   * looks for a confirmation is looking at the component that ships.
   */
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionProvider>
            {/*
              Always present in production — `AppLayout` mounts it unconditionally
              for every authenticated route, before any page-level component ever
              renders (`SelectedChildProvider`, `(app)/layout.tsx`). `myChildIds`
              is `undefined` here rather than a real list: no test asserts on the
              switcher through this generic wrapper, and a page that does
              (`landmarks.test.tsx`, `roles.test.tsx`) wraps itself explicitly with
              real ids where the assertion needs them.
            */}
            <SelectedChildProvider myChildIds={undefined}>{children}</SelectedChildProvider>
          </SessionProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
  }

  return rtlRender(ui, { wrapper: Wrapper });
}
