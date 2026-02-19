export interface ServiceEndpoint {
  method: string;
  path: string;
  description: string;
  params: Record<
    string,
    { type: string; required: boolean; description: string }
  >;
}

export interface ServiceManifest {
  id: string;
  name: string;
  description: string;
  category:
    | "commerce"
    | "communication"
    | "finance"
    | "compute"
    | "provisioning";
  status: "active" | "beta" | "coming_soon";
  endpoints: ServiceEndpoint[];
  docsMarkdown: string;
}
