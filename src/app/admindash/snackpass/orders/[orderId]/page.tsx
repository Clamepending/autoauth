import Link from "next/link";
import { getSnackpassOrderById } from "@/services/snackpass/orders";
import { FulfillmentActions } from "./status-form";

function toUsd(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

type Props = { params: Promise<{ orderId: string }> };

export default async function SnackpassAdminOrderPage({ params }: Props) {
  const { orderId } = await params;
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) {
    return (
      <main style={{ padding: 48 }}>
        <h1>Invalid order id</h1>
        <p>
          <Link href="/admindash/snackpass">Back to Snackpass admin</Link>
        </p>
      </main>
    );
  }

  const order = await getSnackpassOrderById(id);
  if (!order) {
    return (
      <main style={{ padding: 48 }}>
        <h1>Order not found</h1>
        <p>
          <Link href="/admindash/snackpass">Back to Snackpass admin</Link>
        </p>
      </main>
    );
  }

  const taxCents = order.estimated_tax_cents ?? 0;
  const feeCents = order.processing_fee_cents ?? 0;
  const tipCents = order.tip_cents ?? 0;
  const serviceFee = order.service_fee_cents ?? 0;
  const deliveryFee = order.delivery_fee_cents ?? 0;
  const subtotal = order.estimated_price_cents + serviceFee + deliveryFee;
  const totalCents = subtotal + taxCents + feeCents + tipCents;

  return (
    <main
      style={{
        padding: "48px 24px",
        maxWidth: 1000,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
        display: "block",
        overflow: "visible",
        position: "relative",
        zIndex: 1,
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Snackpass order #{order.id}</h1>
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
          <dt style={{ color: "var(--muted)" }}>Dish</dt>
          <dd style={{ margin: 0 }}>{order.dish_name}</dd>
          <dt style={{ color: "var(--muted)" }}>Restaurant</dt>
          <dd style={{ margin: 0 }}>{order.restaurant_name}</dd>
          <dt style={{ color: "var(--muted)" }}>Order type</dt>
          <dd style={{ margin: 0 }}>{order.order_type}</dd>
          <dt style={{ color: "var(--muted)" }}>Pickup/Delivery</dt>
          <dd style={{ margin: 0 }}>{order.shipping_location}</dd>
          {order.delivery_instructions && (
            <>
              <dt style={{ color: "var(--muted)" }}>Delivery notes</dt>
              <dd style={{ margin: 0 }}>{order.delivery_instructions}</dd>
            </>
          )}
          <dt style={{ color: "var(--muted)" }}>Estimated total</dt>
          <dd style={{ margin: 0 }}>{toUsd(totalCents) ?? "Unknown"}</dd>
          <dt style={{ color: "var(--muted)" }}>Tip</dt>
          <dd style={{ margin: 0 }}>{tipCents ? toUsd(tipCents) : "—"}</dd>
          <dt style={{ color: "var(--muted)" }}>Comment</dt>
          <dd style={{ margin: 0 }}>{order.fulfillment_note ?? "—"}</dd>
          <dt style={{ color: "var(--muted)" }}>Updated</dt>
          <dd style={{ margin: 0 }}>{new Date(order.updated_at).toLocaleString()}</dd>
        </dl>
      </div>

      <FulfillmentActions
        orderId={order.id}
        initialNote={order.fulfillment_note ?? ""}
      />

      <p style={{ marginTop: 20 }}>
        <Link href="/admindash/snackpass">Back to Snackpass admin</Link>
      </p>
    </main>
  );
}
