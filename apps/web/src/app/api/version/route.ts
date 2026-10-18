// A public commit ID lets us verify that the existing host serves a pushed update.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ revision: process.env.VERCEL_GIT_COMMIT_SHA ?? "local" });
}
