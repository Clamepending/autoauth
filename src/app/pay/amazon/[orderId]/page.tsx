import Link from "next/link";
import { getAmazonOrderById } from "@/lib/db";
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

  const order = await getAmazonOrderById(id);
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

  return (
    <main className="pay-page">
      <div className="pay-card">
        <div className="eyebrow">Amazon order #{order.id}</div>
        <h1>Complete payment</h1>
        <p className="pay-lede">Placeholder charge: $100. Pay with card or Google Pay via Stripe.</p>
        <dl className="pay-details">
          <dt>Item</dt>
          <dd>
            <a href={order.item_url} target="_blank" rel="noopener noreferrer" className="pay-link">
              {order.item_url}
            </a>
          </dd>
          <dt>Shipping</dt>
          <dd>{order.shipping_location}</dd>
        </dl>
        <PayButton orderId={order.id} />
        <p className="pay-cancel">
          <Link href="/">Cancel and return to ottoauth</Link>
        </p>
      </div>
    </main>
  );
}
