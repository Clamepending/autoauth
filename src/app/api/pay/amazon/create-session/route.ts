import { deprecatedApiResponse } from "@/lib/legacy-api";

export async function POST() {
  return deprecatedApiResponse({
    legacyPath: "/api/pay/amazon/create-session",
    replacementPath: "/api/services/order/submit",
    message:
      "Amazon-specific payment session creation is deprecated. Submit Amazon orders through the canonical order API with store='amazon'.",
  });
}
