import { NextResponse } from "next/server";

import { leadSchema } from "@/lib/lead-schema";
import { persistLead } from "@/lib/lead-store";

export async function POST(request: Request) {
  const payload = await request.json();
  const parsed = leadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  await persistLead(parsed.data);

  return NextResponse.json({ ok: true }, { status: 201 });
}
