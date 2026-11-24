// Fresh-burst sniper for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// Design record — what was weighed and why this shape won:
//
// 1. Buy-everything-early (the equal-weight baseline): buys each coin once it has any real
//    reserve and holds to the end. Simple, and it always clears the 20-coin bar, but most
//    pump.fun coins bleed out, so holding every launch to the flatten is a slow loss on
//    the median coin. Rejected as the main engine; kept as the fallback shape for the
//    guardrail probes only (buy a liquid coin, sell it as soon as the buy lands).
//
// 2. Momentum with pyramiding (the pilot momentum bot): buys on accelerating buy pressure
//    and adds into strength behind a trailing stop. Strong on the dev window, and its shape
//    is what v2 adopts: a small first buy, adds only into strength, a mature entry age
//    (fresh curves are mostly bundled launches that get dumped), and a rolling-window
//    signal (net inflow, acceleration, price near its window high) instead of a
//    cumulative-since-creation tape. The parts dropped: the 2 SOL stake (ours caps at
//    0.25 SOL per coin), the dozen tuned thresholds, and re-entry after an exit (one
//    entry per coin, ever — breadth comes from turnover, not from re-trading a coin).
//
// 3. Dip-buying / mean reversion (the pilot reversion bot): buys 30-45% drawdowns on
//    strong curves. It needs a run-up first and a dip second, so it trades late in a
//    coin's life and fights the dominant pump.fun direction, which is down after the
//    first minutes. Rejected: on a 6-hour window the edge is in the first minutes of a
//    launch, not in catching its falling knife.
//
// 4. This bot — fresh-burst sniper v2 (was: buy the opening tape once, full size, at
//    60-600 slots old): watch every coin from its CreateEvent and decide once on a
//    rolling 30-slot window once it is mature (500+ slots old, about 3.5 min), on
//    accelerating buy pressure — net SOL flowing in, several distinct buyers, price up
//    a little and sitting near its window high, inflow accelerating into the newer half
//    of the window. The first buy is a 0.05 SOL probe; one add of up to 0.20 SOL
//    follows only while the signal still holds, the price is at or above the first
//    buy's, and the position is up — false starts cost little, runners get size.
//    Exits are a hard stop, a take-profit (+25% — most +10% moves round-trip to zero,
//    so winners are banked), a trailing stop, a hold cap, a stale exit, and an instant
//    exit when the creator sells. One entry per coin, so breadth — the 20-coin
//    guardrail — comes from turnover, and a pace-based prober tops it up if entries
//    ever run dry.
//
// Fee arithmetic (why the sizes are what they are): a round trip pays ~1.25% of size on
// the buy and ~1.25% on the sell, plus 105,000 lamports of transaction fees per order,
// so about 2.5% + 0.00021 SOL per round trip. The 0.05 SOL first buy pays ~0.0015 SOL
// of fees — a false start stopped at -12% costs ~0.0075 SOL all-in, about a quarter of
// what the v1 full-size first buy cost. At the full 0.25 SOL stake a round trip costs
// ~0.0065 SOL, roughly a quarter of the 12% stop — the stop still means something.
// At the 0.01 SOL minimum buy the fixed fees alone are ~2% of size, which is why
// 0.01 SOL is the floor and never the target. The per-reply buy cap (1% of a curve's
// real SOL reserve) binds before the target on young curves, so small buys on small
// curves are the norm and the size grows with the curve's own traction.
//
// Drawdown: at most 5 positions, each at most 0.25 SOL, so at most 1.25 SOL (12.5% of
// capital) is ever at risk at once, and in practice most of it sits in 0.05 SOL first
// buys until a position proves itself. The 12% stop caps the loss per full position
// near 0.03 SOL plus fees, and a typical false start (probe only, no add) costs ~0.0075
// SOL. Even a run of five straight stopped-out full positions costs under 2% of
// capital. The 50% drawdown guardrail is nowhere near binding.
//
// Pass 2 — revision notes (after a full re-read of pass 1):
// - Removed the unused LAMPORTS_PER_SOL import (sizes go through the local SOL constant).
// - Entry now also requires the coin's most recent trade to be a buy: the opening tape
//   can pass every filter while the last print is a sell, i.e. the coin is being sold
//   into right now. Buying into an active sell-off is the one failure mode the tape
//   filters did not see, so the last print must be a buy (tracked as lastIsBuy).
//
// Pass 3 — tuning (v2), after grade-local on the dev dataset (128,058 events, 24 h):
// net PnL -0.3247 SOL, 196 round trips, win rate 17.3%, fees 0.256 SOL, max drawdown
// 4.5%, guardrails met, deterministic (L1 regrade reproduced byte for byte). The v1
// shape lost because it committed full size (0.25 SOL) at 60 slots old on a cumulative
// tape with no take-profit: 83% of entries were false starts at ~0.031 SOL each, and
// the winners that did reach +10% gave most of it back through the 10% trail.
// Changes, and why:
// - Entry is now a rolling 30-slot window (net flow, buyers, acceleration, near-high),
//   not cumulative-since-creation: a coin must be buying NOW, not have bought once.
// - minAge 60 -> 500 slots: the first minutes are mostly bundled launches that dump.
// - Run-up band +3..+80% from create -> +5..+50% over the window: no chasing verticals.
// - First buy 0.25 SOL -> 0.05 SOL probe, plus one 0.20 SOL add into strength (signal
//   still holds, price >= first buy's, position up): false starts cost ~4x less, and
//   size only follows a position that is already working.
// - Take-profit +25% added (bank winners — most +10% moves round-trip to zero), stop
//   10% -> 12%, trail 10% -> 15% (runners get room now that the first buy is small).
// - Hold cap 3600 -> 1500 slots (a position that has not paid in ~10 min is dead money).
// - Deliberately NOT changed: the pacer (still the guardrail backstop), one entry per
//   coin, the creator filters (dev buy cap, dev-sold skip), determinism, the 5-position
//   cap. No fade exit added (the stale exit already covers dead coins), no second add,
//   no parameter tuned to a single dev-window cell — the bands stay wide on purpose.
//
// Determinism: every decision is a pure function of the batches the harness sends.
// Iteration is over insertion-ordered maps fed by the batch stream, with held mints
// visited in sorted order. No clock, no randomness, no environment, no I/O.

import {
  type Batch,
  type Bot,
  type BotState,
  type OrderInput,
  type Pubkey,
} from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since CreateEvent) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** Rolling entry window in slots: the signal reads only trades inside it. */
  window: number;
  /** Buy trades inside the window before entry. */
  minBuys: number;
  /** Distinct non-creator buyers inside the window. */
  minBuyers: number;
  /** Creator's own buys since creation, at most (SOL): a dev-heavy launch is skipped. */
  maxDevBuySol: number;
  /** Net SOL bought (buys minus sells) inside the window, at least. */
  minNetSol: number;
  /** Price now over the price at the window start, minus 1: entry band (skip dead launches and verticals). */
  minPriceUp: number;
  maxPriceUp: number;
  /** Net inflow in the newer half of the window must be at least this multiple of the older half's (acceleration). */
  accel: number;
  /** Price now at least this share of the window's high. */
  nearHigh: number;
  /** Largest single non-creator buyer's share of the window's buy SOL, at most. */
  maxBuyerShare: number;
  /** Real SOL reserve at decision time: entry band. */
  minRqSol: number;
  maxRqSol: number;
  /** First buy of a position (SOL): a probe — false starts must cost little. */
  initialSol: number;
  /** Each add-on buy (SOL), into strength only. */
  addSol: number;
  /** Total SOL to put into one position at most (initial + adds). */
  stakeSol: number;
  /** Smallest single buy worth paying the transaction fee for. */
  minBuySol: number;
  /** Slippage allowed on buys (bps); sells always go out wide open so exits execute. */
  buySlipBps: number;
  sellSlipBps: number;
  /** Exit when the position's liquidation value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** Exit the whole position once it is worth cost * (1 + takeProfit): bank winners. */
  takeProfit: number;
  /** Trailing stop arms once value reaches cost * (1 + trailArm). */
  trailArm: number;
  /** ...and exits on a fall of trailDrop from the best value seen. */
  trailDrop: number;
  /** Exit after holding this many slots regardless. */
  maxHoldSlots: number;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Most new entries per batch (keeps one wild batch from filling every slot). */
  maxEntriesPerBatch: number;
  /** Guardrail pacing: target distinct coins and fills by the end of the window. */
  targetCoins: number;
  targetFills: number;
  /** Window length in block-time seconds the pace is measured against (6 h). */
  paceSecs: number;
  /** Size of a guardrail probe round trip (SOL): above the 0.01 SOL bar, small enough to be cheap. */
  probeSol: number;
  /** Most probe round trips open at once. */
  maxProbes: number;
  /** Real SOL reserve a probe candidate needs (so the 1% cap admits the probe size). */
  probeMinRqSol: number;
}

// Tuned for robustness on a fresh window, not for the single best dev-window cell:
// wide entry bands, one buy per coin, exits that cut losers and let winners run.
export const DEFAULT_PARAMS: Params = {
  minAge: 500,
  maxAge: 3600,
  window: 30,
  minBuys: 3,
  minBuyers: 5,
  maxDevBuySol: 2.5,
  minNetSol: 1,
  minPriceUp: 0.05,
  maxPriceUp: 0.5,
  accel: 1,
  nearHigh: 0.95,
  maxBuyerShare: 0.6,
  minRqSol: 2,
  maxRqSol: 60,
  initialSol: 0.05,
  addSol: 0.2,
  stakeSol: 0.25,
  minBuySol: 0.01,
  buySlipBps: 1500,
  sellSlipBps: 10_000,
  stopLoss: 0.12,
  takeProfit: 0.25,
  trailArm: 0.1,
  trailDrop: 0.15,
  maxHoldSlots: 1500,
  staleSlots: 600,
  maxEntriesPerBatch: 2,
  targetCoins: 30,
  targetFills: 60,
  paceSecs: 21_600,
  probeSol: 0.02,
  maxProbes: 2,
  probeMinRqSol: 3,
};

const SOL = 1e9;
const FEE_BPS = 125n;
const BPS = 10_000n;

/** One recorded trade, kept on the coin's rolling tape. */
interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: Pubkey;
  price: number;
}

/** The rolling tape of one coin, kept from its CreateEvent onward. */
interface Tape {
  createdSlot: number;
  creator: Pubkey;
  /** Trades inside the entry window (older ones are dropped as new ones come). */
  trades: Trade[];
  devBuySol: number;
  devSold: boolean;
  lastTradeSlot: number;
  /** The most recent trade was a buy: entry requires the dip to be bought, not sold into. */
  lastIsBuy: boolean;
  /** Decided for good: bought, aged out, or filtered out. One entry per coin, ever. */
  done: boolean;
}

interface Held {
  openedSlot: number;
  /** Best liquidation value seen (lamports); the trailing stop is measured from it. */
  peakLamports: bigint;
  /** True while the sell for this position is being decided (do not send a second). */
  exiting: boolean;
  /** Guardrail probe: sell as soon as the buy has landed. */
  probe: boolean;
  /** SOL sent in buys for this position (initial + adds, fees excluded). */
  investedSol: number;
  /** Price (vq/vt) when the last buy was decided: adds need the price at or above it. */
  lastAddPrice: number;
}

/**
 * What selling `tokens` against these reserves would pay after curve fees
 * (protocol + creator, 95 + 30 bps), capped at the curve's real SOL: you cannot
 * extract more SOL than the curve holds. The constant-product quote itself is the
 * market model the replay grades with, so this is the honest liquidation value.
 */
function sellProceeds(tokens: bigint, vq: bigint, vt: bigint, rq: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  let q = (tokens * vq) / (vt + tokens);
  if (q > rq) q = rq;
  const fee = (q * FEE_BPS + BPS - 1n) / BPS;
  return q > fee ? q - fee : 0n;
}

/** The per-reply buy cap, with a margin: the harness checks it against reserves
 *  shifted by our own earlier flow on the coin, which can sit a little below the
 *  recorded ones the SDK keeps. */
function buyCap(state: BotState, mint: Pubkey): bigint {
  return (state.maxBuyLamports(mint) * 97n) / 100n;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe mints with a buy in flight or a position waiting to be sold. */
  const probes = new Set<Pubkey>();
  /** My own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = {
        createdSlot: -1,
        creator: '',
        trades: [],
        devBuySol: 0,
        devSold: false,
        lastTradeSlot: -1,
        lastIsBuy: false,
        done: false,
      };
      tapes.set(mint, t);
    }
    return t;
  };

  /** The entry signal on a coin's rolling window at slot `now`: every filter must pass.
   *  A coin is judged on whether it is buying NOW — net inflow, several distinct
   *  buyers, price up a little and sitting near its window high, inflow accelerating
   *  into the newer half of the window — not on what its tape looked like at birth. */
  const signalOk = (t: Tape, now: number, rqSol: number, price: number): boolean => {
    if (t.createdSlot < 0) return false;
    const age = now - t.createdSlot;
    if (age < p.minAge || age > p.maxAge) return false;
    if (rqSol < p.minRqSol || rqSol > p.maxRqSol) return false;
    if (t.devBuySol > p.maxDevBuySol) return false;
    if (t.devSold) return false;
    if (!t.lastIsBuy) return false;
    const from = now - p.window;
    const mid = now - p.window / 2;
    let buySol = 0;
    let sellSol = 0;
    let buys = 0;
    let netOld = 0;
    let netNew = 0;
    let startPrice = -1;
    let high = 0;
    const byUser = new Map<Pubkey, number>();
    for (const tr of t.trades) {
      if (tr.slot <= from) {
        startPrice = tr.price;
        continue;
      }
      if (startPrice < 0) startPrice = tr.price;
      const signed = tr.buy ? tr.sol : -tr.sol;
      if (tr.slot <= mid) netOld += signed;
      else netNew += signed;
      if (tr.buy) {
        buySol += tr.sol;
        buys++;
        byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
      } else {
        sellSol += tr.sol;
      }
      if (tr.price > high) high = tr.price;
    }
    if (buys < p.minBuys || byUser.size < p.minBuyers) return false;
    if (buySol - sellSol < p.minNetSol) return false;
    if (startPrice <= 0) return false;
    const up = price / startPrice - 1;
    if (up < p.minPriceUp || up > p.maxPriceUp) return false;
    if (high > 0 && price < high * p.nearHigh) return false;
    if (netNew <= 0 || netNew < p.accel * netOld) return false;
    if (buySol > 0) {
      let top = 0;
      for (const v of byUser.values()) if (v > top) top = v;
      if (top > p.maxBuyerShare * buySol) return false;
    }
    return true;
  };

  /** Liquidation value of a held position in lamports: sell proceeds at the latest
   *  marked reserves, less one transaction fee. Zero when the curve is gone. */
  const positionValue = (state: BotState, marks: Map<Pubkey, { vq: bigint; vt: bigint; rq: bigint }>, mint: Pubkey, tokens: bigint): bigint => {
    const m = marks.get(mint);
    const curve = state.curves.get(mint);
    const vq = m !== undefined ? m.vq : (curve?.virtual_quote_reserves ?? 0n);
    const vt = m !== undefined ? m.vt : (curve?.virtual_token_reserves ?? 0n);
    const rq = m !== undefined ? m.rq : (curve?.real_quote_reserves ?? 0n);
    const gross = sellProceeds(tokens, vq, vt, rq);
    const tx = state.txFeeLamports();
    return gross > tx ? gross - tx : 0n;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();

      // --- Fold the batch: fills first, then events into the tapes. ---
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) continue; // a harness close, not my order
        if (f.status === 'filled') {
          myFills++;
          myCoins.add(f.mint);
        } else if (f.side === 'buy' && !state.positions.has(f.mint)) {
          // The opening buy never filled: forget the position (the coin stays done —
          // one entry per coin — so a rejected buy costs nothing but the chance).
          let stillPending = false;
          for (const po of state.pending.values()) if (po.order.mint === f.mint) stillPending = true;
          if (!stillPending) {
            held.delete(f.mint);
            probes.delete(f.mint);
          }
        }
      }
      // Positions the harness closed (curve completed / window flattened) leave held.
      for (const mint of [...held.keys()]) {
        if (state.positions.has(mint)) continue;
        let stillPending = false;
        for (const po of state.pending.values()) if (po.order.mint === mint) stillPending = true;
        if (!stillPending) {
          held.delete(mint);
          probes.delete(mint);
        }
      }

      const touched: Pubkey[] = [];
      const touchedSet = new Set<Pubkey>();
      const devSoldNow = new Set<Pubkey>();
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.createdSlot = e.slot;
          t.creator = e.creator;
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / SOL;
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          t.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price });
          t.lastTradeSlot = e.slot;
          t.lastIsBuy = e.is_buy;
          if (e.is_buy && e.user === t.creator) {
            t.devBuySol += sol;
          } else if (!e.is_buy && e.user === t.creator) {
            t.devSold = true;
            if (held.has(e.mint)) devSoldNow.add(e.mint);
          }
        }
        if (!touchedSet.has(e.mint)) {
          touchedSet.add(e.mint);
          touched.push(e.mint);
        }
      }
      // Drop trades older than the entry window (plus a margin) from the touched
      // tapes: the signal reads the window only, and the tapes must not grow unbounded.
      for (const mint of touched) {
        const t = tapes.get(mint);
        if (t === undefined) continue;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - (p.window + 60)) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }

      const marks = new Map<Pubkey, { vq: bigint; vt: bigint; rq: bigint }>();
      for (const m of batch.marks) {
        marks.set(m.mint, {
          vq: BigInt(m.virtual_quote_reserves),
          vt: BigInt(m.virtual_token_reserves),
          rq: BigInt(m.real_quote_reserves),
        });
      }
      const pendingMints = new Set<Pubkey>();
      for (const po of state.pending.values()) pendingMints.add(po.order.mint);
      const orders: OrderInput[] = [];

      // --- 1. Exits, held mints in sorted order (deterministic). ---
      for (const mint of [...held.keys()].sort()) {
        if (orders.length >= cap) break;
        const h = held.get(mint)!;
        const pos = state.positions.get(mint);
        if (pos === undefined) continue; // buy still in flight; the sweep above handles the rest
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue; // harness closes it
        if (h.exiting || pendingMints.has(mint)) continue; // a sell is already in flight
        const value = positionValue(state, marks, mint, pos.token_amount);
        const cost = pos.cost_lamports;
        if (value > h.peakLamports) h.peakLamports = value;
        const t = tapes.get(mint);
        let exit = false;
        if (h.probe) {
          exit = true; // a probe sells the moment its buy has landed
        } else if (value <= (cost * BigInt(Math.round((1 - p.stopLoss) * 100))) / 100n) {
          exit = true; // hard stop
        } else if (value >= (cost * BigInt(Math.round((1 + p.takeProfit) * 100))) / 100n) {
          exit = true; // take-profit: bank the winner before it round-trips
        } else if (h.peakLamports >= (cost * BigInt(Math.round((1 + p.trailArm) * 100))) / 100n && value < (h.peakLamports * BigInt(Math.round((1 - p.trailDrop) * 100))) / 100n) {
          exit = true; // trailing stop, armed only after a real gain
        } else if (now - h.openedSlot > p.maxHoldSlots) {
          exit = true; // hold cap: take the money, do not bag-hold
        } else if (t !== undefined && t.lastTradeSlot >= 0 && now - t.lastTradeSlot > p.staleSlots) {
          exit = true; // nobody trades it any more
        } else if (devSoldNow.has(mint)) {
          exit = true; // the creator sold while we hold: leave at once
        }
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.sellSlipBps });
        h.exiting = true;
        pendingMints.add(mint);
      }

      // --- 2. Entries on coins that traded this batch, in event order. ---
      // A first buy is a small probe; one add follows only into strength (signal still
      // holds, price at or above the first buy's, position up) up to the stake cap.
      let free = state.freeCashLamports();
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let entries = 0;
      for (const mint of touched) {
        if (orders.length >= cap || entries >= p.maxEntriesPerBatch) break;
        if (pendingMints.has(mint) || probes.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const t = tapes.get(mint);
        if (t === undefined) continue;
        if (t.createdSlot >= 0 && now - t.createdSlot > p.maxAge) t.done = true;
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / SOL;
        const h = held.get(mint);
        if (h !== undefined) {
          // Add into strength only: not exiting, room under the stake, signal alive,
          // price stepped up from the last buy, and the position already in profit.
          if (h.exiting || h.probe) continue;
          if (h.investedSol >= p.stakeSol - p.minBuySol) continue;
          const pos = state.positions.get(mint);
          if (pos === undefined) continue;
          if (price < h.lastAddPrice) continue;
          if (!signalOk(t, now, rqSol, price)) continue;
          const value = positionValue(state, marks, mint, pos.token_amount);
          if (value < pos.cost_lamports) continue;
          const capLamports = buyCap(state, mint);
          let amount = BigInt(Math.floor(p.addSol * SOL));
          const room = BigInt(Math.floor((p.stakeSol - h.investedSol) * SOL));
          if (amount > room) amount = room;
          if (amount > capLamports) amount = capLamports;
          if (amount < BigInt(Math.floor(p.minBuySol * SOL))) continue;
          if (free < amount + tx) continue;
          orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
          h.investedSol += Number(amount) / SOL;
          h.lastAddPrice = price;
          free -= amount + tx;
          entries++;
          pendingMints.add(mint);
          continue;
        }
        if (slotsLeft <= 0) break;
        if (t.done) continue;
        if (!signalOk(t, now, rqSol, price)) continue;
        const capLamports = buyCap(state, mint);
        let amount = BigInt(Math.floor(p.initialSol * SOL));
        if (amount > capLamports) amount = capLamports;
        if (amount < BigInt(Math.floor(p.minBuySol * SOL))) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
        held.set(mint, { openedSlot: now, peakLamports: 0n, exiting: false, probe: false, investedSol: Number(amount) / SOL, lastAddPrice: price });
        t.done = true;
        free -= amount + tx;
        slotsLeft--;
        entries++;
        pendingMints.add(mint);
      }

      // --- 3. Guardrail pacing: probes when fills or coins lag the pace. ---
      // The bar is 20 coins with >= 0.01 SOL round trips; pace toward 30 coins / 60
      // fills over the 6-hour window so a quiet stretch of entries never strands the run.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const probeLamports = BigInt(Math.floor(p.probeSol * SOL));
          let best: Pubkey | null = null;
          let bestRq = 0;
          for (const mint of touched) {
            if (held.has(mint) || pendingMints.has(mint) || probes.has(mint)) continue;
            if (myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            const rqSol = Number(curve.real_quote_reserves) / SOL;
            if (rqSol < p.probeMinRqSol) continue;
            if (rqSol > bestRq) {
              bestRq = rqSol;
              best = mint;
            }
          }
          if (best !== null && free >= probeLamports + tx && buyCap(state, best) >= probeLamports) {
            orders.push({ side: 'buy', mint: best, quote_lamports: probeLamports, max_slippage_bps: p.buySlipBps });
            held.set(best, { openedSlot: now, peakLamports: 0n, exiting: false, probe: true, investedSol: p.probeSol, lastAddPrice: 0 });
            probes.add(best);
            const bt = tapes.get(best);
            if (bt !== undefined) bt.done = true;
            free -= probeLamports + tx;
          }
        }
      }
      return orders;
    },

    onDone(state: BotState): void {
      console.error(
        `[fresh-burst-sniper] done: batches=${state.seq + 1} fills=${myFills} coins=${myCoins.size} cash=${state.cash} open=${state.positions.size}`,
      );
    },
  };
}
