import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";

import {
	createModels,
	type AssistantMessageEvent,
	type Message,
} from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";

import { resolveOpenCodeCliBinary } from "../src/agent/opencode-cli/binary.ts";
import { parseOpenCodeCliLine } from "../src/agent/opencode-cli/cli-events.ts";
import { OPENCODE_CLI_API, OPENCODE_CLI_PROVIDER, OpenCodeCliError } from "../src/agent/opencode-cli/constants.ts";
import { inspectOpenCodeCliInstallation } from "../src/agent/opencode-cli/installation.ts";
import { OpenCodeCliLaunchError, createOpenCodeCliLauncher } from "../src/agent/opencode-cli/launch.ts";
import {
	DEFAULT_OPENCODE_CLI_MODELS,
	OPENCODE_CLI_MODELS,
	createOpenCodeCliProvider,
	fetchLiveOpenCodeFreeModels,
	formatOpenCodeModelName,
	getOpenCodeCliModels,
	parseOpenCodeModelsOutput,
	setOpenCodeCliModels,
} from "../src/agent/opencode-cli/provider.ts";
import { createOpenCodeCliStreamFunction, toOpenCodeArgs, type RunOpenCodeCli } from "../src/agent/opencode-cli/stream.ts";
import { toOpenCodePrompt } from "../src/agent/opencode-cli/transcript.ts";
import { describe, it } from "node:test";

const HOME = "/home/u";

describe("OpenCode CLI binary resolution", () => {
	it("resolves from PATH on posix", () => {
		const isExecutable = (p: string) => p === "/usr/bin/opencode";
		const binary = resolveOpenCodeCliBinary({
			env: { PATH: "/bin:/usr/bin" },
			platform: "linux",
			homeDir: HOME,
			isExecutable,
		});
		assert.equal(binary, "/usr/bin/opencode");
	});

	it("resolves from known directories on win32", () => {
		const isExecutable = (p: string) => p.toLowerCase() === "c:\\users\\u\\.opencode\\bin\\opencode.exe";
		const binary = resolveOpenCodeCliBinary({
			env: { PATH: "C:\\Windows\\System32", USERPROFILE: "C:\\Users\\u" },
			platform: "win32",
			homeDir: "C:\\Users\\u",
			isExecutable,
		});
		assert.equal(binary?.toLowerCase(), "c:\\users\\u\\.opencode\\bin\\opencode.exe");
	});

	it("returns null when binary not found", () => {
		const binary = resolveOpenCodeCliBinary({
			env: { PATH: "/bin" },
			platform: "linux",
			homeDir: HOME,
			isExecutable: () => false,
		});
		assert.equal(binary, null);
	});
});

describe("OpenCode CLI installation inspection", () => {
	it("returns not-found when binary is absent", async () => {
		const res = await inspectOpenCodeCliInstallation(() => null, async () => "0.1.5");
		assert.equal(res.state, "not-found");
		assert.equal(res.version, null);
	});

	it("returns meets-minimum on valid version", async () => {
		const res = await inspectOpenCodeCliInstallation(() => "/bin/opencode", async () => "opencode 0.2.1");
		assert.equal(res.state, "meets-minimum");
		assert.equal(res.version, "0.2.1");
	});

	it("returns update-required when below minimum", async () => {
		const res = await inspectOpenCodeCliInstallation(() => "/bin/opencode", async () => "0.0.9");
		assert.equal(res.state, "update-required");
		assert.equal(res.version, "0.0.9");
	});

	it("returns version-unchecked on failure", async () => {
		const res = await inspectOpenCodeCliInstallation(() => "/bin/opencode", async () => { throw new Error("timeout"); });
		assert.equal(res.state, "version-unchecked");
		assert.equal(res.version, null);
	});
});

describe("OpenCode CLI event parser", () => {
	it("parses step_start", () => {
		const res = parseOpenCodeCliLine(JSON.stringify({ type: "step_start", sessionID: "ses_123" }));
		assert.deepEqual(res, { type: "step_start", sessionID: "ses_123", part: undefined });
	});

	it("parses text and reasoning events", () => {
		const t = parseOpenCodeCliLine(JSON.stringify({ type: "text", delta: "hello " }));
		assert.deepEqual(t, { type: "text", text: undefined, delta: "hello ", part: undefined });

		const r = parseOpenCodeCliLine(JSON.stringify({ type: "reasoning", delta: "thinking..." }));
		assert.deepEqual(r, { type: "reasoning", reasoning: undefined, delta: "thinking...", part: undefined });
	});

	it("parses step_finish with tokens", () => {
		const res = parseOpenCodeCliLine(JSON.stringify({
			type: "step_finish",
			part: {
				reason: "stop",
				tokens: { total: 100, input: 40, output: 60, reasoning: 10, cache: { read: 20, write: 0 } },
			},
		}));
		assert.equal(res?.type, "step_finish");
		assert.equal(res?.part?.tokens?.total, 100);
		assert.equal(res?.part?.tokens?.reasoning, 10);
	});

	it("returns null on invalid JSON", () => {
		assert.equal(parseOpenCodeCliLine("not json"), null);
	});
});

describe("OpenCode CLI args and prompt", () => {
	it("formats command args", () => {
		const args = toOpenCodeArgs("anthropic/claude-sonnet-4-20250514", "Say hi");
		assert.deepEqual(args, ["run", "--standalone", "--format", "json", "--archived", "--auto", "--model", "anthropic/claude-sonnet-4-20250514", "Say hi"]);
	});

	it("formats single user message", () => {
		const prompt = toOpenCodePrompt([{ role: "user", content: "hello", timestamp: 1 }]);
		assert.equal(prompt, "hello");
	});

	it("formats multi-turn conversation", () => {
		const messages: Message[] = [
			{ role: "system", content: "You are helpful", timestamp: 1 },
			{ role: "user", content: "hello", timestamp: 2 },
			{ role: "assistant", content: [{ type: "text", text: "hi there" }], api: "opencode-cli", provider: "opencode-cli", model: "m", usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 3 },
			{ role: "user", content: "next", timestamp: 4 },
		];
		const prompt = toOpenCodePrompt(messages);
		assert.ok(prompt.includes("[system]\nYou are helpful"));
		assert.ok(prompt.includes("[user]\nhello"));
		assert.ok(prompt.includes("[assistant]\nhi there"));
		assert.ok(prompt.includes("[user]\nnext"));
	});
});

describe("OpenCode CLI dynamic free models", () => {
	it("formats display names cleanly", () => {
		assert.equal(formatOpenCodeModelName("opencode/big-pickle"), "Big Pickle (OpenCode Free)");
		assert.equal(formatOpenCodeModelName("opencode/deepseek-v4.1-flash-free"), "Deepseek V4.1 Flash (OpenCode Free)");
		assert.equal(formatOpenCodeModelName("opencode/mimo-v2.6-flash-free"), "MiMo V2.6 Flash (OpenCode Free)");
	});

	it("filters and parses live free model lists from CLI output", () => {
		const raw = "openai/gpt-4o\nanthropic/claude-sonnet-4-6\nopencode/big-pickle\nopencode/deepseek-v4.1-flash-free\n\n";
		const models = parseOpenCodeModelsOutput(raw);
		assert.equal(models.length, 2);
		assert.equal(models[0]?.id, "opencode/big-pickle");
		assert.equal(models[1]?.id, "opencode/deepseek-v4.1-flash-free");
	});

	it("falls back to default models if output has no matching free models", () => {
		const models = parseOpenCodeModelsOutput("some-unknown-model");
		assert.deepEqual(models, DEFAULT_OPENCODE_CLI_MODELS);
	});

	it("fetches live free models using binary mock", async () => {
		const mockFindBinary = () => null;
		const models = await fetchLiveOpenCodeFreeModels(mockFindBinary);
		assert.ok(models.length > 0);
	});
});

describe("OpenCode CLI launcher", () => {
	it("throws on aborted signal", async () => {
		const controller = new AbortController();
		controller.abort();
		const launcher = createOpenCodeCliLauncher({ findBinary: () => "/bin/opencode", readVersion: async () => "0.2.0" });
		await assert.rejects(async () => {
			await launcher([], { cwd: "/tmp", env: process.env, signal: controller.signal });
		}, OpenCodeCliLaunchError);
	});

	it("returns null when binary missing", async () => {
		const launcher = createOpenCodeCliLauncher({ findBinary: () => null });
		const child = await launcher([], { cwd: "/tmp", env: process.env });
		assert.equal(child, null);
	});
});

describe("OpenCode CLI stream function", () => {
	function createMockChild(): { child: ChildProcessWithoutNullStreams; stdin: PassThrough; stdout: PassThrough; stderr: PassThrough } {
		const ee = new EventEmitter();
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		const child = Object.assign(ee, {
			stdin, stdout, stderr,
			kill: () => true,
		}) as unknown as ChildProcessWithoutNullStreams;
		return { child, stdin, stdout, stderr };
	}

	async function collectEvents(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}
		return events;
	}

	it("streams text and tokens successfully", async () => {
		const { child, stdout } = createMockChild();
		const runCli: RunOpenCodeCli = () => {
			setTimeout(() => {
				stdout.write(JSON.stringify({ type: "step_start" }) + "\n");
				stdout.write(JSON.stringify({ type: "reasoning", delta: "pondering" }) + "\n");
				stdout.write(JSON.stringify({ type: "text", delta: "hello world" }) + "\n");
				stdout.write(JSON.stringify({
					type: "step_finish",
					part: { reason: "stop", tokens: { total: 15, input: 5, output: 10, reasoning: 3 } },
				}) + "\n");
				child.emit("close", 0);
			}, 10);
			return child;
		};
		const streamFn = createOpenCodeCliStreamFunction(runCli);
		const model = OPENCODE_CLI_MODELS[0]!;
		const stream = streamFn(model, normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 1 }] }));

		const events = await collectEvents(stream);
		const doneEvent = events.find((e) => e.type === "done");
		assert.ok(doneEvent && doneEvent.type === "done");
		assert.equal(doneEvent.message.stopReason, "stop");
		assert.equal(doneEvent.message.usage.totalTokens, 15);
		assert.equal(doneEvent.message.usage.reasoning, 3);
		assert.ok(events.some((e) => e.type === "text_delta" && e.delta === "hello world"));
		assert.ok(events.some((e) => e.type === "thinking_delta" && e.delta === "pondering"));
	});
});
