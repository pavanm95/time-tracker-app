import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { NextResponse } from "next/server";

type ProfilePayload = {
  userId: string;
  username: string;
  fullName?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProfilePayload;
    const userId = body?.userId?.trim();
    const username = body?.username?.trim().toLowerCase();
    const fullName = body?.fullName?.trim() ?? null;

    if (!userId || !username) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload" },
        { status: 400 },
      );
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { ok: false, error: existingError.message },
        { status: 500 },
      );
    }

    if (existing && existing.id !== userId) {
      return NextResponse.json(
        { ok: false, error: "Username already exists" },
        { status: 409 },
      );
    }

    if (!existing) {
      const { error } = await supabaseAdmin.from("user_profiles").insert({
        id: userId,
        username,
        full_name: fullName,
      });

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
