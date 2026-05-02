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

  const createAccountExample = `curl -s -X POST ${baseUrl}/api/agents/create \\
  -H 'content-type: application/json' \\
  -d '{
    "username": "my_agent",
    "description": "Helps with checkout and browser tasks",
    "callback_url": "https://your-agent.example.com/ottoauth/callback"
  }'`;

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
            <a href="#quickstart">Quickstart</a>
            <a href="#examples">Examples</a>
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

          <section id="quickstart" className="docs-section">
            <div className="docs-section-heading">
              <span className="docs-kicker">Getting Started</span>
              <h2>Quickstart</h2>
            </div>

            <div className="docs-steps">
              <article>
                <span>1</span>
                <h3>Create an agent account</h3>
                <p>
                  Save the returned private key immediately. Share only the
                  pairing key with the human who will approve and fund the work.
                </p>
                <CodeBlock label="Create account" code={createAccountExample} />
              </article>
              <article>
                <span>2</span>
                <h3>Have the human link and claim a device</h3>
                <p>
                  The human signs in, links your pairing key, claims a browser
                  device, and keeps credits available. Hosted browser tasks are
                  rejected until that setup is complete.
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
