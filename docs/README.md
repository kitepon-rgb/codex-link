# Codex Link Docs

Codex Link is a new project, separate from the old `codex-rc` implementation.

It is designed around:

- native iPhone app first
- local Mac/PC Codex Host apps
- a multi-tenant Relay for auth, host registry, and routing
- Codex latest features where verified
- no central Codex execution server

## Reading order

1. [product-brief.md](product-brief.md)
2. [architecture.md](architecture.md)
3. [security-model.md](security-model.md)
4. [mvp-plan.md](mvp-plan.md)
5. [session-authority.md](session-authority.md)
6. [codex-feature-verification.md](codex-feature-verification.md)

## Decisions

- App name: **Codex Link**
- Subtitle: **Connect your iPhone to local Codex**
- Mac/PC app: **Codex Link Host**
- Server: **Codex Link Relay**
- Relay is multi-tenant, even if self-hosted on a home LAN.
- Relay does not execute Codex.
- Host apps execute Codex locally and own local side effects.
- iPhone app connects to Relay, selects an authorized Host, then controls local Codex through that Host.
- Never show another user's Host list.
- Do not infer Codex feature relationships from similar names. Verify through official docs or smoke tests.
