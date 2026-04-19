type ApiPickupDetails = {
  order_number?: string | null;
  pickup_name?: string | null;
  [key: string]: unknown;
};

type ApiTaskWithPickupDetails = {
  pickup_details?: ApiPickupDetails | null;
  [key: string]: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function withPickupNameInOrderNumberDisplay<T extends ApiTaskWithPickupDetails>(
  task: T,
): T {
  const details = task.pickup_details;
  const orderNumber = clean(details?.order_number);
  const pickupName = clean(details?.pickup_name);
  if (!details || !orderNumber || !pickupName) return task;

  const normalizedOrderNumber = orderNumber.toLowerCase();
  const normalizedPickupName = pickupName.toLowerCase();
  if (
    normalizedOrderNumber.includes(normalizedPickupName) ||
    normalizedOrderNumber.includes("name:")
  ) {
    return task;
  }

  return {
    ...task,
    pickup_details: {
      ...details,
      order_number: `${orderNumber} - Name: ${pickupName}`,
    },
  };
}
