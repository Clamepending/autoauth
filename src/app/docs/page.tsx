import type { Metadata } from "next";

import { getBaseUrl } from "@/lib/base-url";
import { getAllManifests } from "@/services/registry";

export const metadata: Metadata = {
  title: "Developer Docs | OttoAuth",
  description:
    "Integrate OttoAuth agent accounts, service discovery, browser tasks, and checkout flows.",
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
  const activeServices = services.filter((service) => service.status !== "coming_soon");

  const credentialExample = `# Human action:
# Dashboard -> Agent API Keys -> Generate API keys

export OTTOAUTH_BASE_URL=${baseUrl}
export OTTOAUTH_USERNAME=<dashboard_generated_username>
export OTTOAUTH_PRIVATE_KEY=<dashboard_generated_private_key>`;

  const discoverExample = `curl -s ${baseUrl}/api/services
curl -s ${baseUrl}/api/services/computeruse
curl -s ${baseUrl}/api/services/computeruse/docs`;

  const submitTaskExample = `curl -s -X POST ${baseUrl}/api/services/computeruse/submit-task \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "private_key": "OTTOAUTH_PRIVATE_KEY",
    "task_title": "Snackpass pickup",
    "website_url": "https://www.snackpass.co/",
    "max_charge_cents": 2000,
    "task_prompt": "Platform: Snackpass\\nStore or merchant name: Little Plearn\\nFulfillment method: pickup\\nItem name: Pad see ew\\nOrder details: mild spice, no peanuts\\nAdditional instructions: only complete checkout if the total is under the spend cap."
  }'`;

  const statusExample = `curl -s -X POST ${baseUrl}/api/services/computeruse/tasks/123 \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "private_key": "OTTOAUTH_PRIVATE_KEY"
  }'`;

  const eventsExample = `curl -s -X POST ${baseUrl}/api/services/computeruse/runs/run_abc123/events \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "private_key": "OTTOAUTH_PRIVATE_KEY",
    "limit": 100
  }'`;

  const typescriptExample = `const response = await fetch("${baseUrl}/api/services/computeruse/submit-task", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: process.env.OTTOAUTH_USERNAME,
    private_key: process.env.OTTOAUTH_PRIVATE_KEY,
    task_title: "Amazon batteries",
    website_url: "https://www.amazon.com",
    max_charge_cents: 2500,
    task_prompt: [
      "Open Amazon.",
      "Buy two packs of AA batteries.",
      "Use the default address on file.",
      "Stop and ask for clarification if the total is above $25."
    ].join("\\n")
  })
});

if (!response.ok) {
  throw new Error(await response.text());
}

const task = await response.json();
console.log(task.id, task.status);`;

  const pollingExample = `async function waitForTask(taskId: number) {
  while (true) {
    const response = await fetch(\`${baseUrl}/api/services/computeruse/tasks/\${taskId}\`, {
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

    const { task } = await response.json();
    if (task.status === "awaiting_agent_clarification") {
      return { action: "answer_clarification", task };
    }
    if (task.status === "completed" || task.status === "failed") {
      return { action: "finished", task };
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
    "website_url": "https://www.snackpass.co/",
    "max_charge_cents": 2000,
    "task_prompt": "Platform: Snackpass\\nStore: Little Plearn\\nItem: Pad see ew\\nFulfillment: pickup",
}

response = requests.post(
    "${baseUrl}/api/services/computeruse/submit-task",
    json=payload,
    timeout=30,
)
response.raise_for_status()
print(response.json())`;

  const clarificationExample = `{
  "event": "ottoauth.computeruse.clarification_requested",
  "taskId": 123,
  "question": "The requested item is unavailable. What should I choose instead?",
  "deadlineSeconds": 300
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
            <a href="#introduction">Introduction</a>
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
              <div className="eyebrow">v0 hosted API</div>
              <h1>Developer documentation</h1>
            </div>
            <div className="docs-topbar-actions">
              <a className="auth-button" href="/dashboard">Dashboard</a>
              <a className="auth-button primary" href="/skill.md">Agent skill</a>
            </div>
          </header>

          <section id="introduction" className="docs-section">
            <p className="lede">
              OttoAuth lets agents create accounts, link to a human, discover
              callable services, and submit browser or checkout tasks without
              taking direct custody of the human's site credentials or payment
              details.
            </p>

            <div className="docs-index">
              <div>
                <span className="docs-index-label">Docs index</span>
                <h2>Machine-readable first</h2>
                <p>
                  Agents should start with the service index, then load the
                  service-specific tool list and markdown docs for the task they
                  need to perform.
                </p>
              </div>
              <div className="docs-index-links">
                <a href="/skill.md">GET /skill.md</a>
                <a href="/api/services">GET /api/services</a>
                <a href="/api/services/computeruse">GET /api/services/computeruse</a>
              </div>
            </div>
          </section>

          <section id="features" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Coverage</span>
              <h2>E-commerce automation features</h2>
            </div>
            <p>
              OttoAuth covers the full developer workflow with a service-first
              API and a browser fulfiller behind it. Typed services are exposed
              where flows are stable; flexible retailer work is handled through
              structured browser tasks.
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
                  Use <code>submit_task</code> for universal browser checkout,
                  or the Amazon service for price-then-pay Amazon orders.
                </p>
              </article>
              <article>
                <h3>Products, quantities, variants</h3>
                <p>
                  Put product URLs, search instructions, quantities, variants,
                  substitutions, and max spend into a structured task prompt.
                </p>
              </article>
              <article>
                <h3>Managed retailer accounts</h3>
                <p>
                  OttoAuth uses human-claimed browser profiles instead of storing
                  retailer passwords. Humans control the signed-in browser device.
                </p>
              </article>
              <article>
                <h3>Status follow-up</h3>
                <p>
                  Poll <code>/api/services/computeruse/tasks/:taskId</code> for
                  status, billing, pickup, tracking, clarification, and final
                  summary fields.
                </p>
              </article>
              <article>
                <h3>Order history and events</h3>
                <p>
                  Use <code>/history</code> to list recent tasks and{" "}
                  <code>/runs/:runId/events</code> for execution history.
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
                <h3>Webhooks and clarification</h3>
                <p>
                  Configure a callback URL on generated credentials so OttoAuth
                  can ask the agent for clarification when a fulfiller is blocked.
                </p>
              </article>
              <article>
                <h3>Cancellations and returns</h3>
                <p>
                  Submit cancellation, return-label, refund, or exchange requests
                  as browser tasks against the original retailer account and
                  follow their status like any other task.
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
                <h3>Have the human claim a device</h3>
                <p>
                  The human signs in, claims a browser device, and keeps credits
                  available. Hosted browser tasks are rejected until the
                  generated agent key has a funded human account and a device.
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
                <h3>Submit and poll a task</h3>
                <p>
                  Send a compact work order, keep a spend cap on checkout tasks,
                  and poll the task endpoint until it completes, fails, or asks
                  for clarification.
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
              Treat every OttoAuth browser order as an asynchronous task. Save
              the returned <code>task.id</code> and <code>run_id</code>, show the
              human <code>/orders/&lt;taskId&gt;</code> when useful, and poll
              until the task reaches <code>completed</code> or <code>failed</code>.
            </p>
            <div className="docs-callouts">
              <article>
                <h3>Queued or running</h3>
                <p>
                  The task is waiting for or being handled by a browser
                  fulfiller. Poll status every 15-60 seconds.
                </p>
              </article>
              <article>
                <h3>Awaiting clarification</h3>
                <p>
                  Answer the callback question or POST to the clarification
                  endpoint before the deadline.
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
            </div>
            <CodeBlock label="Poll until terminal status" code={pollingExample} />
            <CodeBlock label="Get task status" code={statusExample} />
            <CodeBlock label="Get run events" code={eventsExample} />
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
              When a browser fulfiller gets blocked on an agent-submitted task,
              OttoAuth can post a clarification request to the callback URL saved
              on the agent account. Return a JSON answer from that webhook, or
              respond later through the clarification endpoint before the
              deadline.
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
                  Answer the question promptly. If the deadline expires, the task
                  is cancelled instead of guessing.
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
                follow the hosted account flow, then call the active service that
                matches the job.
              </p>
            </div>
            <a className="auth-button primary" href="/skill.md">Open /skill.md</a>
          </section>
        </section>

        <aside className="docs-toc" aria-label="Current docs summary">
          <div className="docs-toc-card">
            <span className="docs-kicker">Available now</span>
            <ul>
              {activeServices.map((service) => (
                <li key={service.id}>
                  <a href={`/api/services/${service.id}`}>{service.name}</a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
