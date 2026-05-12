import { NextResponse } from "next/server";

import { leadSchema } from "@/lib/lead-schema";
import { persistLead } from "@/lib/lead-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  const parsed = leadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid payload." },
      { status: 400 },
    );
  }

  try {
    await persistLead(parsed.data);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unable to record your request." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
