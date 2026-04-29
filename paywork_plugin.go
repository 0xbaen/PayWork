// PayWork Plugin — Canopy Blockchain Freelance Escrow Protocol
// File: plugin/paywork_plugin.go
//
// This is the complete onchain plugin. It:
//   1. Defines 6 custom transaction types registered with the Canopy FSM
//   2. Implements ApplyTransaction() — the state machine Canopy calls per block tx
//   3. Implements HandleQuery()      — serves read requests via RPC port 50002
//   4. Binds all state to Canopy's native key-value store (no external DB)
//   5. Registers itself via init() so the Canopy node loads it at startup
//
// All CNPY transfers use Canopy's native Accounts module — no wrapped tokens.
//
// Verified data flow:
//   Frontend → RPC :50003 → ApplyTransaction() → Canopy state store
//   Frontend → RPC :50002 → HandleQuery()      → Canopy state store (read-only)

package paywork

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"

	canopy "github.com/canopy-network/canopy/lib"
)

// ─── Plugin Registration ──────────────────────────────────────────────────────
// init() is called when the Canopy node imports this package.
// To activate: add `_ "github.com/your-org/paywork/plugin"` to node's main.go

func init() {
	canopy.RegisterPlugin(&PayWorkPlugin{})
}

type PayWorkPlugin struct{}

func (p *PayWorkPlugin) Name() string    { return "paywork" }
func (p *PayWorkPlugin) Version() string { return "1.0.0" }

// ─── Transaction Types ────────────────────────────────────────────────────────

const (
	TxTypeCreateEscrow   = "paywork/create_escrow"
	TxTypeAcceptProject  = "paywork/accept_project"
	TxTypeReleasePayment = "paywork/release_payment"
	TxTypeRefund         = "paywork/refund"
	TxTypeRaiseDispute   = "paywork/raise_dispute"
	TxTypeResolveDispute = "paywork/resolve_dispute"
)

// ─── State Keys ───────────────────────────────────────────────────────────────
// All PayWork data lives in Canopy's native state tree under these prefixes.
// Nothing is stored outside the chain.

const (
	prefixEscrow = "paywork/escrow/"
	prefixIdx    = "paywork/idx/"
)

func escrowKey(id string) []byte   { return []byte(prefixEscrow + id) }
func idxKey(cat, val, id string) []byte {
	return []byte(fmt.Sprintf("%s%s/%s/%s", prefixIdx, cat, val, id))
}

// ─── Onchain Types ────────────────────────────────────────────────────────────

type EscrowStatus string

const (
	StatusOpen       EscrowStatus = "open"
	StatusAccepted   EscrowStatus = "accepted"
	StatusInProgress EscrowStatus = "in_progress"
	StatusDelivered  EscrowStatus = "delivered"
	StatusCompleted  EscrowStatus = "completed"
	StatusDisputed   EscrowStatus = "disputed"
	StatusRefunded   EscrowStatus = "refunded"
)

// EscrowRecord is the canonical onchain state of a single escrow.
// Serialised as JSON and stored in the Canopy state tree.
// Amounts in uCNPY: 1 CNPY = 1_000_000 uCNPY.
type EscrowRecord struct {
	EscrowID       string       `json:"escrow_id"`
	ClientAddr     string       `json:"client_addr"`
	FreelancerAddr string       `json:"freelancer_addr,omitempty"`
	Title          string       `json:"title"`
	Description    string       `json:"description"`
	AmountCNPY     uint64       `json:"amount_cnpy"`
	Status         EscrowStatus `json:"status"`
	CreatedAt      int64        `json:"created_at"`
	AcceptedAt     int64        `json:"accepted_at,omitempty"`
	CompletedAt    int64        `json:"completed_at,omitempty"`
	DeadlineBlock  int64        `json:"deadline_block"`
	Milestones     []Milestone  `json:"milestones,omitempty"`
}

type Milestone struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	AmountCNPY uint64 `json:"amount_cnpy"`
	Completed  bool   `json:"completed"`
}

// ─── TX Payload Types ─────────────────────────────────────────────────────────

type MsgCreateEscrow struct {
	Title         string      `json:"title"`
	Description   string      `json:"description"`
	AmountCNPY    uint64      `json:"amount_cnpy"`
	DeadlineBlock int64       `json:"deadline_block"`
	Milestones    []Milestone `json:"milestones,omitempty"`
}
type MsgAcceptProject  struct { EscrowID string `json:"escrow_id"` }
type MsgReleasePayment struct { EscrowID string `json:"escrow_id"`; Note string `json:"note,omitempty"` }
type MsgRefund         struct { EscrowID string `json:"escrow_id"`; Reason string `json:"reason,omitempty"` }
type MsgRaiseDispute   struct { EscrowID string `json:"escrow_id"`; Reason string `json:"reason"`; Evidence string `json:"evidence,omitempty"` }
type MsgResolveDispute struct {
	EscrowID          string `json:"escrow_id"`
	ClientPercent     uint8  `json:"client_percent"`
	FreelancerPercent uint8  `json:"freelancer_percent"`
	Resolution        string `json:"resolution"`
}

// ─── ApplyTransaction — State Machine ────────────────────────────────────────
// Called by Canopy for every PayWork transaction included in a block.
// Error = transaction rejected. No error = state change committed.

func (p *PayWorkPlugin) ApplyTransaction(ctx canopy.TxContext) error {
	switch ctx.TxType() {

	case TxTypeCreateEscrow:
		var msg MsgCreateEscrow
		if err := json.Unmarshal(ctx.Payload(), &msg); err != nil {
			return fmt.Errorf("paywork/create_escrow: bad payload: %w", err)
		}
		// Validation
		if msg.Title == "" || len(msg.Title) > 120 {
			return errors.New("paywork/create_escrow: title required, max 120 chars")
		}
		if msg.AmountCNPY == 0 {
			return errors.New("paywork/create_escrow: amount must be > 0")
		}
		if msg.DeadlineBlock <= ctx.BlockHeight() {
			return errors.New("paywork/create_escrow: deadline must be a future block")
		}
		if len(msg.Milestones) > 0 {
			var sum uint64
			for _, m := range msg.Milestones {
				sum += m.AmountCNPY
			}
			if sum != msg.AmountCNPY {
				return fmt.Errorf("paywork/create_escrow: milestone sum %d ≠ total %d", sum, msg.AmountCNPY)
			}
		}
		// Balance check
		bal, err := ctx.Accounts().GetBalance(ctx.Sender(), "CNPY")
		if err != nil {
			return fmt.Errorf("paywork/create_escrow: balance read failed: %w", err)
		}
		if bal < msg.AmountCNPY {
			return fmt.Errorf("paywork/create_escrow: insufficient CNPY (have %d, need %d)", bal, msg.AmountCNPY)
		}
		// Lock CNPY into module escrow account
		if err := ctx.Accounts().Transfer(ctx.Sender(), moduleAddr(), msg.AmountCNPY, "CNPY"); err != nil {
			return fmt.Errorf("paywork/create_escrow: CNPY lock failed: %w", err)
		}
		// Write record
		id := deriveID(ctx.Sender(), ctx.BlockHeight(), ctx.TxHash())
		return writeEscrow(ctx.Store(), &EscrowRecord{
			EscrowID:      id,
			ClientAddr:    ctx.Sender(),
			Title:         msg.Title,
			Description:   msg.Description,
			AmountCNPY:    msg.AmountCNPY,
			Status:        StatusOpen,
			CreatedAt:     ctx.BlockHeight(),
			DeadlineBlock: msg.DeadlineBlock,
			Milestones:    msg.Milestones,
		})

	case TxTypeAcceptProject:
		var msg MsgAcceptProject
		if err := json.Unmarshal(ctx.Payload(), &msg); err != nil {
			return fmt.Errorf("paywork/accept_project: bad payload: %w", err)
		}
		e, err := readEscrow(ctx.Store(), msg.EscrowID)
		if err != nil { return err }
		if e.Status != StatusOpen {
			return fmt.Errorf("paywork/accept_project: status is '%s', not 'open'", e.Status)
		}
		if e.ClientAddr == ctx.Sender() {
			return errors.New("paywork/accept_project: client cannot accept own escrow")
		}
		if ctx.BlockHeight() > e.DeadlineBlock {
			return errors.New("paywork/accept_project: deadline has passed")
		}
		e.FreelancerAddr = ctx.Sender()
		e.Status = StatusAccepted
		e.AcceptedAt = ctx.BlockHeight()
		return writeEscrow(ctx.Store(), e)

	case TxTypeReleasePayment:
		var msg MsgReleasePayment
		if err := json.Unmarshal(ctx.Payload(), &msg); err != nil {
			return fmt.Errorf("paywork/release_payment: bad payload: %w", err)
		}
		e, err := readEscrow(ctx.Store(), msg.EscrowID)
		if err != nil { return err }
		if e.ClientAddr != ctx.Sender() {
			return errors.New("paywork/release_payment: only client can release")
		}
		if e.Status != StatusAccepted && e.Status != StatusInProgress && e.Status != StatusDelivered {
			return fmt.Errorf("paywork/release_payment: invalid status '%s'", e.Status)
		}
		if e.FreelancerAddr == "" {
			return errors.New("paywork/release_payment: no freelancer assigned")
		}
		// Transfer CNPY from escrow module to freelancer
		if err := ctx.Accounts().Transfer(moduleAddr(), e.FreelancerAddr, e.AmountCNPY, "CNPY"); err != nil {
			return fmt.Errorf("paywork/release_payment: transfer failed: %w", err)
		}
		e.Status = StatusCompleted
		e.CompletedAt = ctx.BlockHeight()
		return writeEscrow(ctx.Store(), e)

	case TxTypeRefund:
		var msg MsgRefund
		if err := json.Unmarshal(ctx.Payload(), &msg); err != nil {
			return fmt.Errorf("paywork/refund: bad payload: %w", err)
		}
		e, err := readEscrow(ctx.Store(), msg.EscrowID)
		if err != nil { return err }
		if e.ClientAddr != ctx.Sender() {
			return errors.New("paywork/refund: only client can refund")
		}
		deadlinePassed := ctx.BlockHeight() > e.DeadlineBlock
		if e.Status != StatusOpen && !deadlinePassed {
			return fmt.Errorf("paywork/refund: status '%s' and deadline not passed", e.Status)
		}
		if err := ctx.Accounts().Transfer(moduleAddr(), e.ClientAddr, e.AmountCNPY, "CNPY"); err != nil {
			return fmt.Errorf("paywork/refund: transfer failed: %w", err)
		}
		e.Status = StatusRefunded
		e.CompletedAt = ctx.BlockHeight()
		return writeEscrow(ctx.Store(), e)

	case TxTypeRaiseDispute:
		var msg MsgRaiseDispute
		if err := json.Unmarshal(ctx.Payload(), &msg); err != nil {
			return fmt.Errorf("paywork/raise_dispute: bad payload: %w", err)
		}
		e, err := readEscrow(ctx.Store(), msg.EscrowID)
		if err != nil { return err }
		if ctx.Sender() != e.ClientAddr && ctx.Sender() != e.FreelancerAddr {
			return errors.New("paywork/raise_dispute: not an escrow party")
		}
		if e.Status == StatusCompleted || e.Status == StatusRefunded {
			return errors.New("paywork/raise_dispute: escrow is already finalised")
		}
		e.Status = StatusDisputed
		return writeEscrow(ctx.Store(), e)

	case TxTypeResolveDispute:
		var msg MsgResolveDispute
		if err := json.Unmarshal(ctx.Payload(), &msg); err != nil {
			return fmt.Errorf("paywork/resolve_dispute: bad payload: %w", err)
		}
		if int(msg.ClientPercent)+int(msg.FreelancerPercent) != 100 {
			return errors.New("paywork/resolve_dispute: percentages must sum to 100")
		}
		if !ctx.Governance().IsArbiter(ctx.Sender()) {
			return errors.New("paywork/resolve_dispute: sender is not an authorised arbiter")
		}
		e, err := readEscrow(ctx.Store(), msg.EscrowID)
		if err != nil { return err }
		if e.Status != StatusDisputed {
			return fmt.Errorf("paywork/resolve_dispute: status is '%s', not 'disputed'", e.Status)
		}
		clientShare := e.AmountCNPY * uint64(msg.ClientPercent) / 100
		freelancerShare := e.AmountCNPY - clientShare
		if clientShare > 0 {
			if err := ctx.Accounts().Transfer(moduleAddr(), e.ClientAddr, clientShare, "CNPY"); err != nil {
				return fmt.Errorf("paywork/resolve_dispute: client transfer failed: %w", err)
			}
		}
		if freelancerShare > 0 {
			if err := ctx.Accounts().Transfer(moduleAddr(), e.FreelancerAddr, freelancerShare, "CNPY"); err != nil {
				return fmt.Errorf("paywork/resolve_dispute: freelancer transfer failed: %w", err)
			}
		}
		e.Status = StatusCompleted
		e.CompletedAt = ctx.BlockHeight()
		return writeEscrow(ctx.Store(), e)
	}

	return fmt.Errorf("paywork: unrecognised transaction type '%s'", ctx.TxType())
}

// ─── HandleQuery ──────────────────────────────────────────────────────────────
// Serves read-only queries from the frontend via RPC port 50002.

func (p *PayWorkPlugin) HandleQuery(ctx canopy.QueryContext) ([]byte, error) {
	switch ctx.Method() {

	case "paywork_getEscrow":
		var q struct{ EscrowID string `json:"escrow_id"` }
		if err := json.Unmarshal(ctx.Params(), &q); err != nil { return nil, err }
		e, err := readEscrow(ctx.Store(), q.EscrowID)
		if err != nil { return nil, err }
		return json.Marshal(e)

	case "paywork_listEscrows":
		var q struct {
			Status         string `json:"status,omitempty"`
			ClientAddr     string `json:"client_addr,omitempty"`
			FreelancerAddr string `json:"freelancer_addr,omitempty"`
			Limit          int    `json:"limit,omitempty"`
			Offset         int    `json:"offset,omitempty"`
		}
		if err := json.Unmarshal(ctx.Params(), &q); err != nil { return nil, err }
		if q.Limit == 0 { q.Limit = 20 }
		records, total, err := scanEscrows(ctx.Store(), q.Status, q.ClientAddr, q.FreelancerAddr, q.Limit, q.Offset)
		if err != nil { return nil, err }
		return json.Marshal(map[string]any{"escrows": records, "total": total})

	case "paywork_getStats":
		stats, err := computeStats(ctx.Store())
		if err != nil { return nil, err }
		return json.Marshal(stats)
	}

	return nil, fmt.Errorf("paywork: unknown query '%s'", ctx.Method())
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

func writeEscrow(store canopy.Store, e *EscrowRecord) error {
	data, err := json.Marshal(e)
	if err != nil { return err }
	if err := store.Set(escrowKey(e.EscrowID), data); err != nil { return err }
	// Secondary indexes
	store.Set(idxKey("status", string(e.Status), e.EscrowID), []byte("1"))
	if e.ClientAddr != ""     { store.Set(idxKey("client",     e.ClientAddr,     e.EscrowID), []byte("1")) }
	if e.FreelancerAddr != "" { store.Set(idxKey("freelancer", e.FreelancerAddr, e.EscrowID), []byte("1")) }
	return nil
}

func readEscrow(store canopy.Store, id string) (*EscrowRecord, error) {
	data, err := store.Get(escrowKey(id))
	if err != nil { return nil, fmt.Errorf("paywork: escrow '%s' not found", id) }
	var e EscrowRecord
	return &e, json.Unmarshal(data, &e)
}

func scanEscrows(store canopy.Store, status, clientAddr, freelancerAddr string, limit, offset int) ([]*EscrowRecord, int, error) {
	prefix := prefixEscrow
	if status != ""        { prefix = prefixIdx + "status/"     + status        + "/" }
	if clientAddr != ""    { prefix = prefixIdx + "client/"     + clientAddr    + "/" }
	if freelancerAddr != "" { prefix = prefixIdx + "freelancer/" + freelancerAddr + "/" }

	keys, err := store.List([]byte(prefix))
	if err != nil { return nil, 0, err }

	total := len(keys)
	if offset < total { keys = keys[offset:] } else { return []*EscrowRecord{}, total, nil }
	if len(keys) > limit { keys = keys[:limit] }

	out := make([]*EscrowRecord, 0, len(keys))
	for _, k := range keys {
		s := string(k)
		id := s[lastSlash(s)+1:]
		if prefix == prefixEscrow { id = s[len(prefixEscrow):] }
		e, err := readEscrow(store, id)
		if err != nil { continue }
		out = append(out, e)
	}
	return out, total, nil
}

type Stats struct {
	Total         int    `json:"total"`
	Open          int    `json:"open"`
	Active        int    `json:"active"`
	Completed     int    `json:"completed"`
	Disputed      int    `json:"disputed"`
	TotalLockedCNPY uint64 `json:"total_locked_cnpy"`
	TotalPaidCNPY   uint64 `json:"total_paid_cnpy"`
}

func computeStats(store canopy.Store) (*Stats, error) {
	keys, err := store.List([]byte(prefixEscrow))
	if err != nil { return nil, err }
	s := &Stats{}
	for _, k := range keys {
		id := string(k)[len(prefixEscrow):]
		e, err := readEscrow(store, id)
		if err != nil { continue }
		s.Total++
		switch e.Status {
		case StatusOpen:                                    s.Open++;      s.TotalLockedCNPY += e.AmountCNPY
		case StatusAccepted, StatusInProgress, StatusDelivered: s.Active++; s.TotalLockedCNPY += e.AmountCNPY
		case StatusCompleted:                               s.Completed++; s.TotalPaidCNPY   += e.AmountCNPY
		case StatusDisputed:                                s.Disputed++;  s.TotalLockedCNPY += e.AmountCNPY
		}
	}
	return s, nil
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// deriveID produces a deterministic escrow ID from (sender, blockHeight, txHash).
func deriveID(sender string, height int64, txHash []byte) string {
	h := sha256.New()
	h.Write([]byte(sender))
	h.Write([]byte(fmt.Sprintf("%d", height)))
	h.Write(txHash)
	return fmt.Sprintf("ESC-%x", h.Sum(nil)[:8])
}

// moduleAddr returns the deterministic module account that holds locked CNPY.
func moduleAddr() string { return canopy.ModuleAddress("paywork/escrow") }

func lastSlash(s string) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '/' { return i }
	}
	return -1
}
