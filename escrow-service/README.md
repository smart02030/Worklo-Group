# Escrow Service

A Go microservice for milestone escrow: a client locks funds for a fixed number
of milestones, approves them as work lands, and the contractor claims each
approved milestone to trigger a payout.

Go 1.22+ · Supabase (Postgres) over PostgREST, with milestone mutations as SQL
functions · port `4001`.

## Build and run

```bash
# 1. Apply in order via Supabase dashboard → SQL Editor:
#      supabase/schema.sql
#      supabase/escrow-rpc.sql   <-- REQUIRED: atomic RPCs + transfer outbox
# 2. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local

cd escrow-service
go mod download
go run ./cmd/server      # http://localhost:4001
go test ./...            # no database required
```

| Variable                    | Default  |                               |
| --------------------------- | -------- | ----------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`  | required | Supabase project URL          |
| `SUPABASE_SERVICE_ROLE_KEY` | required | Service-role key              |
| `PORT`                      | `4001`   |                               |
| `LOG_LEVEL`                 | `info`   | `debug`/`info`/`warn`/`error` |
| `SHUTDOWN_GRACE_SECONDS`    | `20`     | in-flight request drain       |

Bad configuration fails at startup, not on the first request.

### Endpoints

| Method | Path                             |                                    |
| ------ | -------------------------------- | ---------------------------------- |
| `POST` | `/escrow`                        | `201`                              |
| `GET`  | `/escrow/{id}`                   | `404` if absent                    |
| `POST` | `/escrow/{id}/approve-milestone` | client only, `{"caller_id":"..."}` |
| `POST` | `/escrow/{id}/claim-milestone`   | contractor only                    |
| `GET`  | `/project/{projectId}/escrow`    | added for the Next.js layer        |
| `GET`  | `/healthz`                       | liveness                           |

Every failure uses one envelope:

```json
{
  "error": {
    "code": "NO_APPROVED_MILESTONE",
    "message": "no approved milestone available to claim (1 approved, 1 claimed)",
    "request_id": "5f0c…"
  }
}
```

`400` bad input · `403` wrong caller · `404` unknown · `409` state refused ·
`502` Supabase failed · `500` bug here.

## Concurrency

Every milestone mutation is a single guarded `UPDATE … WHERE … RETURNING`
inside a Postgres function. All preconditions live in the `WHERE` clause:

```sql
UPDATE escrows SET milestones_approved = milestones_approved + 1
 WHERE id = p_escrow_id AND client_id = p_caller_id
   AND status = 'active' AND milestones_approved < total_milestones
RETURNING *;
```

**Guarantee.** Postgres row-locks for the statement, and under `READ COMMITTED`
a blocked writer re-evaluates its `WHERE` against the newly committed row once
it acquires the lock. The second of two concurrent approvals therefore sees the
first one's increment before deciding whether its guard still holds. There is
no window where two callers read `N` and both write `N+1`. Schema `CHECK`
constraints are a second line of defence.

**Why not the alternatives.** Read-modify-write from Go is unfixable over
PostgREST — one HTTP request per statement, no transaction spanning the read
and the write. Optimistic concurrency (`version` column + retry) would also be
correct, but nothing is computed application-side between read and write, so it
would only add a retry loop. Application-level locking breaks the moment there
is more than one instance. `SELECT … FOR UPDATE` is what I'd use if the
operation spanned several statements; for one increment it is more machinery
for the same guarantee.

**Where it breaks.**

1. **No request idempotency.** This protects the counters, not the intent — a
   client that retries a timed-out request will approve twice, since both are
   legitimately "approve the next milestone". Needs an `Idempotency-Key` with a
   unique constraint and a replayed response. Most important thing missing.
2. **Failure diagnosis is advisory.** When the `UPDATE` matches nothing the
   function re-reads the row to decide 403 vs 409; under concurrency that read
   can be stale. Affects only which 4xx is returned, never whether money moved.
3. **Serialisation, not throughput.** Writers to one escrow queue on one row
   lock. Fine for one client and one contractor; wrong for a hot aggregate row.
4. **Logic lives in SQL**, so it is not covered by Go tests and needs a
   migration to change. That is the real cost of this choice.

## Fund transfer

The claim RPC increments `milestones_claimed` **and** inserts an
`escrow_transfers` row in the same transaction. Only then is the transfer
attempted. `UNIQUE (escrow_id, milestone_index)` makes the guarantee structural
rather than procedural.

**At-most-once payment, at-least-once attempt.**

| Crash point                   | Outcome                                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before commit                 | Nothing happened; retry cleanly                                                                                                                                                          |
| After commit, before transfer | Claim recorded, `pending` row for the worker                                                                                                                                             |
| Transfer failed               | Row marked `failed` with the error, retried later                                                                                                                                        |
| Transfer sent, marking failed | **The one bad case** — logged at `ERROR` with everything needed to reconcile, reported as `pending`. The row ID is stable across retries, so a provider idempotency key makes it a no-op |

A failed transfer deliberately does **not** fail the claim: the increment is
already committed, so an error would tell the contractor to retry something
already recorded. Instead the response is `200` with
`transfer.status: "pending"` and the UI says the payout is queued.

Not built: the retry worker itself. Rows are indexed for it
(`idx_escrow_transfers_unsettled`) but nothing sweeps them yet.

## Other decisions

**PostgREST over pgx.** One credential and access path shared with the Next.js
app, no pool tuning against Supabase's pooler. Costs a round trip per statement
and client-side transactions — but pushing mutations into SQL functions
neutralises the transaction problem for exactly the operations that need it. If
this grew multi-statement workflows I would move to pgx.

**Observability.** Structured JSON logs; request IDs accepted from
`X-Request-Id` (so a trace spans the Next.js proxy) or generated, injected by a
custom `slog.Handler` so no line can omit one; echoed in the response header
and every error body; one access-log line per request, 5xx at `ERROR` and 4xx
at `WARN`. Internal causes are logged, never serialised.

**Shutdown.** `SIGTERM` drains in-flight handlers for up to
`SHUTDOWN_GRACE_SECONDS`, deliberately longer than the Supabase timeout. A
payout runs on a context detached from the request, so a client disconnect does
not abandon a payment we owe.

**Testability.** `service.Service` depends on a `Repository` interface and
handlers on an `EscrowService` interface, so nothing needs a database. Covered:
every authorisation rule, every state guard, 50 concurrent approvals against 5
milestones yielding exactly 5 successes, transfer failure leaving the claim
committed and the row retryable, settlement-write failure still succeeding, a
cancelled request still paying out, and upstream failure surfacing as `502`
rather than a misleading `404`.

## Verified against a live database

| Check                                           | Result                                      |
| ----------------------------------------------- | ------------------------------------------- |
| create → approve → claim                        | `201`/`200`/`200`, counters correct         |
| contractor approves / client claims             | `403` both                                  |
| claim with nothing approved                     | `409`                                       |
| **20 concurrent approvals, 3-milestone escrow** | **exactly 3 × `200`, 17 × `409`**           |
| **20 concurrent claims, 3 approved**            | **exactly 3 × `200`, `status → completed`** |
| outbox after those claims                       | 3 rows, indices 1/2/3, all `sent`           |

40 simultaneous requests produced exactly 3 approvals and 3 payments totalling
the escrow's value and not a cent more.

## With more time

1. **Idempotency keys** on approve and claim — the largest correctness gap.
2. **The retry worker** for unsettled outbox rows.
3. **Move to pgx** — same guarantees, logic back in Go where it is testable.
4. **Automated integration tests** (testcontainers). I verified the SQL by hand;
   a manual check is not a regression test.
5. **Metrics and tracing.** Logs answer "what happened to this request", not
   "how many claims are failing now".
6. **Authentication.** The service trusts `caller_id` because the Next.js proxy
   sets it from the session and the service is not internet-facing. That is a
   deployment assumption, not a security boundary — it should verify the JWT.
7. **Money as a typed value**; `int64` cents with an implicit USD is a latent
   bug the moment there are two currencies.

## Designing `cancel_escrow`

`POST /escrow/{id}/cancel`, body `{"caller_id": "...", "reason": "..."}`.

```
pending   → cancelled     always (no funds committed)
active    → cancelled     allowed; unclaimed milestones released
completed → cancelled     REJECTED (409) — everything is already paid
cancelled → cancelled     no-op, 200 (idempotent by nature)
```

**Who.** Only the client, and only while
`milestones_claimed = milestones_approved`. If the client has approved work the
contractor has not yet claimed, cancelling would strand a payment they already
agreed to; that must be paid out first, or go through a dispute path, which is
a different feature.

```sql
UPDATE escrows SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = p_reason
 WHERE id = p_escrow_id AND client_id = p_caller_id
   AND status IN ('pending', 'active')
   AND milestones_claimed = milestones_approved
RETURNING *;
```

Same shape as approve and claim — one statement, all guards in the `WHERE` — so
cancellation cannot interleave with an in-flight mutation. A claim racing a
cancel either completes first (and the cancel then correctly fails its
`claimed = approved` check) or runs after (and fails its own `status = 'active'`
check). Neither ordering pays out from a cancelled escrow.

**Ordering.** The mirror of the claim path, for the same reason:

1. One transaction: flip `status` to `cancelled` **and** insert a refund outbox
   row for `amount_per_milestone × (total_milestones − milestones_claimed)`,
   keyed uniquely on the escrow so a replay cannot duplicate it.
2. Commit — the escrow is now closed, which is what stops a concurrent claim
   from racing the refund.
3. Attempt the refund; settle it or leave it for the retry worker.

State first, money second: a crash between the two leaves a durable refund
obligation, whereas refunding first and crashing before the commit would leave
a live escrow whose funds are already gone.

**Terminal by design.** Reopening a cancelled escrow would mean reconciling the
balance against whatever was already refunded — a real-money problem. A new
escrow is cheap; the cancelled row stays as the record.

## Known gaps

- **Race detector not run** — `-race` needs cgo and there was no C toolchain on
  the build machine. Concurrency tests assert final counts under `-count=30`,
  which catches lost updates but not a benign-looking data race. Run
  `CGO_ENABLED=1 go test ./... -race` where gcc is available.
- **Graceful shutdown not exercised end-to-end** — built on Windows, which has
  no real `SIGTERM`. The path is `signal.NotifyContext` → `srv.Shutdown`, but
  "in-flight requests drain" is asserted by construction, not by a test.
- Retry worker and idempotency keys are designed above but not implemented.
