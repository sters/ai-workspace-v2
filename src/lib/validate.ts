import { NextResponse } from "next/server";
import type z from "zod";

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; response: NextResponse };

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): ParseResult<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join("; ");
    return {
      success: false,
      response: NextResponse.json({ error: message }, { status: 400 }),
    };
  }
  return { success: true, data: result.data };
}
