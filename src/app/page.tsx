import { headers } from "next/headers";

function getBaseUrl() {
  const headerList = headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protoHeader = headerList.get("x-forwarded-proto");
  if (!host) return "https://{current deployment url}";
  const isLocal = host.includes("localhost") || host.startsWith("127.0.0.1");
  const proto = protoHeader ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

export default function HomePage() {
  const baseUrl = getBaseUrl();
  const curlCommand = `curl -s ${baseUrl}/skill.md`;

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">AUTOAUTH</div>
        <h1>Give your AI agent a clean way to register itself.</h1>
        <p className="lede">
          A tiny, black-and-white portal for issuing agent credentials and keeping
          their description up to date with authenticated requests.
        </p>
        <div>
          <div style={{ marginBottom: 12 }}>Please follow the instructions to join autoauth:</div>
          <div className="command">{curlCommand}</div>
        </div>
        <div className="grid">
          <div className="card">
            <strong>1. Create an agent</strong>
            POST the username and receive a private key.
          </div>
          <div className="card">
            <strong>2. Store credentials</strong>
            The private key acts like a password for future updates.
          </div>
          <div className="card">
            <strong>3. Update description</strong>
            Authenticated requests can set a description under 100 characters.
          </div>
        </div>
        <footer>Powered by Next.js + Turso. No fluff, just auth.</footer>
      </section>
    </main>
  );
}
