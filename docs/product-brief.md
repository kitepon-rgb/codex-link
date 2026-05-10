# Product Brief

## Name

**Codex Link**

Subtitle:

```text
Connect your iPhone to local Codex
```

## One-liner

Codex Link lets an iPhone control Codex running locally on a user's own Mac or PC.

## Problem

Codex can act on local projects and local tools, but iPhone is not a good place to run local developer workflows.

A user wants to:

- start or continue Codex work from iPhone
- approve actions from iPhone
- see live progress and completion
- use Live Activities for long-running work
- keep local side effects on the Mac or PC that owns the project
- avoid manually entering LAN IPs or exposing local ports

## Product thesis

Do not run Codex on a central server.
Run Codex on the local computer that owns the project.

Use a central Relay only for:

- user auth
- host registry
- online/offline state
- authorized routing
- optional reconnect event cache

```text
iPhone app
  -> Codex Link Relay
      -> user's Codex Link Host on Mac/PC
          -> local Codex CLI / app-server
          -> local project files and tools
```

## Components

### Codex Link iPhone app

- host list
- project/thread selection
- chat UI
- approvals
- timeline
- Live Activities
- device settings

### Codex Link Host

A local Mac/PC companion app.

- logs in to Relay
- registers a Host for the user
- opens outbound WebSocket to Relay
- connects to local Codex CLI / app-server
- executes turns locally
- reports transcript, timeline, approvals, status

### Codex Link Relay

A multi-tenant broker.

- authenticates users/devices
- stores host registry and ACLs
- routes messages between iPhone and authorized Hosts
- does not run Codex
- does not store project files or SSH keys

## Non-goals

- iPhone app SSHing into computers
- iPhone app reading project folders directly
- central server running Codex for everyone
- one shared API token for all users
- showing global Host lists
- forcing users to enter local IPs/domains manually
- reusing old `codex-rc` run/log model
