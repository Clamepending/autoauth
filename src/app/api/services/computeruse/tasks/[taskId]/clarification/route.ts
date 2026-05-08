import { publicComputerUseDeprecated } from "@/lib/legacy-api";

export async function POST() {
  return publicComputerUseDeprecated("/api/services/computeruse/tasks/:taskId/clarification");
}
