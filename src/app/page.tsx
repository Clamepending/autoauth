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

const AGENT_LOGOS: Record<string, React.ReactNode> = {
  codex: (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3.8 26.6 9.9v12.2L16 28.2 5.4 22.1V9.9L16 3.8Z" />
      <path d="m16 9.4 5.9 3.4v6.4L16 22.6l-5.9-3.4v-6.4L16 9.4Z" />
      <path d="M10.1 12.8 5.4 9.9" />
      <path d="M21.9 12.8 26.6 9.9" />
      <path d="M16 22.6v5.6" />
    </svg>
  ),
  "claude-code": (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="16" cy="16" r="2.5" fill="currentColor" stroke="none" />
      <path d="M16 4.5v7" />
      <path d="M16 20.5v7" />
      <path d="M4.5 16h7" />
      <path d="M20.5 16h7" />
      <path d="m7.8 7.8 5 5" />
      <path d="m19.2 19.2 5 5" />
      <path d="m24.2 7.8-5 5" />
      <path d="m12.8 19.2-5 5" />
    </svg>
  ),
  openclaw: (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.4 25.8c1.5-4 4-6 7.6-6s6.1 2 7.6 6" />
      <path d="M10.5 20.8 8.2 11c-.2-.9.7-1.5 1.4-.9l5.2 4.5" />
      <path d="M16 19.8 14.9 7.3c-.1-.9 1-1.4 1.6-.8l4.8 5.7" />
      <path d="m21.5 20.8 2.3-9.8c.2-.9-.7-1.5-1.4-.9l-5.2 4.5" />
      <path d="M12.3 25.7h7.4" />
    </svg>
  ),
  "ml-intern": (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 24V8l6.2 8.7L18 8v16" />
      <path d="M22 8v16h5" />
      <path d="M8 6.5h16" />
      <path d="m16 3.8 7.6 2.7L16 9.2 8.4 6.5 16 3.8Z" />
    </svg>
  ),
  hermes: (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 5v22" />
      <path d="M10 10h12" />
      <path d="M10 22h12" />
      <path d="M15.5 12c-3.9-2.7-7.3-3.2-10.2-1.5 1.3 3.1 4.3 4.7 9.1 4.7" />
      <path d="M16.5 12c3.9-2.7 7.3-3.2 10.2-1.5-1.3 3.1-4.3 4.7-9.1 4.7" />
    </svg>
  ),
  "custom-agent": (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="7" width="22" height="18" />
      <path d="m10 14 4 3-4 3" />
      <path d="M17 20h5" />
      <path d="M12 4v3" />
      <path d="M20 4v3" />
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

const SUPPORTED_AGENTS = [
  { id: "codex", name: "Codex" },
  { id: "claude-code", name: "Claude Code" },
  { id: "openclaw", name: "OpenClaw" },
  { id: "ml-intern", name: "ML Intern" },
  { id: "hermes", name: "Hermes" },
  { id: "custom-agent", name: "Your custom agent" },
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
        <div className="supported-agents">
          <div className="supported-accounts-title">Supported agents</div>
          <ul className="supported-agents-list">
            {SUPPORTED_AGENTS.map((agent) => (
              <li key={agent.id} className="supported-agent">
                <span className="supported-agent-logo" title={agent.name} aria-hidden>
                  {AGENT_LOGOS[agent.id]}
                </span>
                <span className="supported-agent-name">{agent.name}</span>
              </li>
            ))}
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
