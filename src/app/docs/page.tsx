import type { Metadata } from "next";

import { getBaseUrl } from "@/lib/base-url";
import { getAgentIntegrationPrompt } from "@/lib/llm-docs";
import { getAllManifests } from "@/services/registry";

import { DocsClient } from "./docs-client";

export const metadata: Metadata = {
  title: "Docs | OttoAuth",
  description:
    "Minimal OttoAuth docs for humans and LLM coding agents.",
};

export const dynamic = "force-dynamic";

export default function DocsPage() {
  const baseUrl = getBaseUrl();

  return (
    <DocsClient
      baseUrl={baseUrl}
      services={getAllManifests()}
      agentIntegrationPrompt={getAgentIntegrationPrompt(baseUrl)}
    />
  );
}
