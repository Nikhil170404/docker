import { createClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  plan: string;
}

export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, plan")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email!,
    name: profile?.name ?? "",
    plan: profile?.plan ?? "free",
  };
}

export async function destroySession() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
