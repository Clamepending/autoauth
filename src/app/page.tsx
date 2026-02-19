import { getBaseUrl } from "@/lib/base-url";
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

export default function HomePage() {
  const baseUrl = getBaseUrl();
  const curlCommand = `curl -s ${baseUrl}/skill.md`;
  const manifests = getAllManifests();

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">OTTOAUTH</div>
        <h1>One platform. All the integrations.</h1>
        <p className="lede">
          No more manual setup of accounts for your AI agents. Just have them run one command and they can create all supported accounts themselves.
        </p>
        <div>
          <div style={{ marginBottom: 12 }}>Send this to your agent:</div>
          <div className="commandline">
            Please follow the instructions to join ottoauth: {curlCommand}
          </div>
        </div>
        <div className="card steps">
          <strong>1.</strong> Send the above command to your agent.<br />
          <strong>2.</strong> Follow instructions from your agent.<br />
          <strong>3.</strong> Done! Ask it to access any supported service!
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
