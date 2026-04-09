import { NextRequest, NextResponse } from "next/server";

// One-time migration endpoint — creates missing tables
// Hit GET /api/migrate to run
export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const sql = `
    CREATE TABLE IF NOT EXISTS general_chat (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      message text NOT NULL,
      mentions text[] DEFAULT '{}',
      parent_id uuid REFERENCES general_chat(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE general_chat ENABLE ROW LEVEL SECURITY;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'general_chat' AND policyname = 'general_chat_all') THEN
        CREATE POLICY general_chat_all ON general_chat FOR ALL USING (true) WITH CHECK (true);
      END IF;
    END $$;

    ALTER TABLE deliverables ALTER COLUMN file_url DROP NOT NULL;
    ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS description text;
  `;

  // Use Supabase's pg endpoint via service role
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ sql }),
  });

  // If the RPC doesn't exist, try creating it first, then retry
  if (!res.ok) {
    // Fallback: try to use a different approach via node-postgres or pg-meta
    return NextResponse.json({
      status: "manual_migration_needed",
      message: "Please run the following SQL in your Supabase SQL Editor:",
      sql: sql.trim(),
    }, { status: 200 });
  }

  return NextResponse.json({ status: "migrated" });
}
