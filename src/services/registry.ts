import type { ServiceManifest } from "@/services/_shared/types";
import { getManifest as getAmazonManifest } from "@/services/amazon/manifest";
import { getManifest as getComputerUseManifest } from "@/services/computeruse/manifest";

/**
 * Static stubs for services that are announced but not yet implemented.
 * As each service is built out, move it to its own manifest module.
 */
const COMING_SOON: ServiceManifest[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Create its own GitHub account",
    category: "provisioning",
    status: "coming_soon",
    endpoints: [],
    docsMarkdown: "",
  },
  {
    id: "email",
    name: "Email",
    description: "Receive/send email with its own account",
    category: "communication",
    status: "coming_soon",
    endpoints: [],
    docsMarkdown: "",
  },
  {
    id: "doordash",
    name: "DoorDash",
    description: "Order food via DoorDash",
    category: "commerce",
    status: "coming_soon",
    endpoints: [],
    docsMarkdown: "",
  },
  {
    id: "snackpass",
    name: "Snackpass",
    description: "Order food on Snackpass",
    category: "commerce",
    status: "coming_soon",
    endpoints: [],
    docsMarkdown: "",
  },
  {
    id: "other",
    name: "Other",
    description: "Other integration",
    category: "commerce",
    status: "coming_soon",
    endpoints: [],
    docsMarkdown: "",
  },
];

export function getAllManifests(): ServiceManifest[] {
  return [getAmazonManifest(), getComputerUseManifest(), ...COMING_SOON];
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
