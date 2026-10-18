import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * «Шинэ хувилбар гарлаа» — 2026-10-18, the client: a phone's installed app
 * kept the code it first loaded, and nothing told it a deploy had happened.
 */
async function renderWith(serverBuild: string) {
  vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "build-a");
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ build: serverBuild }), { status: 200 })),
  );
  const { UpdateBanner } = await import("@/components/shell/update-banner");
  render(<UpdateBanner />);
}

describe("the update banner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("offers the new build when the server runs another one", async () => {
    await renderWith("build-b");

    expect(await screen.findByText("Шинэ хувилбар гарлаа.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Шинэчлэх" })).toBeInTheDocument();
  });

  it("says nothing while the page is the server's own build", async () => {
    await renderWith("build-a");

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/version", expect.anything()),
    );
    expect(screen.queryByText("Шинэ хувилбар гарлаа.")).toBeNull();
  });
});
