export type OttoAuthPayProtectConfig = {
  serviceId: number | string;
  price: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

export type OttoAuthPayRequestContext = {
  serviceId: string;
  callId: string;
  capability: string | null;
};

export function createOttoAuthPay() {
  return {
    protect(config: OttoAuthPayProtectConfig) {
      return async function protectRequest<T>(
        request: Request,
        handler: (context: OttoAuthPayRequestContext) => Promise<T> | T,
      ) {
        const serviceId = request.headers.get("x-ottoauth-service-id");
        const callId = request.headers.get("x-ottoauth-call-id");
        if (!serviceId || !callId || serviceId !== String(config.serviceId)) {
          return new Response(
            JSON.stringify({
              error: "Missing or invalid OttoAuth Pay service headers.",
            }),
            {
              status: 402,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return handler({
          serviceId,
          callId,
          capability: request.headers.get("x-ottoauth-capability"),
        });
      };
    },
  };
}

export const ottoauthPay = createOttoAuthPay();
