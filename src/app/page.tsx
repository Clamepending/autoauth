import type { Metadata } from "next";

import { getCurrentHumanUser } from "@/lib/human-session";
import { getBaseUrl } from "@/lib/base-url";
import { HomeCommandBox } from "@/app/home-command-box";

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
};

const IMAGE_ICONS: Record<string, { src: string; alt: string }> = {
  amazon: { src: "/amazonlogo.png", alt: "Amazon" },
  grubhub: { src: "/grubhublogo.png", alt: "Grubhub" },
  instacart: { src: "/instacartlogo.jpg", alt: "Instacart" },
  snackpass: { src: "/snackpasslogo.png", alt: "Snackpass" },
  uber: { src: "/uber.svg", alt: "Uber" },
};

const SUPPORTED_ACCOUNTS = [
  { id: "amazon", name: "Amazon" },
  { id: "grubhub", name: "Grubhub" },
  { id: "instacart", name: "Instacart" },
  { id: "uber", name: "Uber" },
  { id: "snackpass", name: "Snackpass" },
  { id: "ebay", name: "eBay" },
  { id: "ubereats", name: "Uber Eats" },
];

export const metadata: Metadata = {
  title: "Let Agents buy things",
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const curlCommand = `curl -s ${getBaseUrl()}/skill.md`;
  const humanUser = await getCurrentHumanUser();

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">OTTOAUTH</div>
        <h1>Let Agents buy things</h1>
        <div className="grid">
          <div className="card">
            <strong>For agents</strong>
            <HomeCommandBox command={curlCommand} />
            <div className="agent-steps">
              <strong>1.</strong> Send the above command to your agent.<br />
              <strong>2.</strong> Sign in and link the agent to your account.<br />
              <strong>3.</strong> Once linked, your agent can start orders for you.
            </div>
          </div>
          <div className="card">
            <strong>For humans</strong>
            <div>Sign in and start orders yourself. Linking an agent is optional.</div>
            <div className="hero-actions" style={{ marginTop: 14 }}>
              <a className="auth-button primary" href={humanUser ? "/dashboard" : "/login"}>
                {humanUser ? "Open Dashboard" : "Human Sign In"}
              </a>
            </div>
          </div>
        </div>
        <div className="supported-accounts">
          <div className="supported-accounts-title">Supported accounts</div>
          <ul className="supported-accounts-list">
            {SUPPORTED_ACCOUNTS.map((account) => {
              const img = IMAGE_ICONS[account.id];
              return (
                <li key={account.id} className="supported-account">
                  <span className={`logo${img ? " logo-img" : ""}`} title={account.name} aria-hidden>
                    {img ? (
                      <img src={img.src} alt="" width={28} height={28} />
                    ) : (
                      SERVICE_ICONS.other
                    )}
                  </span>
                  <span className="supported-account-desc">{account.name}</span>
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
