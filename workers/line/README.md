# LINE worker (Go)

This module replaces only the Mac's outbound LINE worker. The Next.js webhook,
worker API, database, authentication, LINE formatter and web chat stay unchanged.
It uses the Go standard library only; no Node.js process is needed at runtime.

From the repository root:

```sh
npm run line:worker:build
npm run line:worker -- --check
npm run line:worker
```

The npm wrapper is optional. LaunchAgent executes `build/line-worker` directly
with `NODE_ENV=development`, `CHAT_PROVIDER=codex-local`, the verified
`CODEX_LOCAL_BIN`, and this repository as its working directory. Do not start a
second worker while LaunchAgent is running. See [operations](../../docs/line-integration.md)
for configuration precedence, macOS permissions and rollback.

## Boundaries preserved

- HTTPS-only origin, except explicit localhost/127.0.0.1/::1 test endpoints;
  64-hex-character bearer token; no redirects; bounded responses and timeouts.
- One job at a time; claim/lease/complete/deliver protocol unchanged. Drain
  acknowledged jobs immediately; wait 15 seconds after empty/error/409 responses.
- Codex `app-server` over stdio, pinned CLI and model, Business account check,
  ephemeral read-only thread, inherited MCP disabled, tool requests rejected,
  minimal child environment, 55-second limit and strict correction validation.
  The [official App Server protocol](https://learn.chatgpt.com/docs/app-server)
  is the reference; this port intentionally retains the already-tested version
  rather than automatically adopting protocol or model updates.
- `/battery`: fixed `pmset -g batt`, no shell, bounded output, five-second limit.
- Development issues: local `gh` credentials only, fixed repository, literal
  proposal formatting, single-use publication permit, bounded reconciliation
  across open/closed issues, and never a second POST after an ambiguous result.
- SIGINT/SIGTERM cancel network calls and children. Logs exclude text,
  corrections, tokens, raw provider errors and battery details.

## Tests

```sh
npm run test:worker # go vet + race-enabled offline Go tests
npm run test:unit   # above + build + existing TS API-contract/process tests
```

The Go protocol tests use the existing offline Codex fixture and never read
stored Codex credentials. The TypeScript worker tests launch the compiled Go
binary against local mock servers. Prompt/disabled-feature parity checks catch
drift against the web adapter. CI installs Go only for the verification job;
Vercel's Next.js build does not require Go.

An optional live check uses one small Business turn but does not poll the queue,
write a database record, send LINE messages or publish an issue:

```sh
cd workers/line
ZHUELOG_LIVE_CODEX_TEST=1 CODEX_LOCAL_BIN=/absolute/path/to/codex go test -count=1 -run '^TestLiveCodex$' -v .
```

The runtime configuration loader deliberately accepts only single-line literal
worker settings. It does not evaluate shell syntax, dotenv variable expansion,
or load database/LINE channel credentials. Keep test fixtures and production
configuration separate.
