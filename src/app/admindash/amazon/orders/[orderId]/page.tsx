import Link from "next/link";
import { getOrderById } from "@/services/amazon/orders";
import { FulfillmentActions } from "./status-form";

type Props = { params: Promise<{ orderId: string }> };

function toUsd(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AmazonAdminOrderPage({ params }: Props) {
  const { orderId } = await params;
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) {
    return (
      <main style={{ padding: 48 }}>
        <h1>Invalid order id</h1>
        <p>
          <Link href="/admindash">Back to admin dashboard</Link>
        </p>
      </main>
    );
  }

  const order = await getOrderById(id);
  if (!order) {
    return (
      <main style={{ padding: 48 }}>
        <h1>Order not found</h1>
        <p>
          <Link href="/admindash">Back to admin dashboard</Link>
        </p>
      </main>
    );
  }

  const itemCents = order.estimated_price_cents;
  const taxCents = order.estimated_tax_cents ?? 0;
  const feeCents = order.processing_fee_cents ?? 0;
  const totalCents = itemCents != null ? itemCents + taxCents + feeCents : null;

  return (
    <main style={{ padding: 48, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Amazon order #{order.id}</h1>
      <p style={{ color: "var(--muted)", marginBottom: 24 }}>
        Review details, then mark as fulfilled or failed.
      </p>

      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--paper)",
          padding: 20,
          marginBottom: 20,
        }}
      >
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "180px 1fr",
            rowGap: 10,
            columnGap: 16,
            margin: 0,
          }}
        >
          <dt style={{ color: "var(--muted)" }}>Status</dt>
          <dd style={{ margin: 0 }}>{order.status}</dd>
          <dt style={{ color: "var(--muted)" }}>Agent</dt>
          <dd style={{ margin: 0 }}>{order.username_lower}</dd>
          <dt style={{ color: "var(--muted)" }}>Product</dt>
          <dd style={{ margin: 0 }}>{order.product_title ?? "Unknown"}</dd>
          <dt style={{ color: "var(--muted)" }}>Item URL</dt>
          <dd style={{ margin: 0 }}>
            <a href={order.item_url} target="_blank" rel="noreferrer">
              {order.item_url}
            </a>
          </dd>
          <dt style={{ color: "var(--muted)" }}>Shipping</dt>
          <dd style={{ margin: 0 }}>{order.shipping_location}</dd>
          <dt style={{ color: "var(--muted)" }}>Estimated total</dt>
          <dd style={{ margin: 0 }}>{toUsd(totalCents) ?? "Unknown"}</dd>
          <dt style={{ color: "var(--muted)" }}>Tracking number</dt>
          <dd style={{ margin: 0 }}>{order.tracking_number ?? "—"}</dd>
          <dt style={{ color: "var(--muted)" }}>Comment</dt>
          <dd style={{ margin: 0 }}>{order.fulfillment_note ?? "—"}</dd>
          <dt style={{ color: "var(--muted)" }}>Updated</dt>
          <dd style={{ margin: 0 }}>{new Date(order.updated_at).toLocaleString()}</dd>
        </dl>
      </div>

      <FulfillmentActions
        orderId={order.id}
        initialTrackingNumber={order.tracking_number ?? ""}
        initialNote={order.fulfillment_note ?? ""}
      />

      <p style={{ marginTop: 20 }}>
        <Link href="/admindash">Back to admin dashboard</Link>
      </p>
    </main>
  );
}
