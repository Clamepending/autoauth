import { publicComputerUseDeprecated } from "@/lib/legacy-api";

export async function GET() {
  return publicComputerUseDeprecated("/api/services/computeruse/tasks/:taskId");
}

export async function POST() {
  return publicComputerUseDeprecated("/api/services/computeruse/tasks/:taskId");
}
