"use client";

import { useEffect, useState } from "react";

type ImportState =
  | { status: "loading"; message: string }
  | { status: "error"; message: string };

function isLocalPayloadUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not import this checkout.";
}

export function CheckoutImportClient({ payloadUrl }: { payloadUrl: string }) {
  const [state, setState] = useState<ImportState>({
    status: "loading",
    message: "Loading order from the local app...",
  });

  useEffect(() => {
    let canceled = false;

    async function run() {
      try {
        if (!payloadUrl || !isLocalPayloadUrl(payloadUrl)) {
          throw new Error("Checkout import requires a localhost payload URL.");
        }

        setState({
          status: "loading",
          message: "Loading order from the local app...",
        });
        const handoffResponse = await fetch(payloadUrl, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const handoffPayload = await handoffResponse.json().catch(() => null);
        if (!handoffResponse.ok) {
          throw new Error(
            typeof handoffPayload?.error === "string"
              ? handoffPayload.error
              : "The local app could not provide the order.",
          );
        }
        const checkoutPayload = handoffPayload?.checkout ?? handoffPayload;
        if (!checkoutPayload || typeof checkoutPayload !== "object") {
          throw new Error("The local app returned an invalid checkout payload.");
        }

        if (!canceled) {
          setState({
            status: "loading",
            message: "Uploading files to OttoAuth...",
          });
        }
        const checkoutResponse = await fetch("/v1/checkout/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(checkoutPayload),
        });
        const checkout = await checkoutResponse.json().catch(() => null);
        if (!checkoutResponse.ok) {
          throw new Error(
            typeof checkout?.error === "string"
              ? checkout.error
              : "OttoAuth could not create the checkout.",
          );
        }

        const checkoutUrl =
          typeof checkout?.url === "string"
            ? checkout.url
            : typeof checkout?.session?.url === "string"
              ? checkout.session.url
              : "";
        if (!checkoutUrl) {
          throw new Error("OttoAuth did not return a checkout URL.");
        }
        window.location.replace(checkoutUrl);
      } catch (error) {
        if (!canceled) {
          setState({ status: "error", message: errorMessage(error) });
        }
      }
    }

    run();
    return () => {
      canceled = true;
    };
  }, [payloadUrl]);

  return (
    <div
      className={state.status === "error" ? "auth-error" : "auth-success"}
      aria-live="polite"
    >
      {state.message}
    </div>
  );
}
