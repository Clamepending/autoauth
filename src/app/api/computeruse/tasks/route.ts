import { publicComputerUseDeprecated } from "@/lib/legacy-api";

export async function GET() {
  return publicComputerUseDeprecated("/api/computeruse/tasks");
}

export async function POST() {
  return publicComputerUseDeprecated("/api/computeruse/tasks");
}
