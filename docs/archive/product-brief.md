# Product Brief

## Name

**Codex Link**

Subtitle:

```text
Connect your iPhone to local Codex
```

## One-liner

Codex Link lets an iPhone control Codex running locally on a user's own Mac or PC.

## Origin

Codex Link exists to fulfill the ideal that the older `codex-rc` project was reaching for.

The goal is simple:

- control an active local development session from an iPhone app
- make the session state easy to understand
- avoid missing or disappearing logs
- make it obvious when AI is working
- show long-running work through Live Activities
- make it easy for a user to connect to their local machine
- let a local PC/Mac finish Host setup with one install command
- use the configured Relay domain as a shared hub for many users and Hosts
- eventually ship as an App Store app

The project should carry forward the ideal, not the old implementation model.

## Problem

Codex can act on local projects and local tools, but iPhone is not a good place to run local developer workflows.

A user wants to:

- start or continue Codex work from iPhone
- approve actions from iPhone
- see live progress and completion
- see complete session logs without gaps caused by UI restarts or reconnects
- understand whether the AI is idle, thinking, running tools, waiting for approval, failed, or complete
- use Live Activities for long-running work
- keep local side effects on the Mac or PC that owns the project
- set up the local Host with a single install command as much as possible
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

The Relay domain is a shared hub. Multiple users and multiple Host machines may connect to the same domain, so authentication and authorization are required from the beginning.

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
- clear running/idle/waiting status
- Live Activities
- device settings

### Codex Link Host

A local Mac/PC companion app.

- installs and configures with one command where the platform allows it
- logs in to Relay
- registers a Host for the user
- opens outbound WebSocket to Relay
- connects to local Codex CLI / app-server
- executes turns locally
- reports transcript, timeline, approvals, status
- preserves enough event history for reconnect and UI recovery

### Codex Link Relay

A multi-tenant broker.

- runs behind the configured shared domain
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
