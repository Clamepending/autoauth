import Link from "next/link";
import { getOrderById } from "@/services/amazon/orders";
import { PayButton } from "./pay-button";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orderId: string }> };

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

  const hasPriceEstimate = order.estimated_price_cents != null;

  if (!hasPriceEstimate) {
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

  const priceDisplay = `$${(order.estimated_price_cents! / 100).toFixed(2)}`;

  return (
    <main className="pay-page">
      <div className="pay-card">
        <div className="eyebrow">Amazon order #{order.id}</div>
        <h1>Complete payment</h1>
        <p className="pay-lede">
          Charge: {priceDisplay} (scraped from product page). Pay with card or
          Google Pay via Stripe.
        </p>
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
        <PayButton orderId={order.id} priceDisplay={priceDisplay} />
        <p className="pay-cancel">
          <Link href="/">Cancel and return to ottoauth</Link>
        </p>
      </div>
    </main>
  );
}
