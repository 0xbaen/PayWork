/**
 * PayWork — Canopy RPC Client (Final)
 * File: rpc/canopy-rpc.js
 *
 * All blockchain communication routes through this module.
 * Port 50002 = Query RPC  (read state from Canopy chain)
 * Port 50003 = TX RPC     (submit signed transactions to Canopy chain)
 *
 * Real data flow:
 *   Frontend → submitTx() → port 50003 → Canopy node → state machine → onchain
 *   Frontend → query()    → port 50002 → Canopy node → state tree    → response
 *
 * Wallet signing:
 *   Signing is handled by window.canopy (the Canopy browser wallet extension).
 *   The private key NEVER leaves the user's device.
 *   In local-node dev mode (no extension), unsigned txs are accepted by
 *   the local node when --dev-mode is set.
 */

const QUERY_URL = import.meta.env?.VITE_CANOPY_QUERY_URL ?? "http://localhost:50002";
const TX_URL    = import.meta.env?.VITE_CANOPY_TX_URL    ?? "http://localhost:50003";
const DENOM     = "CNPY";
const TIMEOUT_MS = 10_000;

// ─── Core Transport ───────────────────────────────────────────────────────────

/**
 * Send a JSON-RPC 2.0 request to the Canopy query endpoint (port 50002).
 * Read-only — never changes chain state.
 */
async function query(method, params = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${QUERY_URL}/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new RPCError(`HTTP ${res.status}`, res.status);
    const data = await res.json();
    if (data.error) throw new RPCError(data.error.message, data.error.code);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build, sign, and broadcast a transaction to the Canopy TX endpoint (port 50003).
 * Signing happens in the user's wallet — private key never exposed to this code.
 *
 * @param {string} txType   - e.g. "paywork/create_escrow"
 * @param {object} payload  - transaction-specific data
 * @param {string} sender   - sender's Canopy address
 * @returns {{ txHash, height, escrowId? }}
 */
async function submitTx(txType, payload, sender) {
  // 1. Build the unsigned transaction envelope
  const chainStatus = await getChainStatus();
  const unsigned = {
    type:        txType,
    payload:     JSON.stringify(payload),
    sender,
    chain_id:    chainStatus.chain_id,
    sequence:    await getAccountSequence(sender),
    timestamp:   Math.floor(Date.now() / 1000),
    nonce:       crypto.randomUUID(),
  };

  // 2. Sign with the Canopy wallet extension, or fall back to dev-mode
  let signed;
  if (typeof window !== "undefined" && window.canopy?.signTransaction) {
    signed = await window.canopy.signTransaction(unsigned);
  } else if (import.meta.env?.DEV) {
    // Local dev only — accepted by nodes started with --dev-mode flag
    console.warn("PayWork: wallet extension not found, using dev-mode signing");
    signed = { ...unsigned, signature: "dev-mode", pub_key: "" };
  } else {
    throw new Error(
      "Canopy wallet extension not found. " +
      "Please install it from https://canopynetwork.org/wallet"
    );
  }

  // 3. Broadcast to port 50003
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TX_URL}/v1/transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "broadcast_tx", params: signed }),
      signal: controller.signal,
    });
    if (!res.ok) throw new RPCError(`TX broadcast HTTP ${res.status}`, res.status);
    const data = await res.json();
    if (data.error) throw new RPCError(data.error.message, data.error.code);
    return data.result; // { tx_hash, height, success, escrow_id? }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Escrow Transaction Functions ─────────────────────────────────────────────

/**
 * Create a new escrow — locks CNPY onchain.
 * @returns {{ txHash, height, escrowId }}
 */
export async function createEscrow({ title, description, amountCNPY, deadlineBlock, milestones = [] }, sender) {
  if (!title)        throw new Error("Job title is required");
  if (!amountCNPY || amountCNPY <= 0) throw new Error("Escrow amount must be > 0");

  const result = await submitTx("paywork/create_escrow", {
    title,
    description,
    amount_cnpy:    toUCNPY(amountCNPY),
    deadline_block: deadlineBlock,
    milestones:     milestones.map(m => ({
      id:          m.id,
      title:       m.title,
      amount_cnpy: toUCNPY(m.amount),
      completed:   false,
    })),
  }, sender);

  return { txHash: result.tx_hash, height: result.height, escrowId: result.escrow_id };
}

/**
 * Freelancer accepts an open job — claims it onchain.
 */
export async function acceptProject(escrowId, freelancerAddr) {
  const result = await submitTx("paywork/accept_project", { escrow_id: escrowId }, freelancerAddr);
  return { txHash: result.tx_hash, height: result.height };
}

/**
 * Client releases payment — transfers locked CNPY to freelancer onchain.
 */
export async function releasePayment(escrowId, note = "", clientAddr) {
  const result = await submitTx("paywork/release_payment", { escrow_id: escrowId, note }, clientAddr);
  return { txHash: result.tx_hash, height: result.height };
}

/**
 * Client cancels escrow and reclaims CNPY.
 * Only valid if status == "open" OR deadline block has passed.
 */
export async function requestRefund(escrowId, reason = "", clientAddr) {
  const result = await submitTx("paywork/refund", { escrow_id: escrowId, reason }, clientAddr);
  return { txHash: result.tx_hash, height: result.height };
}

/**
 * Either party raises a dispute — freezes funds pending arbitration.
 */
export async function raiseDispute(escrowId, reason, evidence = "", callerAddr) {
  const result = await submitTx("paywork/raise_dispute", { escrow_id: escrowId, reason, evidence }, callerAddr);
  return { txHash: result.tx_hash, height: result.height };
}

/**
 * Arbiter resolves a dispute — splits CNPY proportionally.
 */
export async function resolveDispute(escrowId, clientPercent, freelancerPercent, resolution, arbiterAddr) {
  if (clientPercent + freelancerPercent !== 100) throw new Error("Percentages must sum to 100");
  const result = await submitTx("paywork/resolve_dispute", {
    escrow_id:          escrowId,
    client_percent:     clientPercent,
    freelancer_percent: freelancerPercent,
    resolution,
  }, arbiterAddr);
  return { txHash: result.tx_hash, height: result.height };
}

// ─── Query Functions ──────────────────────────────────────────────────────────

/** Fetch a single escrow record directly from Canopy chain state. */
export async function getEscrow(escrowId) {
  return query("paywork_getEscrow", { escrow_id: escrowId });
}

/**
 * List escrows from chain state with optional filters.
 * All data comes from the live Canopy state tree — not a database.
 */
export async function listEscrows({ status, clientAddr, freelancerAddr, limit = 20, offset = 0 } = {}) {
  return query("paywork_listEscrows", {
    status,
    client_addr:     clientAddr,
    freelancer_addr: freelancerAddr,
    limit,
    offset,
  });
}

/** Get aggregated onchain stats for the PayWork protocol. */
export async function getStats() {
  return query("paywork_getStats", {});
}

/** Get CNPY balance for an address (live from chain). */
export async function getCNPYBalance(address) {
  const result = await query("account_balance", { address, denom: DENOM });
  return { address, balanceCNPY: fromUCNPY(result.balance), balanceUCNPY: result.balance };
}

/** Get the current block height and chain info. */
export async function getChainStatus() {
  return query("chain_status", {});
}

/** Get full transaction receipt by hash (for confirmation display). */
export async function getTxReceipt(txHash) {
  return query("tx_details", { hash: txHash });
}

/** Get current account sequence (nonce) for transaction building. */
export async function getAccountSequence(address) {
  try {
    const result = await query("account_info", { address });
    return result.sequence ?? 0;
  } catch {
    return 0;
  }
}

// ─── Connection Health Check ──────────────────────────────────────────────────

export async function checkConnection() {
  try {
    const [queryStatus, txStatus] = await Promise.allSettled([
      fetch(`${QUERY_URL}/health`),
      fetch(`${TX_URL}/health`),
    ]);
    const chainStatus = await getChainStatus();
    return {
      connected:   true,
      queryPort:   { url: QUERY_URL, ok: queryStatus.status === "fulfilled" },
      txPort:      { url: TX_URL,    ok: txStatus.status === "fulfilled" },
      chainId:     chainStatus.chain_id,
      blockHeight: chainStatus.latest_block_height,
      nodeVersion: chainStatus.node_version,
    };
  } catch (err) {
    return {
      connected: false,
      error:     err.message,
      queryPort: { url: QUERY_URL, ok: false },
      txPort:    { url: TX_URL,    ok: false },
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert human-readable CNPY to uCNPY (integer) */
export function toUCNPY(cnpy) {
  return Math.round(parseFloat(cnpy) * 1_000_000);
}

/** Convert uCNPY (integer) to human-readable CNPY */
export function fromUCNPY(ucnpy) {
  return ucnpy / 1_000_000;
}

/** Format CNPY for display */
export function formatCNPY(ucnpy, decimals = 4) {
  return fromUCNPY(ucnpy).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

class RPCError extends Error {
  constructor(message, code) {
    super(message);
    this.name  = "RPCError";
    this.code  = code;
  }
}

export default {
  createEscrow, acceptProject, releasePayment, requestRefund,
  raiseDispute, resolveDispute, getEscrow, listEscrows, getStats,
  getCNPYBalance, getChainStatus, getTxReceipt, checkConnection,
  toUCNPY, fromUCNPY, formatCNPY,
};
