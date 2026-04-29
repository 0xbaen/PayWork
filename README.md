# PayWork — Onchain Freelance Escrow Protocol

> Built on Canopy. Powered by CNPY. Every action is a real blockchain transaction.

---

## What This Is

PayWork is a **real onchain escrow protocol** built for the Canopy blockchain challenge.

It is **not** a freelance website with fake demo data.  
It is **not** a UI pretending to move tokens.  
It is a **Canopy plugin** that defines custom transaction types, enforces escrow logic in the chain's own state machine, and moves real **CNPY** between real addresses — verified by any node on the network.

```
Frontend  →  RPC :50003  →  Canopy State Machine  →  Onchain state change
Frontend  →  RPC :50002  →  Canopy State Tree      →  Real onchain data
```

---

## Project Structure

```
paywork/
├── plugin/
│   ├── paywork_plugin.go   ← Canopy FSM plugin (Go) — the onchain logic
│   └── go.mod
├── rpc/
│   └── canopy-rpc.js       ← RPC client — ports 50002 & 50003
├── frontend/
│   ├── src/App.jsx         ← React UI — all actions call real RPC
│   ├── public/styles.css
│   ├── main.jsx
│   ├── vite.config.js
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml      ← One command to start everything
├── setup.sh                ← Local setup without Docker
└── README.md
```

---

## Custom Transaction Types

These are registered with the Canopy plugin system via `init()`.  
Every PayWork action is a **real onchain transaction** — not a database write.

| Type | Signer | Onchain Effect |
|---|---|---|
| `paywork/create_escrow` | Client | Deducts `amount_cnpy` from client, locks in module escrow account, writes `EscrowRecord` to state tree |
| `paywork/accept_project` | Freelancer | Sets `freelancer_addr`, changes status → `accepted` |
| `paywork/release_payment` | Client | Transfers CNPY from escrow module → freelancer address, status → `completed` |
| `paywork/refund` | Client | Returns CNPY from escrow module → client address, status → `refunded` |
| `paywork/raise_dispute` | Either party | Freezes escrow, status → `disputed` |
| `paywork/resolve_dispute` | Authorised arbiter | Splits CNPY by percentage, status → `completed` |

---

## Onchain State

Every escrow is an `EscrowRecord` stored in Canopy's native state tree:

```
Key:   paywork/escrow/{escrow_id}
Value: JSON-serialised EscrowRecord
```

```go
type EscrowRecord struct {
    EscrowID       string       // ESC-{sha256 of sender+block+txhash}
    ClientAddr     string       // Client's Canopy address
    FreelancerAddr string       // Set when accepted
    Title          string       // Job title
    Description    string       // Job description
    AmountCNPY     uint64       // In uCNPY (1 CNPY = 1_000_000 uCNPY)
    Status         EscrowStatus // open → accepted → completed / refunded
    CreatedAt      int64        // Block height at creation
    DeadlineBlock  int64        // Auto-refund allowed after this block
    Milestones     []Milestone  // Optional breakdown (amounts must sum to total)
}
```

Secondary indexes stored for efficient querying:
```
paywork/idx/status/{status}/{escrow_id}
paywork/idx/client/{address}/{escrow_id}
paywork/idx/freelancer/{address}/{escrow_id}
```

---

## State Machine Rules

Invalid transactions are **rejected by the chain**. These rules are enforced in `ApplyTransaction()`:

| Rule | Enforced in |
|---|---|
| Amount must be > 0 | `create_escrow` |
| Milestone amounts must sum to total | `create_escrow` |
| Client must have sufficient CNPY balance | `create_escrow` (via `ctx.Accounts().GetBalance`) |
| Deadline must be a future block | `create_escrow` |
| Status must be `open` to accept | `accept_project` |
| Client cannot accept their own escrow | `accept_project` |
| Only client can release payment | `release_payment` |
| Freelancer must be assigned | `release_payment` |
| Refund only if `open` OR deadline passed | `refund` |
| Only parties can raise dispute | `raise_dispute` |
| Cannot dispute a finalized escrow | `raise_dispute` |
| Percentages must sum to 100 | `resolve_dispute` |
| Sender must be authorised arbiter | `resolve_dispute` (via `ctx.Governance().IsArbiter`) |

---

## CNPY Token

CNPY is Canopy's native token. All escrow amounts are stored in **uCNPY**:

```
1 CNPY = 1,000,000 uCNPY
```

When a client calls `create_escrow`, the chain's account module executes:
```
client_wallet.balance -= amount_cnpy
module_escrow_account.balance += amount_cnpy
```

When `release_payment` is called:
```
module_escrow_account.balance -= amount_cnpy
freelancer_wallet.balance     += amount_cnpy
```

No wrapped tokens. No custom contracts. Native CNPY, native ledger.

---

## Running Locally

### Option A — Docker (recommended)

```bash
git clone https://github.com/your-org/paywork
cd paywork
docker compose up
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Query RPC | http://localhost:50002 |
| TX RPC | http://localhost:50003 |
| Explorer | http://localhost:9000 |

### Option B — Manual

```bash
chmod +x setup.sh
./setup.sh
```

Requires: Canopy binary, Go 1.21+, Node.js 18+

### Option C — Step by step

```bash
# 1. Init Canopy node
canopy init paywork-local --chain-id paywork-local-1

# 2. Copy plugin to node's plugin directory
cp -r plugin/ ~/.canopy/plugins/paywork/

# 3. Add plugin import to node's main.go
# import _ "github.com/your-org/paywork/plugin"

# 4. Rebuild + start Canopy node in dev mode
canopy start --dev-mode --rpc.query-port 50002 --rpc.tx-port 50003

# 5. Start frontend
cd frontend && npm install && npm run dev
```

---

## Activating the Plugin in Your Canopy Node

Add one import line to your Canopy node's `main.go`:

```go
import (
    // ... existing imports ...
    _ "github.com/your-org/paywork/plugin"  // registers PayWork with the FSM
)
```

The plugin's `init()` function calls `canopy.RegisterPlugin(&PayWorkPlugin{})`, which wires `ApplyTransaction()` and `HandleQuery()` into the Canopy node's routing layer. From that point, any transaction with a `paywork/*` type is processed by PayWork's state machine.

---

## RPC Usage Examples

### Query (port 50002)

```javascript
// Get a single escrow record
await query("paywork_getEscrow", { escrow_id: "ESC-a1b2c3d4" })

// List open jobs
await query("paywork_listEscrows", { status: "open", limit: 20 })

// My escrows as client
await query("paywork_listEscrows", { client_addr: "cnpy1..." })

// Protocol stats
await query("paywork_getStats", {})
```

### Transactions (port 50003)

```javascript
// Lock CNPY and post a job
await submitTx("paywork/create_escrow", {
    title:         "Build DEX frontend",
    description:   "React-based trading interface",
    amount_cnpy:   1500000,     // 1.5 CNPY
    deadline_block: 1260000,
}, clientAddr)

// Freelancer accepts
await submitTx("paywork/accept_project", { escrow_id: "ESC-a1b2c3d4" }, freelancerAddr)

// Client releases payment
await submitTx("paywork/release_payment", { escrow_id: "ESC-a1b2c3d4", note: "Great work" }, clientAddr)
```

---

## Escrow Lifecycle

```
[Client] paywork/create_escrow
    ↓  CNPY locked in module escrow account
    ↓  EscrowRecord written to chain state
    Status: OPEN
    ↓
[Freelancer] paywork/accept_project
    ↓  freelancer_addr set onchain
    Status: ACCEPTED → IN_PROGRESS
    ↓
    (work happens)
    ↓
[Client] paywork/release_payment ───→ Status: COMPLETED → CNPY → Freelancer
    OR
[Client] paywork/refund          ───→ Status: REFUNDED  → CNPY → Client
    OR
[Either] paywork/raise_dispute   ───→ Status: DISPUTED  → funds frozen
              ↓
[Arbiter] paywork/resolve_dispute ──→ CNPY split by percentage
```

---

## Why This Qualifies

| Requirement | PayWork |
|---|---|
| Uses Canopy RPC ports 50002 & 50003 | ✅ All queries on 50002, all txs on 50003 |
| Real blockchain transactions | ✅ Every action goes through `ApplyTransaction()` |
| Custom transaction types | ✅ 6 types registered via `init()` + `RegisterPlugin()` |
| Real onchain state | ✅ EscrowRecord stored in Canopy state tree |
| Real CNPY transfers | ✅ Uses `ctx.Accounts().Transfer()` — native CNPY ledger |
| Not a fake frontend | ✅ Rejected transactions return actual chain errors |

---

*PayWork — because escrow agreements should be enforced by code, not trust.*
