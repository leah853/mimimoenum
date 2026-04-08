import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Check if user exists in our users table, create if not
      const serviceClient = await createServiceClient();

      // Check allowed_emails
      const { data: allowed } = await serviceClient
        .from("allowed_emails")
        .select("role")
        .eq("email", data.user.email)
        .single();

      if (!allowed) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=not_allowed`);
      }

      // Upsert user record
      await serviceClient.from("users").upsert(
        {
          auth_id: data.user.id,
          email: data.user.email!,
          full_name:
            data.user.user_metadata?.full_name ||
            data.user.email!.split("@")[0],
          role: allowed.role,
        },
        { onConflict: "auth_id" }
      );

      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
