import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type StreamFunction,
	type TranscriptContext,
} from "@earendil-works/pi-ai";

import { externalCliEnv } from "../../core/auth-env.ts";
import { parseOpenCodeCliLine } from "./cli-events.ts";
import { OpenCodeCliError } from "./constants.ts";
import { OpenCodeCliLaunchError } from "./launch.ts";
import { toOpenCodePrompt } from "./transcript.ts";

export type RunOpenCodeCliOptions = { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal };
export type OpenCodeCliChild = ChildProcessWithoutNullStreams | null;
export type RunOpenCodeCli = (args: string[], options: RunOpenCodeCliOptions) => OpenCodeCliChild | Promise<OpenCodeCliChild>;

const ABORT_MESSAGE = "Request was aborted";
const START_FAILED_MESSAGE = "opencode CLI failed to start";

export function toOpenCodeArgs(modelId: string, promptText: string): string[] {
	return [
		"run",
		"--standalone",
		"--format",
		"json",
		"--archived",
		"--auto",
		"--model",
		modelId,
		promptText,
	];
}

function createOutput(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

async function startTurn(
	runCli: RunOpenCodeCli,
	stream: AssistantMessageEventStream,
	model: Model<Api>,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
): Promise<void> {
	const output = createOutput(model);
	let finished = false;
	let started = false;
	let cwd: string | null = null;
	let cleanedUp = false;

	const cleanup = async () => {
		if (cleanedUp || !cwd) return;
		cleanedUp = true;
		await rm(cwd, { recursive: true, force: true }).catch(() => {});
	};

	const fail = (message: string, reason: "aborted" | "error") => {
		if (finished) return;
		finished = true;
		output.stopReason = reason;
		output.errorMessage = message.toLowerCase().includes("not signed in") ? OpenCodeCliError.NotSignedIn : message;
		stream.push({ type: "error", reason, error: output });
		stream.end();
		void cleanup();
	};

	if (options?.signal?.aborted) {
		fail(ABORT_MESSAGE, "aborted");
		return;
	}

	try {
		cwd = await mkdtemp(join(tmpdir(), "opencode-cwd-"));
	} catch (err: unknown) {
		fail((err as Error).message || START_FAILED_MESSAGE, "error");
		return;
	}

	const promptText = toOpenCodePrompt(context.messages);
	const args = toOpenCodeArgs(model.id, promptText);
	let child: OpenCodeCliChild;

	try {
		child = await runCli(args, { cwd, env: externalCliEnv(), signal: options?.signal });
	} catch (err: unknown) {
		const message = options?.signal?.aborted
			? ABORT_MESSAGE
			: err instanceof OpenCodeCliLaunchError
				? err.message
				: (err as Error).message || START_FAILED_MESSAGE;
		fail(message, options?.signal?.aborted ? "aborted" : "error");
		return;
	}

	if (!child) {
		fail(OpenCodeCliError.CliNotFound, "error");
		return;
	}

	const start = () => {
		if (started) return;
		started = true;
		stream.push({ type: "start", partial: output });
	};

	type TextBlock = { contentIndex: number; block: { type: "text"; text: string } };
	type ThinkingBlock = { contentIndex: number; block: { type: "thinking"; thinking: string } };

	let currentText: TextBlock | null = null;
	let currentThinking: ThinkingBlock | null = null;

	const closeThinking = () => {
		if (currentThinking) {
			stream.push({
				type: "thinking_end",
				contentIndex: currentThinking.contentIndex,
				content: currentThinking.block.thinking,
				partial: output,
			});
			currentThinking = null;
		}
	};

	const closeText = () => {
		if (currentText) {
			stream.push({
				type: "text_end",
				contentIndex: currentText.contentIndex,
				content: currentText.block.text,
				partial: output,
			});
			currentText = null;
		}
	};

	let stderrOutput = "";
	child.stderr.on("data", (chunk: Buffer) => {
		stderrOutput += chunk.toString("utf8");
	});

	child.stdin.on("error", () => {});
	try {
		child.stdin.end();
	} catch {}

	if (options?.signal) {
		const onAbort = () => {
			try {
				child?.kill("SIGTERM");
			} catch {}
			fail(ABORT_MESSAGE, "aborted");
		};

		if (options.signal.aborted) {
			onAbort();
			return;
		}
		options.signal.addEventListener("abort", onAbort, { once: true });
	}

	const rl = createInterface({ input: child.stdout });

	rl.on("line", (line: string) => {
		if (finished) return;
		const event = parseOpenCodeCliLine(line);
		if (!event) return;

		switch (event.type) {
			case "step_start":
				start();
				break;

			case "reasoning": {
				const delta = event.delta ?? event.reasoning;
				if (delta) {
					start();
					closeText();
					if (!currentThinking) {
						const contentIndex = output.content.length;
						const block = { type: "thinking" as const, thinking: "" };
						output.content.push(block);
						currentThinking = { contentIndex, block };
						stream.push({ type: "thinking_start", contentIndex, partial: output });
					}
					currentThinking.block.thinking += delta;
					stream.push({
						type: "thinking_delta",
						contentIndex: currentThinking.contentIndex,
						delta,
						partial: output,
					});
				}
				break;
			}

			case "text": {
				const delta = event.delta ?? event.text;
				if (delta) {
					start();
					closeThinking();
					if (!currentText) {
						const contentIndex = output.content.length;
						const block = { type: "text" as const, text: "" };
						output.content.push(block);
						currentText = { contentIndex, block };
						stream.push({ type: "text_start", contentIndex, partial: output });
					}
					currentText.block.text += delta;
					stream.push({
						type: "text_delta",
						contentIndex: currentText.contentIndex,
						delta,
						partial: output,
					});
				}
				break;
			}

			case "tool_use":
				break;

			case "step_finish": {
				const tokens = event.part?.tokens;
				if (tokens) {
					if (typeof tokens.input === "number") output.usage.input = tokens.input;
					if (typeof tokens.output === "number") output.usage.output = tokens.output;
					if (typeof tokens.total === "number") output.usage.totalTokens = tokens.total;
					if (typeof tokens.reasoning === "number") output.usage.reasoning = tokens.reasoning;
					if (typeof tokens.cache?.read === "number") output.usage.cacheRead = tokens.cache.read;
					if (typeof tokens.cache?.write === "number") output.usage.cacheWrite = tokens.cache.write;
				}
				break;
			}

			case "error":
				fail(event.error || "OpenCode turn failed", "error");
				break;
		}
	});

	child.on("close", (code) => {
		void cleanup();
		if (!finished) {
			if (options?.signal?.aborted) {
				fail(ABORT_MESSAGE, "aborted");
			} else if (code !== 0) {
				fail(stderrOutput.trim() || `opencode CLI exited with code ${code}`, "error");
			} else {
				start();
				closeThinking();
				closeText();
				finished = true;
				output.stopReason = "stop";
				stream.push({ type: "done", reason: "stop", message: output });
				stream.end();
			}
		}
	});

	child.on("error", (err) => {
		fail(err.message, "error");
	});
}

export function createOpenCodeCliStreamFunction(runCli: RunOpenCodeCli): StreamFunction<Api, SimpleStreamOptions> {
	return (model, context, options) => {
		const stream = createAssistantMessageEventStream();
		startTurn(runCli, stream, model, context, options).catch((error: unknown) => {
			console.error("opencode CLI turn failed:", error);
		});
		return stream;
	};
}
