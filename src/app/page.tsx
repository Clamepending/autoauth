import type { Metadata } from "next";

import { getCurrentHumanUser } from "@/lib/human-session";
import { getFeaturedPlatforms } from "@/lib/platform-catalog";
import { TweetEmbed } from "@/app/tweet-embed";

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
};

const AGENT_LOGO_IMAGES: Record<string, { src: string; alt: string }> = {
  codex: { src: "/agent-codex.svg", alt: "OpenAI" },
  "claude-code": { src: "/agent-claude.svg", alt: "Claude" },
  openclaw: { src: "/agent-openclaw.svg", alt: "OpenClaw" },
  "ml-intern": { src: "/agent-ml-intern.svg", alt: "Hugging Face" },
  hermes: { src: "/agent-hermes.png", alt: "Hermes" },
};

const CUSTOM_AGENT_LOGO = (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="7" width="22" height="18" />
    <path d="m10 14 4 3-4 3" />
    <path d="M17 20h5" />
    <path d="M12 4v3" />
    <path d="M20 4v3" />
  </svg>
);

const IMAGE_ICONS: Record<string, { src: string; alt: string }> = {
  amazon: { src: "/amazonlogo.png", alt: "Amazon" },
  ebay: { src: "/ebaylogo.png", alt: "eBay" },
  grubhub: { src: "/grubhublogo.png", alt: "Grubhub" },
  instacart: { src: "/instacartlogo.jpg", alt: "Instacart" },
  snackpass: { src: "/snackpasslogo.png", alt: "Snackpass" },
  uber_eats: { src: "/ubereatslogo.png", alt: "Uber Eats" },
};

const HIDDEN_HOMEPAGE_PLATFORM_IDS = new Set(["uber", "lyft"]);

const SUPPORTED_AGENTS = [
  { id: "codex", name: "Codex" },
  { id: "claude-code", name: "Claude Code" },
  { id: "openclaw", name: "OpenClaw" },
  { id: "ml-intern", name: "ML Intern" },
  { id: "hermes", name: "Hermes" },
  { id: "custom-agent", name: "Your custom agent" },
];

export const metadata: Metadata = {
  title: "Let Agents Buy Things",
};

export const dynamic = "force-dynamic";

function platformHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function platformLogoSrc(platform: { id: string; url: string }) {
  const local = IMAGE_ICONS[platform.id];
  if (local) return local.src;
  const host = platformHost(platform.url);
  return host
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
    : null;
}

export default async function HomePage() {
  const humanUser = await getCurrentHumanUser();
  const featuredPlatforms = getFeaturedPlatforms(50).filter(
    (platform) => !HIDDEN_HOMEPAGE_PLATFORM_IDS.has(platform.id),
  );
  const carouselPlatforms = featuredPlatforms.slice(0, 32);
  const carouselSplitIndex = Math.ceil(carouselPlatforms.length / 2);
  const platformCarouselRows = [
    carouselPlatforms.slice(0, carouselSplitIndex),
    carouselPlatforms.slice(carouselSplitIndex),
  ];
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
        <h1>Let Agents Buy Things</h1>
        <p className="lede">One API to buy anything</p>
        <div className="hero-actions hero-primary-actions">
          <a className="auth-button primary" href={humanUser ? "/dashboard" : "/login"}>
            {humanUser ? "Open Dashboard" : "Human Sign In"}
          </a>
          <a className="auth-button primary" href="/docs">
            Developer Docs
          </a>
        </div>
        <div className="supported-accounts">
          <div className="supported-accounts-title">Popular supported platforms</div>
          <div className="platform-carousel" aria-label="Popular supported platforms">
            {platformCarouselRows.map((row, rowIndex) => (
              <div key={rowIndex} className="platform-carousel-row">
                {[0, 1].map((copyIndex) => (
                  <div
                    key={copyIndex}
                    className="platform-carousel-sequence"
                    aria-hidden={copyIndex === 1 ? true : undefined}
                  >
                    {row.map((platform) => {
                      const logoSrc = platformLogoSrc(platform);
                      return (
                        <div key={`${copyIndex}-${platform.id}`} className="supported-platform">
                          <span className="supported-platform-logo" title={platform.name} aria-hidden>
                            {logoSrc ? (
                              <img src={logoSrc} alt="" width={32} height={32} loading="lazy" />
                            ) : (
                              SERVICE_ICONS.other
                            )}
                          </span>
                          <span className="supported-platform-copy">
                            <strong>{platform.name}</strong>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="supported-agents">
          <div className="supported-accounts-title">Supported agents</div>
          <ul className="supported-agents-list">
            {SUPPORTED_AGENTS.map((agent) => {
              const logo = AGENT_LOGO_IMAGES[agent.id];
              return (
                <li key={agent.id} className="supported-agent">
                  <span className="supported-agent-logo" title={agent.name} aria-hidden>
                    {logo ? (
                      <img src={logo.src} alt="" width={28} height={28} loading="lazy" />
                    ) : (
                      CUSTOM_AGENT_LOGO
                    )}
                  </span>
                  <span className="supported-agent-name">{agent.name}</span>
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
