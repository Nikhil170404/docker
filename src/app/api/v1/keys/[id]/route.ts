import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth/session";
import { revokeApiKey } from "@/lib/server/api-key-repository";

/** Revokes a key. Scoped to its owner, so one customer cannot revoke another's. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in first." } },
      { status: 401 },
    );
  }

  const revoked = await revokeApiKey(user.id, (await params).id);
  if (!revoked) {
    return NextResponse.json(
      { error: { code: "not_found", message: "No such key." } },
      { status: 404 },
    );
  }
  return new NextResponse(null, { status: 204 });
}
