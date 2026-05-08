import { publicComputerUseDeprecated } from "@/lib/legacy-api";

export async function GET() {
  return publicComputerUseDeprecated("/api/computeruse/register-device");
}

export async function POST() {
  return publicComputerUseDeprecated("/api/computeruse/register-device");
}
