# OpenClaw `src/` Codebase Report

## 1. Repository Purpose

`openclaw` is not just a chat bot repository. Its `src/` tree implements the core of a local-first personal AI assistant platform built around:

- a CLI entrypoint
- a long-running Gateway control plane
- a plugin platform for channels, providers, tools, and memory
- an agent runtime that executes turns and routes replies back to users

The center of gravity is the Gateway. The CLI is the main operator surface, but the Gateway is the runtime hub that connects channels, nodes, apps, plugins, sessions, and agents.

At a high level, `src/` is responsible for:

- starting and routing CLI commands
- loading and validating config
- starting the Gateway server
- loading plugins and exposing public Plugin SDK seams
- routing inbound messages into sessions and agents
- executing agent turns
- sending responses back through channels or operator surfaces

## 2. Top-Level Structure

The highest-value top-level modules in `src/` are:

- `src/cli`
  - CLI shell, argument parsing, command registration, lazy subcommand loading.
- `src/commands`
  - Actual user-facing command behavior for onboarding, agent runs, doctor flows, setup, channels, and models.
- `src/gateway`
  - Gateway runtime, protocol, server methods, health, discovery, plugin bootstrap, WebSocket handlers.
- `src/plugins`
  - Plugin discovery, manifest validation, loader, registry assembly, runtime registration.
- `src/plugin-sdk`
  - Public contract exposed to bundled and third-party plugins.
- `src/channels`
  - Channel abstractions, channel plugin registry, allowlists, channel config matching, channel helpers.
- `src/agents`
  - Agent execution orchestration, model selection, auth profiles, sandbox, skills, embedded Pi runtime.
- `src/config`
  - Config loading, validation, migration, runtime snapshots, path resolution, schema behavior.
- `src/infra`
  - Cross-cutting runtime infrastructure: env, networking, discovery, approvals, file/path safety, diagnostics, control UI assets, device identity.
- `src/auto-reply`
  - Reply dispatch pipeline, inbound context normalization, typing-aware buffered dispatch.

The rest of the tree mainly falls into four supporting groups:

- runtime support
  - `routing`, `sessions`, `secrets`, `security`, `process`, `node-host`
- multimodal/media
  - `media`, `media-understanding`, `tts`, `image-generation`, `web-search`
- interaction surfaces
  - `wizard`, `flows`, `tui`, `terminal`, `markdown`, `interactive`, `canvas-host`, `mcp`
- shared/supporting code
  - `shared`, `utils`, `types`, `test-helpers`, `test-utils`, `context-engine`

## 3. Main Execution Flow

The most representative runtime path is:

1. User runs `openclaw ...`
2. `openclaw.mjs` validates the Node runtime and loads built output
3. `src/entry.ts` normalizes startup behavior
4. `src/cli/run-main.ts` builds the CLI program and lazily registers commands
5. A command such as `openclaw gateway run` enters Gateway startup
6. `src/gateway/server.impl.ts` loads config, initializes runtime state, loads plugins, and attaches protocol handlers
7. Channel plugins start through the channel manager
8. Inbound messages are normalized into route/session context
9. `src/agents/agent-command.ts` resolves the session, model, auth context, and runtime mode
10. `src/agents/command/attempt-execution.ts` performs the turn
11. `src/auto-reply` and delivery logic send output back to the appropriate surface

That flow shows the core architecture clearly:

- CLI selects intent
- Gateway assembles system state
- plugins register capabilities
- channels convert inbound events into normalized message context
- routing/sessions pick the correct agent conversation
- agents execute the turn
- reply pipeline delivers the result

## 4. Module Responsibilities

### `src/entry.ts`

This is the runtime CLI source entrypoint.

Responsibilities:

- boot-time environment normalization
- Node compile cache setup
- process title and warning filter setup
- profile/container argument normalization
- root help/version fast-paths
- delegating the actual CLI execution into `src/cli/run-main.ts`

Why it matters:

- it keeps startup side effects centralized
- it protects against double-entry behavior when bundled output imports entry code indirectly

### `src/cli`

This is the CLI framework layer, not the business layer.

Key files:

- `src/cli/run-main.ts`
- `src/cli/program/build-program.ts`
- `src/cli/program/command-registry.ts`
- `src/cli/program/register.subclis.ts`
- `src/cli/gateway-cli/register.ts`
- `src/cli/deps.ts`

Responsibilities:

- constructing the Commander program
- lazy registration of primary commands and sub-CLIs
- loading `.env` and runtime guards
- routing to container/profile modes
- defining CLI-specific command surfaces such as `gateway`, `channels`, `models`, `node`, `cron`
- exposing lazy outbound send dependencies for core channels

Important architectural behavior:

- command registration is intentionally lazy
- plugin CLI registration happens only when needed
- the CLI tries to keep startup lightweight by avoiding eager imports of heavy runtime modules

### `src/commands`

This is where CLI commands become actual behavior.

Key files:

- `src/commands/onboard.ts`
- `src/commands/agent-via-gateway.ts`
- `src/commands/agent.ts`
- `src/commands/agents.*`
- `src/commands/channel-setup/*`
- `src/commands/doctor/*`

Responsibilities:

- onboarding and setup flows
- agent turn execution from the CLI
- multi-agent management
- doctor and health-oriented operator flows
- channel setup and configuration actions
- models and provider-facing command behavior

Important split:

- `src/cli` defines the command shell
- `src/commands` implements the command semantics

### `src/gateway`

This is the runtime center of the system.

Key files:

- `src/gateway/server.impl.ts`
- `src/gateway/server-plugin-bootstrap.ts`
- `src/gateway/server-channels.ts`
- `src/gateway/server-chat.ts`
- `src/gateway/protocol/index.ts`
- `src/gateway/protocol/schema.ts`

Responsibilities:

- assembling the Gateway runtime
- loading config snapshots and startup auth
- loading startup plugins and pinning registries
- managing channels and their runtime status
- exposing Gateway protocol methods and events
- serving WebSocket clients, nodes, and control surfaces
- coordinating cron, discovery, health checks, reloads, and maintenance

Architectural role:

- the Gateway is the control plane
- it is where plugins, channels, nodes, sessions, and agents converge

`src/gateway/protocol` deserves special attention:

- it defines the wire contract
- schema changes here are protocol changes, not local refactors
- operator clients and nodes depend on this layer staying aligned with docs and validators

### `src/plugins`

This is the plugin runtime backend.

Key files:

- `src/plugins/loader.ts`
- `src/plugins/registry.ts`
- `src/plugins/discovery.ts`
- `src/plugins/manifest-registry.ts`
- `src/plugins/runtime/index.ts`
- `src/plugins/AGENTS.md`

Responsibilities:

- discovering bundled, installed, and path-based plugins
- validating plugin manifests
- enforcing trust/path/ownership rules during discovery and load
- building a plugin registry of channels, providers, services, commands, hooks, and tools
- maintaining the active plugin runtime registry
- exposing plugin runtime helpers to the rest of the system

Important architectural property:

- this repo is plugin-centric
- many major features are not hardcoded in core; they are capabilities registered through the plugin layer

### `src/plugin-sdk`

This is the public extension boundary.

Key files:

- `src/plugin-sdk/AGENTS.md`
- `src/plugin-sdk/core.ts`
- `src/plugin-sdk/entrypoints.ts`
- `src/plugin-sdk/plugin-entry.ts`

Responsibilities:

- defining the supported public surface for plugins
- exposing focused subpath entrypoints such as `openclaw/plugin-sdk/...`
- keeping package exports, source entrypoints, docs, and API baselines aligned
- preventing plugins from depending on core internals directly

Why it matters:

- it is the contract boundary between core and extensions
- changes here have compatibility impact beyond this repository

### `src/channels`

This is the channel abstraction and common behavior layer.

Key files:

- `src/channels/AGENTS.md`
- `src/channels/registry.ts`
- `src/channels/plugins/registry.ts`
- `src/channels/channel-config.ts`
- `src/channels/allow-from.ts`
- `src/channels/command-gating.ts`

Responsibilities:

- defining channel metadata and normalized identifiers
- resolving channel plugins from the active registry
- shared channel configuration logic
- allowlist and command gating behavior
- common matching and account resolution behavior

Architectural role:

- core channel behavior lives here
- extension authors are supposed to consume channel seams through `plugin-sdk`, not by importing channel internals directly

### `src/agents`

This is the agent execution orchestration layer.

Key files:

- `src/agents/agent-command.ts`
- `src/agents/command/attempt-execution.ts`
- `src/agents/agent-scope.ts`
- `src/agents/skills.ts`
- `src/agents/auth-profiles/*`
- `src/agents/cli-runner/*`

Responsibilities:

- validating and preparing an agent turn
- resolving session, agent id, model, thinking level, timeout, auth profile, and workspace
- deciding whether to run through Gateway, CLI backend, or embedded Pi runtime
- persisting session/transcript state
- managing skills snapshots and auth profile stores
- exposing agent-scoped runtime behaviors to the rest of the system

Important design detail:

- `src/commands/agent-via-gateway.ts` shows Gateway-first agent execution
- local embedded execution is a fallback or explicit mode, not the primary architecture

### `src/auto-reply`

This is the reply pipeline and message dispatch layer.

Key files:

- `src/auto-reply/dispatch.ts`
- `src/auto-reply/reply/*`
- `src/auto-reply/templating.ts`

Responsibilities:

- finalizing inbound message context
- creating and managing reply dispatchers
- dispatching replies from config-selected behavior
- coordinating buffered or typing-aware response emission

Why it matters:

- it is the layer between “agent produced output” and “channel/operator surface receives it”
- this is where output behavior becomes user-visible

### `src/config`

This is the configuration platform for the entire system.

Key files:

- `src/config/config.ts`
- `src/config/io.ts`
- `src/config/validation.ts`
- `src/config/legacy-migrate.ts`
- `src/config/paths.ts`

Responsibilities:

- reading and writing config
- validating config objects
- migrating legacy config
- maintaining runtime config snapshots
- exposing path and default resolution helpers

Important architectural property:

- many other subsystems depend on config snapshots, not on ad hoc config reads
- this layer carries a lot of compatibility and migration burden

### `src/routing`

This is the session and agent routing logic.

Key files:

- `src/routing/resolve-route.ts`
- `src/routing/session-key.ts`
- `src/routing/account-lookup.ts`

Responsibilities:

- deciding which agent should handle an inbound event
- building canonical session keys
- matching channel/account/peer/guild/team/role bindings
- determining last-route behavior and session routing scope

Why it matters:

- if you want to understand “why did this message go to this agent/session,” this is the module to read

### `src/sessions`

This is the session policy and lifecycle layer.

Key files:

- `src/sessions/send-policy.ts`
- `src/sessions/model-overrides.ts`
- `src/sessions/session-lifecycle-events.ts`
- `src/sessions/transcript-events.ts`

Responsibilities:

- send policy enforcement
- model override behavior
- lifecycle event propagation
- transcript update signaling

It is a narrower layer than `routing`, but critical for runtime behavior.

### `src/secrets`

This is the SecretRef resolution layer.

Key files:

- `src/secrets/resolve.ts`
- `src/secrets/configure.ts`
- `src/secrets/audit.ts`
- `src/secrets/ref-contract.ts`

Responsibilities:

- resolving secret references from provider/file/exec sources
- enforcing provider- and path-level constraints
- protecting secret resolution through batch limits, output limits, file limits, and permission checks
- helping commands and config flows work safely with secrets

Why it matters:

- this repository treats secret resolution as a first-class runtime problem, not just a config parsing detail

### `src/security`

This is the security audit and remediation layer.

Key files:

- `src/security/audit.ts`
- `src/security/fix.ts`
- `src/security/dangerous-config-flags.ts`
- `src/security/dangerous-tools.ts`

Responsibilities:

- auditing configured risk across channels, tools, exec approvals, browser, network exposure, gateway auth, and filesystem state
- categorizing findings by severity
- supporting deep audits and fix flows

Architectural observation:

- this repo explicitly acknowledges that the product touches real messaging surfaces and real tools
- security is not treated as documentation only; it is embedded into runtime checks and audit commands

### `src/infra`

This is the broadest cross-cutting support layer.

Representative areas:

- env and startup helpers
- device auth and identity
- Bonjour discovery
- outbound/session binding services
- exec approval policies
- control UI asset handling
- TLS/network helpers
- diagnostics and logging support

Why it matters:

- `infra` is where operational and host-level concerns live
- if `config` defines the system state, `infra` often implements the low-level mechanics that make that state work

### `src/process`

This is local process execution and supervision.

Key files:

- `src/process/exec.ts`
- `src/process/command-queue.ts`
- `src/process/supervisor/*`

Responsibilities:

- safe local command execution
- Windows command shim behavior
- timeout and no-output timeout handling
- PTY/process supervision
- queueing and recovery behavior

This layer is heavily relevant for tool execution and host interaction.

### `src/node-host`

This is the headless host execution layer for node-owned runtime commands.

Key files:

- `src/node-host/runner.ts`
- `src/node-host/invoke.ts`
- `src/node-host/exec-policy.ts`

Responsibilities:

- running node-host commands
- applying system-run policy
- enforcing execution plans and timeouts

### `src/media`

This is the low-level media handling layer.

Responsibilities:

- fetching media
- MIME detection
- ffmpeg invocation
- local path policy
- image/audio helpers
- file context extraction

This layer is about file/media mechanics, not semantic understanding.

### `src/media-understanding`

This is the semantic media interpretation layer above `media`.

Key files:

- `src/media-understanding/apply.ts`
- `src/media-understanding/runner.ts`
- `src/media-understanding/format.ts`
- `src/media-understanding/attachments.*`

Responsibilities:

- normalizing attachments
- picking understanding capabilities by kind
- dispatching to providers
- formatting transcripts and extracted results
- merging media results back into message context

This is where raw files become useful text context for agents.

### `src/tts`

This is speech output orchestration.

Responsibilities:

- runtime-facing TTS helpers
- provider registry
- voice listing
- telephony-aware speech variants

### `src/image-generation`

This is image generation runtime integration.

Its runtime file is intentionally thin and forwards to Plugin SDK runtime surfaces, which reinforces the plugin-first design.

### `src/web-search`

This is the runtime bridge for configured web search providers.

It is intentionally thin, similar to `image-generation`, and relies on runtime/provider registration.

### `src/wizard`

This is the interactive setup engine.

Key files:

- `src/wizard/setup.ts`
- `src/wizard/prompts.ts`
- `src/wizard/setup.gateway-config.ts`
- `src/wizard/setup.finalize.ts`

Responsibilities:

- running the onboarding/setup wizard
- collecting and confirming risky setup choices
- applying guided configuration
- formatting user-facing setup prompts and completion output

### `src/flows`

This is the multi-step business flow layer used by setup and doctor experiences.

Representative flow:

- `src/flows/channel-setup.ts`

Responsibilities:

- reusable workflow orchestration
- setup/adaptation logic shared across command surfaces
- status and note assembly for guided flows

### `src/tui`

This is the terminal UI surface for talking to the Gateway interactively.

Responsibilities:

- chat log rendering
- command handlers
- event handlers
- themed terminal UI components
- markdown/tool execution rendering inside a TUI shell

### `src/terminal`

This is the CLI terminal rendering layer.

Key file:

- `src/terminal/table.ts`

Responsibilities:

- ANSI-safe rendering
- table layout
- progress lines
- prompt styling
- terminal-safe text output

### `src/markdown`

This is the markdown shaping layer for channel-safe and terminal-safe output.

Responsibilities:

- markdown IR transformations
- tables/fences/code span handling
- WhatsApp-targeted output shaping

### `src/mcp`

This is the MCP bridge layer.

Key file:

- `src/mcp/channel-server.ts`

Responsibilities:

- exposing Gateway/channel capability as an MCP server
- running stdio transport
- registering MCP tools against an OpenClaw bridge

### `src/shared`

This is a shared data-model and helper layer used across runtime surfaces.

Representative helpers:

- chat envelope parsing
- device auth primitives
- bind URL resolution
- entry metadata
- frontmatter helpers

This layer is more structured than `utils`; it tends to hold shared domain shapes, not just helper functions.

### `src/utils`

This is a generic helper layer.

Responsibilities:

- path utilities
- JSON parsing
- string and number helpers
- message channel utilities
- transcript helpers
- concurrency helpers

It is broad but intentionally lightweight.

### `src/context-engine`

This is the context engine abstraction boundary.

Responsibilities:

- registering and resolving context engines
- legacy context engine compatibility
- delegating compaction behavior into runtime-managed engines

### `src/pairing`

This module owns pairing challenges, setup codes, and pairing store semantics for secure inbound access.

### `src/canvas-host`

This module owns the Canvas host server and A2UI serving behavior, including live reload.

### `src/link-understanding`

This module performs safe URL extraction and related formatting/application behavior, using SSRF-aware filtering.

### `src/interactive`

This module defines normalized interactive reply payloads such as buttons and selection blocks.

### `src/bootstrap`

This module contains small Node startup environment helpers, especially around startup env and CA certificate behavior.

### `src/bindings`

This module is a thin bridge for runtime-created and configured conversation binding records.

### `src/extensions`

This module is a narrow public artifact bridge from the core plugin layer to extension-consumable surfaces.

### `src/generated`

This module contains generated plugin/channel entry lists that support loader and registry assembly.

### `src/types`

This module provides local type declarations for dependencies or runtime surfaces lacking first-party types.

### `src/test-helpers` and `src/test-utils`

These are test support modules rather than production runtime modules.

- `test-helpers` is smaller and more local
- `test-utils` is broader and provides reusable harnesses, fixtures, mocks, and scanning helpers

## 5. Architectural Reading Notes

There are a few especially important structural ideas in this repository:

### Gateway-first design

The system is organized around the Gateway as the authoritative runtime surface. Even agent execution exposed through the CLI defaults to Gateway RPC first.

### Plugin-first capability model

Many user-visible features are registered through plugins rather than hardcoded in core. This includes channels, providers, browser-like capabilities, memory, and other runtime surfaces.

### Public SDK boundary is explicit

`src/plugin-sdk` is not convenience code. It is the supported contract boundary. The repository’s own boundary notes make it clear that extensions should not reach into internal `src/**` modules directly.

### Routing and sessions are first-class

This is not a “single chat thread” architecture. The codebase treats channel/account/peer/session/agent routing as a major domain concern.

### Security is integrated into runtime behavior

Secret resolution, DM pairing, audit tooling, exec approvals, filesystem safety, and SSRF-aware behaviors are not side topics. They are embedded throughout the runtime.

## 6. Run, Build, and Test

Important commands for understanding and working with the code:

- `pnpm install`
- `pnpm openclaw onboard --install-daemon`
- `pnpm gateway:watch`
- `pnpm openclaw ...`
- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm ui:build`

What they mean in practice:

- `pnpm openclaw ...`
  - runs the TypeScript development entry
- `pnpm gateway:watch`
  - is the fast loop for Gateway development
- `pnpm check`
  - is the main local code-quality gate
- `pnpm test`
  - uses the repo’s custom test wrapper, not just raw Vitest defaults
- `pnpm build`
  - is a real production-oriented build pipeline, not just TypeScript transpilation

## 7. Recommended Reading Order

If you are ramping up on this codebase, read in this order:

1. `README.md`
2. `AGENTS.md`
3. `package.json`
4. `pnpm-workspace.yaml`
5. `openclaw.mjs`
6. `src/entry.ts`
7. `src/cli/run-main.ts`
8. `src/cli/program/build-program.ts`
9. `src/cli/program/command-registry.ts`
10. `src/cli/program/register.subclis.ts`
11. `src/commands/onboard.ts`
12. `src/commands/agent-via-gateway.ts`
13. `src/gateway/server.impl.ts`
14. `src/gateway/server-plugin-bootstrap.ts`
15. `src/plugins/AGENTS.md`
16. `src/plugins/loader.ts`
17. `src/plugins/registry.ts`
18. `src/plugin-sdk/AGENTS.md`
19. `src/plugin-sdk/core.ts`
20. `src/channels/AGENTS.md`
21. `src/channels/registry.ts`
22. `src/channels/plugins/registry.ts`
23. `src/routing/resolve-route.ts`
24. `src/agents/agent-command.ts`
25. `src/agents/command/attempt-execution.ts`
26. `src/auto-reply/dispatch.ts`
27. `src/config/io.ts`
28. `src/secrets/resolve.ts`
29. `src/security/audit.ts`

After that, deepen in the direction you care about:

- channels and delivery
- plugin authoring
- Gateway protocol
- agent execution/model backends
- setup/onboarding/operator experience
- security and secret handling

## 8. Open Questions and Follow-Up Areas

Areas that deserve a second pass if you want even deeper understanding:

- `src/agents`
  - this is the largest single runtime-oriented subtree and contains many backend-specific execution details
- `src/gateway`
  - especially server methods, node handling, and WebSocket event fanout
- `src/plugins`
  - especially registry population rules, load ordering, and capability-specific runtime behavior
- `src/config`
  - especially validation and legacy migration behavior
- `src/infra`
  - broad and operationally important, but too wide to fully absorb in one pass

Smaller modules that appear intentionally thin:

- `src/docs`
- `src/i18n`
- `src/chat`
- `src/extensions`
- `src/generated`

These are real modules, but they are not the architectural core of the current `src/` tree.

## 9. Final Assessment

The `src/` tree is best understood as four major layers working together:

- operator and UX layer
  - `cli`, `commands`, `wizard`, `flows`, `tui`, `terminal`
- control plane layer
  - `gateway`, `protocol`, `channels`, `routing`, `sessions`
- capability platform layer
  - `plugins`, `plugin-sdk`, `extensions`, `mcp`, `context-engine`
- runtime and safety foundation layer
  - `config`, `infra`, `process`, `secrets`, `security`, `node-host`, `media`

If you keep those four layers in mind, the rest of the codebase becomes much easier to reason about.
