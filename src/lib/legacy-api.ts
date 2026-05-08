import { NextResponse } from "next/server";

import { getBaseUrl } from "@/lib/base-url";

export function deprecatedApiResponse(params: {
  legacyPath: string;
  replacementPath: string;
  message?: string;
}) {
  const baseUrl = getBaseUrl();
  const replacementUrl = `${baseUrl}${params.replacementPath}`;
  return NextResponse.json(
    {
      error: "Deprecated API.",
      deprecated: true,
      legacy_path: params.legacyPath,
      replacement_path: params.replacementPath,
      replacement_url: replacementUrl,
      message:
        params.message ||
        "This browser-task API is no longer part of the public OttoAuth contract. Use the canonical order API instead.",
    },
    {
      status: 410,
      headers: {
        Deprecation: "true",
        Link: `<${replacementUrl}>; rel="successor-version"`,
      },
    },
  );
}

export function publicComputerUseDeprecated(legacyPath: string) {
  return deprecatedApiResponse({
    legacyPath,
    replacementPath: "/api/services/order/submit",
    message:
      "Public browser-use fulfillment endpoints are deprecated. Submit commerce through /api/services/order/submit, then use the returned order id for status, messages, clarification, cancellation, and disputes.",
  });
}
