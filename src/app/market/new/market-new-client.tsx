"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import type { HumanUserRecord } from "@/lib/human-accounts";

const QUICKSTART_ROUTE = `// app/api/ottoauth-demo/route.ts
// Deploy this in any Next.js app, then paste the public URL into OttoAuth.

export async function POST(request: Request) {
  const serviceId = request.headers.get("x-ottoauth-service-id");
  const callId = request.headers.get("x-ottoauth-call-id");

  if (!serviceId || !callId) {
    return Response.json(
      { error: "Missing OttoAuth Pay headers." },
      { status: 402 },
    );
  }

  const body = await request.json();
  const text = String(body.input?.text ?? "");

  return Response.json({
    ok: true,
    call_id: callId,
    output: {
      summary: text ? text.slice(0, 160) : "Hello from my paid agent service!",
      received_reason: body.reason ?? null,
    },
  });
}
`;

const QUICKSTART_CURL = `curl -s -X POST http://localhost:3000/api/ottoauth-demo \
  -H 'content-type: application/json' \
  -H 'x-ottoauth-service-id: local-test' \
  -H 'x-ottoauth-call-id: call_test_123' \
  -H 'x-ottoauth-capability: summarize_text' \
  -d '{
    "input": { "text": "OttoAuth Pay lets agents buy API capabilities from each other." },
    "reason": "Local smoke test",
    "task_id": "local-task-1"
  }'
`;

const DEMO_INPUT_SCHEMA = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "Text to summarize.",
    },
  },
  required: ["text"],
};

const DEMO_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Short summary returned by the provider service.",
    },
    received_reason: {
      type: ["string", "null"],
      description: "The buyer agent's reason for calling the service.",
    },
  },
  required: ["summary"],
};

const DEMO_EXAMPLES = [
  {
    input: {
      text: "OttoAuth Pay lets agents buy API capabilities from each other.",
    },
    output: {
      summary: "OttoAuth Pay lets agents buy API capabilities from each other.",
      received_reason: "Summarize a market design note",
    },
  },
];

function parseJsonField(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

export function MarketNewClient(props: { user: HumanUserRecord }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [capability, setCapability] = useState("");
  const [description, setDescription] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [priceCents, setPriceCents] = useState("1");
  const [tags, setTags] = useState("");
  const [inputSchema, setInputSchema] = useState("{}");
  const [outputSchema, setOutputSchema] = useState("{}");
  const [examples, setExamples] = useState("[]");
  const [visibility, setVisibility] = useState<"public" | "unlisted">("public");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedQuickstart, setCopiedQuickstart] = useState<string | null>(null);

  async function handleCopy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedQuickstart(label);
      window.setTimeout(() => setCopiedQuickstart(null), 1400);
    } catch {
      setMessage("Could not copy to clipboard.");
    }
  }

  function handleFillDemo() {
    setName("One cent text summarizer");
    setCapability("summarize_text");
    setDescription("A tiny demo endpoint that summarizes text and returns a receipt-backed result.");
    setEndpointUrl("https://your-app.vercel.app/api/ottoauth-demo");
    setPriceCents("1");
    setTags("summarization, demo, text");
    setInputSchema(JSON.stringify(DEMO_INPUT_SCHEMA, null, 2));
    setOutputSchema(JSON.stringify(DEMO_OUTPUT_SCHEMA, null, 2));
    setExamples(JSON.stringify(DEMO_EXAMPLES, null, 2));
    setVisibility("public");
    setMessage("Demo values loaded. Replace the endpoint URL after you deploy your route.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const payload = {
        name,
        capability,
        description,
        endpoint_url: endpointUrl,
        price_cents: Number(priceCents),
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        visibility,
        supported_rails: ["ottoauth_ledger"],
        input_schema: parseJsonField(inputSchema),
        output_schema: parseJsonField(outputSchema),
        examples: parseJsonField(examples),
      };
      const response = await fetch("/api/market/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error || "Could not publish service.");
        return;
      }
      router.push(`/market/services/${body.service.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <section className="dashboard-header">
          <div>
            <div className="eyebrow">OttoAuth Pay</div>
            <h1>Publish service</h1>
            <p className="lede">
              Register an agent-facing endpoint so other agents can discover it,
              pay through OttoAuth credits, and receive a receipt.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button" href="/market">
              Back to Market
            </Link>
          </div>
        </section>

        {message && <div className="auth-success">{message}</div>}

        <section className="dashboard-grid wide">
          <article className="dashboard-card dashboard-card-span-2">
            <div className="supported-accounts-title">1-minute provider quickstart</div>
            <p className="dashboard-muted">
              Make a tiny paid HTTP service first. Paste this route into any Next.js app,
              deploy it, then publish the public URL below as your endpoint.
            </p>
            <pre className="dashboard-prewrap">{QUICKSTART_ROUTE}</pre>
            <div className="dashboard-actions">
              <button
                className="auth-button primary"
                type="button"
                onClick={() => handleCopy("route", QUICKSTART_ROUTE)}
              >
                {copiedQuickstart === "route" ? "Copied route" : "Copy route code"}
              </button>
              <button className="auth-button" type="button" onClick={handleFillDemo}>
                Fill form with demo
              </button>
            </div>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Test before publishing</div>
            <p className="dashboard-muted">
              Run your app locally, then use this curl command. OttoAuth will send the
              same headers when a buyer agent pays and calls your service.
            </p>
            <pre className="dashboard-prewrap">{QUICKSTART_CURL}</pre>
            <button
              className="auth-button"
              type="button"
              onClick={() => handleCopy("curl", QUICKSTART_CURL)}
            >
              {copiedQuickstart === "curl" ? "Copied curl" : "Copy curl test"}
            </button>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Request contract</div>
            <p className="dashboard-muted">
              Your endpoint receives JSON with <code>input</code>, <code>reason</code>,
              and <code>task_id</code>. It also receives <code>x-ottoauth-service-id</code>,
              <code>x-ottoauth-call-id</code>, and <code>x-ottoauth-capability</code> headers.
            </p>
            <p className="dashboard-muted">
              Return any JSON object. OttoAuth stores it with the service-call receipt and
              releases credits to you when the endpoint returns HTTP 2xx.
            </p>
          </article>
        </section>

        <form className="dashboard-grid wide" onSubmit={handleSubmit}>
          <article className="dashboard-card">
            <div className="supported-accounts-title">Basics</div>
            <input className="auth-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Service name" required />
            <input className="auth-input" value={capability} onChange={(event) => setCapability(event.target.value)} placeholder="Capability, e.g. summarize_document" required />
            <textarea className="auth-input shipping-textarea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short description" />
            <input className="auth-input" value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://your-service.example/api/call" required />
            <input className="auth-input" type="number" min="0" value={priceCents} onChange={(event) => setPriceCents(event.target.value)} placeholder="Price in cents" required />
            <input className="auth-input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, comma separated" />
            <select className="auth-input" value={visibility} onChange={(event) => setVisibility(event.target.value as "public" | "unlisted")}>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
            </select>
            <p className="dashboard-muted">
              Publishing as {props.user.display_name || props.user.email}. V1 uses the fee-free OttoAuth ledger rail.
            </p>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Schemas</div>
            <label className="dashboard-muted">Input schema JSON</label>
            <textarea className="auth-input task-textarea mono" value={inputSchema} onChange={(event) => setInputSchema(event.target.value)} />
            <label className="dashboard-muted">Output schema JSON</label>
            <textarea className="auth-input task-textarea mono" value={outputSchema} onChange={(event) => setOutputSchema(event.target.value)} />
            <label className="dashboard-muted">Examples JSON</label>
            <textarea className="auth-input task-textarea mono" value={examples} onChange={(event) => setExamples(event.target.value)} />
            <div className="dashboard-actions">
              <button className="auth-button primary" type="submit" disabled={submitting}>
                {submitting ? "Publishing..." : "Publish service"}
              </button>
            </div>
          </article>
        </form>
      </section>
    </main>
  );
}
