export { OPENCODE_CLI_PROVIDER } from "../../core/contracts/opencode-cli.ts";

export const OPENCODE_CLI_API = "opencode-cli";

export enum OpenCodeCliError {
	CliNotFound = "opencode CLI not found",
	NotSignedIn = "not signed in",
}
