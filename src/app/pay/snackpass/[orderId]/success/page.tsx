import Link from "next/link";

export default function SnackpassPaySuccessPage() {
  return (
    <main className="pay-page">
      <div className="pay-card">
        <h1>Payment received</h1>
        <p className="pay-lede">
          Thank you. Your Snackpass order payment was successful. A human operator will place the order and update the status.
        </p>
        <Link href="/" className="pay-button">
          Back to ottoauth
        </Link>
      </div>
    </main>
  );
}
