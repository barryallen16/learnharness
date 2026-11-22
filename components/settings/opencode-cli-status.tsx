"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { OPENCODE_CLI_MINIMUM_VERSION, type OpenCodeCliStatus, type UserSettings } from "@/src/core";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { Button } from "@/components/ui/button";
import { Toggle } from "./controls";

export function openCodeCliStatusLabel(status: OpenCodeCliStatus | null): string {
	switch (status?.state) {
		case "not-found": return "Not found";
		case "meets-minimum": return `Version ${status.version} · meets minimum`;
		case "update-required": return `Version ${status.version} · update required`;
		default: return "Version could not be checked";
	}
}

export function OpenCodeCliInstallationStatus() {
	const [enabled, setEnabled] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<OpenCodeCliStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const request = useRef<AbortController | null>(null);
	const settingsRead = useRef<AbortController | null>(null);
	const settingsWrite = useRef<AbortController | null>(null);

	const read = useCallback(async () => {
		settingsRead.current?.abort();
		const controller = new AbortController();
		settingsRead.current = controller;
		setLoaded(false);
		try {
			const response = await fetch("/api/settings", { cache: "no-store", signal: controller.signal });
			if (!response.ok) throw new Error("settings unavailable");
			const body = await response.json() as { settings: UserSettings | null };
			if (!controller.signal.aborted) {
				setEnabled(body.settings?.opencodeCli?.enabled === true);
				setLoaded(true);
				setError(null);
			}
		} catch {
			if (!controller.signal.aborted) setError("Could not load OpenCode CLI settings.");
		}
	}, []);
	useEffect(() => {
		void read();
		return () => { settingsRead.current?.abort(); settingsWrite.current?.abort(); };
	}, [read]);
	useSettingsSaved((section) => { if (section === "opencodeCli") void read(); });

	const save = async (next: boolean) => {
		const controller = new AbortController();
		settingsWrite.current = controller;
		settingsRead.current?.abort();
		setSaving(true);
		setError(null);
		try {
			const response = await fetch("/api/settings/opencodeCli", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: next }),
				signal: controller.signal,
			});
			if (!response.ok) throw new Error("settings write failed");
			const body = await response.json() as { settings: UserSettings };
			if (typeof body.settings?.opencodeCli?.enabled !== "boolean") throw new Error("invalid settings response");
			if (!controller.signal.aborted) {
				setEnabled(body.settings.opencodeCli.enabled);
				notifySettingsSaved("opencodeCli");
			}
		} catch {
			if (!controller.signal.aborted) setError("Could not save OpenCode CLI settings.");
		} finally {
			if (!controller.signal.aborted) setSaving(false);
		}
	};

	const refresh = useCallback(async () => {
		if (!enabled) return;
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setBusy(true);
		try {
			const response = await fetch("/api/opencode-cli", {
				cache: "no-store",
				signal: controller.signal,
				headers: { "x-learnharness-opencode-cli": "1" },
			});
			if (!response.ok) throw new Error("status unavailable");
			const value = await response.json() as OpenCodeCliStatus;
			if (!["not-found", "meets-minimum", "update-required", "version-unchecked"].includes(value.state)
				|| value.minimumVersion !== OPENCODE_CLI_MINIMUM_VERSION
				|| (value.version !== null && (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version)))) throw new Error("invalid status");
			if (!controller.signal.aborted) setStatus(value);
		} catch {
			if (!controller.signal.aborted) setStatus(null);
		} finally {
			if (!controller.signal.aborted) setBusy(false);
		}
	}, [enabled]);
	useEffect(() => {
		if (enabled) void refresh();
		else { request.current?.abort(); setStatus(null); setBusy(false); }
		return () => request.current?.abort();
	}, [enabled, refresh]);

	return <div className="space-y-2" data-testid="opencode-cli-installation">
		<div className="flex items-center gap-3">
			<span className="font-prose text-(length:--lh-prose-size) text-foreground">OpenCode CLI (opencode)</span>
			<Toggle label="OpenCode CLI" checked={enabled} disabled={!loaded || saving} onChange={(next) => void save(next)} />
		</div>
		{error && <p role="alert" className="text-xs text-error">{error}</p>}
		{enabled && <>
			<div className="flex flex-wrap items-center gap-3">
				<span role="status" className="text-xs text-muted-foreground">{busy ? "Checking…" : openCodeCliStatusLabel(status)}</span>
				<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed" disabled={busy} onClick={() => void refresh()} data-testid="opencode-cli-check-again">Check again</Button>
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground"><strong className="font-medium">Install and authenticate OpenCode in your terminal, then select an OpenCode model here.</strong> LearnHarness starts it when needed - no background process required.</p>
			<p className="text-xs leading-relaxed text-muted-foreground">Checks installation/version only - not authentication, model access, or quota. OpenCode controls billing. Requires v{OPENCODE_CLI_MINIMUM_VERSION}+.</p>
			<p className="text-xs leading-relaxed text-muted-foreground">Verify AI claims independently - they may be inaccurate, incomplete, misleading, or outdated.</p>
		</>}
	</div>;
}
