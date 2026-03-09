import Link from "next/link";

export const dynamic = "force-dynamic";

export default function SnackpassPayPage() {
  return (
    <main className="pay-page">
      <div className="pay-card">
        <h1>Snackpass coming soon</h1>
        <p className="pay-lede">
          Snackpass payments are not available yet on this hosted OttoAuth server.
        </p>
        <p>
          Amazon is currently available for live purchases.
        </p>
        <Link href="/" className="pay-button">
          Back to ottoauth
        </Link>
      </div>
    </main>
  );
}
