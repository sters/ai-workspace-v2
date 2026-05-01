import { NextResponse } from "next/server";
import {
  ConfigValidationError,
  getConfig,
  validateOpeners,
} from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const { openers } = getConfig();
  try {
    validateOpeners(openers);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      return NextResponse.json(
        { error: `Invalid openers config: ${err.message}` },
        { status: 500 },
      );
    }
    throw err;
  }
  return NextResponse.json({ openers });
}
