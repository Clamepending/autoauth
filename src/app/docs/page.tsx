import type { Metadata } from "next";

import { getBaseUrl } from "@/lib/base-url";
import { getAgentIntegrationPrompt } from "@/lib/llm-docs";
import { getAllManifests } from "@/services/registry";

export const metadata: Metadata = {
  title: "Developer Docs | OttoAuth",
  description:
    "Agent-readable OttoAuth docs for service discovery, order orchestration, provider fallback, and order follow-up.",
};

export const dynamic = "force-dynamic";

type CodeBlockProps = {
  label: string;
  code: string;
};

function CodeBlock({ label, code }: CodeBlockProps) {
  return (
    <figure className="docs-code">
      <figcaption>{label}</figcaption>
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

export default function DocsPage() {
  const baseUrl = getBaseUrl();
  const services = getAllManifests();
  const agentIntegrationPrompt = getAgentIntegrationPrompt(baseUrl);

  const credentialExample = `# Human action:
# Dashboard -> Agent API Keys -> Generate API keys

export OTTOAUTH_BASE_URL=${baseUrl}
export OTTOAUTH_USERNAME=<dashboard_generated_username>
export OTTOAUTH_PRIVATE_KEY=sk-oa-<dashboard_generated_secret>`;

  const discoverExample = `curl -s ${baseUrl}/api/services
curl -s ${baseUrl}/api/services/order
curl -s ${baseUrl}/api/services/order/docs`;

  const agentPreflightExample = `curl -s ${baseUrl}/llms.txt
curl -s ${baseUrl}/llms-full.txt
curl -s ${baseUrl}/skill.md
curl -s ${baseUrl}/api/services
curl -s ${baseUrl}/api/services/order`;

  const simpleQuickstart = `# 1. Validate without creating an order
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "dry_run":true,
    "store":"amazon",
    "item_name":"AA batteries",
    "order_details":"Buy two packs. Stop if total is above $25.",
    "max_charge_cents":2500
  }'

# 2. Submit any order
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "store":"amazon",
    "item_name":"AA batteries",
    "order_details":"Buy two packs. Stop if total is above $25.",
    "max_charge_cents":2500
  }'

# 3. Poll status
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123 \\
  -H 'content-type: application/json' \\
  -d '{"username":"my_agent","private_key":"sk-oa-..."}'

# 4. Cancel, message, clarify, or dispute through the same order id
curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/cancel \\
  -H 'content-type: application/json' \\
  -d '{"username":"my_agent","private_key":"sk-oa-...","reason":"Changed plans"}'`;

  const fileUploadQuickstart = `# Upload a CAD, Gerber, BOM, artwork, or document file
curl -s -X POST ${baseUrl}/api/services/order/files \\
  -F username=my_agent \\
  -F private_key=sk-oa-... \\
  -F purpose=cad_model \\
  -F file=@./bracket.step

# Then pass the returned files[] into the order
curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "store":"xometry",
    "files":[{"file_id":"file_...","name":"bracket.step","download_url":"${baseUrl}/api/services/order/files/file_..."}],
    "order_details":"Quote CNC aluminum 6061, quantity 5, bead blasted. Ask before ordering.",
    "max_charge_cents":50000
  }'`;

  const platformCatalogExample = `curl -s ${baseUrl}/api/services/order/platforms`;

  const submitTaskExample = `curl -s -X POST ${baseUrl}/api/services/order/submit \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "private_key": "OTTOAUTH_PRIVATE_KEY",
    "task_title": "Snackpass pickup",
    "store": "snackpass",
    "merchant": "Little Plearn",
    "order_type": "pickup",
    "item_name": "Pad see ew",
    "quantity": "1",
    "order_details": "mild spice, no peanuts",
    "max_charge_cents": 2000,
    "task_prompt": "Only complete checkout if the total is under the spend cap."
  }'`;

  const statusExample = `curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123 \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "private_key": "OTTOAUTH_PRIVATE_KEY"
  }'`;

  const eventsExample = `curl -s -X POST ${baseUrl}/api/services/order/runs/ord_123/events \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "private_key": "OTTOAUTH_PRIVATE_KEY",
    "limit": 100
  }'`;

  const cancelExample = `curl -s -X POST ${baseUrl}/api/services/order/tasks/ord_123/cancel \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "private_key": "OTTOAUTH_PRIVATE_KEY",
    "reason": "The human cancelled this request."
  }'`;

  const typescriptExample = `const response = await fetch("${baseUrl}/api/services/order/submit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: process.env.OTTOAUTH_USERNAME,
    private_key: process.env.OTTOAUTH_PRIVATE_KEY,
    task_title: "Amazon batteries",
    store: "amazon",
    store_url: "https://www.amazon.com",
    order_type: "shipping",
    item_name: "two packs of AA batteries",
    order_details: "Use the default address on file. Stop and ask for clarification if the total is above $25.",
    max_charge_cents: 2500,
    task_prompt: "Use the human's saved Amazon account and payment method."
  })
});

if (!response.ok) {
  throw new Error(await response.text());
}

const task = await response.json();
console.log(task.order.id, task.order.status);`;

  const pollingExample = `async function waitForOrder(orderId: string) {
  while (true) {
    const response = await fetch(\`${baseUrl}/api/services/order/tasks/\${orderId}\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: process.env.OTTOAUTH_USERNAME,
        private_key: process.env.OTTOAUTH_PRIVATE_KEY
      })
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const { order } = await response.json();
    if (order.status === "blocked") {
      return { action: "answer_clarification", order };
    }
    if (["completed", "failed", "canceled", "disputed"].includes(order.status)) {
      return { action: "finished", order };
    }

    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
}`;

  const pythonExample = `import os
import requests

payload = {
    "username": os.environ["OTTOAUTH_USERNAME"],
    "private_key": os.environ["OTTOAUTH_PRIVATE_KEY"],
    "task_title": "Snackpass pickup",
    "store": "snackpass",
    "merchant": "Little Plearn",
    "order_type": "pickup",
    "item_name": "Pad see ew",
    "order_details": "mild spice, no peanuts",
    "max_charge_cents": 2000,
}

response = requests.post(
    "${baseUrl}/api/services/order/submit",
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())`;

  const clarificationExample = `{
  "event": "ottoauth.order.clarification_requested",
  "order_id": "ord_123",
  "question": "The requested item is unavailable. What should I choose instead?",
  "respond_url": "${baseUrl}/api/services/order/tasks/ord_123/clarification"
}`;

  return (
    <main className="docs-page">
      <div className="docs-shell">
        <aside className="docs-sidebar" aria-label="Documentation navigation">
          <a className="docs-brand" href="/">
            <span className="docs-brand-mark">OA</span>
            <span>
              <strong>OttoAuth</strong>
              <small>Developer Docs</small>
            </span>
          </a>
          <nav>
            <a href="#send-to-agent">Send to Agent</a>
            <a href="#quick-api">Quick API</a>
            <a href="#introduction">Introduction</a>
            <a href="#agent-start">Agent Start</a>
            <a href="#features">Features</a>
            <a href="#quickstart">Quickstart</a>
            <a href="#examples">Examples</a>
            <a href="#lifecycle">Order Lifecycle</a>
            <a href="#services">API Reference</a>
            <a href="#webhooks">Webhooks</a>
            <a href="#errors">Errors</a>
          </nav>
        </aside>

        <section className="docs-content">
          <header className="docs-topbar">
            <div>
              <h1>Developer documentation</h1>
            </div>
            <div className="docs-topbar-actions">
              <a className="auth-button" href="/dashboard">Dashboard</a>
              <a className="auth-button" href="/llms.txt">llms.txt</a>
              <a className="auth-button" href="/llms-full.txt">llms-full.txt</a>
              <a className="auth-button primary" href="/skill.md">Agent skill</a>
            </div>
          </header>

          <section id="quick-api" className="docs-section docs-agent-sendoff">
            <div className="docs-section-heading">
              <span className="docs-kicker">Quickstart</span>
              <h2>One API for any order</h2>
            </div>
            <p>
              Use <code>/api/services/order/submit</code> for every platform:
              Amazon, Instacart, Uber, Treatstock, Xometry, PCBWay, Printful,
              and unsupported stores. If the provider has no native adapter yet,
              First test payloads with <code>dry_run: true</code>; dry runs
              create no order rows and require no credentials. If the provider
              has no native adapter yet, OttoAuth routes live orders to
              admindash for human fulfillment while the
              API still exposes price, confirmation, tracking, cancellation,
              messaging, clarification, and dispute state.
            </p>
            <CodeBlock label="Minimal integration" code={simpleQuickstart} />
            <CodeBlock label="Orders with files" code={fileUploadQuickstart} />
            <CodeBlock label="Supported platform catalog" code={platformCatalogExample} />
          </section>

          <section id="send-to-agent" className="docs-section docs-agent-sendoff">
            <div className="docs-section-heading">
              <span className="docs-kicker">For humans</span>
              <h2>Send this to your coding agent to integrate this API</h2>
            </div>
            <p>
              Copy this block into Codex, Cursor, Claude Code, or another coding
              agent. The visual docs below are written for humans; the linked
              Markdown files are the source of truth for agents.
            </p>
            <CodeBlock label="Coding agent prompt" code={agentIntegrationPrompt} />
            <div className="docs-index-links">
              <a href="/llms.txt">Short agent index</a>
              <a href="/llms-full.txt">Full Markdown context</a>
              <a href="/docs.md">This page as Markdown</a>
              <a href="/api/services/order/docs">Order API Markdown</a>
            </div>
          </section>

          <section id="introduction" className="docs-section">
            <p className="lede">
              OttoAuth lets agents receive dashboard-generated credentials,
              discover callable services, and submit commerce orders
              without taking direct custody of the human's site credentials or
              payment details.
            </p>

            <div className="docs-index">
              <div>
                <span className="docs-index-label">Docs index</span>
                <h2>Human docs plus agent-readable Markdown</h2>
                <p>
                  Humans can skim this page to understand the product and API.
                  Coding agents should read <code>/llms.txt</code>,{" "}
                  <code>/llms-full.txt</code>, <code>/skill.md</code>, and the
                  service Markdown docs.
                </p>
              </div>
              <div className="docs-index-links">
                <a href="/skill.md">GET /skill.md</a>
                <a href="/llms.txt">GET /llms.txt</a>
                <a href="/llms-full.txt">GET /llms-full.txt</a>
                <a href="/docs.md">GET /docs.md</a>
                <a href="/api/services">GET /api/services</a>
                <a href="/api/services/order">GET /api/services/order</a>
              </div>
            </div>
          </section>

          <section id="agent-start" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Agent Bootstrap</span>
              <h2>How the agent-readable docs are organized</h2>
            </div>
            <p>
              OttoAuth follows the common agent-docs pattern: a short{" "}
              <code>/llms.txt</code> index, a full-context{" "}
              <code>/llms-full.txt</code> bundle, page-level Markdown, and a
              machine-readable service registry. This visual page stays
              human-readable.
            </p>
            <div className="docs-callouts">
              <article>
                <h3>Read order</h3>
                <p>
                  Read <code>/llms.txt</code> for the short operating contract,
                  then <code>/skill.md</code> for the full hosted-agent workflow.
                </p>
              </article>
              <article>
                <h3>Credential source</h3>
                <p>
                  Ask the human for dashboard-generated OttoAuth API keys. New
                  integrations should not use legacy pairing-key flows.
                </p>
              </article>
              <article>
                <h3>Tool discovery</h3>
                <p>
                  Fetch <code>/api/services</code>, choose an active or beta
                  service, then fetch its tool JSON and markdown docs.
                </p>
              </article>
              <article>
                <h3>Task discipline</h3>
                <p>
                  Submit structured orders, save the order ID, poll status, send
                  messages, open disputes, and answer clarifications when blocked.
                </p>
              </article>
            </div>
            <CodeBlock label="Agent preflight reads" code={agentPreflightExample} />
          </section>

          <section id="features" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Coverage</span>
              <h2>E-commerce automation features</h2>
            </div>
            <p>
              OttoAuth covers the full developer workflow with a service-first
              API and provider-capability router behind it. Native APIs are used
              only when enabled; otherwise admindash exposes the order to a
              human operator. Amazon, Snackpass, and other store-specific work
              all go through the same general order endpoint with{" "}
              <code>store</code>, <code>merchant</code>, and related fields.
            </p>
            <div className="docs-callouts">
              <article>
                <h3>Auth and API keys</h3>
                <p>
                  Humans generate linked agent credentials in the dashboard.
                  Agents authenticate every service call with <code>username</code>{" "}
                  and <code>private_key</code>.
                </p>
              </article>
              <article>
                <h3>Create orders</h3>
                <p>
                  Use <code>submit_order</code> for purchases, delivery, rides,
                  manufacturing, cancellations, returns, disputes, and support.
                  Set <code>store</code> to values like Amazon, Treatstock, JLCPCB,
                  Instacart, or Uber instead of calling store-specific endpoints.
                </p>
              </article>
              <article>
                <h3>Products, quantities, variants</h3>
                <p>
                  Put product URLs, search instructions, quantities, variants,
                  substitutions, and max spend into structured fields or a
                  compact fallback prompt.
                </p>
              </article>
              <article>
                <h3>Human fallback</h3>
                <p>
                  Unknown or unsupported stores land in admindash with normalized
                  fields, files, checklist, messages, spend cap, and completion form.
                </p>
              </article>
              <article>
                <h3>Status follow-up</h3>
                <p>
                  Poll <code>/api/services/order/tasks/:taskId</code> for
                  status, billing, pickup, tracking, clarification, and final
                  summary fields.
                </p>
              </article>
              <article>
                <h3>Order history and events</h3>
                <p>
                  Use <code>/history</code> to list recent tasks and{" "}
                  <code>/runs/:orderId/events</code> for the order event timeline.
                </p>
              </article>
              <article>
                <h3>Tracking and delivery details</h3>
                <p>
                  Completed task responses can include <code>tracking_details</code>,
                  <code>tracking_summary</code>, pickup details, receipts, and
                  fulfillment notes.
                </p>
              </article>
              <article>
                <h3>Messages and clarification</h3>
                <p>
                  Use messages for vendor, driver, shopper, requester, or operator
                  communication. Use clarification responses when an order is blocked.
                </p>
              </article>
              <article>
                <h3>Cancellations and returns</h3>
                <p>
                  Cancel in-flight orders or open disputes/refund requests through
                  the same lifecycle instead of branching by store.
                </p>
              </article>
              <article>
                <h3>Testing and failure modes</h3>
                <p>
                  Use dev login, mock/device routes, spend caps, and explicit
                  task prompts to exercise success, unavailable item, price cap,
                  clarification, and failed fulfillment paths.
                </p>
              </article>
            </div>
          </section>

          <section id="quickstart" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Getting Started</span>
              <h2>Quickstart</h2>
            </div>

            <div className="docs-steps">
              <article>
                <span>1</span>
                <h3>Get dashboard-generated credentials</h3>
                <p>
                  The human creates OttoAuth API keys in the dashboard and sends
                  the username plus private key to the agent. That key is already
                  linked to the human account and credit balance.
                </p>
                <CodeBlock label="Agent credentials" code={credentialExample} />
              </article>
              <article>
                <span>2</span>
                <h3>Fund the human account</h3>
                <p>
                  The human signs in and keeps credits available. If credits are
                  missing, the API can return an x402 funding challenge before
                  the order is accepted.
                </p>
              </article>
              <article>
                <span>3</span>
                <h3>Discover the current tools</h3>
                <p>
                  Treat service discovery as the stable contract. Services marked
                  active or beta can be called; coming soon services are listed
                  for planning only.
                </p>
                <CodeBlock label="Discover services" code={discoverExample} />
              </article>
              <article>
                <span>4</span>
                <h3>Submit and poll an order</h3>
                <p>
                  Send a compact work order, keep a spend cap on checkout tasks,
                  and poll the order endpoint until it completes, fails, is
                  canceled, is disputed, or asks for clarification.
                </p>
                <CodeBlock label="Submit task" code={submitTaskExample} />
                <CodeBlock label="Check status" code={statusExample} />
              </article>
            </div>
          </section>

          <section id="examples" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Code</span>
              <h2>Example integrations</h2>
            </div>
            <div className="docs-example-grid">
              <CodeBlock label="TypeScript" code={typescriptExample} />
              <CodeBlock label="Python" code={pythonExample} />
            </div>
          </section>

          <section id="lifecycle" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Follow Up</span>
              <h2>Order lifecycle and status</h2>
            </div>
            <p>
              Treat every OttoAuth order as an asynchronous resource. Save the
              returned <code>order.id</code>, use the compatibility{" "}
              <code>task.id</code> only for older clients, and poll until the
              order reaches a terminal or blocked state.
            </p>
            <div className="docs-callouts">
              <article>
                <h3>Human required</h3>
                <p>
                  No enabled provider API exists. The order is visible to an
                  admindash operator for manual fulfillment.
                </p>
              </article>
              <article>
                <h3>Blocked</h3>
                <p>
                  Answer the clarification question through the clarification endpoint.
                </p>
              </article>
              <article>
                <h3>Completed</h3>
                <p>
                  Read <code>summary</code>, <code>pickup_details</code>,{" "}
                  <code>tracking_details</code>, totals, and timestamps from the
                  task object.
                </p>
              </article>
              <article>
                <h3>Failed</h3>
                <p>
                  Read <code>error</code> and <code>summary</code>, then submit a
                  new task with clearer instructions if the human wants a retry.
                </p>
              </article>
              <article>
                <h3>Cancelled</h3>
                <p>
                  Use the cancel endpoint for in-flight tasks when the human
                  changes their mind before fulfillment completes.
                </p>
              </article>
            </div>
            <CodeBlock label="Poll until terminal status" code={pollingExample} />
            <CodeBlock label="Get task status" code={statusExample} />
            <CodeBlock label="Cancel task" code={cancelExample} />
            <CodeBlock label="Get order events" code={eventsExample} />
          </section>

          <section id="services" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Reference</span>
              <h2>Services and endpoints</h2>
            </div>
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
                    <p className="docs-muted">This service is discoverable but not callable yet.</p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section id="webhooks" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Clarification</span>
              <h2>Webhook handling</h2>
            </div>
            <p>
              When an operator or provider adapter gets blocked, OttoAuth records
              a clarification request. Respond through the clarification endpoint
              so the order can resume.
            </p>
            <CodeBlock label="Clarification event shape" code={clarificationExample} />
          </section>

          <section id="errors" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Operations</span>
              <h2>Error handling</h2>
            </div>
            <div className="docs-callouts">
              <article>
                <h3>401 or 403</h3>
                <p>
                  Check the agent username, private key, and whether the human
                  has linked this agent.
                </p>
              </article>
              <article>
                <h3>402 or spend-cap failures</h3>
                <p>
                  Ask the human to refill credits or lower the requested work
                  order total.
                </p>
              </article>
              <article>
                <h3>404 service errors</h3>
                <p>
                  Refresh <code>/api/services</code>. Hosted services can be
                  active, beta, or coming soon.
                </p>
              </article>
              <article>
                <h3>Awaiting clarification</h3>
                <p>
                  Answer the question promptly. OttoAuth keeps the order blocked
                  instead of guessing.
                </p>
              </article>
            </div>
          </section>

          <section className="docs-section docs-footer-cta">
            <div>
              <span className="docs-kicker">Ready</span>
              <h2>Start from the agent skill</h2>
              <p>
                The shortest integration path is to fetch <code>/skill.md</code>,
                follow the hosted account flow, then call the active order
                service with the right store fields.
              </p>
            </div>
            <a className="auth-button primary" href="/skill.md">Open /skill.md</a>
          </section>
        </section>

        <aside className="docs-toc" aria-label="Current docs summary">
          <div className="docs-toc-card">
            <span className="docs-kicker">Service catalog</span>
            <ul>
              {services.map((service) => (
                <li key={service.id}>
                  <a href={`/api/services/${service.id}`}>{service.name}</a>
                  <span className="docs-toc-status">
                    {service.status.replace("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
