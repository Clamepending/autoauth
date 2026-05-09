import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_BROWSER_HANDOFF_BYTES = 4 * 1024 * 1024;

function scriptString(value: string) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function renderImportPage(params: {
  payloadText?: string;
  initialError?: string;
  status?: number;
}) {
  const payloadText = params.payloadText ?? "";
  const initialError = params.initialError ?? "";

  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preparing OttoAuth Checkout</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8f7f2;
        color: #111111;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      main {
        width: min(720px, calc(100vw - 40px));
      }
      .eyebrow {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 24px;
        font-size: clamp(38px, 8vw, 84px);
        line-height: 0.94;
        letter-spacing: 0;
      }
      .panel {
        border: 2px solid #111111;
        background: #ffffff;
        box-shadow: 12px 12px 0 #d6d1c4;
        padding: 28px;
      }
      .message {
        margin: 0;
        font-size: 18px;
        line-height: 1.5;
      }
      .message.error {
        color: #9f1d1d;
      }
      .back-link {
        color: #111111;
        display: none;
        font-weight: 800;
        margin-top: 18px;
      }
      .back-link.visible {
        display: inline-block;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">OttoAuth Checkout</p>
      <h1>Preparing Order</h1>
      <section class="panel" aria-live="polite">
        <p class="message" id="message">Loading checkout details...</p>
        <a class="back-link" id="backLink" href="javascript:history.back()">Back to app</a>
      </section>
    </main>
    <script>
      (function () {
        var payloadText = ${scriptString(payloadText)};
        var initialError = ${scriptString(initialError)};
        var message = document.getElementById("message");
        var backLink = document.getElementById("backLink");

        function fail(text) {
          message.textContent = text || "OttoAuth could not prepare this checkout.";
          message.className = "message error";
          backLink.className = "back-link visible";
        }

        async function run() {
          if (initialError) {
            fail(initialError);
            return;
          }
          if (!payloadText) {
            fail("Checkout payload is missing.");
            return;
          }

          var checkoutPayload;
          try {
            checkoutPayload = JSON.parse(payloadText);
          } catch (_error) {
            fail("Checkout payload is invalid.");
            return;
          }

          try {
            message.textContent = "Uploading order and files to OttoAuth...";
            var response = await fetch("/v1/checkout/sessions", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(checkoutPayload)
            });
            var checkout = await response.json().catch(function () {
              return null;
            });
            if (!response.ok) {
              throw new Error(
                checkout && typeof checkout.error === "string"
                  ? checkout.error
                  : "OttoAuth could not create the checkout."
              );
            }
            var checkoutUrl =
              checkout && typeof checkout.url === "string"
                ? checkout.url
                : checkout && checkout.session && typeof checkout.session.url === "string"
                  ? checkout.session.url
                  : "";
            if (!checkoutUrl) {
              throw new Error("OttoAuth did not return a checkout URL.");
            }
            message.textContent = "Opening confirmation...";
            window.location.replace(checkoutUrl);
          } catch (error) {
            fail(error instanceof Error ? error.message : "OttoAuth could not prepare this checkout.");
          }
        }

        run();
      })();
    </script>
  </body>
</html>`,
    {
      status: params.status ?? (initialError ? 400 : 200),
      headers: {
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex",
      },
    },
  );
}

async function payloadTextFromRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const payload = form.get("payload");
    return typeof payload === "string" ? payload : "";
  }

  if (contentType.includes("application/json")) {
    const json = await request.json();
    return JSON.stringify(json);
  }

  return request.text();
}

export async function POST(request: Request) {
  try {
    const payloadText = await payloadTextFromRequest(request);
    if (!payloadText.trim()) {
      return renderImportPage({
        initialError: "Checkout payload is missing.",
        status: 400,
      });
    }

    const byteLength = new TextEncoder().encode(payloadText).length;
    if (byteLength > MAX_BROWSER_HANDOFF_BYTES) {
      return renderImportPage({
        initialError:
          "This checkout is too large for browser handoff. Use a file URL or a local pending payload URL instead.",
        status: 413,
      });
    }

    const parsed = JSON.parse(payloadText);
    return renderImportPage({ payloadText: JSON.stringify(parsed) });
  } catch (error) {
    return renderImportPage({
      initialError:
        error instanceof Error ? error.message : "Checkout payload is invalid.",
      status: 400,
    });
  }
}

export async function GET() {
  return renderImportPage({
    initialError: "Checkout payload is missing.",
    status: 400,
  });
}
