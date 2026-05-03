"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AdminRestartOrderButtonProps = {
  taskId: number;
  disabled?: boolean;
};

export function AdminRestartOrderButton({
  taskId,
  disabled = false,
}: AdminRestartOrderButtonProps) {
  const router = useRouter();
  const [isRestarting, setIsRestarting] = useState(false);

  async function restartOrder() {
    if (disabled || isRestarting) return;
    const confirmed = window.confirm(
      `Restart order #${taskId}? Active in-flight work for this order will be marked failed before the replacement is queued.`,
    );
    if (!confirmed) return;

    setIsRestarting(true);
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}/restart`, {
        method: "POST",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || "Restart failed.");
        return;
      }
      router.refresh();
    } catch {
      window.alert("Restart request failed.");
    } finally {
      setIsRestarting(false);
    }
  }

  return (
    <button
      type="button"
      className="admin-mini-button danger"
      disabled={disabled || isRestarting}
      onClick={restartOrder}
    >
      {isRestarting ? "Restarting..." : "Restart"}
    </button>
  );
}
