import { getOpenCodeCliBinary } from "../agent/opencode-cli/binary.ts";
import { settingsStore } from "../store/settings.ts";

export function opencodeCliEnabled(): boolean {
	return settingsStore.readSettings()?.opencodeCli?.enabled === true;
}

export function opencodeCliAvailable(): boolean {
	return opencodeCliEnabled() && getOpenCodeCliBinary() !== null;
}
