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
- Codex `app-server` over stdio, fixed model, Business account check,
  ephemeral read-only thread, inherited MCP disabled, tool requests rejected,
  minimal child environment, 55-second limit and strict correction validation.
  The [official App Server protocol](https://learn.chatgpt.com/docs/app-server)
  is the reference; CLI versions are not gated, while protocol validation and
  the configured model remain enforced.
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

`test:unit` builds the binary first, then runs Go validation and TypeScript tests
concurrently. Go tests that do not mutate process environment use `t.Parallel()`
with up to four concurrent tests; TypeScript uses up to four isolated test-file
processes. Environment-mutating Go tests and the opt-in live check stay serial.
Either suite failing makes the command fail, after both suites finish. Ctrl+C
terminates the active runners. Browser E2E stays serial because it resets a
shared database before each test.

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

## Codex compatibility and failure notifications

The Go worker tries the installed Codex App Server regardless of CLI version.
It still enforces the Business account, configured model, read-only thread,
disabled tools/MCP, timeout and correction schema. Protocol incompatibility is
handled as an actual processing failure. The separate TypeScript web chat
adapter retains its existing version requirement.

Correction failures are logged with an RFC 3339 timestamp, job ID and fixed
error code. Updated servers advertise `failureNotifications` on claim; the
worker sends the code only to those servers. With older servers it uses the
legacy failure command and logs that notification requires a server update.
Deploy the web/API update to enable notifications, then restart the worker.
No database migration is needed.

The server persists a Japanese failure reply and code in the existing job,
without creating a learning note. It queues delivery immediately instead of
retrying generation; delivery keeps the existing lease, retry key and bounded
retry window. Raw provider errors, credentials and input text are excluded from
failure notifications/logs. If the server is unreachable, the worker logs the
failure; LINE notification cannot be queued until communication is restored.
A process crash, sleep or power loss cannot produce an immediate notification.

LaunchAgent's `KeepAlive` restarts an exited process but cannot run work while
the Mac is asleep or logged out.
