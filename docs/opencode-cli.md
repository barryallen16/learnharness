# OpenCode CLI

LearnHarness can use an externally installed **OpenCode CLI** as a model provider.
This runs separately from direct API keys and built-in subscription connections.
The CLI manages its own authentication, model routing, and free tier access.

## Set up

1. Install and authenticate the OpenCode CLI outside LearnHarness on the machine running the LearnHarness server.
2. Ensure the `opencode` binary is discoverable in `PATH` or standard user install paths.
On Windows, a runnable `opencode.exe` is required; `.cmd` wrappers are ignored.
3. Enable **Settings -> Providers -> External CLI -> OpenCode CLI**.
This setting is off by default.
Use **Check again** to verify the CLI status.
4. Select one of the available models discovered by the CLI or defaults such as `opencode/big-pickle` or `opencode/deepseek-v4.1-flash-free`.

The minimum supported version is **0.1.0**.
The check executes `opencode --version` with a 5-second timeout.
Passing the version probe confirms binary presence, but does not verify account status or provider quota.

## Execution and streaming

LearnHarness maintains control of its agent turn lifecycle, tools, and persistence.
It serializes the conversation transcript and streams model responses from the CLI child process via standard input and output.
Each request runs in an isolated child process using an empty working directory.
Reasoning tokens and stream usage are mapped directly into LearnHarness session accounting.
Cancellation terminates the active child process and aborts the ongoing stream cleanly.

## Maintainer entry points

- Core contracts: [`src/core/contracts/opencode-cli.ts`](../src/core/contracts/opencode-cli.ts)
- Discovery and binary resolution: [`src/agent/opencode-cli/binary.ts`](../src/agent/opencode-cli/binary.ts)
- Version probe: [`src/agent/opencode-cli/installation.ts`](../src/agent/opencode-cli/installation.ts)
- Stream adaptation: [`src/agent/opencode-cli/stream.ts`](../src/agent/opencode-cli/stream.ts)
- Settings UI: [`components/settings/opencode-cli-status.tsx`](../components/settings/opencode-cli-status.tsx)
- Server route: [`app/api/opencode-cli/route.ts`](../app/api/opencode-cli/route.ts)
- Unit tests: [`tests/opencode-cli-agent.test.ts`](../tests/opencode-cli-agent.test.ts) and [`tests/opencode-cli-server-ui.test.ts`](../tests/opencode-cli-server-ui.test.ts)
