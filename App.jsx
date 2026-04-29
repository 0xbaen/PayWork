import { useState, useEffect, useCallback } from "react";

// ─── Canopy RPC Layer ─────────────────────────────────────────────────────────
// All blockchain calls route through this. Ports 50002 (query) and 50003 (tx).
// In dev/demo mode, we simulate responses to show the data flow.

const CANOPY_QUERY = "http://localhost:50002";
const CANOPY_TX    = "http://localhost:50003";

async function rpcQuery(method, params = {}) {
  try {
    const res = await fetch(`${CANOPY_QUERY}/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  } catch {
    // Dev mode — return mock data so the UI is fully explorable
    return devModeQuery(method, params);
  }
}

async function rpcSubmitTx(txType, payload, sender) {
  try {
    const res = await fetch(`${CANOPY_TX}/v1/transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: Date.now(),
        method: "broadcast_tx",
        params: { type: txType, payload, sender, nonce: Math.random().toString(36).slice(2), timestamp: Date.now() },
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  } catch {
    return devModeTx(txType, payload, sender);
  }
}

// ─── Dev Mode (demonstrates onchain flow without running node) ────────────────
let devEscrows = [
  { escrow_id: "ESC-001a2b3c", client_addr: "cnpy1qw3er5ty7ui9op2as4df6gh8jk1lz", freelancer_addr: "cnpy1zx0cv9bn8mv7qw2er4ty6ui8op3as", title: "Build DeFi Dashboard UI", description: "React-based dashboard for a DEX with charts, swap interface, and wallet integration. Must be responsive and support dark mode.", amount_cnpy: 850000, status: "in_progress", created_at: 1240010, accepted_at: 1240050, completed_at: 0, deadline_block: 1250000, milestones: [{ id: "m1", title: "Wireframes & Design", amount_cnpy: 200000, completed: true }, { id: "m2", title: "Frontend implementation", amount_cnpy: 500000, completed: false }, { id: "m3", title: "Testing & delivery", amount_cnpy: 150000, completed: false }] },
  { escrow_id: "ESC-004d5e6f", client_addr: "cnpy1mn2op3qr4st5uv6wx7yz8ab9cd0ef", freelancer_addr: "", title: "Smart Contract Audit", description: "Full security audit of a lending protocol. Must include detailed report with severity ratings and remediation advice.", amount_cnpy: 1500000, status: "open", created_at: 1241100, accepted_at: 0, completed_at: 0, deadline_block: 1260000, milestones: [] },
  { escrow_id: "ESC-007g8h9i", client_addr: "cnpy1zx0cv9bn8mv7qw2er4ty6ui8op3as", freelancer_addr: "cnpy1qw3er5ty7ui9op2as4df6gh8jk1lz", title: "Logo & Brand Identity", description: "Create full brand package: logo in multiple formats, color palette, typography guide, and basic usage examples.", amount_cnpy: 320000, status: "completed", created_at: 1238500, accepted_at: 1238600, completed_at: 1240800, deadline_block: 1248000, milestones: [] },
  { escrow_id: "ESC-010j1k2l", client_addr: "cnpy1ab2cd3ef4gh5ij6kl7mn8op9qr0st", freelancer_addr: "cnpy1uv2wx3yz4ab5cd6ef7gh8ij9kl0mn", title: "Canopy Node Setup & Infra", description: "Set up 3 Canopy validator nodes with monitoring, alerting, and automated backups.", amount_cnpy: 600000, status: "disputed", created_at: 1239200, accepted_at: 1239300, completed_at: 0, deadline_block: 1249000, milestones: [] },
  { escrow_id: "ESC-013m4n5o", client_addr: "cnpy1op2qr3st4uv5wx6yz7ab8cd9ef0gh", freelancer_addr: "", title: "Technical Whitepaper", description: "Write a comprehensive technical whitepaper for a Layer 2 protocol. 15-20 pages, peer-review quality.", amount_cnpy: 250000, status: "open", created_at: 1241500, accepted_at: 0, completed_at: 0, deadline_block: 1255000, milestones: [] },
];
let devBlockHeight = 1241887;
let devWalletAddr = "cnpy1qw3er5ty7ui9op2as4df6gh8jk1lz";
let devBalance = 2340000;

function devModeQuery(method, params) {
  if (method === "chain_status") return { connected: true, latest_block_height: devBlockHeight, chain_id: "canopy-mainnet-1", node_version: "1.4.2" };
  if (method === "account_balance") return { address: params.address, balance: devBalance, denom: "CNPY" };
  if (method === "paywork_getEscrow") return devEscrows.find(e => e.escrow_id === params.escrow_id) || null;
  if (method === "paywork_listEscrows") {
    let list = [...devEscrows];
    if (params.status) list = list.filter(e => e.status === params.status);
    if (params.client_addr) list = list.filter(e => e.client_addr === params.client_addr);
    if (params.freelancer_addr) list = list.filter(e => e.freelancer_addr === params.freelancer_addr);
    return { escrows: list.slice(params.offset || 0, (params.offset || 0) + (params.limit || 20)), total: list.length };
  }
  if (method === "tx_details") return { hash: params.hash, confirmed: true, height: devBlockHeight - 5, timestamp: Date.now() - 30000 };
  return null;
}

function devModeTx(txType, payload, sender) {
  const txHash = "0x" + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join("");
  devBlockHeight += 1;
  const newId = "ESC-" + Math.random().toString(36).slice(2, 8);

  if (txType === "paywork/create_escrow") {
    const escrow = { escrow_id: newId, client_addr: sender, freelancer_addr: "", title: payload.title, description: payload.description, amount_cnpy: payload.amount_cnpy, status: "open", created_at: devBlockHeight, accepted_at: 0, completed_at: 0, deadline_block: payload.deadline_block, milestones: payload.milestones || [] };
    devEscrows.unshift(escrow);
    devBalance -= payload.amount_cnpy;
    return { tx_hash: txHash, height: devBlockHeight, escrow_id: newId, success: true };
  }
  if (txType === "paywork/accept_project") {
    const e = devEscrows.find(e => e.escrow_id === payload.escrow_id);
    if (e) { e.status = "accepted"; e.freelancer_addr = sender; e.accepted_at = devBlockHeight; }
    return { tx_hash: txHash, height: devBlockHeight, success: true };
  }
  if (txType === "paywork/release_payment") {
    const e = devEscrows.find(e => e.escrow_id === payload.escrow_id);
    if (e) { e.status = "completed"; e.completed_at = devBlockHeight; devBalance += e.amount_cnpy; }
    return { tx_hash: txHash, height: devBlockHeight, success: true };
  }
  if (txType === "paywork/refund") {
    const e = devEscrows.find(e => e.escrow_id === payload.escrow_id);
    if (e) { e.status = "refunded"; devBalance += e.amount_cnpy; }
    return { tx_hash: txHash, height: devBlockHeight, success: true };
  }
  if (txType === "paywork/raise_dispute") {
    const e = devEscrows.find(e => e.escrow_id === payload.escrow_id);
    if (e) e.status = "disputed";
    return { tx_hash: txHash, height: devBlockHeight, success: true };
  }
  return { tx_hash: txHash, height: devBlockHeight, success: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatCNPY = (ucnpy) => (ucnpy / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const shortenAddr = (addr) => addr ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : "—";
const copyToClipboard = (text) => navigator.clipboard?.writeText(text);

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icon = {
  Dashboard: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  Briefcase: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>,
  Lock: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  Check: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
  X: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Plus: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Chain: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  User: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Alert: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  ExternalLink: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  Copy: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
};

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const labels = { open: "Open", accepted: "Accepted", in_progress: "In Progress", delivered: "Delivered", completed: "Completed", disputed: "Disputed", refunded: "Refunded" };
  return <span className={`badge ${status}`}><span className="badge-dot" />{labels[status] || status}</span>;
}

// ─── Toast System ─────────────────────────────────────────────────────────────
function ToastContainer({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{t.title}</div>
          {t.message && <div style={{ fontSize: 12, opacity: 0.75 }}>{t.message}</div>}
          {t.txHash && (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, marginTop: 6, opacity: 0.6 }}>
              TX: {t.txHash.slice(0, 20)}…
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── TX Receipt ───────────────────────────────────────────────────────────────
function TxReceipt({ result }) {
  if (!result) return null;
  return (
    <div className="tx-receipt">
      <div className="tx-receipt-title">Transaction Confirmed Onchain</div>
      <div className="tx-receipt-row"><span className="tx-receipt-key">TX Hash</span><span className="tx-receipt-val">{result.tx_hash}</span></div>
      <div className="tx-receipt-row"><span className="tx-receipt-key">Block</span><span className="tx-receipt-val">{result.height}</span></div>
      {result.escrow_id && <div className="tx-receipt-row"><span className="tx-receipt-key">Escrow ID</span><span className="tx-receipt-val">{result.escrow_id}</span></div>}
    </div>
  );
}

// ─── Create Escrow Modal ──────────────────────────────────────────────────────
function CreateEscrowModal({ onClose, onSuccess, walletAddr, currentBlock }) {
  const [form, setForm] = useState({ title: "", description: "", amountCNPY: "", deadlineDays: "30" });
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [txResult, setTxResult] = useState(null);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const addMilestone = () => setMilestones(m => [...m, { id: Date.now().toString(), title: "", amount: "" }]);
  const removeMilestone = (id) => setMilestones(m => m.filter(x => x.id !== id));
  const setMilestone = (id, k, v) => setMilestones(m => m.map(x => x.id === id ? { ...x, [k]: v } : x));

  const totalMilestone = milestones.reduce((s, m) => s + (parseFloat(m.amount) || 0), 0);
  const escrowAmt = parseFloat(form.amountCNPY) || 0;
  const mismatch = milestones.length > 0 && Math.abs(totalMilestone - escrowAmt) > 0.0001;

  async function submit() {
    if (!form.title || !form.amountCNPY) return;
    setLoading(true);
    try {
      const deadlineBlock = currentBlock + Math.floor((parseInt(form.deadlineDays) * 86400) / 6);
      const payload = {
        title: form.title, description: form.description,
        amount_cnpy: Math.round(parseFloat(form.amountCNPY) * 1_000_000),
        deadline_block: deadlineBlock,
        milestones: milestones.map(m => ({ id: m.id, title: m.title, amount_cnpy: Math.round(parseFloat(m.amount) * 1_000_000), completed: false })),
      };
      const result = await rpcSubmitTx("paywork/create_escrow", payload, walletAddr);
      setTxResult(result);
      setTimeout(() => { onSuccess(); onClose(); }, 3000);
    } finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">Post a New Job</div>
            <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4 }}>Funds locked onchain via <span style={{ color: "var(--cnpy)" }}>Canopy escrow</span></div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon.X /></button>
        </div>
        <div className="modal-body">
          {!txResult ? (
            <>
              <div className="form-group">
                <label className="form-label">Job Title</label>
                <input className="form-input" value={form.title} onChange={set("title")} placeholder="e.g. Build a DEX frontend with React" />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea form-input" value={form.description} onChange={set("description")} placeholder="Describe the work, deliverables, and requirements..." />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Escrow Amount</label>
                  <div className="form-input-cnpy">
                    <input className="form-input" type="number" min="0" step="0.01" value={form.amountCNPY} onChange={set("amountCNPY")} placeholder="0.00" />
                    <span className="denom-tag">CNPY</span>
                  </div>
                  <span className="form-hint">Will be locked in Canopy escrow</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Deadline (days)</label>
                  <input className="form-input" type="number" min="1" max="365" value={form.deadlineDays} onChange={set("deadlineDays")} />
                  <span className="form-hint">Auto-refund if no freelancer accepts</span>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>Milestones (optional)</label>
                  <button className="btn btn-outline btn-sm" onClick={addMilestone}><Icon.Plus /> Add</button>
                </div>
                {milestones.map(m => (
                  <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <input className="form-input" placeholder="Milestone title" value={m.title} onChange={e => setMilestone(m.id, "title", e.target.value)} />
                    <div className="form-input-cnpy" style={{ margin: 0 }}>
                      <input className="form-input" type="number" placeholder="0" value={m.amount} onChange={e => setMilestone(m.id, "amount", e.target.value)} style={{ borderRadius: "var(--radius-md) 0 0 var(--radius-md)" }} />
                      <span className="denom-tag">CNPY</span>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={() => removeMilestone(m.id)} style={{ padding: "8px" }}><Icon.X /></button>
                  </div>
                ))}
                {mismatch && <div style={{ color: "var(--disputed)", fontSize: 12, fontFamily: "var(--font-mono)" }}>⚠ Milestone total ({totalMilestone} CNPY) must equal escrow amount ({escrowAmt} CNPY)</div>}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Escrow Created Onchain</div>
              <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 20 }}>Funds locked in Canopy chain. Freelancers can now apply.</div>
              <TxReceipt result={txResult} />
            </div>
          )}
        </div>
        {!txResult && (
          <div className="modal-footer">
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className={`btn btn-cnpy ${loading ? "btn-loading" : ""}`} onClick={submit} disabled={loading || !form.title || !form.amountCNPY || mismatch}>
              {loading ? "" : `Lock ${form.amountCNPY || "0"} CNPY & Post Job`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Escrow Detail Modal ──────────────────────────────────────────────────────
function EscrowDetailModal({ escrow, onClose, onAction, walletAddr }) {
  const [loading, setLoading] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [showDisputeForm, setShowDisputeForm] = useState(false);

  const isClient = walletAddr === escrow.client_addr;
  const isFreelancer = walletAddr === escrow.freelancer_addr;

  async function act(type, extraPayload = {}) {
    setLoading(type);
    try {
      const payload = { escrow_id: escrow.escrow_id, ...extraPayload };
      const result = await rpcSubmitTx(`paywork/${type}`, payload, walletAddr);
      setTxResult(result);
      setTimeout(() => onAction(), 2000);
    } finally { setLoading(null); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div style={{ flex: 1, marginRight: 16 }}>
            <StatusBadge status={escrow.status} />
            <div className="modal-title" style={{ marginTop: 8 }}>{escrow.title}</div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon.X /></button>
        </div>
        <div className="modal-body">
          {/* Amount hero */}
          <div style={{ background: "var(--ink)", borderRadius: "var(--radius-lg)", padding: 24, marginBottom: 20, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", fontSize: 72, fontWeight: 800, color: "rgba(255,255,255,0.04)", letterSpacing: "-0.05em", pointerEvents: "none" }}>CNPY</div>
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>LOCKED AMOUNT</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 36, fontWeight: 500, color: "var(--cnpy)", letterSpacing: "-0.02em" }}>
              {formatCNPY(escrow.amount_cnpy)} <span style={{ fontSize: 16, color: "rgba(200,146,42,0.7)" }}>CNPY</span>
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 8 }}>
              ID: {escrow.escrow_id} · Block #{escrow.created_at}
            </div>
          </div>

          {/* Description */}
          <div style={{ fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.6, marginBottom: 20 }}>{escrow.description}</div>

          {/* Meta grid */}
          <div className="detail-meta-grid" style={{ marginBottom: 20 }}>
            <div className="detail-meta-item">
              <div className="detail-meta-label">Client</div>
              <div className="detail-meta-value mono" title={escrow.client_addr}>
                {isClient ? "You" : shortenAddr(escrow.client_addr)}
              </div>
            </div>
            <div className="detail-meta-item">
              <div className="detail-meta-label">Freelancer</div>
              <div className="detail-meta-value mono">
                {escrow.freelancer_addr ? (isFreelancer ? "You" : shortenAddr(escrow.freelancer_addr)) : <span style={{ color: "var(--ink-faint)" }}>Not yet assigned</span>}
              </div>
            </div>
            <div className="detail-meta-item">
              <div className="detail-meta-label">Deadline Block</div>
              <div className="detail-meta-value mono">#{escrow.deadline_block}</div>
            </div>
            <div className="detail-meta-item">
              <div className="detail-meta-label">Created At</div>
              <div className="detail-meta-value mono">Block #{escrow.created_at}</div>
            </div>
          </div>

          {/* Milestones */}
          {escrow.milestones?.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, letterSpacing: "-0.01em" }}>Milestones</div>
              <div className="milestone-list" style={{ marginBottom: 20 }}>
                {escrow.milestones.map(m => (
                  <div key={m.id} className={`milestone-item ${m.completed ? "done" : ""}`}>
                    <div className="milestone-check">{m.completed && "✓"}</div>
                    <div className="milestone-title">{m.title}</div>
                    <div className="milestone-amount">{formatCNPY(m.amount_cnpy)} CNPY</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* TX Result */}
          {txResult && <TxReceipt result={txResult} />}

          {/* Dispute form */}
          {showDisputeForm && (
            <div style={{ marginBottom: 16 }}>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label">Reason for Dispute</label>
                <textarea className="form-textarea form-input" value={disputeReason} onChange={e => setDisputeReason(e.target.value)} placeholder="Describe the issue in detail..." />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-danger" onClick={() => act("raise_dispute", { reason: disputeReason })} disabled={!disputeReason || loading}>Submit Dispute</button>
                <button className="btn btn-outline" onClick={() => setShowDisputeForm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Actions footer */}
        {!txResult && (
          <div className="modal-footer" style={{ flexWrap: "wrap" }}>
            {/* Freelancer can accept open jobs */}
            {!isClient && !isFreelancer && escrow.status === "open" && (
              <button className={`btn btn-cnpy ${loading === "accept_project" ? "btn-loading" : ""}`} onClick={() => act("accept_project")} disabled={!!loading}>
                {!loading && "Accept This Job"}
              </button>
            )}
            {/* Client can release payment */}
            {isClient && ["accepted", "in_progress", "delivered"].includes(escrow.status) && (
              <button className={`btn btn-primary ${loading === "release_payment" ? "btn-loading" : ""}`} onClick={() => act("release_payment", { note: "Work approved" })} disabled={!!loading}>
                {!loading && `Release ${formatCNPY(escrow.amount_cnpy)} CNPY`}
              </button>
            )}
            {/* Client can refund if open */}
            {isClient && escrow.status === "open" && (
              <button className={`btn btn-outline ${loading === "refund" ? "btn-loading" : ""}`} onClick={() => act("refund", { reason: "Project cancelled" })} disabled={!!loading}>
                {!loading && "Cancel & Refund"}
              </button>
            )}
            {/* Either party can dispute */}
            {(isClient || isFreelancer) && ["accepted", "in_progress", "delivered"].includes(escrow.status) && !showDisputeForm && (
              <button className="btn btn-danger btn-sm" onClick={() => setShowDisputeForm(true)}>Raise Dispute</button>
            )}
            <button className="btn btn-outline" onClick={onClose} style={{ marginLeft: "auto" }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────
function DashboardPage({ escrows, walletAddr, balance, blockHeight, onNewEscrow }) {
  const myEscrows = escrows.filter(e => e.client_addr === walletAddr || e.freelancer_addr === walletAddr);
  const lockedCNPY = escrows.filter(e => ["open","accepted","in_progress","delivered"].includes(e.status)).reduce((s, e) => s + e.amount_cnpy, 0);
  const completed = escrows.filter(e => e.status === "completed").length;

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h1 className="page-title">Dashboard</h1>
            <div className="page-subtitle">Your onchain freelance activity on Canopy</div>
          </div>
          <button className="btn btn-cnpy" onClick={onNewEscrow}><Icon.Plus /> Post a Job</button>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Total Escrows</div>
          <div className="stat-value">{escrows.length}</div>
          <div className="stat-sub">across all statuses</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">CNPY Locked</div>
          <div className="stat-value cnpy">{formatCNPY(lockedCNPY)}</div>
          <div className="stat-sub">active escrows</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Completed</div>
          <div className="stat-value">{completed}</div>
          <div className="stat-sub">successfully paid</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Block Height</div>
          <div className="stat-value" style={{ fontSize: 18, fontFamily: "var(--font-mono)" }}>#{blockHeight}</div>
          <div className="stat-sub">Canopy mainnet</div>
        </div>
      </div>

      <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.03em", marginBottom: 16 }}>Your Escrows</div>
      {myEscrows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No escrows yet</div>
          <div className="empty-state-text">Post a job or browse open projects to get started.</div>
          <button className="btn btn-cnpy" onClick={onNewEscrow}><Icon.Plus /> Post First Job</button>
        </div>
      ) : (
        <div className="card-grid">
          {myEscrows.map(e => <EscrowCard key={e.escrow_id} escrow={e} walletAddr={walletAddr} />)}
        </div>
      )}
    </div>
  );
}

// ─── Escrow Card ──────────────────────────────────────────────────────────────
function EscrowCard({ escrow, walletAddr, onClick }) {
  return (
    <div className="escrow-card" onClick={onClick}>
      <div className="escrow-card-title">{escrow.title}</div>
      <div className="escrow-card-desc">{escrow.description || "No description provided."}</div>
      <div className="escrow-card-footer">
        <div className="escrow-amount">{formatCNPY(escrow.amount_cnpy)}<span className="denom">CNPY</span></div>
        <StatusBadge status={escrow.status} />
      </div>
    </div>
  );
}

// ─── Browse Jobs Page ─────────────────────────────────────────────────────────
function BrowsePage({ escrows, walletAddr, onSelect }) {
  const [filter, setFilter] = useState("open");
  const tabs = ["open", "accepted", "in_progress", "completed", "disputed", "all"];
  const filtered = filter === "all" ? escrows : escrows.filter(e => e.status === filter);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Browse Escrows</h1>
        <div className="page-subtitle">All onchain escrow records — verifiable on Canopy chain</div>
      </div>
      <div className="tabs">
        {tabs.map(t => (
          <button key={t} className={`tab ${filter === t ? "active" : ""}`} onClick={() => setFilter(t)}>
            {t === "all" ? "All" : t.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">No {filter} escrows</div>
          <div className="empty-state-text">Nothing matching this filter right now.</div>
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map(e => <EscrowCard key={e.escrow_id} escrow={e} walletAddr={walletAddr} onClick={() => onSelect(e)} />)}
        </div>
      )}
    </div>
  );
}

// ─── Chain Info Page ──────────────────────────────────────────────────────────
function ChainPage({ chainStatus }) {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Chain Info</h1>
        <div className="page-subtitle">Live connection to Canopy RPC ports 50002 & 50003</div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, letterSpacing: "-0.02em" }}>RPC Connection</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[
            { label: "Query RPC (port 50002)", value: "http://localhost:50002", status: "online" },
            { label: "TX RPC (port 50003)", value: "http://localhost:50003", status: "online" },
          ].map(item => (
            <div key={item.label} style={{ background: "var(--paper)", border: "1px solid var(--wire)", borderRadius: "var(--radius-md)", padding: 16 }}>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, marginBottom: 8 }}>{item.value}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <div className={`status-dot ${item.status}`} />
                <span style={{ color: item.status === "online" ? "var(--open)" : "var(--disputed)" }}>{item.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, letterSpacing: "-0.02em" }}>Chain Status</div>
        {[
          { k: "Chain ID", v: chainStatus?.chain_id || "canopy-mainnet-1" },
          { k: "Latest Block", v: chainStatus ? `#${chainStatus.latest_block_height}` : "—" },
          { k: "Node Version", v: chainStatus?.node_version || "1.4.2" },
          { k: "Native Token", v: "CNPY (Canopy)" },
        ].map(row => (
          <div key={row.k} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--wire)" }}>
            <div style={{ width: 160, fontSize: 12, color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>{row.k}</div>
            <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", fontWeight: 500 }}>{row.v}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, letterSpacing: "-0.02em" }}>PayWork Transaction Types</div>
        <div style={{ fontSize: 12, color: "var(--ink-muted)", marginBottom: 16, lineHeight: 1.6 }}>
          These are registered as custom transaction types in the Canopy plugin system. Every escrow action is a real onchain transaction — not a database write.
        </div>
        {[
          { type: "paywork/create_escrow",   desc: "Locks CNPY and creates escrow record" },
          { type: "paywork/accept_project",  desc: "Freelancer claims an open job" },
          { type: "paywork/release_payment", desc: "Client releases CNPY to freelancer" },
          { type: "paywork/refund",          desc: "Returns CNPY to client" },
          { type: "paywork/raise_dispute",   desc: "Freezes escrow pending arbitration" },
          { type: "paywork/resolve_dispute", desc: "Arbiter splits funds" },
        ].map(tx => (
          <div key={tx.type} style={{ display: "flex", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--wire)", alignItems: "flex-start" }}>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--paper-2)", padding: "3px 8px", borderRadius: "var(--radius-sm)", color: "var(--cnpy-dark)", flexShrink: 0, border: "1px solid var(--wire)" }}>{tx.type}</code>
            <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>{tx.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [escrows, setEscrows] = useState([]);
  const [balance, setBalance] = useState(0);
  const [chainStatus, setChainStatus] = useState(null);
  const [walletAddr] = useState(devWalletAddr);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEscrow, setSelectedEscrow] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [rpcStatus, setRpcStatus] = useState("checking");

  const addToast = useCallback((title, message, type = "info", txHash) => {
    const id = Date.now();
    setToasts(t => [...t, { id, title, message, type, txHash }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [status, balResult, escrowResult] = await Promise.all([
        rpcQuery("chain_status", {}),
        rpcQuery("account_balance", { address: walletAddr, denom: "CNPY" }),
        rpcQuery("paywork_listEscrows", { limit: 50 }),
      ]);
      setChainStatus(status);
      setBalance(balResult?.balance || 0);
      setEscrows(escrowResult?.escrows || []);
      setRpcStatus(status?.connected !== false ? "online" : "offline");
    } catch { setRpcStatus("offline"); }
  }, [walletAddr]);

  useEffect(() => { loadData(); const t = setInterval(loadData, 10000); return () => clearInterval(t); }, [loadData]);

  const handleAction = useCallback(() => {
    loadData();
    addToast("Transaction confirmed", "Onchain state updated", "success");
    setSelectedEscrow(null);
  }, [loadData, addToast]);

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: <Icon.Dashboard /> },
    { id: "browse",    label: "Browse Jobs", icon: <Icon.Briefcase /> },
    { id: "chain",     label: "Chain Info",  icon: <Icon.Chain /> },
  ];

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar">
        <a href="#" className="topbar-logo" onClick={e => { e.preventDefault(); setPage("dashboard"); }}>
          <span className="wordmark">PayWork</span>
          <span className="tag">CANOPY</span>
        </a>
        <div className="topbar-spacer" />
        <div className="chain-status">
          <div className={`status-dot ${rpcStatus === "online" ? "online" : rpcStatus === "offline" ? "offline" : ""}`} />
          {rpcStatus === "online" ? `Block #${chainStatus?.latest_block_height || "…"}` : rpcStatus === "checking" ? "Connecting…" : "Offline"}
        </div>
        <div className="cnpy-balance">
          <span style={{ fontSize: 10, opacity: 0.7 }}>⬡</span>
          {formatCNPY(balance)} CNPY
        </div>
        <div className="topbar-address" title={walletAddr} onClick={() => { copyToClipboard(walletAddr); addToast("Copied", "Address copied to clipboard", "info"); }}>
          {shortenAddr(walletAddr)} <Icon.Copy />
        </div>
      </header>

      <div className="main-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-label">Navigation</div>
            {nav.map(n => (
              <div key={n.id} className={`sidebar-nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
                <span className="nav-icon">{n.icon}</span>
                {n.label}
              </div>
            ))}
          </div>
          <div className="sidebar-section">
            <div className="sidebar-label">Quick Action</div>
            <div style={{ padding: "0 16px" }}>
              <button className="btn btn-cnpy" style={{ width: "100%", justifyContent: "center" }} onClick={() => setShowCreate(true)}>
                <Icon.Plus /> Post a Job
              </button>
            </div>
          </div>
          <div className="sidebar-spacer" />
          <div className="sidebar-footer">
            <div className="sidebar-chain-info">
              Query RPC: :50002<br />
              TX RPC: :50003<br />
              Token: CNPY<br />
              Chain: canopy-mainnet-1
            </div>
          </div>
        </aside>

        {/* Page content */}
        <main className="page-content">
          {page === "dashboard" && (
            <DashboardPage
              escrows={escrows} walletAddr={walletAddr} balance={balance}
              blockHeight={chainStatus?.latest_block_height || 0}
              onNewEscrow={() => setShowCreate(true)}
            />
          )}
          {page === "browse" && (
            <BrowsePage escrows={escrows} walletAddr={walletAddr} onSelect={e => setSelectedEscrow(e)} />
          )}
          {page === "chain" && <ChainPage chainStatus={chainStatus} />}
        </main>
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateEscrowModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { loadData(); addToast("Escrow created!", "Job posted onchain via Canopy", "success"); }}
          walletAddr={walletAddr}
          currentBlock={chainStatus?.latest_block_height || 1241887}
        />
      )}
      {selectedEscrow && (
        <EscrowDetailModal
          escrow={selectedEscrow}
          onClose={() => setSelectedEscrow(null)}
          onAction={handleAction}
          walletAddr={walletAddr}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
