import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { externalCliEnv } from "../../core/auth-env.ts";
import { OPENCODE_CLI_MINIMUM_VERSION, type OpenCodeCliStatus } from "../../core/contracts/opencode-cli.ts";
import { getOpenCodeCliBinary } from "./binary.ts";

export type ReadOpenCodeCliVersion = (binary: string) => Promise<string>;

export const readOpenCodeCliVersion: ReadOpenCodeCliVersion = (binary) => new Promise((resolve, reject) => {
	execFile(binary, ["--version"], {
		cwd: tmpdir(), env: externalCliEnv(), windowsHide: true,
		timeout: 5_000, killSignal: "SIGKILL", maxBuffer: 4_096,
	}, (error, stdout) => error ? reject(error) : resolve(stdout));
});

export async function inspectOpenCodeCliInstallation(
	findBinary: () => string | null = getOpenCodeCliBinary,
	readVersion: ReadOpenCodeCliVersion = readOpenCodeCliVersion,
): Promise<OpenCodeCliStatus> {
	const base = { version: null, minimumVersion: OPENCODE_CLI_MINIMUM_VERSION };
	const binary = findBinary();
	if (!binary) return { ...base, state: "not-found" };
	try {
		const output = await readVersion(binary);
		const match = /(?:opencode\s+|v)?(\d+)\.(\d+)\.(\d+)/i.exec(output.trim());
		if (!match) return { ...base, state: "version-unchecked" };
		const parts = match.slice(1, 4).map(Number);
		if (!parts.every(Number.isSafeInteger)) return { ...base, state: "version-unchecked" };
		const minimum = OPENCODE_CLI_MINIMUM_VERSION.split(".").map(Number);
		const differing = parts.findIndex((part, index) => part !== minimum[index]);
		const meetsMinimum = differing === -1 || parts[differing]! > minimum[differing]!;
		return { ...base, version: parts.join("."), state: meetsMinimum ? "meets-minimum" : "update-required" };
	} catch {
		return { ...base, state: "version-unchecked" };
	}
}
