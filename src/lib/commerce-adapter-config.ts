export type CommerceFulfillmentCategory = "api" | "zinc" | "ottoauth_agents";

function env(name: string) {
  return (process.env[name] || "").trim();
}

export function commerceEnv(name: string, fallback = "") {
  return env(name) || fallback;
}

export function directApiAdapterConfigured(adapterId: string) {
  switch (adapterId) {
    case "api.mouser":
      return Boolean(env("OTTOAUTH_MOUSER_API_KEY") || env("MOUSER_API_KEY"));
    case "api.digikey":
      return Boolean(
        (env("OTTOAUTH_DIGIKEY_ACCESS_TOKEN") || env("DIGIKEY_ACCESS_TOKEN")) &&
          (env("OTTOAUTH_DIGIKEY_CLIENT_ID") || env("DIGIKEY_CLIENT_ID")),
      );
    case "api.treatstock":
      return Boolean(env("OTTOAUTH_TREATSTOCK_PRIVATE_KEY") || env("TREATSTOCK_PRIVATE_KEY"));
    case "api.xometry":
      return Boolean(env("OTTOAUTH_XOMETRY_API_BASE_URL") && env("OTTOAUTH_XOMETRY_API_KEY"));
    case "api.protolabs":
      return Boolean(env("OTTOAUTH_PROTOLABS_API_BASE_URL") && env("OTTOAUTH_PROTOLABS_API_KEY"));
    case "api.fictiv":
      return Boolean(env("OTTOAUTH_FICTIV_API_BASE_URL") && env("OTTOAUTH_FICTIV_API_KEY"));
    default:
      return false;
  }
}

export function configuredDirectApiAdapterIds() {
  return [
    "api.mouser",
    "api.digikey",
    "api.treatstock",
    "api.xometry",
    "api.protolabs",
    "api.fictiv",
  ].filter(directApiAdapterConfigured);
}
