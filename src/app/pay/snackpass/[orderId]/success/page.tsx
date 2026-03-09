import Link from "next/link";

export default function SnackpassPaySuccessPage() {
  return (
    <main className="pay-page">
      <div className="pay-card">
        <h1>Snackpass coming soon</h1>
        <p className="pay-lede">
          Snackpass is not live yet on this hosted OttoAuth server.
        </p>
        <Link href="/" className="pay-button">
          Back to ottoauth
        </Link>
      </div>
    </main>
  );
}
