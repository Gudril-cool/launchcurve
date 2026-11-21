// LaunchCurve: a power-law token launch radar.
//
// The idea, in one paragraph. Plot every protocol whose token already trades on
// log-log axes — TVL on x, market cap (the snapshot's FDV proxy) on y — and the
// cloud of points follows a curve, not a multiple: value grows slower than TVL.
// LaunchCurve fits that curve to the snapshot's own peers with ordinary least
// squares in log space, log10(FDV) = a + b·log10(TVL), closed-form and fully
// deterministic. Each category then earns a small offset: the median residual
// of its peers (actual minus curve, in log10), shrunk toward zero by peer count
// so a category with two lucky peers cannot bend the curve, and clamped to
// ±0.6 log10. A protocol that records no token is priced by reading its TVL off
// the shifted curve, then three modest adjustments from its own record: 7-day
// TVL momentum, survival time with no token, and chain breadth.
//
//   implied = round( 10^(a + b·log10(TVL) + categoryOffset)
//                    x momentumFactor(change_7d)
//                    x survivalFactor(age_days)
//                    x breadthFactor(chains) )
//
// Honesty rules the dashboard repeats: a protocol here "records no token" in
// the snapshot — DefiLlama's record, not proof no token exists anywhere. The
// implied value is this model's claim about what a launch could be worth if
// the record held, never a prediction that a token will be issued. The fit is
// honest about its own weakness, too: the dashboard prints a, b, R² and the
// peer count, so a reader can see exactly how much of the variance the curve
// explains and how much it does not.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted power law plus the diagnostics a reader needs to judge it. */
export interface CurveFit {
  /** Intercept a in log10(FDV) = a + b·log10(TVL). */
  a: number;
  /** Slope b: the elasticity of value with respect to TVL. */
  b: number;
  /** Share of log-space variance the curve explains. */
  r_squared: number;
  /** Protocols carrying an mcap figure at all. */
  peers_with_mcap: number;
  /** Peers usable in log space (positive mcap and positive TVL). */
  peer_count: number;
}

/** One category's offset: its peers' median residual, shrunk and clamped. */
export interface CategoryOffset {
  category: string;
  peers: number;
  median_residual: number;
  offset: number;
}

/** The model's constants, stated in the dashboard so a reader can re-derive any row. */
export interface ModelConstants {
  /** Peers a category needs before its residual outweighs the pull to zero. */
  shrinkage_peers: number;
  /** Category offsets are clamped into ± this many log10 units. */
  offset_clamp: number;
  /** Momentum: factor = 1 + clamp(change_7d, floor, cap) / 100 x weight. */
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  /** Survival: factor = base + span x min(age, days) / days. */
  survival_base: number;
  survival_span: number;
  survival_days: number;
  unknown_age_days: number;
  /** Breadth: factor = 1 + per_extra_chain x min(chains - 1, max_extra). */
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  shrinkage_peers: 6,
  offset_clamp: 0.6,
  momentum_weight: 0.3,
  momentum_floor_pct: -40,
  momentum_cap_pct: 80,
  survival_base: 0.8,
  survival_span: 0.35,
  survival_days: 1825,
  unknown_age_days: 365,
  breadth_per_chain: 0.025,
  breadth_max_extra: 8,
};

/** The model's version label, named in the dashboard and in every board row. */
export const MODEL_VERSION = 'launchcurve-1';

/** How many already-trading protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 36;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'records-no-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    version: string;
    curve_value_usd: number;
    category_offset: number;
    category_peers: number;
    momentum_factor: number;
    survival_factor: number;
    breadth_factor: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  curve_value_usd: number;
  category_offset: number;
  category_peers: number;
  momentum_factor: number;
  survival_factor: number;
  breadth_factor: number;
  farm_steps: string[];
}

/** A protocol whose token already trades: shown with the market's number, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Everything data.js carries for the dashboard. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: CurveFit;
  protocol_count: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  offsets: CategoryOffset[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from listed_at to the snapshot's as_of; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty numeric list (the list is sorted in place). */
function median(values: number[]): number {
  const s = values.sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A protocol records no token when all three token fields are null in the snapshot. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Categories that are not launches-in-waiting but products of an asset that
 * already trades: a bridge's wrapped inventory, a staking wrapper of ETH, a
 * restaked BTC. The snapshot carries no parentProtocol field, so — exactly as
 * the watchlist's own rule does with the fields it has — the category, plus
 * two name tests, stands in for it: a name carrying the whole word wrapped,
 * staked or staking, or opening with an exchange's name (Binance, Coinbase,
 * Bybit, Kraken, Bitget, OKX, Bitfinex or Gemini). WBTC, Binance staked ETH
 * and their kin are set aside by this rule, not ranked: their "token" exists;
 * it is someone else's.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isProductOfLiveToken(p: SnapshotProtocol): boolean {
  return (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name);
}

/** Whether a pre-token protocol may be ranked: not a versioned pool, not a product of a live token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !VERSIONED.test(p.name) && !isProductOfLiveToken(p);
}

/** The fitted curve and the per-category offsets, derived once from the snapshot's peers. */
export interface CurveTable {
  fit: CurveFit;
  by_category: Map<string, CategoryOffset>;
}

/**
 * Fit the power law. Peers are protocols with a recorded market cap and
 * positive TVL; log space also needs a positive cap, and the snapshot carries
 * a handful of zero or negative caps (dead or mis-recorded tokens), which are
 * counted in peers_with_mcap but excluded from the fit — a log of zero would
 * poison the line, and pretending otherwise would be worse. The regression is
 * the textbook closed form: b = Cov(x, y) / Var(x), a = ȳ − b·x̄, over
 * x = log10(TVL), y = log10(mcap). Residuals then give each category its
 * median miss; the offset applied is that median scaled by n / (n + shrinkage)
 * and clamped, so thin categories stay near the global curve.
 */
export function fitCurve(snapshot: Snapshot, model: ModelConstants = MODEL): CurveTable {
  const peers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const usable = peers.filter((p) => p.mcap_usd! > 0);
  const xs = usable.map((p) => Math.log10(p.tvl_usd));
  const ys = usable.map((p) => Math.log10(p.mcap_usd!));
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varX = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i]! - meanX) * (ys[i]! - meanY);
    varX += (xs[i]! - meanX) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  }
  const b = varX > 0 ? cov / varX : 0;
  const a = meanY - b * meanX;
  let ssRes = 0;
  const residualsByCategory = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const predicted = a + b * xs[i]!;
    const residual = ys[i]! - predicted;
    ssRes += residual ** 2;
    const key = usable[i]!.category ?? 'Uncategorized';
    const list = residualsByCategory.get(key);
    if (list === undefined) residualsByCategory.set(key, [residual]);
    else list.push(residual);
  }
  const fit: CurveFit = {
    a: round4(a),
    b: round4(b),
    r_squared: ssTot > 0 ? round4(1 - ssRes / ssTot) : 0,
    peers_with_mcap: peers.length,
    peer_count: n,
  };
  const byCategory = new Map<string, CategoryOffset>();
  for (const [category, residuals] of residualsByCategory) {
    const med = median(residuals);
    const count = residuals.length;
    const shrunk = med * (count / (count + model.shrinkage_peers));
    byCategory.set(category, {
      category,
      peers: count,
      median_residual: round4(med),
      offset: round4(clamp(shrunk, -model.offset_clamp, model.offset_clamp)),
    });
  }
  return { fit, by_category: byCategory };
}

/** The offset one protocol is valued with: its category's, or zero when it has no peers. */
export function offsetFor(p: SnapshotProtocol, curve: CurveTable): CategoryOffset {
  const stat = curve.by_category.get(p.category ?? 'Uncategorized');
  if (stat !== undefined) return stat;
  return { category: p.category ?? 'Uncategorized', peers: 0, median_residual: 0, offset: 0 };
}

/** The curve reading, the three adjustment factors and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  curve: CurveTable,
  model: ModelConstants = MODEL,
): { implied: number; curveValue: number; stat: CategoryOffset; momentum: number; survival: number; breadth: number; age: number | null } {
  const stat = offsetFor(p, curve);
  const age = ageDays(asOf, p.listed_at);
  const curveValue = Math.pow(10, curve.fit.a + curve.fit.b * Math.log10(Math.max(1, p.tvl_usd)) + stat.offset);
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, model.momentum_floor_pct, model.momentum_cap_pct);
  const momentum = 1 + (growth / 100) * model.momentum_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const survival = model.survival_base + (clamp(ageForModel, 0, model.survival_days) / model.survival_days) * model.survival_span;
  const breadth = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra);
  const implied = Math.max(1, Math.round(curveValue * momentum * survival * breadth));
  return { implied, curveValue, stat, momentum, survival, breadth, age };
}

// ------------------------------------------------------------------ farm plans
//
// Every plan runs on a cadence, because that is how farming actually happens:
// a setup window, a position window, a deepening window, then a weekly rhythm
// until the hold ends. Each step opens with its cadence — "Days 1–3:",
// "Days 4–10:", "Days 11–20:", "Weekly:", "Days 21–45:" — and weaves the
// capital, the gas and the minutes into the sentence itself. The playbook is
// picked by the protocol's category, the chain by its own chain list, the
// stake by its TVL and the hold by its age. No name is looked up anywhere.

/** The chain a plan farms on: the first that is not Ethereum when one exists, else the first. */
function farmChain(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its main chain';
  return p.chains.find((c) => c.toLowerCase() !== 'ethereum') ?? p.chains[0]!;
}

/** Gas reality, in words, for the chain the plan actually uses. */
function gasWords(p: SnapshotProtocol): string {
  const chain = farmChain(p).toLowerCase();
  if (chain === 'ethereum') return 'mainnet gas of roughly $12–25 for the setup transactions and $6–10 a week after';
  if (chain.includes('solana')) return 'Solana fees under $1 for the whole setup and under $1 a week after';
  return 'gas of roughly $1–4 for the setup transactions and $1–2 a week after';
}

/** The weekly gas figure, in words, matching the chain gasWords quotes for setup. */
function weeklyGasWords(p: SnapshotProtocol): string {
  const chain = farmChain(p).toLowerCase();
  if (chain === 'ethereum') return '$6–10 of gas a week';
  if (chain.includes('solana')) return 'under $1 of fees a week';
  return '$1–2 of gas a week';
}

/** A sensible starter position from the protocol's own scale. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** The hold a plan asks for: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

type Playbook = { open: string; deepen: string; weekly: string };

/** The category's playbook: the opening position, the deepening move, the weekly rhythm. */
function playbookFor(p: SnapshotProtocol, capital: number, chain: string): Playbook {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return {
      open: `supply $${capital} of USDC to ${n} on ${chain} as collateral, borrow back about 40% against it and re-supply that borrow once — one careful loop, never a leverage stack`,
      deepen: `repay roughly $25 of the borrow and borrow it again on a different day, so the record shows both sides of the market worked more than once`,
      weekly: `check the health factor, top up collateral if it drifts toward liquidation, and claim whatever supply rewards the dashboard shows`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return {
      open: `swap $${Math.round(capital / 2)} of USDC into the pool's second asset on ${chain} and add $${capital} of paired liquidity to ${n}'s highest-volume stable or majors pool`,
      deepen: `route two small swaps of about $25 each through ${n}'s own interface on separate days — native-interface volume is what most points programs count`,
      weekly: `collect the week's fees, nudge the position back into range if it drifted, and leave the LP shares untouched in the farming wallet`,
    };
  }
  if (c.includes('bridge') || c.includes('canonical') || c.includes('cross chain')) {
    return {
      open: `bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then park the bridged funds in a lending or yield app on the destination chain instead of bridging straight back`,
      deepen: `bridge a second, smaller amount of about $50 over a different route or to a second destination ${n} supports, a full week after the first crossing`,
      weekly: `make one small genuine transaction on the destination chain — a swap, a claim, a top-up — so the wallet reads as a resident, not a pass-through`,
    };
  }
  if (c.includes('staking') || c.includes('restaking')) {
    return {
      open: `stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the liquid receipt token in the same wallet, unsold and unwrapped`,
      deepen: `allocate the receipt to one operator or vault inside ${n} if it offers the choice, taking the default rather than chasing the highest advertised rate`,
      weekly: `claim staking rewards once they pass about $5 and re-stake them, so the balance history shows compounding rather than a one-off deposit`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('basis')) {
    return {
      open: `deposit $${capital} of USDC into ${n} on ${chain}; hold vault shares if it is a vault product, or run one small hedged pair — long spot against an equal short perp — if it is a trading venue`,
      deepen: `open and close one extra small trade of about $25 margin on a later day, keeping the book hedged, so the account carries real trading history`,
      weekly: `rebalance the hedge whenever the two legs drift more than 5% apart, and withdraw nothing until the hold below is complete`,
    };
  }
  if (c.includes('prediction')) {
    return {
      open: `fund $${capital} on ${n} and take positions in three liquid markets you can genuinely follow, sizing each near $${Math.max(10, Math.round(capital / 5))} so no single outcome decides the farm`,
      deepen: `rest one limit order for at least a day, or add a small slice of liquidity to one market's book if ${n} supports it`,
      weekly: `trade at least one market and let resolved markets settle — settled history is the activity record that counts`,
    };
  }
  if (c.includes('rwa')) {
    return {
      open: `finish ${n}'s onboarding or KYC if it asks, then mint $${capital} of its tokenized asset on ${chain} and hold it in the farming wallet`,
      deepen: `run one round trip of about $25 — a partial redemption, a week of holding, then a re-mint — so the wallet shows the product's full flow`,
      weekly: `collect each yield distribution as it lands and keep the position whole; RWA farms pay for duration, not transaction count`,
    };
  }
  if (c.includes('launchpad')) {
    return {
      open: `register the wallet on ${n}, clear any allowlist or staking requirement it publishes, and commit $${capital} across the next two sales it runs on ${chain}`,
      deepen: `claim whatever the first sale distributes and hold it at least two weeks instead of selling into the first day's book`,
      weekly: `check the sale calendar and enter each new sale's registration window, even at the minimum, to build an unbroken participation streak`,
    };
  }
  if (c.includes('stable') || c.includes('algo')) {
    return {
      open: `mint or buy $${capital} of ${n}'s stable asset on ${chain} and deposit it into the protocol's own savings or staking vault, where the balance is visible and earning`,
      deepen: `make one $25 round trip — mint, hold a week, redeem — so the wallet shows both directions of the product's core flow`,
      weekly: `top up about $10 or claim the savings yield, keeping the vault balance continuously non-zero across every weekly snapshot`,
    };
  }
  if (c.includes('chain')) {
    return {
      open: `bridge $${capital} of USDC onto ${n}'s chain and spread it across three native apps: a lending market, a DEX pool and one more protocol the chain itself features`,
      deepen: `pay gas in the chain's native token and make the wallet's early transactions native-app transactions, never transfers between your own wallets`,
      weekly: `make two or three genuine transactions across different native apps, so the wallet builds a varied on-chain history`,
    };
  }
  // Yield, Yield Aggregator, Farm, Risk Curators, Onchain Capital Allocator and the rest.
  return {
    open: `deposit $${capital} of USDC into ${n}'s main vault or strategy on ${chain} and keep the shares in the farming wallet for the whole hold`,
    deepen: `withdraw about 10% and re-deposit it on a different day, so the wallet shows a full deposit–withdraw–deposit cycle without churning`,
    weekly: `claim or compound the vault's rewards and note the share price in your farm log, proof the position stayed live`,
  };
}

/** Trim a step into the gate's 20–600 character window without cutting a word in half. */
function fitStep(s: string): string {
  if (s.length <= 600) return s;
  const cut = s.slice(0, 596);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/**
 * One protocol's farm plan: seven cadence steps derived from its category,
 * chains, TVL and age. The same code writes every plan; nothing is per-name.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = farmChain(p);
  const gas = gasWords(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const play = playbookFor(p, capital, chain);
  return [
    fitStep(`Days 1–3: Set up a fresh wallet for ${p.name} alone, fund it in one transfer from your main wallet and write the seed phrase down offline. Budget 10 minutes and one funding transfer of about $2 in gas; never farm from the wallet that holds your savings.`),
    fitStep(`Days 4–10: Open the position — ${play.open}. Budget the $${capital} of capital plus ${gas}, and about 20 minutes at the keyboard.`),
    fitStep(`Days 11–20: Deepen it — ${play.deepen}. Budget about $25 of capital moved, $1–6 of gas and 15 minutes, once in this window.`),
    fitStep(`Weekly: Keep the rhythm — ${play.weekly}. Budget ${weeklyGasWords(p)} and 10 minutes a week, every week of the hold.`),
    fitStep(`Weekly: Log the farm as you go — wallet address, dates, transaction hashes, capital in and out for ${p.name} — and register the wallet wherever ${p.name} publishes its own points, rewards or governance page. Budget 5 minutes a week; claim only through links on the protocol's own page.`),
    fitStep(`Days 21–${hold}: Hold the position for at least ${hold} days with no full withdrawal, so the activity spans several weekly snapshots. The cost is the $${capital} staying deployed — the yield it would earn elsewhere — and nothing else.`),
    fitStep(`After day ${hold}: Exit in two tranches a week apart rather than one full withdrawal, keep the farm log as your proof of work if a distribution ever asks, and only then sweep what remains back to your main wallet. Budget 15 minutes and two exit transactions of gas.`),
  ];
}

// ------------------------------------------------------------------ the board

/** The board: every watchlist slug, plus every other rankable pre-token protocol the snapshot holds. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const curve = fitCurve(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => ({ p, ...impliedValue(p, snapshot.as_of, curve, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'records-no-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      version: MODEL_VERSION,
      curve_value_usd: Math.round(s.curveValue),
      category_offset: s.stat.offset,
      category_peers: s.stat.peers,
      momentum_factor: round4(s.momentum),
      survival_factor: round4(s.survival),
      breadth_factor: round4(s.breadth),
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The already-trading protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, derived from the same board main.ts writes. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const curve = fitCurve(snapshot, model);
  const live = liveRows(snapshot);
  const offsets = [...curve.by_category.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit: curve.fit,
    protocol_count: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    offsets,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      curve_value_usd: r.model.curve_value_usd,
      category_offset: r.model.category_offset,
      category_peers: r.model.category_peers,
      momentum_factor: r.model.momentum_factor,
      survival_factor: r.model.survival_factor,
      breadth_factor: r.model.breadth_factor,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board checks. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const outside = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  if (outside < 60) return `only ${outside} rows sit outside the watchlist, under the 60 the gate implies`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value: not a ranking';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script — no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.CURVE=${JSON.stringify(radar)};\n`;
}
