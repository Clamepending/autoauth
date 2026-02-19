import Link from "next/link";
import { getOrderById } from "@/services/amazon/orders";
import { PayButton } from "./pay-button";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orderId: string }> };

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AmazonPayPage({ params }: Props) {
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

  const order = await getOrderById(id);
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

  if (order.estimated_price_cents == null) {
    return (
      <main className="pay-page">
        <div className="pay-card">
          <div className="eyebrow">Amazon order #{order.id}</div>
          <h1>Price unavailable</h1>
          <p className="pay-lede">
            The price for this item could not be automatically determined from
            the product page. A human operator needs to review this order and
            set the price manually.
          </p>
          <dl className="pay-details">
            <dt>Item</dt>
            <dd>
              <a
                href={order.item_url}
                target="_blank"
                rel="noopener noreferrer"
                className="pay-link"
              >
                {order.item_url}
              </a>
            </dd>
            <dt>Shipping</dt>
            <dd>{order.shipping_location}</dd>
            <dt>Status</dt>
            <dd>{order.status} — awaiting manual price review</dd>
          </dl>
          <p className="pay-cancel">
            <Link href="/">Back to ottoauth</Link>
          </p>
        </div>
      </main>
    );
  }

  const itemCents = order.estimated_price_cents;
  const taxCents = order.estimated_tax_cents ?? 0;
  const feeCents = order.processing_fee_cents ?? 0;
  const totalCents = itemCents + taxCents + feeCents;

  return (
    <main className="pay-page">
      <div className="pay-card">
        <div className="eyebrow">Amazon order #{order.id}</div>
        <h1>Complete payment</h1>
        {order.product_title && (
          <p className="pay-product-title">{order.product_title}</p>
        )}
        <dl className="pay-details">
          <dt>Item</dt>
          <dd>
            <a
              href={order.item_url}
              target="_blank"
              rel="noopener noreferrer"
              className="pay-link"
            >
              {order.item_url}
            </a>
          </dd>
          <dt>Shipping</dt>
          <dd>{order.shipping_location}</dd>
        </dl>
        <div className="pay-breakdown">
          <div className="pay-breakdown-row">
            <span>Item price</span>
            <span>{fmt(itemCents)}</span>
          </div>
          {taxCents > 0 && (
            <div className="pay-breakdown-row">
              <span>Est. tax{order.tax_state ? ` (${order.tax_state})` : ""}</span>
              <span>{fmt(taxCents)}</span>
            </div>
          )}
          {feeCents > 0 && (
            <div className="pay-breakdown-row pay-breakdown-fee">
              <span>Processing fee</span>
              <span>{fmt(feeCents)}</span>
            </div>
          )}
          <div className="pay-breakdown-row pay-breakdown-total">
            <span>Total</span>
            <span>{fmt(totalCents)}</span>
          </div>
        </div>
        <p className="pay-fee-note">
          ottoauth does not profit from this transaction. The processing fee
          covers the Stripe payment processing cost (2.9% + $0.30) so
          the exact item price + tax reaches Amazon. You can verify the math:
          {" "}{fmt(totalCents)} &minus; ({fmt(totalCents)} &times; 2.9% + $0.30)
          = {fmt(itemCents + taxCents)}.
        </p>
        <PayButton orderId={order.id} priceDisplay={fmt(totalCents)} />
        <p className="pay-cancel">
          <Link href="/">Cancel and return to ottoauth</Link>
        </p>
      </div>
    </main>
  );
}
