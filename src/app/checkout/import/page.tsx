import { CheckoutImportClient } from "./checkout-import-client";

type Props = {
  searchParams?: {
    payload_url?: string;
    payloadUrl?: string;
  };
};

export const dynamic = "force-dynamic";

export default function CheckoutImportPage({ searchParams }: Props) {
  const payloadUrl =
    typeof searchParams?.payload_url === "string"
      ? searchParams.payload_url
      : typeof searchParams?.payloadUrl === "string"
        ? searchParams.payloadUrl
        : "";

  return (
    <main className="checkout-page">
      <section className="checkout-shell">
        <div className="checkout-header">
          <div>
            <p className="eyebrow">OttoAuth Checkout</p>
            <h1>Preparing Order</h1>
          </div>
        </div>
        <section className="dashboard-card checkout-primary-card">
          <div className="dashboard-section-header">
            <div>
              <p className="dashboard-muted">Importing from local app</p>
              <h2 className="dashboard-card-title">Loading checkout details</h2>
            </div>
          </div>
          <CheckoutImportClient payloadUrl={payloadUrl} />
        </section>
      </section>
    </main>
  );
}
