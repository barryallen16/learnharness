import { opencodeCliInstallationResponse } from "@/src/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
	return opencodeCliInstallationResponse(request);
}
