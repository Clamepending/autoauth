import type { ServiceManifest } from "@/services/_shared/types";
import { getManifest as getOrderManifest } from "@/services/order/manifest";

export function getAllManifests(): ServiceManifest[] {
  return [getOrderManifest()];
}

export function getManifest(serviceId: string): ServiceManifest | null {
  return (
    getAllManifests().find((m) => m.id === serviceId.toLowerCase()) ?? null
  );
}

export function getSupportedServiceIds(): string[] {
  return getAllManifests().map((m) => m.id);
}

export function isSupportedService(serviceId: string): boolean {
  return getAllManifests().some((m) => m.id === serviceId.toLowerCase());
}
