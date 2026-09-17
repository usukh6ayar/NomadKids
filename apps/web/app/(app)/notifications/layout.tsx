"use client";

import type { ReactNode } from "react";
import { RequireRole } from "@/components/shell/require-role";

/** Class boards and notices belong to teaching staff, management and parents. */
export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return <RequireRole roles={["TEACHER", "ADMIN", "PARENT"]}>{children}</RequireRole>;
}
