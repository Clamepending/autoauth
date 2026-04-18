"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import type { HumanUserRecord } from "@/lib/human-accounts";
import type { MarketServiceRecord } from "@/lib/market-services";

function parseJsonField(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "Not provided") return null;
  return JSON.parse(trimmed);
}

function prettyJson(value: string | null) {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((tag) => String(tag)).join(", ");
    }
  } catch {}
  return "";
}

export function MarketServiceEditClient(props: {
  service: MarketServiceRecord;
  user: HumanUserRecord;
}) {
  const { service } = props;
  const router = useRouter();
  const [name, setName] = useState(service.name);
  const [capability, setCapability] = useState(service.capability);
  const [description, setDescription] = useState(service.description);
  const [endpointUrl, setEndpointUrl] = useState(service.endpoint_url);
  const [priceCents, setPriceCents] = useState(String(service.price_cents));
  const [tags, setTags] = useState(parseTags(service.tags_json));
  const [inputSchema, setInputSchema] = useState(prettyJson(service.input_schema_json));
  const [outputSchema, setOutputSchema] = useState(prettyJson(service.output_schema_json));
  const [examples, setExamples] = useState(prettyJson(service.examples_json));
  const [visibility, setVisibility] = useState<"public" | "unlisted">(
    service.visibility,
  );
  const [status, setStatus] = useState<"enabled" | "disabled">(service.status);
  const [refundPolicy, setRefundPolicy] = useState(service.refund_policy || "");
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
        status,
        supported_rails: ["ottoauth_ledger"],
        input_schema: parseJsonField(inputSchema),
        output_schema: parseJsonField(outputSchema),
        examples: parseJsonField(examples),
        refund_policy: refundPolicy,
      };
      const response = await fetch(`/api/market/services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error || "Could not update service.");
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
            <h1>Edit service</h1>
            <p className="lede">
              Update pricing, schemas, visibility, or disable this offering.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button" href={`/market/services/${service.id}`}>
              Back to service
            </Link>
          </div>
        </section>

        {message && <div className="auth-error">{message}</div>}

        <form className="dashboard-grid wide" onSubmit={handleSubmit}>
          <article className="dashboard-card">
            <div className="supported-accounts-title">Basics</div>
            <input
              className="auth-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Service name"
              required
            />
            <input
              className="auth-input"
              value={capability}
              onChange={(event) => setCapability(event.target.value)}
              placeholder="Capability, e.g. summarize_document"
              required
            />
            <textarea
              className="auth-input shipping-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short description"
            />
            <input
              className="auth-input"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              placeholder="https://your-service.example/api/call"
              required
            />
            <input
              className="auth-input"
              type="number"
              min="0"
              value={priceCents}
              onChange={(event) => setPriceCents(event.target.value)}
              placeholder="Price in cents"
              required
            />
            <input
              className="auth-input"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Tags, comma separated"
            />
            <select
              className="auth-input"
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as "public" | "unlisted")
              }
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
            </select>
            <select
              className="auth-input"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as "enabled" | "disabled")
              }
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            <textarea
              className="auth-input shipping-textarea"
              value={refundPolicy}
              onChange={(event) => setRefundPolicy(event.target.value)}
              placeholder="Refund policy"
            />
            <p className="dashboard-muted">
              Editing as {props.user.display_name || props.user.email}. Disabled
              services are hidden from Market search and cannot be called.
            </p>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Schemas</div>
            <label className="dashboard-muted">Input schema JSON</label>
            <textarea
              className="auth-input task-textarea mono"
              value={inputSchema}
              onChange={(event) => setInputSchema(event.target.value)}
            />
            <label className="dashboard-muted">Output schema JSON</label>
            <textarea
              className="auth-input task-textarea mono"
              value={outputSchema}
              onChange={(event) => setOutputSchema(event.target.value)}
            />
            <label className="dashboard-muted">Examples JSON</label>
            <textarea
              className="auth-input task-textarea mono"
              value={examples}
              onChange={(event) => setExamples(event.target.value)}
            />
            <div className="dashboard-actions">
              <button className="auth-button primary" type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Save service"}
              </button>
            </div>
          </article>
        </form>
      </section>
    </main>
  );
}
