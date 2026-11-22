export type OpenCodeTokens = {
	total?: number;
	input?: number;
	output?: number;
	reasoning?: number;
	cache?: {
		write?: number;
		read?: number;
	};
};

export type OpenCodePart = {
	id?: string;
	sessionID?: string;
	messageID?: string;
	type?: string;
	text?: string;
	delta?: string;
	reasoning?: string;
	tool?: string;
	state?: {
		status?: string;
		input?: unknown;
		output?: string;
		title?: string;
		metadata?: Record<string, unknown>;
	};
	reason?: string;
	tokens?: OpenCodeTokens;
	cost?: number;
};

export type OpenCodeCliEvent =
	| { type: "step_start"; sessionID?: string; part?: OpenCodePart }
	| { type: "text"; text?: string; delta?: string; part?: OpenCodePart }
	| { type: "reasoning"; reasoning?: string; delta?: string; part?: OpenCodePart }
	| { type: "tool_use"; part?: OpenCodePart }
	| { type: "step_finish"; part?: OpenCodePart }
	| { type: "error"; error?: string; message?: string };

export function parseOpenCodeCliLine(text: string): OpenCodeCliEvent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}

	if (typeof parsed !== "object" || parsed === null) return null;

	const record = parsed as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type : undefined;
	if (!type) return null;

	const part = (typeof record.part === "object" && record.part !== null)
		? (record.part as OpenCodePart)
		: undefined;

	switch (type) {
		case "step_start":
			return {
				type: "step_start",
				sessionID: typeof record.sessionID === "string" ? record.sessionID : undefined,
				part,
			};

		case "text":
			return {
				type: "text",
				text: typeof record.text === "string" ? record.text : part?.text,
				delta: typeof record.delta === "string" ? record.delta : part?.delta,
				part,
			};

		case "reasoning":
			return {
				type: "reasoning",
				reasoning: typeof record.reasoning === "string" ? record.reasoning : (part?.reasoning ?? part?.text),
				delta: typeof record.delta === "string" ? record.delta : part?.delta,
				part,
			};

		case "tool_use":
			return {
				type: "tool_use",
				part,
			};

		case "step_finish":
			return {
				type: "step_finish",
				part,
			};

		case "error":
			return {
				type: "error",
				error: typeof record.error === "string" ? record.error : (typeof record.message === "string" ? record.message : undefined),
			};

		default:
			return null;
	}
}
