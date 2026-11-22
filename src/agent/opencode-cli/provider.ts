import { execFile } from "node:child_process";
import { createProvider, type Api, type Model, type Provider, type SimpleStreamOptions, type StreamFunction } from "@earendil-works/pi-ai";

import { OPENCODE_CLI_API, OPENCODE_CLI_PROVIDER } from "./constants.ts";
import { getOpenCodeCliBinary } from "./binary.ts";
import { createOpenCodeCliLauncher } from "./launch.ts";
import { createOpenCodeCliStreamFunction } from "./stream.ts";

const SHARED_MODEL_FIELDS = {
	api: OPENCODE_CLI_API,
	provider: OPENCODE_CLI_PROVIDER,
	baseUrl: "",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	reasoning: true,
	thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
	contextWindow: 200_000,
	maxTokens: 64_000,
} satisfies Omit<Model<Api>, "id" | "name">;

export function formatOpenCodeModelName(id: string): string {
	const withoutPrefix = id.replace(/^opencode\//, "");
	const withoutSuffix = withoutPrefix.replace(/-free$/, "");
	const parts = withoutSuffix.split(/[-_]/).map((w) => {
		if (/^v\d/i.test(w) || /^\d/i.test(w)) return w.toUpperCase();
		if (w.toLowerCase() === "mimo") return "MiMo";
		if (w.toLowerCase() === "vl") return "VL";
		return w.charAt(0).toUpperCase() + w.slice(1);
	});
	return `${parts.join(" ")} (OpenCode Free)`;
}

export function toOpenCodeFreeModel(id: string): Model<Api> {
	return {
		...SHARED_MODEL_FIELDS,
		id,
		name: formatOpenCodeModelName(id),
	};
}

export const DEFAULT_OPENCODE_CLI_MODELS: readonly Model<Api>[] = [
	toOpenCodeFreeModel("opencode/big-pickle"),
	toOpenCodeFreeModel("opencode/deepseek-v4.1-flash-free"),
	toOpenCodeFreeModel("opencode/nemotron-3.5-lightning-free"),
	toOpenCodeFreeModel("opencode/mimo-v2.6-flash-free"),
	toOpenCodeFreeModel("opencode/longcat-2.5-free"),
	toOpenCodeFreeModel("opencode/beam-free"),
	toOpenCodeFreeModel("opencode/flint-40b-free"),
	toOpenCodeFreeModel("opencode/hy4-flash-free"),
	toOpenCodeFreeModel("opencode/iceman-free"),
	toOpenCodeFreeModel("opencode/tidepool-alpha-free"),
	toOpenCodeFreeModel("opencode/nemotron-3.5-super-vl-free"),
];

export const OPENCODE_CLI_MODELS = DEFAULT_OPENCODE_CLI_MODELS;

let liveModels: readonly Model<Api>[] = DEFAULT_OPENCODE_CLI_MODELS;

export function getOpenCodeCliModels(): readonly Model<Api>[] {
	return liveModels;
}

export function setOpenCodeCliModels(models: readonly Model<Api>[]): void {
	if (models.length > 0) liveModels = models;
}

export function parseOpenCodeModelsOutput(output: string): readonly Model<Api>[] {
	const lines = output
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => Boolean(s) && (s.startsWith("opencode/") || s.includes("free")));

	if (lines.length === 0) return DEFAULT_OPENCODE_CLI_MODELS;
	return lines.map(toOpenCodeFreeModel);
}

export async function fetchLiveOpenCodeFreeModels(
	findBinary: () => string | null = getOpenCodeCliBinary,
): Promise<readonly Model<Api>[]> {
	const binary = findBinary();
	if (!binary) return liveModels;

	return new Promise((resolve) => {
		execFile(binary, ["models"], { timeout: 5000, windowsHide: true }, (error, stdout) => {
			if (error || !stdout) {
				resolve(liveModels);
				return;
			}
			const parsed = parseOpenCodeModelsOutput(stdout);
			setOpenCodeCliModels(parsed);
			resolve(parsed);
		});
	});
}

export async function refreshOpenCodeCliModels(): Promise<void> {
	await fetchLiveOpenCodeFreeModels();
}

export function createOpenCodeCliProvider(streamSimple: StreamFunction<Api, SimpleStreamOptions>): Provider {
	const provider = createProvider({
		id: OPENCODE_CLI_PROVIDER,
		name: "OpenCode CLI",
		auth: { apiKey: { name: "OpenCode CLI", resolve: async () => ({ auth: {}, source: "opencode CLI" }) } },
		models: DEFAULT_OPENCODE_CLI_MODELS,
		api: { stream: streamSimple, streamSimple },
	});
	return {
		...provider,
		getModels: () => getOpenCodeCliModels(),
		getAllModels: () => getOpenCodeCliModels(),
	};
}

export const streamOpenCodeCli = createOpenCodeCliStreamFunction(createOpenCodeCliLauncher());
