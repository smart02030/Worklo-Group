# Worklo — Senior Backend Assignment (Next.js + Go)

Worklo is a PSA (Professional Services Automation) platform for managing projects, tasks, time tracking, and client relationships. In this exercise you'll extend Worklo with a Go microservice that handles milestone escrow — locking client funds and releasing them per approved milestone — integrated into the existing Next.js project.

We evaluate the quality of your decisions, not the line count.

If you have any questions, feel free to reach out.
    
## Time Consideration   

Scoped for 2–3 hours. If you hit that limit, submit what you have and note what you'd finish next in your README.            
   
**Focus:** Part 1 (Go escrow service) is the core evaluation. Part 2 (Next.js wiring) has stubs already in the repo — complete them after the service works.     

## Getting Started     

You'll need **Node.js 20.9+**, **Go 1.22+**, and a free [Supabase](https://supabase.com) project.

```bash
# 1. Fork this repo and clone your fork
npm install

# 2. Set up environment variables
cp .env.local.template .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
# and SUPABASE_SERVICE_ROLE_KEY from Supabase → Settings → API

# 3. Run the database schema
# → Supabase dashboard → SQL Editor → run these in order:
#    a) supabase/schema.sql          (includes escrows table)
#    b) supabase/seed-roles.sql      (fixed role UUIDs for demo users)
# If you already ran an older schema.sql without escrows:
#    c) supabase/escrows.sql

# 4. Create demo login users (password for all: Test1234!)
npm run seed:users

# 5. Start the Next.js app
npm run dev              # http://localhost:3000
# Sign in via role buttons on /login (e.g. Senior Designer)

# 6. Run the escrow service
cd escrow-service
go mod download
go run ./cmd/server   # http://localhost:4001
```

### Demo users

| Email | Role | Password |
|---|---|---|
| `superadmin@test.local` | Superadmin | `Test1234!` |
| `exec@test.local` | Executive Director | `Test1234!` |
| `manager@test.local` | Account Manager | `Test1234!` |
| `pm@test.local` | Project Manager | `Test1234!` |
| `admin@test.local` | Admin | `Test1234!` |
| `designer@test.local` | Senior Designer | `Test1234!` |
| `dev@test.local` | Senior Developer | `Test1234!` |
| `contributor@test.local` | Contributor | `Test1234!` |
| `client@test.local` | Client | `Test1234!` |

## Task Overview

### Part 1 — Go escrow service (`escrow-service/`) — primary focus

Build a REST microservice for milestone escrow backed by Supabase (Postgres). The `escrows` table is defined in `supabase/schema.sql` (and `supabase/escrows.sql` for incremental apply).

**Data model** — `Escrow`:

| Field | Type |
|---|---|
| `id` | `uuid` |
| `project_id` | `uuid` |
| `client_id` | `uuid` |
| `contractor_id` | `uuid` |
| `total_milestones` | `int` |
| `milestones_approved` | `int` |
| `milestones_claimed` | `int` |
| `amount_per_milestone` | `int64` (cents) |
| `status` | `pending` \| `active` \| `completed` \| `cancelled` |
| `created_at` | `timestamp` |

**Endpoints:**

- `POST /escrow` — create escrow
- `POST /escrow/:id/approve-milestone` — client approves next milestone
- `POST /escrow/:id/claim-milestone` — contractor claims next approved milestone
- `GET /escrow/:id` — return escrow state or `404`

**Constraints:**

- Concurrent `approve` or `claim` requests must not corrupt milestone counts — choose and defend a concurrency strategy, and describe its failure modes
- The fund-transfer side effect can fail independently of the DB commit — design for that and explain your guarantees
- The service must be observable in production — requests must be traceable and errors must be diagnosable from logs alone
- The service must shut down without dropping in-flight requests
- The service layer must be testable without a running database
- All failure modes must return structured, descriptive errors with appropriate HTTP status codes

You may persist via Supabase REST, a Postgres RPC, or direct SQL (e.g. pgx) against the same database — defend the tradeoff.

### Part 2 — Next.js integration — stubs provided

Complete the existing stubs (do not rebuild the app from scratch):

- **`app/api/projects/[projectId]/escrow/route.js`** — `GET` and `POST` routes proxying to the Go service; requires existing auth guard
- **`components/project-escrow.tsx`** — displays escrow state; "Create Escrow" form; "Approve Milestone" (client only); "Claim Milestone" (contractor only); re-fetches after each action

## How We Evaluate

- Your concurrency strategy and whether you can defend it — what does it guarantee, where does it break, and why did you choose it?
- How you handle the fund-transfer failure case and what guarantees you provide
- Whether the service is genuinely observable in production
- How you structure the codebase and why
- The quality and coverage of your tests
- The tradeoffs you made and whether you can articulate them

## Submission Guidelines

Don't open a PR to this repo. Share your fork URL.

Include an `escrow-service/README.md` with:
- Build and run instructions
- The tradeoffs you made and what you'd do differently with more time
- How you'd design `cancel_escrow` — state transitions, ordering, and why
