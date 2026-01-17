import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { NextResponse } from "next/server";

type FinalizePayload = {
  taskId: string;
  status: "running" | "paused";
  clientAccumulatedMs: number; // what client thinks total is at close time
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as FinalizePayload;

    if (!body?.taskId || !body?.status) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload" },
        { status: 400 },
      );
    }

    // On tab close: “finish running task and update db”
    // We mark it as finished and set ended_at now. duration_ms = clientAccumulatedMs.
    const { error } = await supabaseAdmin
      .from("tasks")
      .update({
        status: "finished",
        ended_at: new Date().toISOString(),
        duration_ms: Math.max(0, Math.floor(body.clientAccumulatedMs)),
        accumulated_ms: Math.max(0, Math.floor(body.clientAccumulatedMs)),
      })
      .eq("id", body.taskId)
      .in("status", ["running", "paused"]); // only finalize if not already finished

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
