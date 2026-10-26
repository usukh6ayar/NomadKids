import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { GroupGuardianInvitations } from "@/components/child/group-guardian-invitations";

/*
 * ★ 2026-10-26: «Бүлгээр урих» called a child whose card was still out
 * «холбогдсон», and answered an empty group «Олдсонгүй.».
 */
afterEach(() => vi.unstubAllGlobals());

const GROUP = "44444444-4444-4444-8444-444444444444";

async function press(body: unknown) {
  const user = userEvent.setup();
  stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/groups/${GROUP}/guardian-invitations`, method: "POST", status: 201, body },
  ]);
  renderWithProviders(
    <GroupGuardianInvitations groupId={GROUP} groupName="Дэлбээ" label="Бүлгээр урих" />,
  );
  await user.click(screen.getByRole("button", { name: "Бүлгээр урих" }));
  await user.click(await screen.findByRole("button", { name: "Урилга үүсгэх" }));
}

describe("«Бүлгээр урих»", () => {
  it("says which children have joined and whose card is still valid", async () => {
    await press({ items: [], skipped: 2, pending: 5, empty: false });
    expect(
      await screen.findByText(
        "2 хүүхдийн эцэг эх бүртгүүлсэн, 5 хүүхдийн урилга хүчинтэй хэвээр тул алгассан.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/хугацаа нь дуусмагц энд дахин урьж болно/)).toBeInTheDocument();
  });

  it("tells a teacher with an empty group to register the children first", async () => {
    await press({ items: [], skipped: 0, pending: 0, empty: true });
    expect(await screen.findByText(/Бүлэгт хүүхэд бүртгэгдээгүй байна/)).toBeInTheDocument();
  });
});
