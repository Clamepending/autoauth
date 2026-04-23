import { NextResponse } from "next/server";
import { getActiveMacrosForDomain } from "@/lib/macro-mining-store";

/**
 * GET /api/macros/:domain
 * Extension fetches active macros for a domain at loop start.
 *
 * Returns: { macros: MinedMacro[] }
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> },
) {
  try {
    const { domain } = await params;
    if (!domain) {
      return NextResponse.json({ error: "Missing domain" }, { status: 400 });
    }

    const records = await getActiveMacrosForDomain(domain);
    const macros = records.map((r) => {
      try {
        return JSON.parse(r.macro_json);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return NextResponse.json({ macros });
  } catch (err) {
    console.error("[macros/domain] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
