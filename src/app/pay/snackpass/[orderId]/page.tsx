import Link from "next/link";
import { getSnackpassOrderById } from "@/services/snackpass/orders";
import { PayButton } from "./pay-button";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orderId: string }> };

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function SnackpassPayPage({ params }: Props) {
  const { orderId } = await params;
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) {
    return (
      <main className="pay-page">
        <div className="pay-card">
          <h1>Invalid order</h1>
          <p>This payment link is invalid.</p>
          <Link href="/">Back to ottoauth</Link>
        </div>
      </main>
    );
  }

  const order = await getSnackpassOrderById(id);
  if (!order) {
    return (
      <main className="pay-page">
        <div className="pay-card">
          <h1>Order not found</h1>
          <p>This order does not exist or has been removed.</p>
          <Link href="/">Back to ottoauth</Link>
        </div>
      </main>
    );
  }

  const baseCents = order.estimated_price_cents;
  const taxCents = order.estimated_tax_cents ?? 0;
  const serviceFee = order.service_fee_cents ?? 0;
  const deliveryFee = order.delivery_fee_cents ?? 0;
  const tipCents = order.tip_cents ?? 0;
  const processingFee = order.processing_fee_cents ?? 0;
  const subtotal = baseCents + serviceFee + deliveryFee;
  const totalCents = subtotal + taxCents + tipCents + processingFee;

  return (
    <main className="pay-page">
      <div className="pay-card">
        <div className="eyebrow">Snackpass order #{order.id}</div>
        <h1>Complete payment</h1>
        <p className="pay-product-title">{order.dish_name}</p>
        <dl className="pay-details">
          <dt>Restaurant</dt>
          <dd>{order.restaurant_name}</dd>
          <dt>Order type</dt>
          <dd>{order.order_type}</dd>
          <dt>Pickup/Delivery</dt>
          <dd>{order.shipping_location}</dd>
          {order.delivery_instructions && (
            <>
              <dt>Delivery notes</dt>
              <dd>{order.delivery_instructions}</dd>
            </>
          )}
        </dl>
        <div className="pay-breakdown">
          <div className="pay-breakdown-row">
            <span>Item price</span>
            <span>{fmt(baseCents)}</span>
          </div>
          {serviceFee > 0 && (
            <div className="pay-breakdown-row">
              <span>Service fee</span>
              <span>{fmt(serviceFee)}</span>
            </div>
          )}
          {deliveryFee > 0 && (
            <div className="pay-breakdown-row">
              <span>Delivery fee</span>
              <span>{fmt(deliveryFee)}</span>
            </div>
          )}
          {taxCents > 0 && (
            <div className="pay-breakdown-row">
              <span>Est. tax{order.tax_state ? ` (${order.tax_state})` : ""}</span>
              <span>{fmt(taxCents)}</span>
            </div>
          )}
          {tipCents > 0 && (
            <div className="pay-breakdown-row">
              <span>Tip</span>
              <span>{fmt(tipCents)}</span>
            </div>
          )}
          {processingFee > 0 && (
            <div className="pay-breakdown-row pay-breakdown-fee">
              <span>Processing fee</span>
              <span>{fmt(processingFee)}</span>
            </div>
          )}
          <div className="pay-breakdown-row pay-breakdown-total">
            <span>Total</span>
            <span>{fmt(totalCents)}</span>
          </div>
        </div>
        <p className="pay-fee-note">
          ottoauth does not profit from this transaction. The processing fee
          covers the Stripe payment processing cost (2.9% + $0.30).
        </p>
        <PayButton orderId={order.id} priceDisplay={fmt(totalCents)} />
        <p className="pay-cancel">
          <Link href="/">Cancel and return to ottoauth</Link>
        </p>
      </div>
    </main>
  );
}
