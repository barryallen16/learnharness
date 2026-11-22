import { spawn } from "node:child_process";
import type { OpenCodeCliStatus } from "../../core/contracts/opencode-cli.ts";
import { getOpenCodeCliBinary } from "./binary.ts";
import { inspectOpenCodeCliInstallation, readOpenCodeCliVersion, type ReadOpenCodeCliVersion } from "./installation.ts";
import type { RunOpenCodeCli } from "./stream.ts";

export class OpenCodeCliLaunchError extends Error {}

const VERSION_CACHE_TTL_MS = 60_000;

export function createOpenCodeCliLauncher({
	findBinary = getOpenCodeCliBinary,
	readVersion = readOpenCodeCliVersion,
	spawnProcess = spawn,
}: {
	findBinary?: () => string | null;
	readVersion?: ReadOpenCodeCliVersion;
	spawnProcess?: typeof spawn;
} = {}): RunOpenCodeCli {
	let cachedStatus: { status: OpenCodeCliStatus; timestamp: number } | null = null;

	return async (args, options) => {
		if (options.signal?.aborted) throw new OpenCodeCliLaunchError("Request was aborted");
		const binary = findBinary();
		if (!binary) return null;
		const now = Date.now();
		const status = (cachedStatus && (now - cachedStatus.timestamp < VERSION_CACHE_TTL_MS))
			? cachedStatus.status
			: await inspectOpenCodeCliInstallation(() => binary, readVersion);
		if (status.state === "meets-minimum") {
			cachedStatus = { status, timestamp: now };
		}
		if (status.state === "update-required") {
			throw new OpenCodeCliLaunchError(`OpenCode CLI ${status.version} requires an update. LearnHarness requires at least ${status.minimumVersion}; update OpenCode CLI outside LearnHarness.`);
		}
		if (status.state !== "meets-minimum") {
			throw new OpenCodeCliLaunchError("OpenCode CLI's version could not be checked. Check your installation outside LearnHarness and try again.");
		}
		if (options.signal?.aborted) throw new OpenCodeCliLaunchError("Request was aborted");
		return spawnProcess(binary, args, { cwd: options.cwd, env: options.env, stdio: "pipe" });
	};
}
