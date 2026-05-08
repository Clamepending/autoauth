import type { ReactNode } from "react";

import { requireAdminPageAccess } from "@/lib/admin-auth";

export default async function AdminDashLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdminPageAccess("/admindash");
  return children;
}
