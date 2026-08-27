import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";

/**
 * The shared feedback pair — CLAUDE.md §5's "Confirm before delete, toast after
 * save", which the product stated as a rule and implemented nowhere.
 *
 * ★ These test the mechanism, not any one screen. The migrated flows keep their
 * own tests; what is asserted here is that the mechanism is safe to adopt: that
 * it announces, that it does not stack, that it cleans up its timers, and that
 * the dialog cannot fire twice.
 */

/** The live regions carry `aria-live` and no role, so they are found by hook. */
const assertiveRegion = () => document.querySelector<HTMLElement>('[data-toast-region="error"]')!;
const politeRegion = () => document.querySelector<HTMLElement>('[data-toast-region="status"]')!;

function Harness({ label, tone }: { label: string; tone: "success" | "error" | "info" }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast[tone](label)}>
      үзүүлэх {label}
    </button>
  );
}

describe("toast", () => {
  it("shows a success and announces it politely, not as an alert", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness label="Хадгаллаа" tone="success" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Хадгаллаа/ }));

    await screen.findByText("Хадгаллаа");
    // A confirmation must not interrupt what a screen reader is saying.
    expect(within(politeRegion()).getByText("Хадгаллаа")).toBeInTheDocument();
    expect(within(assertiveRegion()).queryByText("Хадгаллаа")).toBeNull();
    // ★ And it must not add a permanent landmark to every page — see the note
    // in `toast.tsx`. The regions carry `aria-live`, never a role.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  /**
   * ★ Errors go in the assertive region and successes in the polite one.
   *
   * One region with a changing `aria-live` is read at the politeness it had
   * when the reader first saw it, so the two are separate nodes that both exist
   * from mount.
   */
  it("puts an error in the assertive region", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness label="Алдаа гарлаа" tone="error" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Алдаа/ }));

    await screen.findByText("Алдаа гарлаа");
    expect(within(assertiveRegion()).getByText("Алдаа гарлаа")).toBeInTheDocument();
    expect(within(politeRegion()).queryByText("Алдаа гарлаа")).toBeNull();
  });

  it("renders all three tones", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness label="Амжилттай" tone="success" />
        <Harness label="Бүтсэнгүй" tone="error" />
        <Harness label="Мэдээлэл" tone="info" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Амжилттай/ }));
    await user.click(screen.getByRole("button", { name: /Бүтсэнгүй/ }));
    await user.click(screen.getByRole("button", { name: /Мэдээлэл/ }));

    expect(await screen.findByText("Амжилттай")).toBeInTheDocument();
    expect(screen.getByText("Бүтсэнгүй")).toBeInTheDocument();
    expect(screen.getByText("Мэдээлэл")).toBeInTheDocument();
  });

  /**
   * ★★ The spam guard.
   *
   * A double-clicked save, or an `onSuccess` that runs once per item in a loop,
   * would otherwise stack four identical cards down the corner of the screen.
   */
  it("does not stack the same message twice", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness label="Хадгаллаа" tone="success" />
      </ToastProvider>,
    );

    const trigger = screen.getByRole("button", { name: /Хадгаллаа/ });
    await user.click(trigger);
    await user.click(trigger);
    await user.click(trigger);

    await waitFor(() => expect(screen.getAllByText("Хадгаллаа")).toHaveLength(1));
  });

  it("can be dismissed by hand before it expires", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness label="Хадгаллаа" tone="success" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Хадгаллаа/ }));
    await screen.findByText("Хадгаллаа");

    await user.click(screen.getByRole("button", { name: "Хаах" }));
    await waitFor(() => expect(screen.queryByText("Хадгаллаа")).toBeNull());
  });

  it("does not cover the page — the strip ignores pointer events", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness label="Хадгаллаа" tone="success" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Хадгаллаа/ }));
    const card = (await screen.findByText("Хадгаллаа")).closest("div")!;

    // The card itself is clickable; the full-width strip behind it is not.
    expect(card.className).toContain("pointer-events-auto");
    expect(card.parentElement!.parentElement!.className).toContain("pointer-events-none");
  });
});

describe("toast auto-dismiss", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("clears a success after its lifetime, and keeps an error for longer", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Harness label="Хадгаллаа" tone="success" />
        <Harness label="Алдаа гарлаа" tone="error" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Хадгаллаа/ }));
    await user.click(screen.getByRole("button", { name: /Алдаа/ }));
    expect(await screen.findByText("Хадгаллаа")).toBeInTheDocument();

    // Past the success lifetime (4s) but inside the error's (9s).
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Хадгаллаа")).toBeNull();
    expect(screen.getByText("Алдаа гарлаа")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Алдаа гарлаа")).toBeNull();
  });
});

describe("confirm dialog", () => {
  function Subject({ pending = false, onConfirm = () => {} }) {
    return (
      <ConfirmDialog
        title="Архивлах"
        description="Ану-г архивлах уу?"
        confirmLabel="Архивлах"
        pendingLabel="Архивлаж байна…"
        tone="danger"
        pending={pending}
        onConfirm={onConfirm}
        trigger={<Button>Архивлах</Button>}
      />
    );
  }

  it("stays closed until the trigger is pressed", () => {
    render(<Subject />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names what will happen, and does not act on open", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Subject onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Архивлах" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Ану-г архивлах уу?")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancelling closes it and does nothing", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Subject onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Архивлах" }));
    await user.click(await screen.findByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /** Escape is the keyboard's cancel, and Radix wires it for us — pinned so a
   *  future hand-rolled replacement cannot quietly lose it. */
  it("closes on Escape without acting", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Subject onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Архивлах" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirming calls the action exactly once", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Subject onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Архивлах" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Архивлах" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  /**
   * ★ The pending state is what stops a double submit.
   *
   * The dialog deliberately stays open while the request runs — closing it
   * would hide the only thing saying the work has started.
   */
  it("disables both buttons while the action is pending", async () => {
    const user = userEvent.setup();
    render(<Subject pending />);

    await user.click(screen.getByRole("button", { name: "Архивлах" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("button", { name: "Архивлаж байна…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Болих" })).toBeDisabled();
  });

  /**
   * ★ Regression: the dialog must close even when the action never renders a
   * pending state.
   *
   * The first version closed on a true → false edge of `pending`. A mutation
   * that resolves inside one commit — a fast local API, a cached response —
   * never produces that edge, so the dialog stayed open over a finished action.
   * It failed silently, and worse than it looks: `aria-modal` hides the rest of
   * the page from the accessibility tree, so the caller's own inline error was
   * rendered and unreachable.
   */
  it("closes after an action that is never observably pending", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    // `pending` is never true — the synchronous case.
    render(<Subject pending={false} onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Архивлах" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Архивлах" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("moves focus into the dialog so the keyboard is not left behind", async () => {
    const user = userEvent.setup();
    render(<Subject />);

    await user.click(screen.getByRole("button", { name: "Архивлах" }));
    const dialog = await screen.findByRole("dialog");

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });
});
