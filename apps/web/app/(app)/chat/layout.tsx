"use client";

import type { ReactNode } from "react";
import { RequireRole } from "@/components/shell/require-role";

/** Chat is not part of the cook or accountant workspace. */
export default function ChatLayout({ children }: { children: ReactNode }) {
  return <RequireRole roles={["TEACHER", "ADMIN", "PARENT"]}>{children}</RequireRole>;
}
