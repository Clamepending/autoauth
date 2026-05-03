import type { Metadata } from "next";

import { getCurrentHumanUser } from "@/lib/human-session";
import { getBaseUrl } from "@/lib/base-url";
import { HomeCommandBox } from "@/app/home-command-box";
import { TweetEmbed } from "@/app/tweet-embed";

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
  ebay: { src: "/ebaylogo.png", alt: "eBay" },
  grubhub: { src: "/grubhublogo.png", alt: "Grubhub" },
  instacart: { src: "/instacartlogo.jpg", alt: "Instacart" },
  snackpass: { src: "/snackpasslogo.png", alt: "Snackpass" },
  uber: { src: "/uber.svg", alt: "Uber" },
  ubereats: { src: "/ubereatslogo.png", alt: "Uber Eats" },
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
  const curlCommand = `curl -s ${getBaseUrl()}/llms.txt`;
  const humanUser = await getCurrentHumanUser();
  const socialPosts = [
    {
      id: "first-boba",
      html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">First boba ordered by my agent! <a href="https://t.co/jzQI4xOp0a">pic.twitter.com/jzQI4xOp0a</a></p>&mdash; Mark (@clamepending) <a href="https://twitter.com/clamepending/status/2043109349967667560?ref_src=twsrc%5Etfw">April 11, 2026</a></blockquote>',
    },
    {
      id: "agent-order",
      html: '<blockquote class="twitter-tweet"><a href="https://twitter.com/clamepending/status/2049012594481168843?ref_src=twsrc%5Etfw"></a></blockquote>',
    },
  ];

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">OTTOAUTH</div>
        <h1>Let Agents buy things</h1>
        <p className="lede">
          One API. Any store.
        </p>
        <div className="grid">
          <div className="card">
            <strong>For agents</strong>
            <HomeCommandBox command={curlCommand} />
            <div className="agent-steps">
              <strong>1.</strong> Send the above command to your agent.<br />
              <strong>2.</strong> Sign in and generate dashboard API keys.<br />
              <strong>3.</strong> Send the keys to your agent so it can start orders.
            </div>
          </div>
          <div className="card">
            <strong>For humans</strong>
            <div>Link your agent and deposit money</div>
            <div className="hero-actions" style={{ marginTop: 14 }}>
              <a className="auth-button primary" href={humanUser ? "/dashboard" : "/login"}>
                {humanUser ? "Open Dashboard" : "Human Sign In"}
              </a>
            </div>
          </div>
          <div className="card">
            <strong>For developers</strong>
            <div>Read the docs, copy the examples, and connect your AI agent to the general order API.</div>
            <div className="hero-actions" style={{ marginTop: 14 }}>
              <a className="auth-button primary" href="/docs">
                Developer Docs
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
        <div className="homepage-social">
          <div className="homepage-social-title">From X</div>
          <div className="homepage-social-grid">
            {socialPosts.map((post) => (
              <TweetEmbed key={post.id} html={post.html} />
            ))}
          </div>
        </div>
        <footer>Powered by Next.js + Turso. No fluff, just auth.</footer>
      </section>
    </main>
  );
}
