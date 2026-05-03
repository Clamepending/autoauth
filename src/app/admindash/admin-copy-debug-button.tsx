"use client";

import { useState } from "react";

type AdminCopyDebugButtonProps = {
  text: string;
};

export function AdminCopyDebugButton({ text }: AdminCopyDebugButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyDebugBundle() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.alert("Could not copy the debug bundle.");
    }
  }

  return (
    <button type="button" className="admin-button" onClick={copyDebugBundle}>
      {copied ? "Copied" : "Copy Codex bundle"}
    </button>
  );
}
