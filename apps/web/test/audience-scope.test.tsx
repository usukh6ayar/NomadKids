import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import { useState } from "react";
import { AudiencePicker, type Audience } from "@/components/notifications/audience-picker";

/**
 * Who the compose screens let you write to — client, 2026-09-10: "багш зөвхөн
 * өөрийн бүлэгтээ л пост оруулна ... Удирдлага л бүх цэцэрлэг болон бүлэг
 * сонгон судалгаа болон пост оруулж болно."
 *
 * ★ This is a *courtesy*, and the tests say so.
 *
 * The rule is `TenantAccessService.assertCanAddressAudience` and it answers
 * 404 to a teacher who omits the audience whatever this screen drew —
 * `notifications.test.ts` and `surveys.test.ts` carry that. What is asserted
 * here is the thing the server cannot do: stop a teacher writing a whole
 * notice and then being told no.
 *
 * ★★ The default matters as much as the option.
 *
 * `null` — everyone — is this control's initial value, and for a teacher that
 * is now the one audience they may not send. A screen that merely hid the
 * option would open already invalid.
 */

const GROUPS = {
  items: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Дэлбээ бүлэг",
      ageBand: "MIDDLE",
      childCount: 18,
    },
  ],
  page: 1,
  pageSize: 100,
  total: 1,
  totalPages: 1,
};

function stubPicker(roles: Parameters<typeof sessionFor>[0]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: "/groups", body: GROUPS },
    { path: "/children", body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 } },
  ]);
}

/**
 * ★ The harness holds the value, because the picker's own behaviour depends on
 * it being held.
 *
 * A teacher's `null` is corrected to the named shape by an effect inside the
 * component, and the group and child lists render only once that correction
 * has come back in as a prop. A fixed `value={null}` froze the control one
 * step before the thing under test — invisible while a sentence stood in that
 * branch, and the reason these tests could assert only the sentence.
 */
function Harness({ onValue }: { onValue: (next: Audience) => void }) {
  const [value, setValue] = useState<Audience>(null);
  return (
    <AudiencePicker
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
      disabled={false}
    />
  );
}

function Picker({ roles }: { roles: Parameters<typeof sessionFor>[0] }) {
  stubPicker(roles);
  let latest: Audience = null;
  const view = renderWithProviders(<Harness onValue={(next) => (latest = next)} />);
  return { view, read: () => latest };
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

describe("who a notice may be addressed to", () => {
  it("offers an administrator the whole kindergarten", async () => {
    Picker({ roles: ["ADMIN"] });

    // The control itself, not its options: `Select` is a Radix listbox and
    // only mounts `role="option"` while the popup is open.
    expect(await screen.findByLabelText("Хэнд харагдах")).toBeInTheDocument();
  });

  /**
   * ★ The sentence that used to stand in for the select is gone — the client,
   * 2026-09-16, asked for the explanatory lines to be removed. What the
   * teacher gets instead is what they were always going to use: the group
   * list and the child list, open.
   */
  it("does not offer a teacher the whole kindergarten", async () => {
    Picker({ roles: ["TEACHER"] });

    expect(await screen.findByLabelText("Дэлбээ бүлэг")).toBeInTheDocument();
    expect(screen.queryByLabelText("Хэнд харагдах")).not.toBeInTheDocument();
  });

  it("gives the teacher the group and child lists to choose from", async () => {
    Picker({ roles: ["TEACHER"] });

    expect(await screen.findByLabelText("Дэлбээ бүлэг")).toBeInTheDocument();
    expect(screen.getByText(/Тодорхой хүүхэд сонгох/)).toBeInTheDocument();
  });

  it("moves a teacher off the everyone default without being asked", async () => {
    const { read } = Picker({ roles: ["TEACHER"] });

    await screen.findByLabelText("Дэлбээ бүлэг");
    // `null` is "everyone"; the picker corrects itself to the named shape.
    expect(read()).toEqual({ groupIds: [], childIds: [] });
  });

  it("leaves an administrator on the everyone default", async () => {
    const { read } = Picker({ roles: ["ADMIN"] });

    await screen.findByLabelText("Хэнд харагдах");
    expect(read()).toBeNull();
  });
});
