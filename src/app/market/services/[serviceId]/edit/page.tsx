import { notFound, redirect } from "next/navigation";
import { getCurrentHumanUser } from "@/lib/human-session";
import { getMarketServiceById } from "@/lib/market-services";
import { MarketServiceEditClient } from "./market-service-edit-client";

export const dynamic = "force-dynamic";

type Props = {
  params: {
    serviceId: string;
  };
};

export default async function EditMarketServicePage({ params }: Props) {
  const serviceId = Number(params.serviceId);
  if (!Number.isInteger(serviceId) || serviceId <= 0) notFound();

  const user = await getCurrentHumanUser();
  if (!user) {
    redirect(`/login?returnTo=/market/services/${serviceId}/edit`);
  }

  const service = await getMarketServiceById(serviceId);
  if (!service || service.owner_human_user_id !== user.id) notFound();

  return <MarketServiceEditClient service={service} user={user} />;
}
