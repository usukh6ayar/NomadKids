import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallAppCard } from "@/components/public/install-app";
import { detectPlatform } from "@/lib/install-app";

/**
 * «NomadKids-ийг утсандаа суулгах». An iPhone has no install API, so it gets
 * the Safari steps; Chrome on Android hands over its own install sheet, so it
 * gets a button that opens it.
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";

function asUserAgent(ua: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36";

describe("install card", () => {
  it("tells platforms apart, including an iPad that calls itself a Mac", () => {
    expect(detectPlatform(IPHONE)).toBe("ios");
    expect(detectPlatform(ANDROID)).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("other");
  });

  it("opens on an iPhone with the Safari steps already showing", async () => {
    asUserAgent(IPHONE);
    render(<InstallAppCard />);

    await userEvent.click(await screen.findByRole("button", { name: /утсандаа суулгах/ }));

    expect(screen.getByRole("tab", { name: /iPhone/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Add to Home Screen")).toBeInTheDocument();
    // No install API on iOS, so no button pretending there is one.
    expect(screen.queryByRole("button", { name: "Одоо суулгах" })).toBeNull();
  });

  it("on Android, hands over to Chrome's own install sheet", async () => {
    asUserAgent(ANDROID);
    render(<InstallAppCard />);

    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });

    await userEvent.click(await screen.findByRole("button", { name: /утсандаа суулгах/ }));
    await userEvent.click(screen.getByRole("button", { name: "Одоо суулгах" }));

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("is not offered when the site already runs from the home screen", async () => {
    asUserAgent(IPHONE);
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) => ({ matches: query === "(display-mode: standalone)" }) as MediaQueryList,
    );
    render(<InstallAppCard />);

    await act(async () => {});
    expect(screen.queryByRole("button", { name: /утсандаа суулгах/ })).toBeNull();
  });

  /*
    ★ 2026-10-08, the client: a phone only, the first visit only, × to put it
    away, and never once installed (the test above).
  */
  it("is not offered on a computer", async () => {
    asUserAgent(DESKTOP);
    render(<InstallAppCard />);

    await act(async () => {});
    expect(screen.queryByRole("button", { name: /утсандаа суулгах/ })).toBeNull();
  });

  it("goes for good when × is pressed", async () => {
    asUserAgent(IPHONE);
    const first = render(<InstallAppCard />);

    await userEvent.click(await screen.findByRole("button", { name: "Суулгах санал хаах" }));
    expect(screen.queryByRole("button", { name: /утсандаа суулгах/ })).toBeNull();

    first.unmount();
    render(<InstallAppCard />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /утсандаа суулгах/ })).toBeNull();
  });

  it("shows on the first visit only", async () => {
    asUserAgent(IPHONE);
    const first = render(<InstallAppCard />);
    expect(await screen.findByRole("button", { name: /утсандаа суулгах/ })).toBeInTheDocument();
    first.unmount();

    // The same visit: still offered.
    const again = render(<InstallAppCard />);
    expect(await screen.findByRole("button", { name: /утсандаа суулгах/ })).toBeInTheDocument();
    again.unmount();

    // A later visit: not.
    window.localStorage.setItem(
      "nomadkids:install-card:first-seen",
      String(Date.now() - 2 * 60 * 60_000),
    );
    render(<InstallAppCard />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /утсандаа суулгах/ })).toBeNull();
  });
});
