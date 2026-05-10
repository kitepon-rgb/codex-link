# MVP Plan

The MVP proves the product loop:

```text
iPhone app
  -> Relay
      -> Mac Host
          -> local Codex
```

The MVP should not try to support every platform or every Codex feature at once.

## Phase 0: Repository setup

- [ ] Create app/service/package folders.
- [ ] Add placeholder READMEs.
- [ ] Add basic contribution notes.
- [ ] Add protocol sketch.

Target layout:

```text
apps/
  ios/
  mac-host/

services/
  relay/

packages/
  protocol/
  codex-client/

docs/
```

## Phase 1: Relay skeleton

- [ ] User login placeholder.
- [ ] Device registration placeholder.
- [ ] Host registry model.
- [ ] Per-user Host list.
- [ ] Host online/offline status.
- [ ] Host WebSocket connection.
- [ ] iPhone client connection or HTTP relay.
- [ ] Authorization check for every Host route.

## Phase 2: Mac Host MVP

- [ ] Host app registers itself with Relay.
- [ ] Host app opens outbound connection to Relay.
- [ ] Host reports name and capabilities.
- [ ] Host exposes one configured project folder.
- [ ] Host can call local Codex through the chosen integration path.
- [ ] Host returns final response.
- [ ] Host reports basic running/completed/failed status.

## Phase 3: iPhone MVP

- [ ] Login.
- [ ] Host list.
- [ ] Select Host.
- [ ] Select project.
- [ ] Send prompt.
- [ ] Show running/completed/failed.
- [ ] Show final response.
- [ ] Basic approval UI if available.

## Phase 4: Live activity MVP

- [ ] Define LiveActivityState.
- [ ] Start Live Activity for a running turn.
- [ ] Update status.
- [ ] Show approval-required state.
- [ ] End on completed/failed/canceled.
- [ ] Tap into active turn.

## Phase 5: Event-native UX

- [ ] Normalize Codex events into Codex Link events.
- [ ] Add transcript projection.
- [ ] Add timeline projection.
- [ ] Keep raw logs/debug data out of the normal UI.
- [ ] Add reconnect state.

## Phase 6: Multi-user hardening

- [ ] Real authentication.
- [ ] Device revocation.
- [ ] Host sharing/ACL.
- [ ] Audit metadata.
- [ ] Rate limits.
- [ ] Privacy model decision for relay payloads.

## MVP non-goals

- Windows Host.
- App Store release.
- Full end-to-end encryption.
- Full Codex thread/session compatibility.
- Reusing old `codex-rc` server code.
- Centralized Codex execution.
