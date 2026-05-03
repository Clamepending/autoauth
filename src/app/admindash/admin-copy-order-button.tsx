"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AdminCopyOrderButtonProps = {
  taskId: number;
};

export function AdminCopyOrderButton({ taskId }: AdminCopyOrderButtonProps) {
  const router = useRouter();
  const [isCopying, setIsCopying] = useState(false);

  async function copyOrder() {
    if (isCopying) return;
    const confirmed = window.confirm(
      `Issue a new order copied from #${taskId}? The original order will be left unchanged.`,
    );
    if (!confirmed) return;

    setIsCopying(true);
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}/copy`, {
        method: "POST",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || "Copy failed.");
        return;
      }
      const nextTaskId = data?.task?.id;
      if (nextTaskId) {
        router.push(`/admindash/orders/${nextTaskId}`);
        router.refresh();
        return;
      }
      router.refresh();
    } catch {
      window.alert("Copy request failed.");
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <button
      type="button"
      className="admin-button primary"
      disabled={isCopying}
      onClick={copyOrder}
    >
      {isCopying ? "Issuing..." : "Copy as new order"}
    </button>
  );
}
