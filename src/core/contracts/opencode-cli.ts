export const OPENCODE_CLI_PROVIDER = "opencode-cli";

export const OPENCODE_CLI_MINIMUM_VERSION = "0.1.0";

export interface OpenCodeCliStatus {
	state: "not-found" | "meets-minimum" | "update-required" | "version-unchecked";
	version: string | null;
	minimumVersion: string;
}
