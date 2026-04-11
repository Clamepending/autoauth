import { getBaseUrl } from "@/lib/base-url";
import { getCurrentHumanUser } from "@/lib/human-session";
import { getAllManifests } from "@/services/registry";

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  ),
  email: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 6-10 7L2 6" />
    </svg>
  ),
  doordash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  ),
  computeruse: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 18v2" />
    </svg>
  ),
  snackpass: null,
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
};

const IMAGE_ICONS: Record<string, { src: string; alt: string }> = {
  amazon: { src: "/amazonlogo.png", alt: "Amazon" },
  snackpass: { src: "/snackpasslogo.png", alt: "Snackpass" },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const baseUrl = getBaseUrl();
  const curlCommand = `curl -s ${baseUrl}/skill.md`;
  const manifests = getAllManifests();
  const humanUser = await getCurrentHumanUser();

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">OTTOAUTH</div>
        <h1>Agents, humans, and fulfillers now share one OttoAuth flow.</h1>
        <p className="lede">
          OttoAuth now lets an OpenClaw-style agent pair with a human, lets humans submit their own browser tasks with a live watch page, and lets claimed extension devices opt into a marketplace to fulfill orders and earn credits.
        </p>
        <div>
          <div style={{ marginBottom: 12 }}>Send this to your agent:</div>
          <div className="commandline">
            Please follow the instructions to join ottoauth: {curlCommand}
          </div>
        </div>
        <div className="card steps">
          <strong>1.</strong> Send the above command to your agent.<br />
          <strong>2.</strong> Let your agent create its OttoAuth account.<br />
          <strong>3.</strong> Sign in as the human, link the pairing key, and claim a browser device.<br />
          <strong>4.</strong> Submit tasks from your agent or directly from OttoAuth, then watch fulfillment live.<br />
          <strong>5.</strong> If you want, enable marketplace fulfillment on your device and earn credits by completing other humans&apos; tasks.
        </div>
        <div className="hero-actions">
          <a className="auth-button primary" href={humanUser ? "/dashboard" : "/login"}>
            {humanUser ? "Open Dashboard" : "Human Sign In"}
          </a>
          <a className="auth-button" href={humanUser ? "/orders/new" : "/login"}>
            {humanUser ? "Submit Human Order" : "See Human Flow"}
          </a>
        </div>
        <div className="grid">
          <div className="card">
            <strong>OpenClaw-ready onboarding</strong>
            Your agent creates an OttoAuth account once, keeps its private key secret, shares a pairing key with the human, and then uses the <code>computeruse</code> service as the default browser-task path.
          </div>
          <div className="card">
            <strong>Human self-serve orders</strong>
            Humans can sign in to OttoAuth and use <code>/orders/new</code> to create their own browser tasks, then follow live low-rate screenshots on each order page while a fulfiller works.
          </div>
          <div className="card">
            <strong>Marketplace fulfillers</strong>
            Claimed extension devices can opt into marketplace fulfillment from the dashboard. When they complete another human&apos;s task, OttoAuth transfers credits to the fulfiller after completion.
          </div>
        </div>
        <div className="supported-accounts">
          <div className="supported-accounts-title">Supported accounts</div>
          <ul className="supported-accounts-list">
            {manifests.map((m) => {
              const img = IMAGE_ICONS[m.id];
              const svg = SERVICE_ICONS[m.id];
              return (
                <li key={m.id} className="supported-account">
                  <span className={`logo${img ? " logo-img" : ""}`} title={m.name} aria-hidden>
                    {img ? (
                      <img src={img.src} alt="" width={28} height={28} />
                    ) : (
                      svg ?? null
                    )}
                  </span>
                  <span className="supported-account-desc">
                    {m.description}
                    {m.status !== "active" && (
                      <> <strong>(Coming Soon)</strong></>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <footer>Powered by Next.js + Turso. No fluff, just auth.</footer>
      </section>
    </main>
  );
}
