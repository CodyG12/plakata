import { adminHandle } from "@/server/admin-http";
import { builderOptions } from "@/server/admin-questions";

/** GET /api/admin/options: the values the Builder's dropdowns offer (teams, countries, stats…). */
export async function GET(request: Request) {
  return adminHandle(request, async ({ index }) => builderOptions(index));
}
