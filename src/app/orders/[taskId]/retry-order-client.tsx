"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type RetryOrderClientProps = {
  taskId: number;
  taskTitle: string | null;
};

export function RetryOrderClient({ taskId, taskTitle }: RetryOrderClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  async function retryOrder() {
    setError(null);
    setIsRetrying(true);
    try {
      const response = await fetch(`/api/human/tasks/${taskId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; task?: { id?: number } }
        | null;
      if (!response.ok || !payload?.task?.id) {
        throw new Error(payload?.error || "Failed to retry this order.");
      }
      router.push(`/orders/${payload.task.id}`);
      router.refresh();
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Failed to retry this order.",
      );
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <section
      aria-label="Retry failed order"
      style={{
        border: "2px solid #111",
        margin: "0 auto 48px",
        maxWidth: "900px",
        padding: "24px",
        background: "#f7f7f4",
      }}
    >
      <p
        style={{
          fontSize: "0.75rem",
          fontWeight: 800,
          letterSpacing: "0.12em",
          margin: "0 0 8px",
          textTransform: "uppercase",
        }}
      >
        Retry order
      </p>
      <h2 style={{ fontSize: "1.5rem", margin: "0 0 10px" }}>
        Start a fresh fulfillment run
      </h2>
      <p style={{ lineHeight: 1.5, margin: "0 0 18px", maxWidth: "620px" }}>
        This failed order can be requeued with the same request, spend cap, site,
        and delivery details{taskTitle ? ` for "${taskTitle}"` : ""}.
      </p>
      <button
        type="button"
        onClick={retryOrder}
        disabled={isRetrying}
        style={{
          background: "#050505",
          border: "2px solid #050505",
          color: "#fff",
          cursor: isRetrying ? "wait" : "pointer",
          font: "inherit",
          fontWeight: 800,
          padding: "0.8rem 1.1rem",
        }}
      >
        {isRetrying ? "Requeueing..." : "Retry as new order"}
      </button>
      {error ? (
        <p style={{ color: "#9f1d1d", margin: "14px 0 0" }}>{error}</p>
      ) : null}
    </section>
  );
}
