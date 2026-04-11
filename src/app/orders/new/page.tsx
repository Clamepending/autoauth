import { redirect } from "next/navigation";
import { NewOrderClient } from "./new-order-client";
import { getCurrentHumanUser } from "@/lib/human-session";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect("/login");
  }

  return <NewOrderClient />;
}
