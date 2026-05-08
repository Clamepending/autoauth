import { publicComputerUseDeprecated } from "@/lib/legacy-api";

export async function GET() {
  return publicComputerUseDeprecated("/api/services/computeruse/runs/:runId/events");
}

export async function POST() {
  return publicComputerUseDeprecated("/api/services/computeruse/runs/:runId/events");
}
