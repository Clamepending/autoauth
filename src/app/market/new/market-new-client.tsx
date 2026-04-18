"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import type { HumanUserRecord } from "@/lib/human-accounts";

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

        {message && <div className="auth-error">{message}</div>}

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
