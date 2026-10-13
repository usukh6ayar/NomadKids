import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUTER, renderWithProviders, sessionFor, stubApi } from "./support/render";
import LoginPage from "@/app/login/page";
import { RegisteredDevicesCard } from "@/components/settings/registered-devices";
import { describeDevice } from "@/lib/devices";

/*
 * ★ «Бүртгэлтэй төхөөрөмж» — 2026-10-12, the user: every account signs in from
 * at most two devices. The web side is built first against the contract in
 * `lib/devices.ts`; until the API answers, both screens say so.
 */
afterEach(() => vi.unstubAllGlobals());

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const WINDOWS_EDGE = `${WINDOWS_CHROME} Edg/129.0.0.0`;
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const SESSIONS = [
  {
    id: "s-phone",
    userAgent: IPHONE,
    createdAt: "2026-10-01T09:00:00Z",
    lastUsedAt: "2026-10-12T06:20:00Z",
    current: true,
  },
  {
    id: "s-pc",
    userAgent: WINDOWS_CHROME,
    createdAt: "2026-10-05T01:00:00Z",
    lastUsedAt: "2026-10-10T01:05:00Z",
    current: false,
  },
];

describe("describeDevice", () => {
  it("names the system and the browser a person recognises", () => {
    expect(describeDevice(IPHONE)).toEqual({ label: "iPhone · Safari", kind: "phone" });
    expect(describeDevice(WINDOWS_CHROME)).toEqual({
      label: "Windows · Chrome",
      kind: "computer",
    });
    // Edge says «Chrome» too; it must not be read as Chrome.
    expect(describeDevice(WINDOWS_EDGE).label).toBe("Windows · Edge");
    expect(describeDevice(ANDROID_TABLET).kind).toBe("tablet");
    expect(describeDevice(null).label).toBe("Тодорхойгүй төхөөрөмж");
  });
});

describe("«Бүртгэлтэй төхөөрөмж» in the settings", () => {
  it("lists the devices, marks this one, and signs another out after asking", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/sessions/s-pc", method: "DELETE", status: 204 },
      { path: "/auth/sessions", body: { limit: 2, sessions: SESSIONS } },
    ]);
    renderWithProviders(<RegisteredDevicesCard />);

    expect(await screen.findByText("Бүртгэлтэй төхөөрөмж (2/2)")).toBeInTheDocument();
    expect(screen.getByText("iPhone · Safari")).toBeInTheDocument();
    expect(screen.getByText("Энэ төхөөрөмж")).toBeInTheDocument();
    // This device has no «Гаргах»: signing out is the shell menu's.
    expect(screen.getAllByRole("button", { name: /гаргах/ })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Windows · Chrome төхөөрөмжийг гаргах" }));
    const confirm = await screen.findByRole("dialog", { name: "Төхөөрөмжийг гаргах уу?" });
    expect(api.calls.some((call) => call.method === "DELETE")).toBe(false);
    await user.click(within(confirm).getByRole("button", { name: "Гаргах" }));

    await waitFor(() =>
      expect(
        api.calls.find((call) => call.method === "DELETE" && call.url === "/auth/sessions/s-pc"),
      ).toBeTruthy(),
    );
  });

  it("says the list is coming while the API does not answer", async () => {
    stubApi([]);
    renderWithProviders(<RegisteredDevicesCard />);

    expect(await screen.findByText("Төхөөрөмжийн жагсаалт удахгүй нээгдэнэ.")).toBeInTheDocument();
  });
});

describe("signing in on a third device", () => {
  const DEVICE_LIMIT = {
    type: "about:blank",
    title: "Төхөөрөмжийн хязгаар",
    status: 409,
    detail: "Та 2 төхөөрөмжөөс нэвтэрсэн байна. Аль нэгийг нь гаргаад нэвтэрнэ үү.",
    requestId: "test",
    code: "DEVICE_LIMIT",
  };

  async function signIn(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Утасны дугаар эсвэл нэвтрэх нэр/), "99112233");
    await user.type(screen.getByLabelText("Нууц үг *"), "Нууцүг123");
    await user.click(screen.getByRole("button", { name: "Нэвтрэх" }));
  }

  it("lists the signed-in devices and replaces the one chosen", async () => {
    const user = userEvent.setup();
    ROUTER.replace.mockClear();
    stubApi([
      { path: "/auth/me", status: 401 },
      // `/auth/login/devices` before `/auth/login`: stubs match by prefix.
      { path: "/auth/login/devices", method: "POST", body: { sessions: SESSIONS } },
      { path: "/auth/login", method: "POST", status: 409, body: DEVICE_LIMIT },
    ]);
    renderWithProviders(<LoginPage />);
    await signIn(user);

    const choice = await screen.findByRole("button", { name: /Windows · Chrome/ });
    expect(
      // The 409's own sentence — the limit is a server setting.
      screen.getByText("Та 2 төхөөрөмжөөс нэвтэрсэн байна. Аль нэгийг нь гаргаад нэвтэрнэ үү."),
    ).toBeInTheDocument();

    const api = stubApi([
      { path: "/auth/login", method: "POST", body: sessionFor(["TEACHER"]) },
      { path: "/dashboard/primary", body: { dashboard: "teacher" } },
    ]);
    await user.click(choice);

    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/dashboard"));
    expect(api.calls.find((call) => call.url === "/auth/login")?.body).toEqual({
      identifier: "99112233",
      password: "Нууцүг123",
      replaceSessionId: "s-pc",
    });
  });

  it("points at the settings while the device list is not served", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", status: 401 },
      { path: "/auth/login/devices", method: "POST", status: 404, body: null },
      { path: "/auth/login", method: "POST", status: 409, body: DEVICE_LIMIT },
    ]);
    renderWithProviders(<LoginPage />);
    await signIn(user);

    expect(
      await screen.findByText(/«Бүртгэлтэй төхөөрөмж» хэсэгт орж гарна уу/),
    ).toBeInTheDocument();
  });
});
