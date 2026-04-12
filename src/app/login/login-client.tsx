"use client";

import type { FormEvent } from "react";
import { useState } from "react";

export function DevLoginForm(props: { referralCode?: string | null }) {
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          display_name: data.get("display_name"),
          ref: props.referralCode ?? null,
        }),
      });
      if (response.ok) {
        window.location.href = "/dashboard";
        return;
      }
      const payload = await response.json().catch(() => null);
      alert(payload?.error || "Developer login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="dev-login-form" onSubmit={handleSubmit}>
      <input
        className="auth-input"
        type="email"
        name="email"
        placeholder="human@example.com"
        required
      />
      <input
        className="auth-input"
        type="text"
        name="display_name"
        placeholder="Human name"
      />
      <button className="auth-button" type="submit" disabled={submitting}>
        {submitting ? "Signing in..." : "Use developer login"}
      </button>
    </form>
  );
}
