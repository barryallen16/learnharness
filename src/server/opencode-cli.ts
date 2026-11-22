import { inspectOpenCodeCliInstallation } from "../agent/opencode-cli/installation.ts";
import { initAuthEnv } from "./keys.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";
import { opencodeCliEnabled } from "./opencode-cli-config.ts";

export async function opencodeCliInstallationStatus() {
	initAuthEnv();
	return inspectOpenCodeCliInstallation();
}

export async function opencodeCliInstallationResponse(
	request: Request,
	inspect = opencodeCliInstallationStatus,
	enabled = opencodeCliEnabled,
): Promise<Response> {
	const origin = subscriptionRequestOrigin(request);
	const supplied = request.headers.get("origin");
	const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
	if (request.method !== "GET" || !origin
		|| request.headers.get("x-learnharness-opencode-cli") !== "1"
		|| request.headers.get("sec-fetch-site") === "cross-site"
		|| (supplied !== null && supplied !== origin)) {
		return Response.json({ error: "OpenCode CLI checks require a same-origin LearnHarness request." }, { status: 403, headers });
	}
	const runInspect = typeof inspect === "function" ? inspect : opencodeCliInstallationStatus;
	const runEnabled = typeof enabled === "function" ? enabled : opencodeCliEnabled;
	if (!runEnabled()) return Response.json({ error: "OpenCode CLI is disabled." }, { status: 403, headers });
	return Response.json(await runInspect(), { headers });
}
