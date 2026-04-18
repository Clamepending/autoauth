import { redirect } from "next/navigation";
import { getCurrentHumanUser } from "@/lib/human-session";
import { MarketNewClient } from "./market-new-client";

export const dynamic = "force-dynamic";

export default async function NewMarketServicePage() {
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect("/login?returnTo=/market/new");
  }
  return <MarketNewClient user={user} />;
}
