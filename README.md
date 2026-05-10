# Codex Link

**Connect your iPhone to local Codex.**

Codex Link is an independent companion system for controlling Codex running on your own Mac or PC from an iPhone.

It is not a central Codex execution server. Codex runs locally on each user's computer, where it can access that machine's project folders, shell, Xcode, simulator, browser, VS Code, Docker, and other local tools.

The central service is only a broker / registry / relay:

- user authentication
- device registration
- host discovery
- host online/offline state
- authorized relay between iPhone and local Host apps

Codex Link is not affiliated with or endorsed by OpenAI.

## Product shape

```text
iPhone app
  -> Codex Link Relay
      -> user's MacBook Codex Link Host
          -> local Codex CLI / app-server
          -> local projects / Xcode / shell

      -> user's PC Codex Link Host
          -> local Codex CLI / app-server
          -> local projects / VS Code / browser / Docker
```

## Apps

```text
apps/ios
  Native iPhone app.

apps/mac-host
  macOS Codex Link Host app.

apps/pc-host
  Windows/Linux Host app later.

services/relay
  Multi-tenant broker / registry / relay.

packages/protocol
  iPhone <-> Relay <-> Host protocol.

packages/codex-client
  Host-side Codex app-server / CLI integration.
```

## Core decisions

- iPhone app does not SSH into computers.
- iPhone app does not read project folders directly.
- iPhone app does not speak raw Codex app-server JSON-RPC.
- Local Host apps own Codex integration and local side effects.
- The Relay is multi-tenant and must never show another user's hosts.
- The Relay is not the source of truth for Codex context.
- Durable code state should flow through GitHub: branches, commits, PRs, issues, docs.

## Documentation

Start here:

1. [docs/README.md](docs/README.md)
2. [docs/product-brief.md](docs/product-brief.md)
3. [docs/architecture.md](docs/architecture.md)
4. [docs/security-model.md](docs/security-model.md)
5. [docs/mvp-plan.md](docs/mvp-plan.md)

## App naming

- App name: **Codex Link**
- Subtitle: **Connect your iPhone to local Codex**
- Mac/PC app: **Codex Link Host**
- Server: **Codex Link Relay**
