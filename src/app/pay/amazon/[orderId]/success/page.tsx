import Link from "next/link";

export default function AmazonPaySuccessPage() {
  return (
    <main className="pay-page">
      <div className="pay-card">
        <h1>Payment received</h1>
        <p className="pay-lede">Thank you. Your placeholder payment was successful. Order status will be updated manually (e.g. with tracking) as the order is fulfilled.</p>
        <Link href="/" className="pay-button">
          Back to ottoauth
        </Link>
      </div>
    </main>
  );
}
