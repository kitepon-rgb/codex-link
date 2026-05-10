# Architecture

## Overview

Codex Link has three surfaces:

```text
Codex Link iPhone app
  <-> Codex Link Relay
      <-> Codex Link Host app
          <-> local Codex CLI / app-server
```

The Relay is a multi-tenant broker and registry.
The Host is where Codex actually runs.
The iPhone app is the mobile control surface.

## High-level diagram

```text
                 ┌──────────────────────────────────────────────┐
                 │ Codex Link Relay                             │
                 │                                              │
                 │ - users / devices / hosts / ACL              │
                 │ - online state                               │
                 │ - routing / relay                            │
                 │ - audit / rate limit                         │
                 └──────────────────────────────────────────────┘
                         ▲                          ▲
                         │ WSS outbound             │ HTTPS / WSS
                         │                          │
┌────────────────────────┴──────────────┐   ┌───────┴──────────────────────┐
│ Codex Link Host: MacBook              │   │ Codex Link iPhone app         │
│                                       │   │                              │
│ - local Codex CLI / app-server         │   │ - host list                  │
│ - local project folders                │   │ - chat / approval            │
│ - Xcode / Simulator / shell            │   │ - timeline                   │
│ - local side effects                   │   │ - Live Activities            │
└───────────────────────────────────────┘   └──────────────────────────────┘

┌───────────────────────────────────────┐
│ Codex Link Host: Main PC              │
│                                       │
│ - local Codex CLI / app-server         │
│ - local project folders                │
│ - VS Code / browser / Docker / shell   │
└───────────────────────────────────────┘
```

## Relay responsibilities

- user authentication
- device registration
- host registration
- host online/offline state
- host list filtering by owner/ACL
- iPhone-to-Host message routing
- Host-to-iPhone event routing
- device revocation
- rate limiting
- audit logs

The Relay does not:

- run Codex
- read local project folders
- hold SSH keys
- hold `~/.codex`
- act as Codex context source of truth

## Host responsibilities

- authenticate as a device/Host
- open outbound WebSocket to Relay
- start/connect to local Codex
- expose project list and capabilities
- execute turns locally
- handle approvals
- stream transcript/timeline/status events
- keep local side effects local

## iPhone responsibilities

- authenticate user/device
- show authorized Host list
- select Host and project/thread
- send turns
- show progress, transcript, timeline
- show approval cards
- update Live Activities

## Routing model

Host apps do not need inbound port forwarding.
They initiate outbound WSS connections to the Relay.

The iPhone app connects to the Relay and selects an authorized Host.
The Relay routes messages only when the current user has access to that Host.

## Protocol boundary

The iPhone app does not speak raw Codex app-server JSON-RPC.

```text
Codex app-server protocol
  is owned by Host app

Codex Link protocol
  is shared by iPhone app, Relay, and Host app
```

This isolates the iPhone app from Codex experimental protocol churn.

## Package layout target

```text
apps/
  ios/
  mac-host/
  pc-host/

services/
  relay/

packages/
  protocol/
  codex-client/
  security/
```
