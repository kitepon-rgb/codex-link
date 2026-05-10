# Session Authority

Codex Link does not become the source of truth for Codex context.

## Source of truth

Preferred sources of truth:

1. Codex local thread/session/history on the selected Host, when compatible and available.
2. GitHub branch/commit/PR/issue/docs for durable code state.

Codex Link may keep projection data for mobile UX, reconnect, Live Activities, and debugging, but it should not pretend to fully own Codex context.

## Local effects

A turn executes on the selected Host.

```text
MacBook Host
  -> Xcode
  -> Simulator
  -> local project folder
  -> local shell

Main PC Host
  -> VS Code
  -> browser
  -> Docker
  -> local project folder
```

The Relay does not execute local effects.
The iPhone app does not execute local effects.

## Practical fallback

If Codex context cannot be shared across tools or machines, durable state flows through GitHub:

- branch
- commit
- PR
- issue
- docs
- comments

## Open questions

- Can Host-created Codex threads appear in Codex CLI history?
- Can Host-created Codex threads appear in VS Code Codex history?
- How much Codex event history can be reconstructed from official APIs?
- Which Codex APIs are stable enough for MVP?
