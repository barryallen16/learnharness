import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENCODE_CLI_MINIMUM_VERSION, OPENCODE_CLI_PROVIDER, sanitizeUserSettings } from "../src/core";
import { parseOpenCodeCliSettingsBody, parseSettingsSectionBody } from "../src/server/settings-body.ts";
import { opencodeCliAvailable, opencodeCliEnabled } from "../src/server/opencode-cli-config.ts";
import { opencodeCliInstallationResponse } from "../src/server/opencode-cli.ts";
import { providerKeyPresent } from "../src/server/keys.ts";
import { settingsStore } from "../src/store/settings.ts";
import { openCodeCliStatusLabel } from "../components/settings/opencode-cli-status.tsx";

describe("OpenCode CLI settings sanitization", () => {
	it("preserves valid boolean enabled values", () => {
		assert.deepEqual(sanitizeUserSettings({ version: 1, opencodeCli: { enabled: true } })?.opencodeCli, { enabled: true });
		assert.deepEqual(sanitizeUserSettings({ version: 1, opencodeCli: { enabled: false } })?.opencodeCli, { enabled: false });
	});

	it("sanitizes malformed opencodeCli records to empty object", () => {
		for (const malformed of [null, [], true, "on", { enabled: "true" }, { enabled: 1 }]) {
			const sanitized = sanitizeUserSettings({ version: 1, opencodeCli: malformed as never });
			assert.notEqual(sanitized?.opencodeCli?.enabled, true);
		}
	});

	it("leaves opencodeCli undefined when absent in input", () => {
		assert.equal(sanitizeUserSettings({ version: 1 })?.opencodeCli, undefined);
	});
});

describe("OpenCode CLI settings body parser", () => {
	it("parses empty object to empty section settings", () => {
		assert.deepEqual(parseOpenCodeCliSettingsBody({}), { ok: true, settings: {} });
	});

	it("parses valid enabled booleans", () => {
		assert.deepEqual(parseOpenCodeCliSettingsBody({ enabled: true }), { ok: true, settings: { enabled: true } });
		assert.deepEqual(parseOpenCodeCliSettingsBody({ enabled: false }), { ok: true, settings: { enabled: false } });
	});

	it("drops unknown extra properties while keeping enabled", () => {
		assert.deepEqual(parseOpenCodeCliSettingsBody({ enabled: true, ignored: "extra" }), { ok: true, settings: { enabled: true } });
	});

	it("rejects non-boolean enabled or non-object bodies", () => {
		for (const invalid of [null, [], true, "on", { enabled: "true" }, { enabled: 1 }, { enabled: null }]) {
			const res = parseOpenCodeCliSettingsBody(invalid);
			assert.equal(res.ok, false);
		}
	});

	it("parseSettingsSectionBody handles section opencodeCli", () => {
		assert.deepEqual(parseSettingsSectionBody("opencodeCli", { enabled: true }), { ok: true, settings: { enabled: true } });
		assert.equal(parseSettingsSectionBody("opencodeCli", { enabled: "not-bool" }).ok, false);
	});
});

describe("OpenCode CLI keys presence and availability", () => {
	let testDir: string;
	const prevEnv = process.env.LH_DATA_DIR;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "lh-opencode-cli-test-"));
		process.env.LH_DATA_DIR = testDir;
		settingsStore.writeSettings({ version: 1 });
	});

	afterEach(() => {
		if (prevEnv !== undefined) process.env.LH_DATA_DIR = prevEnv;
		else delete process.env.LH_DATA_DIR;
		rmSync(testDir, { recursive: true, force: true });
	});

	it("reflects enabled state from settings store", () => {
		assert.equal(opencodeCliEnabled(), false);
		settingsStore.writeSettings({ version: 1, opencodeCli: { enabled: true } });
		assert.equal(opencodeCliEnabled(), true);
		settingsStore.writeSettings({ version: 1, opencodeCli: { enabled: false } });
		assert.equal(opencodeCliEnabled(), false);
	});

	it("providerKeyPresent checks opencodeCliAvailable", () => {
		settingsStore.writeSettings({ version: 1, opencodeCli: { enabled: false } });
		assert.equal(providerKeyPresent(OPENCODE_CLI_PROVIDER), false);
	});
});

describe("OpenCode CLI installation response route", () => {
	it("rejects non-GET methods", async () => {
		const req = new Request("http://localhost:3000/api/opencode-cli", {
			method: "POST",
			headers: { origin: "http://localhost:3000", "x-learnharness-opencode-cli": "1" },
		});
		const res = await opencodeCliInstallationResponse(req, async () => ({ state: "not-found", version: null, minimumVersion: OPENCODE_CLI_MINIMUM_VERSION }), () => true);
		assert.equal(res.status, 403);
	});

	it("rejects missing x-learnharness-opencode-cli header", async () => {
		const req = new Request("http://localhost:3000/api/opencode-cli", {
			headers: { origin: "http://localhost:3000" },
		});
		const res = await opencodeCliInstallationResponse(req, async () => ({ state: "not-found", version: null, minimumVersion: OPENCODE_CLI_MINIMUM_VERSION }), () => true);
		assert.equal(res.status, 403);
	});

	it("rejects when OpenCode CLI is disabled", async () => {
		const req = new Request("http://localhost:3000/api/opencode-cli", {
			headers: { origin: "http://localhost:3000", "x-learnharness-opencode-cli": "1" },
		});
		const res = await opencodeCliInstallationResponse(req, async () => ({ state: "meets-minimum", version: "0.2.0", minimumVersion: OPENCODE_CLI_MINIMUM_VERSION }), () => false);
		assert.equal(res.status, 403);
	});

	it("returns inspection payload on valid same-origin request", async () => {
		const req = new Request("http://localhost:3000/api/opencode-cli", {
			headers: { origin: "http://localhost:3000", "x-learnharness-opencode-cli": "1" },
		});
		const expected = { state: "meets-minimum" as const, version: "0.2.0", minimumVersion: OPENCODE_CLI_MINIMUM_VERSION };
		const res = await opencodeCliInstallationResponse(req, async () => expected, () => true);
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), expected);
	});
});

describe("OpenCode CLI UI status label", () => {
	it("renders user-facing status messages", () => {
		assert.equal(openCodeCliStatusLabel(null), "Version could not be checked");
		assert.equal(openCodeCliStatusLabel({ state: "not-found", version: null, minimumVersion: OPENCODE_CLI_MINIMUM_VERSION }), "Not found");
		assert.equal(openCodeCliStatusLabel({ state: "meets-minimum", version: "0.2.0", minimumVersion: OPENCODE_CLI_MINIMUM_VERSION }), "Version 0.2.0 · meets minimum");
		assert.equal(openCodeCliStatusLabel({ state: "update-required", version: "0.0.1", minimumVersion: OPENCODE_CLI_MINIMUM_VERSION }), "Version 0.0.1 · update required");
		assert.equal(openCodeCliStatusLabel({ state: "version-unchecked", version: null, minimumVersion: OPENCODE_CLI_MINIMUM_VERSION }), "Version could not be checked");
	});
});
