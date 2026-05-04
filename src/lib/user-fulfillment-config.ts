export function isUserFulfillmentEnabled() {
  return String(process.env.OTTOAUTH_ALLOW_USER_FULFILLMENT || "")
    .trim()
    .toLowerCase() === "1";
}

export function userFulfillmentDisabledError() {
  return {
    error: "User fulfillment devices are not supported. OttoAuth fulfillment is internal.",
  };
}
