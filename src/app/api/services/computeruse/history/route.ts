import { publicComputerUseDeprecated } from "@/lib/legacy-api";

export async function GET() {
  return publicComputerUseDeprecated("/api/services/computeruse/history");
}

export async function POST() {
  return publicComputerUseDeprecated("/api/services/computeruse/history");
}
