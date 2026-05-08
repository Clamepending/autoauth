import { publicComputerUseDeprecated } from "@/lib/legacy-api";

export async function GET() {
  return publicComputerUseDeprecated("/api/computeruse/runs");
}

export async function POST() {
  return publicComputerUseDeprecated("/api/computeruse/runs");
}
