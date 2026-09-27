import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ADMINISTRATION_TAG } from "@/lib/administration-surveys";

/** "Цэцэрлэг" — marks a survey the administration asked, not a teacher. */
export function AdministrationTag({ className }: { className?: string }) {
  return (
    <Badge tone="sun" className={cn("shrink-0", className)}>
      {ADMINISTRATION_TAG}
    </Badge>
  );
}
