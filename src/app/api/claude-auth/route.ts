import { checkAuthStatus } from "@/lib/claude/login";

export async function GET() {
  try {
    const raw = await checkAuthStatus();
    const status = JSON.parse(raw);
    return Response.json(status);
  } catch (err) {
    return Response.json(
      { error: String(err), loggedIn: false },
      { status: 500 },
    );
  }
}
