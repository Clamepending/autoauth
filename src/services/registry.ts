import type { ServiceManifest } from "@/services/_shared/types";
import { getManifest as getAmazonManifest } from "@/services/amazon/manifest";
import { getManifest as getComputerUseManifest } from "@/services/computeruse/manifest";
import { getManifest as getSnackpassManifest } from "@/services/snackpass/manifest";

export function getAllManifests(): ServiceManifest[] {
  return [
    getAmazonManifest(),
    getComputerUseManifest(),
    getSnackpassManifest(),
  ];
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
