# Escrow Service

Go microservice for milestone escrow, backed by Supabase.

## Build and run

```bash
# Apply supabase/schema.sql, then supabase/escrow-rpc.sql (the atomic RPCs
# and the transfer outbox — the service needs both).
# Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.

cd escrow-service
go mod download
go run ./cmd/server      # :4001
go test ./...            # no database needed
```

`PORT`, `LOG_LEVEL` and `SHUTDOWN_GRACE_SECONDS` are optional. Bad config fails
at startup rather than on the first request.

Endpoints are the four from the brief, plus `GET /project/{id}/escrow` (the
Next.js layer knows a project ID, not an escrow ID) and `GET /healthz`. Errors
all use one shape:

```json
{ "error": { "code": "NO_APPROVED_MILESTONE", "message": "...", "request_id": "..." } }
```

## Concurrency

Each milestone mutation is one guarded statement inside a Postgres function:

```sql
UPDATE escrows SET milestones_approved = milestones_approved + 1
 WHERE id = p_escrow_id AND client_id = p_caller_id
   AND status = 'active' AND milestones_approved < total_milestones
RETURNING *;
```

Postgres row-locks for the statement, and under READ COMMITTED a blocked writer
re-checks its WHERE against the newly committed row. So the second of two
concurrent approvals sees the first one's increment before deciding whether its
own guard holds. Two callers can't both read N and write N+1.

I went this way because read-modify-write from Go can't work over PostgREST —
one HTTP request per statement, so there's no transaction spanning the read and
the write. Optimistic concurrency with a version column would also be correct,
but nothing is computed in Go between the read and the write, so it would only
add a retry loop. A mutex breaks as soon as there's a second instance.

Where it breaks:

- **No idempotency.** This protects the counters, not the intent. A client that
  retries a timed-out request approves twice, because both requests genuinely
  mean "approve the next one". Needs an `Idempotency-Key`. Biggest gap.
- When the UPDATE matches nothing I re-read the row to decide 403 vs 409, and
  that read can be stale under load. Only affects which 4xx comes back.
- All writers to one escrow queue on one row lock. Fine for two parties.
- The logic is in SQL, so Go tests don't cover it and changing it needs a
  migration. That's the real cost.

## Fund transfer

The claim RPC increments `milestones_claimed` and inserts an
`escrow_transfers` row in the same transaction, then the transfer is attempted.
`UNIQUE (escrow_id, milestone_index)` is what makes a second payment for one
milestone impossible rather than merely unlikely.

That gives at-most-once payment, at-least-once attempt. A crash before the
commit means nothing happened; after it, there's a durable pending row for a
retry worker. The one bad case is the transfer succeeding but the status write
failing — that's logged at ERROR with everything needed to reconcile, and
reported as pending, never sent.

A failed transfer deliberately does not fail the claim. The increment is
already committed, so erroring would tell the contractor to retry something
already recorded. It returns 200 with `transfer.status: "pending"` instead.

I did not build the retry worker. The rows and the index for it exist, but
nothing sweeps them yet.

## Tradeoffs

**Supabase REST rather than pgx.** One credential and one access path shared
with the Next.js app, no pool tuning. The cost is a round trip per statement
and no client-side transactions — but moving the mutations into SQL functions
solves that for the operations that actually need it. With multi-statement
workflows I'd switch to pgx.

**Interfaces at the service and handler boundaries** so the business logic
tests without a database. The concurrency tests use a fake that's atomic the
way Postgres is, which is what lets them assert "20 concurrent approvals
against 3 milestones yields exactly 3".

**Observability**: JSON logs, request IDs taken from `X-Request-Id` or
generated, injected by a `slog.Handler` so no line can omit one, and echoed
back in error bodies.

With more time, in order: idempotency keys, the retry worker, integration tests
against a real Postgres (I checked the SQL by hand, which isn't a regression
test), and metrics. The service also trusts `caller_id` from the body because
the Next.js proxy sets it from the session — fine while it isn't
internet-facing, but it should verify the JWT itself.

## cancel_escrow

`POST /escrow/{id}/cancel`.

```
pending   → cancelled     always
active    → cancelled     allowed, unclaimed milestones released
completed → cancelled     409, everything is already paid
cancelled → cancelled     no-op
```

Only the client can cancel, and only while `milestones_claimed =
milestones_approved`. If they've approved work the contractor hasn't claimed,
cancelling would strand a payment they already agreed to — that has to be paid
out first, or handled as a dispute, which is a different feature.

```sql
UPDATE escrows SET status = 'cancelled', cancelled_at = NOW()
 WHERE id = p_escrow_id AND client_id = p_caller_id
   AND status IN ('pending', 'active')
   AND milestones_claimed = milestones_approved
RETURNING *;
```

Same shape as the others, so a cancel can't interleave with an in-flight claim.
Whichever gets the row lock first wins: a claim that lands first makes the
cancel fail its `claimed = approved` check, and one that lands second fails its
own `status = 'active'` check. Neither order pays out of a cancelled escrow.

Ordering is the mirror of the claim path. In one transaction, set the status
and insert the refund outbox row for the unclaimed remainder; commit, which
closes the escrow and stops any concurrent claim; then attempt the refund and
leave it for the worker if it fails. State first, money second — refunding
first and crashing before the commit would leave a live escrow whose funds are
gone.

Cancellation is terminal. Reopening would mean reconciling against whatever was
already refunded, and a new escrow is cheaper than getting that wrong.

## Known gaps

- Race detector wasn't run — no C toolchain on the machine I built this on. The
  concurrency tests assert final counts under `-count=30`, which catches lost
  updates but not a benign data race. Run `CGO_ENABLED=1 go test -race` where
  gcc is available.
- Graceful shutdown is `signal.NotifyContext` → `srv.Shutdown`, but I couldn't
  send a real SIGTERM on Windows to prove the drain end to end.
