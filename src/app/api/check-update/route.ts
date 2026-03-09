import { NextResponse } from "next/server";
import { checkForUpdate, requestSelfUpdate } from "@/lib/update";

export const dynamic = "force-dynamic";

export async function GET() {
  const currentHash = process.env.NEXT_PUBLIC_GIT_HASH || "";
  const isBunx = !!process.env.BUNX_MODE;

  if (!isBunx) {
    return NextResponse.json({
      currentHash: currentHash || "",
      latestHash: null,
      updateAvailable: false,
      devMode: true,
    });
  }

  try {
    const result = await checkForUpdate(currentHash);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST() {
  if (!process.env.BUNX_MODE) {
    return NextResponse.json(
      { error: "Self-update is only available when running via bunx." },
      { status: 400 }
    );
  }

  requestSelfUpdate();
  return NextResponse.json({ ok: true });
}
