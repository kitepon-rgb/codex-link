# Codex Feature Verification

Codex Link should use Codex's newest useful capabilities, but it must not infer feature behavior from names alone.

## Rule

Do not design around unverified relationships between similarly named features.

For example, do not assume that a `remote_control` feature key, `remoteControl` status event, and a `remote connections` documentation page all describe the same public API unless official docs or smoke tests confirm it.

## Verification levels

```text
confirmed-official-docs
  Verified in official OpenAI or openai/codex documentation.

confirmed-smoke-test
  Verified through a local reproducible smoke test.

hypothesis
  Plausible, but not yet verified.

unknown
  Do not build on it.
```

Every Codex integration decision should state its verification level.

## Initial investigation list

- [ ] Which `codex app-server` transport should Host use first: stdio, unix socket, or localhost WebSocket?
- [ ] Which app-server APIs are required for turn start, steer, approvals, and event streaming?
- [ ] Can Host-created threads be visible in Codex CLI history?
- [ ] Can Host-created threads be visible in VS Code Codex history?
- [ ] Does official remote connections expose any usable Host integration surface for Codex Link?
- [ ] What are the security recommendations for non-loopback WebSocket access?

## Product stance

Codex Link is experimental-first, but not speculation-first.

Use new features aggressively after verifying what they actually do.
Document assumptions before building on them.
