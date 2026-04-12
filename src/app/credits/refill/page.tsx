import { redirect } from "next/navigation";
import { getHumanCreditBalance } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import { isStripeConfigured } from "@/lib/stripe";
import { RefillClient } from "./refill-client";

export const dynamic = "force-dynamic";

export default async function CreditsRefillPage() {
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect("/login");
  }

  const balanceCents = await getHumanCreditBalance(user.id);

  return (
    <RefillClient
      currentBalanceCents={balanceCents}
      stripeConfigured={isStripeConfigured()}
    />
  );
}
