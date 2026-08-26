import { useMutation, useQueryClient } from "@tanstack/react-query";
import { platformKindergartenSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { Button } from "@/components/ui/button";

/**
 * Suspending or reinstating a tenant.
 *
 * A platform decision, not the kindergarten's own admin's — CLAUDE.md §3.2,
 * §2.3. Deactivating does not delete anything; every record stays, and
 * flipping it back is a second click, not a support ticket.
 *
 * Shared between the platform list (`/platform`) and the per-kindergarten
 * detail view (`/platform/[id]`) — both invalidate the same
 * `["platform", "kindergartens"]` prefix, which covers the list query and
 * `qk.platformKindergarten(id)` alike.
 */
export function ToggleActiveButton({
  kindergarten,
}: {
  kindergarten: { id: string; name: string; isActive: boolean };
}) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: () =>
      mutate(`/platform/kindergartens/${kindergarten.id}`, platformKindergartenSchema, {
        method: "PATCH",
        body: { isActive: !kindergarten.isActive },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "kindergartens"] });
    },
  });

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={toggle.isPending}
      onClick={() => {
        const message = kindergarten.isActive
          ? `${kindergarten.name}-г идэвхгүй болгох уу?\n\nБагш, эцэг эх нэвтрэх боломжгүй болно. Дараа нь дахин идэвхжүүлж болно.`
          : `${kindergarten.name}-г идэвхжүүлэх үү?`;
        if (window.confirm(message)) toggle.mutate();
      }}
    >
      {kindergarten.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
    </Button>
  );
}
