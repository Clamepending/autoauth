import { redirect } from "next/navigation";
import { getHumanCreditBalance } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import { SendMoneyClient } from "./send-money-client";

export const dynamic = "force-dynamic";

function buildReturnTo(params: Record<string, string | string[] | undefined>) {
  const to = typeof params.to === "string" ? params.to : "";
  const search = to ? `?to=${encodeURIComponent(to)}` : "";
  return `/send${search}`;
}

export default async function SendMoneyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(buildReturnTo(params))}`);
  }

  const balanceCents = await getHumanCreditBalance(user.id);
  const initialRecipient =
    typeof params.to === "string" ? params.to.trim() : "";

  return (
    <SendMoneyClient
      user={user}
      balanceCents={balanceCents}
      initialRecipient={initialRecipient}
    />
  );
}
