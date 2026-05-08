import { deprecatedApiResponse } from "@/lib/legacy-api";

export async function POST() {
  return deprecatedApiResponse({
    legacyPath: "/api/pay/snackpass/create-session",
    replacementPath: "/api/services/order/submit",
    message:
      "Snackpass-specific payment session creation is deprecated. Submit Snackpass orders through the canonical order API with store='snackpass'.",
  });
}
