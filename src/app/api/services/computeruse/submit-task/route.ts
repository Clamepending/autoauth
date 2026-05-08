import { publicComputerUseDeprecated } from "@/lib/legacy-api";

export async function GET() {
  return publicComputerUseDeprecated("/api/services/computeruse/submit-task");
}

export async function POST() {
  return publicComputerUseDeprecated("/api/services/computeruse/submit-task");
}
