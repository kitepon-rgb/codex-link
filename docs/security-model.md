# Security Model

Codex Link Relay may be hosted on a home LAN machine, but if other people can use it, it must be treated as a public multi-tenant service.

Do not rely on LAN trust.

## Trust boundaries

```text
iPhone app
  User-facing mobile client.

Relay
  Public-facing broker, registry, and routing service.

Host app
  User-owned Mac or PC. Owns local Codex integration and local files.

Codex
  Local process on the Host machine.
```

## Required concepts

```text
User
  Account that owns or can access Hosts.

Device
  Registered iPhone, Mac Host, or PC Host.

Host
  A local computer available for Codex work.

HostAccess
  Explicit permission for a User to see or operate a Host.

Connection
  A live Host or iPhone connection to the Relay.
```

## Authorization rule

Never return a global Host list.

The iPhone app may only see Hosts that belong to the current user or were explicitly shared with that user.

Every routed message must check that the current user can access the selected Host.
A Host identifier alone is not authorization.

## Authentication rule

Single shared API tokens are not acceptable for multi-user use.

Required properties:

- user login
- per-device registration
- revocable device credentials
- short-lived app sessions
- Host ownership checks
- route authorization checks

## Relay responsibilities

The Relay may store:

- user and device metadata
- Host metadata
- Host online state
- access-control records
- minimal audit metadata
- optional short event cache for reconnect

The Relay should not store:

- project folders
- local Codex auth state
- SSH credentials
- local filesystem data
- Codex session source of truth
- long raw logs unless explicitly designed

## Relay privacy model

MVP may use a broker-readable relay for implementation speed.
If so, the product must say that clearly.

Long-term, encrypted routing between iPhone app and Host app can be considered so that the Relay only sees routing metadata.

Do not claim end-to-end privacy unless that design is actually implemented.

## Host isolation

Local side effects happen on the selected Host.
The Relay does not execute local commands and does not access local project folders.

The Host app owns:

- local Codex integration
- local project access
- local approvals
- local execution boundaries
- local capability reporting

## Non-goals

- showing another user's Hosts
- using one shared token for all users
- making the iPhone app an SSH client
- making the Relay a Codex execution server
- making the Relay the source of truth for Codex context
