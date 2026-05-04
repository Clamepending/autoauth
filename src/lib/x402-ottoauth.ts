import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  HTTPFacilitatorClient,
  type ResourceConfig,
  x402ResourceServer,
} from "@x402/core/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  ResourceInfo,
  SettleResponse,
} from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";

import {
  addCreditLedgerEntry,
  findCreditLedgerEntry,
} from "@/lib/human-accounts";

const DEFAULT_X402_NETWORK = "eip155:84532";
const DEFAULT_X402_FACILITATOR_URL = "https://x402.org/facilitator";
export const DEFAULT_X402_TOP_UP_CENTS = 5000;

let serverPromise: Promise<x402ResourceServer> | null = null;

type X402FundingResource = {
  humanUserId: number;
  amountCents: number;
  request: Request;
  resourcePath: string;
  description: string;
  reason: string;
  agentUsernameLower?: string | null;
  metadata?: Record<string, unknown>;
};

type X402FundingResult =
  | {
      ok: true;
      settlement: SettleResponse;
      responseHeaders: Headers;
      alreadyRecorded: boolean;
    }
  | {
      ok: false;
      response: NextResponse;
    };

function env(name: string) {
  return (process.env[name] || "").trim();
}

function x402PayTo() {
  return env("OTTOAUTH_X402_PAY_TO") || env("X402_PAY_TO");
}

function x402Network(): Network {
  return (env("OTTOAUTH_X402_NETWORK") || DEFAULT_X402_NETWORK) as Network;
}

function x402FacilitatorUrl() {
  return env("OTTOAUTH_X402_FACILITATOR_URL") || DEFAULT_X402_FACILITATOR_URL;
}

function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function centsFromEnv(name: string, fallback: number) {
  const parsed = Number(env(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function defaultX402TopUpCents() {
  return centsFromEnv("OTTOAUTH_X402_DEFAULT_TOP_UP_CENTS", DEFAULT_X402_TOP_UP_CENTS);
}

export function isX402FundingConfigured() {
  return Boolean(x402PayTo());
}

async function getX402Server() {
  if (!serverPromise) {
    const facilitatorClient = new HTTPFacilitatorClient({
      url: x402FacilitatorUrl(),
    });
    serverPromise = (async () => {
      const server = new x402ResourceServer(facilitatorClient).register(
        x402Network(),
        new ExactEvmScheme(),
      );
      await server.initialize();
      return server;
    })();
  }
  return serverPromise;
}

function makeResourceInfo(params: X402FundingResource): ResourceInfo {
  const url = new URL(params.resourcePath, params.request.url);
  return {
    url: url.toString(),
    description: params.description,
    mimeType: "application/json",
  };
}

function makeResourceConfig(params: X402FundingResource): ResourceConfig {
  const payTo = x402PayTo();
  if (!payTo) {
    throw new Error("OTTOAUTH_X402_PAY_TO is required for x402 funding.");
  }
  return {
    scheme: "exact",
    network: x402Network(),
    payTo,
    price: formatUsd(params.amountCents),
    maxTimeoutSeconds: 300,
    extra: {
      service: "ottoauth",
      reason: params.reason,
      amount_cents: params.amountCents,
      human_user_id: params.humanUserId,
      agent_username_lower: params.agentUsernameLower ?? null,
      ...params.metadata,
    },
  };
}

function paymentSignatureHeader(request: Request) {
  return (
    request.headers.get("payment-signature") ||
    request.headers.get("PAYMENT-SIGNATURE") ||
    request.headers.get("x-payment") ||
    request.headers.get("X-PAYMENT") ||
    ""
  ).trim();
}

function decodePaymentPayload(request: Request): PaymentPayload | null {
  const header = paymentSignatureHeader(request);
  if (!header) return null;
  return decodePaymentSignatureHeader(header);
}

async function createPaymentRequired(params: X402FundingResource, error: string) {
  const server = await getX402Server();
  const requirements = await server.buildPaymentRequirements(makeResourceConfig(params));
  return server.createPaymentRequiredResponse(
    requirements,
    makeResourceInfo(params),
    error,
    undefined,
    {
      request: {
        method: params.request.method,
        url: params.request.url,
      },
    },
  );
}

function paymentRequiredResponse(params: {
  paymentRequired: PaymentRequired;
  amountCents: number;
  error: string;
}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "PAYMENT-REQUIRED": encodePaymentRequiredHeader(params.paymentRequired),
  });
  return NextResponse.json(
    {
      error: params.error,
      payment_protocol: "x402",
      x402_version: params.paymentRequired.x402Version,
      amount_cents: params.amountCents,
      amount: formatUsd(params.amountCents),
      resource: params.paymentRequired.resource,
      accepts: params.paymentRequired.accepts,
    },
    { status: 402, headers },
  );
}

function paymentConfigurationResponse(amountCents: number) {
  return NextResponse.json(
    {
      error: "OttoAuth x402 funding is not configured.",
      payment_protocol: "x402",
      x402_configured: false,
      amount_cents: amountCents,
      configure: "Set OTTOAUTH_X402_PAY_TO to the OttoAuth receiving wallet address.",
    },
    { status: 402, headers: { "Cache-Control": "no-store" } },
  );
}

function facilitatorUnavailableResponse(amountCents: number, error: unknown) {
  const message = error instanceof Error ? error.message : "x402 facilitator unavailable.";
  return NextResponse.json(
    {
      error: "OttoAuth could not prepare the x402 payment challenge.",
      detail: message,
      payment_protocol: "x402",
      amount_cents: amountCents,
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function settlementReference(settlement: SettleResponse, paymentPayload: PaymentPayload) {
  if (settlement.transaction?.trim()) return settlement.transaction.trim();
  return createHash("sha256").update(JSON.stringify(paymentPayload)).digest("hex");
}

export async function requireX402Funding(params: X402FundingResource): Promise<X402FundingResult> {
  const amountCents = Math.trunc(params.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "A positive x402 amount is required." },
        { status: 400 },
      ),
    };
  }
  if (!isX402FundingConfigured()) {
    return { ok: false, response: paymentConfigurationResponse(amountCents) };
  }

  let paymentPayload: PaymentPayload | null = null;
  try {
    paymentPayload = decodePaymentPayload(params.request);
  } catch (error) {
    const paymentRequired = await createPaymentRequired(
      { ...params, amountCents },
      error instanceof Error ? error.message : "Invalid x402 payment payload.",
    );
    return {
      ok: false,
      response: paymentRequiredResponse({
        paymentRequired,
        amountCents,
        error: "Invalid x402 payment payload.",
      }),
    };
  }

  if (!paymentPayload) {
    try {
      const paymentRequired = await createPaymentRequired(
        { ...params, amountCents },
        "Payment required",
      );
      return {
        ok: false,
        response: paymentRequiredResponse({
          paymentRequired,
          amountCents,
          error: "Payment required",
        }),
      };
    } catch (error) {
      return { ok: false, response: facilitatorUnavailableResponse(amountCents, error) };
    }
  }

  try {
    const server = await getX402Server();
    const resourceConfig = makeResourceConfig({ ...params, amountCents });
    const resourceInfo = makeResourceInfo(params);
    const requirements = await server.buildPaymentRequirements(resourceConfig);
    const paymentRequired = await server.createPaymentRequiredResponse(
      requirements,
      resourceInfo,
      undefined,
    );
    const matchingRequirements = server.findMatchingRequirements(
      paymentRequired.accepts,
      paymentPayload,
    );
    if (!matchingRequirements) {
      const retryChallenge = await createPaymentRequired(
        { ...params, amountCents },
        "No matching x402 payment requirements found.",
      );
      return {
        ok: false,
        response: paymentRequiredResponse({
          paymentRequired: retryChallenge,
          amountCents,
          error: "No matching x402 payment requirements found.",
        }),
      };
    }

    const verification = await server.verifyPayment(paymentPayload, matchingRequirements);
    if (!verification.isValid) {
      const retryChallenge = await createPaymentRequired(
        { ...params, amountCents },
        verification.invalidMessage || verification.invalidReason || "Invalid x402 payment.",
      );
      return {
        ok: false,
        response: paymentRequiredResponse({
          paymentRequired: retryChallenge,
          amountCents,
          error: verification.invalidMessage || verification.invalidReason || "Invalid x402 payment.",
        }),
      };
    }

    const settlement = await server.settlePayment(paymentPayload, matchingRequirements);
    if (!settlement.success) {
      const retryChallenge = await createPaymentRequired(
        { ...params, amountCents },
        settlement.errorMessage || settlement.errorReason || "x402 settlement failed.",
      );
      return {
        ok: false,
        response: paymentRequiredResponse({
          paymentRequired: retryChallenge,
          amountCents,
          error: settlement.errorMessage || settlement.errorReason || "x402 settlement failed.",
        }),
      };
    }

    const referenceId = settlementReference(settlement, paymentPayload);
    const existingEntry = await findCreditLedgerEntry({
      humanUserId: params.humanUserId,
      entryType: "x402_refill",
      referenceType: "x402_payment",
      referenceId,
    });
    if (!existingEntry) {
      await addCreditLedgerEntry({
        humanUserId: params.humanUserId,
        amountCents,
        entryType: "x402_refill",
        description: `x402 OttoAuth funding (${formatUsd(amountCents)})`,
        referenceType: "x402_payment",
        referenceId,
        metadata: {
          reason: params.reason,
          amount_cents: amountCents,
          network: settlement.network,
          transaction: settlement.transaction,
          payer: settlement.payer ?? verification.payer ?? null,
          agent_username_lower: params.agentUsernameLower ?? null,
          ...params.metadata,
        },
      });
    }

    const responseHeaders = new Headers({
      "PAYMENT-RESPONSE": encodePaymentResponseHeader(settlement),
    });
    return {
      ok: true,
      settlement,
      responseHeaders,
      alreadyRecorded: Boolean(existingEntry),
    };
  } catch (error) {
    return { ok: false, response: facilitatorUnavailableResponse(amountCents, error) };
  }
}
