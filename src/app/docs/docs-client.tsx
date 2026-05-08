"use client";

import { useEffect, useMemo, useState } from "react";

import type { ServiceManifest } from "@/services/_shared/types";

type DocsClientProps = {
  baseUrl: string;
  services: ServiceManifest[];
  agentIntegrationPrompt: string;
};

type TabId = "start" | "quickstart" | "api" | "files" | "status" | "reference";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "start", label: "Start" },
  { id: "quickstart", label: "Quickstart" },
  { id: "api", label: "API" },
  { id: "files", label: "Files" },
  { id: "status", label: "Status" },
  { id: "reference", label: "Reference" },
];

function isTabId(value: string): value is TabId {
  return tabs.some((tab) => tab.id === value);
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await writeClipboard(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      className={`docs-copy-button ${className}`}
      data-copied={copied ? "true" : "false"}
      onClick={handleCopy}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <figure className="docs-code">
      <figcaption>
        <span>{label}</span>
        <CopyButton value={code} />
      </figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

function FieldList({
  fields,
}: {
  fields: Record<string, { type: string; required: boolean; description: string }>;
}) {
  const entries = Object.entries(fields);

  if (entries.length === 0) {
    return <p className="docs-muted">No parameters.</p>;
  }

  return (
    <div className="docs-params">
      {entries.map(([name, field]) => (
        <div key={name} className="docs-param-row">
          <code>{name}</code>
          <span>{field.type}</span>
          <span>{field.required ? "required" : "optional"}</span>
          <p>{field.description}</p>
        </div>
      ))}
    </div>
  );
}

function AgentCompatibility({
  agentIntegrationPrompt,
}: {
  agentIntegrationPrompt: string;
}) {
  return (
    <section className="docs-agent-card" aria-label="LLM coding agent support">
      <div>
        <span className="docs-kicker">LLM coding agent ready</span>
        <h2>Copy the prompt. Let the agent integrate.</h2>
        <p>
          Works with Codex, Cursor, Claude Code, and any agent that can read
          Markdown URLs.
        </p>
      </div>
      <div className="docs-agent-actions">
        <CopyButton
          value={agentIntegrationPrompt}
          label="Copy agent prompt"
          className="docs-copy-button-primary"
        />
        <a href="/skill.md">/skill.md</a>
        <a href="/llms.txt">/llms.txt</a>
        <a href="/llms-full.txt">/llms-full.txt</a>
      </div>
    </section>
  );
}

function AgentMini({
  agentIntegrationPrompt,
}: {
  agentIntegrationPrompt: string;
}) {
  return (
    <div className="docs-agent-mini">
      <span>Agent compatible</span>
      <p>Copy the prompt or point your coding agent at /skill.md.</p>
      <CopyButton value={agentIntegrationPrompt} label="Copy prompt" />
    </div>
  );
}

function makeExamples(baseUrl: string) {
  const credentials = `export OTTOAUTH_BASE_URL=${baseUrl}
export OTTOAUTH_USERNAME=<dashboard_generated_username>
export OTTOAUTH_PRIVATE_KEY=sk-oa-<dashboard_generated_secret>`;

  const agentPreflight = `curl -s ${baseUrl}/llms.txt
curl -s ${baseUrl}/skill.md
curl -s ${baseUrl}/api/services
curl -s ${baseUrl}/api/services/order/docs`;

  const quickstart = `# 1. Validate. No order is created.
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "dry_run": true,
    "store": "amazon",
    "item_name": "AA batteries",
    "order_details": "Buy two packs. Stop if total is above $25.",
    "max_charge_cents": 2500
  }'

# 2. Submit the real order.
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "private_key": "sk-oa-...",
    "store": "amazon",
    "item_name": "AA batteries",
    "order_details": "Buy two packs. Stop if total is above $25.",
    "max_charge_cents": 2500
  }'

# 3. Poll status.
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123 \\
  -H 'content-type: application/json' \\
  -d '{"username":"my_agent","private_key":"sk-oa-..."}'`;

  const apiShape = `POST ${baseUrl}/api/services/order/submit
POST ${baseUrl}/api/services/order/tasks/<orderId>
POST ${baseUrl}/api/services/order/tasks/<orderId>/cancel
POST ${baseUrl}/api/services/order/tasks/<orderId>/messages
POST ${baseUrl}/api/services/order/tasks/<orderId>/clarification
POST ${baseUrl}/api/services/order/files
GET  ${baseUrl}/api/services/order/platforms`;

  const typescript = `const response = await fetch("${baseUrl}/api/services/order/submit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: process.env.OTTOAUTH_USERNAME,
    private_key: process.env.OTTOAUTH_PRIVATE_KEY,
    store: "snackpass",
    merchant: "Little Plearn",
    item_name: "Pad see ew",
    order_details: "pickup, mild spice, no peanuts",
    max_charge_cents: 2000
  })
});

if (!response.ok) throw new Error(await response.text());
const { order } = await response.json();
console.log(order.id, order.status);`;

  const files = `# Upload CAD, Gerber, BOM, artwork, or a document.
curl -s -X POST ${baseUrl}/api/services/order/files \\
  -F username=my_agent \\
  -F private_key=sk-oa-... \\
  -F purpose=cad_model \\
  -F file=@./bracket.step

# Include the returned files[] when submitting the order.
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "private_key": "sk-oa-...",
    "store": "xometry",
    "files": [{"file_id":"file_...","name":"bracket.step"}],
    "order_details": "Quote CNC 6061 aluminum, quantity 5. Ask before ordering.",
    "max_charge_cents": 50000
  }'`;

  const polling = `async function waitForOrder(orderId: string) {
  while (true) {
    const response = await fetch(\`${baseUrl}/api/services/order/tasks/\${orderId}\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: process.env.OTTOAUTH_USERNAME,
        private_key: process.env.OTTOAUTH_PRIVATE_KEY
      })
    });

    if (!response.ok) throw new Error(await response.text());

    const { order } = await response.json();
    if (["completed", "failed", "canceled", "disputed"].includes(order.status)) {
      return order;
    }
    if (order.status === "blocked") {
      return order;
    }

    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
}`;

  return { credentials, agentPreflight, quickstart, apiShape, typescript, files, polling };
}

export function DocsClient({
  baseUrl,
  services,
  agentIntegrationPrompt,
}: DocsClientProps) {
  const [activeTab, setActiveTab] = useState<TabId>("start");
  const examples = useMemo(() => makeExamples(baseUrl), [baseUrl]);
  const callableServices = services.filter((service) => service.status !== "coming_soon");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (isTabId(hash)) {
      setActiveTab(hash);
    }
  }, []);

  function selectTab(tabId: TabId) {
    setActiveTab(tabId);
    window.history.replaceState(null, "", `#${tabId}`);
  }

  function renderTab() {
    if (activeTab === "start") {
      return (
        <>
          <div className="docs-minimal-grid">
            <article>
              <span>1</span>
              <h3>Copy the agent prompt</h3>
              <p>
                Paste it into Codex, Cursor, Claude Code, or another coding
                agent. It tells the agent exactly which OttoAuth docs to read.
              </p>
            </article>
            <article>
              <span>2</span>
              <h3>Use dashboard keys</h3>
              <p>
                The human generates a username and private key in the dashboard.
                Retailer passwords and payment details stay out of the app.
              </p>
            </article>
            <article>
              <span>3</span>
              <h3>Submit one order</h3>
              <p>
                Send a compact work order to the general order endpoint. Use
                dry_run first, then submit the real order with a spend cap.
              </p>
            </article>
          </div>
          <CodeBlock label="Agent preflight" code={examples.agentPreflight} />
        </>
      );
    }

    if (activeTab === "quickstart") {
      return (
        <div className="docs-two-column">
          <article>
            <h3>Credentials</h3>
            <p>
              Create these in the dashboard. Keep them server-side or inside
              the coding agent runtime.
            </p>
            <CodeBlock label="Environment" code={examples.credentials} />
          </article>
          <article>
            <h3>Order flow</h3>
            <p>Validate, submit, poll. That is the happy path.</p>
            <CodeBlock label="Minimal curl" code={examples.quickstart} />
          </article>
        </div>
      );
    }

    if (activeTab === "api") {
      return (
        <>
          <div className="docs-callouts docs-callouts-compact">
            <article>
              <h3>One endpoint</h3>
              <p>
                Use <code>/api/services/order/submit</code> for Amazon,
                Snackpass, manufacturing, delivery, cancellations, returns, and
                unsupported stores.
              </p>
            </article>
            <article>
              <h3>One hard limit</h3>
              <p>
                Real orders need <code>max_charge_cents</code>. OttoAuth will
                not exceed it.
              </p>
            </article>
            <article>
              <h3>One service catalog</h3>
              <p>
                Fetch <code>/api/services</code> and call services marked
                active or beta.
              </p>
            </article>
          </div>
          <CodeBlock label="Endpoints" code={examples.apiShape} />
          <CodeBlock label="TypeScript" code={examples.typescript} />
        </>
      );
    }

    if (activeTab === "files") {
      return (
        <>
          <p>
            Upload CAD, Gerber, BOM, artwork, images, or documents first. Pass
            the returned <code>files[]</code> into the order.
          </p>
          <CodeBlock label="File order" code={examples.files} />
        </>
      );
    }

    if (activeTab === "status") {
      return (
        <>
          <div className="docs-status-row">
            <span>queued</span>
            <span>running</span>
            <span>blocked</span>
            <span>human_required</span>
            <span>completed</span>
            <span>failed</span>
            <span>canceled</span>
            <span>disputed</span>
          </div>
          <p>
            Poll every 15-60 seconds. If the order is blocked, answer the
            clarification endpoint. If the human changes their mind, cancel the
            task by order id.
          </p>
          <CodeBlock label="Polling loop" code={examples.polling} />
        </>
      );
    }

    return (
      <>
        <p>
          There are {services.length} registered services. Call only active or
          beta services. Open each Markdown doc when your agent needs exact tool
          fields.
        </p>
        <div className="docs-service-grid">
          {services.map((service) => (
            <article key={service.id} className="docs-service-card">
              <div className="docs-service-card-header">
                <div>
                  <span className="docs-status">{service.status}</span>
                  <h3>{service.name}</h3>
                </div>
                <code>{service.id}</code>
              </div>
              <p>{service.description}</p>
              <div className="docs-service-links">
                <a href={`/api/services/${service.id}`}>Tool JSON</a>
                {service.docsMarkdown ? (
                  <a href={`/api/services/${service.id}/docs`}>Markdown docs</a>
                ) : null}
              </div>
              {service.endpoints.length > 0 ? (
                <div className="docs-endpoints">
                  {service.endpoints.map((endpoint) => (
                    <details key={`${service.id}-${endpoint.name}`} className="docs-endpoint">
                      <summary>
                        <span>{endpoint.method}</span>
                        <code>{endpoint.path}</code>
                      </summary>
                      <p>{endpoint.description}</p>
                      <FieldList fields={endpoint.params} />
                    </details>
                  ))}
                </div>
              ) : (
                <p className="docs-muted">Not callable yet.</p>
              )}
            </article>
          ))}
        </div>
      </>
    );
  }

  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? "Start";

  return (
    <main className="docs-page">
      <div className="docs-shell docs-minimal-shell">
        <header className="docs-topbar docs-minimal-topbar">
          <a className="docs-brand" href="/">
            <span className="docs-brand-mark">OA</span>
            <span>
              <strong>OttoAuth</strong>
              <small>Docs</small>
            </span>
          </a>
          <nav className="docs-top-links" aria-label="Documentation links">
            <a href="/dashboard">Dashboard</a>
            <a href="/skill.md">Agent skill</a>
            <a href="/docs.md">Markdown</a>
          </nav>
        </header>

        <section className="docs-hero">
          <span className="docs-kicker">Minimal docs</span>
          <h1>Submit any order from an app or coding agent.</h1>
          <p>
            One service endpoint, dashboard-generated credentials, a required
            spend cap for real orders, and Markdown docs that coding agents can
            read directly.
          </p>
          <div className="docs-hero-actions">
            <CopyButton
              value={agentIntegrationPrompt}
              label="Copy agent prompt"
              className="docs-copy-button-primary"
            />
            <a className="docs-secondary-link" href="/api/services/order/docs">
              Order API Markdown
            </a>
            <span>{callableServices.length} callable services</span>
          </div>
        </section>

        <AgentCompatibility agentIntegrationPrompt={agentIntegrationPrompt} />

        <nav className="docs-tabs" aria-label="Docs sections" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`docs-tab-${tab.id}`}
              id={`docs-tab-button-${tab.id}`}
              onClick={() => selectTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section
          className="docs-section docs-tab-panel"
          id={`docs-tab-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`docs-tab-button-${activeTab}`}
        >
          <div className="docs-section-heading">
            <span className="docs-kicker">{activeTabLabel}</span>
            <h2>{activeTabLabel}</h2>
          </div>
          {renderTab()}
          <AgentMini agentIntegrationPrompt={agentIntegrationPrompt} />
        </section>
      </div>
    </main>
  );
}
