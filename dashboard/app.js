// LaunchCurve's dashboard. Everything it renders comes from window.CURVE, the
// data.js that main.ts writes beside this page from the same board it writes
// to board.json — so the page and the board file cannot drift apart. No fetch,
// no network.
//
// What a reader gets: a log-log scatter "valuation map" of the whole board
// with the fitted power law drawn across it, the ranked board itself, a
// per-protocol detail view that re-derives the row's implied value line by
// line from the fit, the farm plan board.json carries for that protocol, and
// a separate view of the protocols whose tokens already trade — the peers
// the curve was fitted on.
(function () {
  'use strict';

  var DATA = window.CURVE;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', wl: false, tab: 'radar', selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    if (days >= 30) return Math.round(days / 30) + ' mo';
    return Math.max(0, Math.round(days)) + ' d';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model, recomputed in the page from the row's own figures and the fit.
  // The detail view compares this against the value board.json carries; they
  // agree to display rounding, because data.js and board.json are one board.
  function curveBase(r) {
    return Math.pow(10, DATA.fit.a + DATA.fit.b * Math.log10(Math.max(1, r.tvl_usd)));
  }
  function impliedOf(r) {
    return Math.max(1, Math.round(curveBase(r) * Math.pow(10, r.category_offset) * r.momentum_factor * r.survival_factor * r.breadth_factor));
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('wl') === '1') state.wl = true;
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.wl) p.set('wl', '1');
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.selected) p.set('p', state.selected);
    var h = p.toString();
    history.replaceState(null, '', h ? '#' + h : window.location.pathname);
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
  }

  // ---- the scatter valuation map -------------------------------------------
  // x = log10(TVL), y = log10(value). Board rows are dots (vermilion when on
  // the watchlist), the fitted peers from the Live view are hollow squares at
  // their market caps, and the dashed line is the fitted power law itself.
  function scatterSvg() {
    var W = 920, H = 400, L = 64, R = 16, T = 12, B = 40;
    var xs = [], ys = [];
    DATA.rows.forEach(function (r) { xs.push(Math.log10(Math.max(1, r.tvl_usd))); ys.push(Math.log10(Math.max(1, r.implied_value_usd))); });
    DATA.live.forEach(function (r) { if (r.mcap_usd > 0 && r.tvl_usd > 0) { xs.push(Math.log10(r.tvl_usd)); ys.push(Math.log10(r.mcap_usd)); } });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function X(v) { return L + (v - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return T + (y1 - v) / (y1 - y0) * (H - T - B); }
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log scatter of TVL against implied value, with the fitted power law">';
    for (var gx = x0; gx <= x1; gx++) {
      s += '<line class="grid" x1="' + X(gx) + '" y1="' + T + '" x2="' + X(gx) + '" y2="' + (H - B) + '"/>';
      s += '<text class="axis-label" x="' + X(gx) + '" y="' + (H - B + 18) + '" text-anchor="middle">' + fmtUsd(Math.pow(10, gx)) + '</text>';
    }
    for (var gy = y0; gy <= y1; gy++) {
      s += '<line class="grid" x1="' + L + '" y1="' + Y(gy) + '" x2="' + (W - R) + '" y2="' + Y(gy) + '"/>';
      s += '<text class="axis-label" x="' + (L - 6) + '" y="' + (Y(gy) + 4) + '" text-anchor="end">' + fmtUsd(Math.pow(10, gy)) + '</text>';
    }
    var ly0 = DATA.fit.a + DATA.fit.b * x0, ly1 = DATA.fit.a + DATA.fit.b * x1;
    function clampY(v) { return Math.max(y0, Math.min(y1, v)); }
    s += '<line class="fit-line" x1="' + X(x0) + '" y1="' + Y(clampY(ly0)) + '" x2="' + X(x1) + '" y2="' + Y(clampY(ly1)) + '"/>';
    DATA.live.forEach(function (r) {
      if (!(r.mcap_usd > 0 && r.tvl_usd > 0)) return;
      s += '<rect class="pt live" data-slug="" x="' + (X(Math.log10(r.tvl_usd)) - 3.5) + '" y="' + (Y(Math.log10(r.mcap_usd)) - 3.5) + '" width="7" height="7"><title>' + esc(r.name) + ' — already trading, mcap ' + fmtUsd(r.mcap_usd) + '</title></rect>';
    });
    DATA.rows.forEach(function (r) {
      s += '<circle class="pt' + (r.watchlist ? ' wl' : '') + '" data-slug="' + esc(r.slug) + '" cx="' + X(Math.log10(Math.max(1, r.tvl_usd))).toFixed(1) + '" cy="' + Y(Math.log10(Math.max(1, r.implied_value_usd))).toFixed(1) + '" r="' + (r.watchlist ? 5 : 3.6) + '"><title>' + esc(r.name) + ' — implied ' + fmtUsd(r.implied_value_usd) + '</title></circle>';
    });
    s += '<text class="axis-label" x="' + (L + (W - L - R) / 2) + '" y="' + (H - 2) + '" text-anchor="middle">TVL (log scale) →</text>';
    s += '</svg>';
    return s;
  }

  function headerHtml() {
    var f = DATA.fit;
    return '<div class="masthead">'
      + '<div class="kicker">Token launch radar · Snapshot of ' + esc(DATA.as_of) + ' · Model ' + esc(DATA.model_version) + '</div>'
      + '<h1>Launch<span class="curve-word">Curve</span></h1>'
      + '<p class="lede">Every protocol that already trades draws one point on a log-log chart of TVL against value. '
      + 'Fit a line through that cloud — <em>log₁₀(FDV) = a + b·log₁₀(TVL)</em> — and a protocol that records no token '
      + 'can be priced by reading its TVL off the curve. That is all this radar does, in the open: the fit, its '
      + 'weakness and every row\u2019s arithmetic are printed below.</p>'
      + '<div class="fitline">'
      + '<span>Intercept <b>a = ' + f.a.toFixed(4) + '</b></span>'
      + '<span>Slope <b>b = ' + f.b.toFixed(4) + '</b></span>'
      + '<span><b>R² = ' + f.r_squared.toFixed(3) + '</b></span>'
      + '<span>Fitted on <b>' + f.peer_count + '</b> peers with a positive cap (of ' + f.peers_with_mcap + ' carrying one)</span>'
      + '<span class="warn">R² is low: TVL alone explains only part of value — treat each row as a claim to inspect, not an answer.</span>'
      + '</div></div>';
  }

  function controlsHtml(count) {
    var cats = categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    return '<div class="controls">'
      + '<div class="tabs" role="tablist">'
      + '<button role="tab" data-tab="radar" aria-selected="' + (state.tab === 'radar') + '">Radar board</button>'
      + '<button role="tab" data-tab="live" aria-selected="' + (state.tab === 'live') + '">Already trading</button>'
      + '</div>'
      + '<input type="search" id="q" placeholder="Search name or slug…" value="' + esc(state.q) + '">'
      + '<select id="cat"><option value="all">All categories</option>' + cats + '</select>'
      + '<label class="wl"><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only (' + DATA.watchlist_size + ')</label>'
      + '</div>'
      + '<p class="count-line">' + count + '</p>';
  }

  function detailHtml(r) {
    var base = curveBase(r);
    var offsetMult = Math.pow(10, r.category_offset);
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    function mrow(label, value) { return '<tr><td>' + label + '</td><td class="num">' + value + '</td></tr>'; }
    return '<section class="detail" id="detail">'
      + '<button class="close-btn" id="close-detail">Close ✕</button>'
      + '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>'
      + '<div class="meta">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ') || 'no chains listed')
      + ' · records no token in the snapshot · listed ' + esc(r.listed_at || 'date unknown') + ' (' + fmtAge(r.age_days) + ' with no token)'
      + ' · TVL ' + fmtUsd(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) + '</div>'
      + '<h3>The arithmetic, line by line</h3>'
      + '<table class="math"><tbody>'
      + mrow('TVL from the snapshot', fmtUsd(r.tvl_usd))
      + mrow('log₁₀(TVL)', Math.log10(Math.max(1, r.tvl_usd)).toFixed(4))
      + mrow('Curve reading: 10^(' + DATA.fit.a.toFixed(4) + ' + ' + DATA.fit.b.toFixed(4) + ' × log₁₀ TVL)', fmtUsd(Math.round(base)))
      + mrow('Category offset ' + (r.category_offset >= 0 ? '+' : '') + r.category_offset.toFixed(4) + ' log₁₀ (×' + offsetMult.toFixed(3) + ', median residual of ' + r.category_peers + ' ' + esc(r.category || 'uncategorized') + ' peers, shrunk toward zero)', fmtUsd(r.curve_value_usd))
      + mrow('× 7-day momentum factor', '×' + r.momentum_factor.toFixed(4))
      + mrow('× survival factor (time with no token)', '×' + r.survival_factor.toFixed(4))
      + mrow('× chain-breadth factor (' + r.chains.length + ' chains)', '×' + r.breadth_factor.toFixed(4))
      + '<tr class="total"><td>Implied value if it launched at this record</td><td class="num">' + fmtUsd(r.implied_value_usd) + '</td></tr>'
      + '</tbody></table>'
      + '<p class="meta">Recomputed in this page from the fit: ' + fmtUsd(impliedOf(r)) + ' — the board\u2019s figure, re-derived. '
      + 'The fit behind it: a = ' + DATA.fit.a.toFixed(4) + ', b = ' + DATA.fit.b.toFixed(4) + ', R² = ' + DATA.fit.r_squared.toFixed(3)
      + ' over ' + DATA.fit.peer_count + ' peers. An implied value is this model\u2019s claim, never a prediction that a token will be issued.</p>'
      + '<h3>The farm plan, on its cadence</h3>'
      + '<ol class="farm">' + steps + '</ol>'
      + '</section>';
  }

  function boardHtml(rows) {
    var body = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>'
        + '<td class="rank">' + r.rank + '</td>'
        + '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="badge">WL</span>' : '') + '<span class="slug">' + esc(r.slug) + '</span></td>'
        + '<td class="hide-m">' + esc(r.category || '—') + '</td>'
        + '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>'
        + '<td class="num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '') + '">' + fmtPct(r.change_7d) + '</td>'
        + '<td class="num hide-m">' + fmtUsd(r.curve_value_usd) + '</td>'
        + '<td class="num hide-m">' + (r.category_offset >= 0 ? '+' : '') + r.category_offset.toFixed(3) + '</td>'
        + '<td class="num implied">' + fmtUsd(r.implied_value_usd) + '</td>'
        + '<td class="chains hide-m">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>'
        + '</tr>';
    }).join('');
    return '<div class="panel"><table><thead><tr>'
      + '<th>#</th><th>Protocol</th><th class="hide-m">Category</th><th class="num">TVL</th><th class="num">7d</th>'
      + '<th class="num hide-m">Curve value</th><th class="num hide-m">Offset</th><th class="num">Implied</th><th class="hide-m">Chains</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function liveHtml() {
    var body = DATA.live.map(function (r) {
      return '<tr><td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>'
        + '<td class="hide-m">' + esc(r.category || '—') + '</td>'
        + '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>'
        + '<td class="num implied">' + fmtUsd(r.mcap_usd) + '</td>'
        + '<td class="num hide-m">' + (r.ratio === null ? 'n/a' : '×' + r.ratio.toFixed(3)) + '</td>'
        + '<td class="num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '') + '">' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
    return '<p class="count-line">The peers the curve was fitted on — the largest ' + DATA.live.length + ' by market cap of '
      + DATA.fit.peer_count + ' usable peers. These tokens already trade; the market\u2019s number is shown, never the model\u2019s.</p>'
      + '<div class="panel"><table><thead><tr><th>Protocol</th><th class="hide-m">Category</th><th class="num">TVL</th>'
      + '<th class="num">Market cap</th><th class="num hide-m">FDV/TVL</th><th class="num">7d</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function footHtml() {
    return '<div class="foot"><b>How to read this sheet.</b> The board ranks ' + DATA.board_size + ' protocols that record no token — '
      + 'all ' + DATA.watchlist_size + ' on the snapshot\u2019s watchlist plus ' + DATA.early_size + ' earlier finds below its '
      + fmtUsd(DATA.floor_usd) + ' floor. Wrapped, staked and bridged products of tokens that already trade are set aside, not ranked: '
      + 'they record no token of their own. “Records no token” is DefiLlama\u2019s record in the sealed snapshot of ' + esc(DATA.as_of)
      + ', not proof none exists. Every farm plan runs on a cadence — setup days, position days, a weekly rhythm — with its capital, '
      + 'gas and minutes written into the steps. Source: ' + esc(DATA.source) + '.</div>';
  }

  function render() {
    var rows = filtered();
    var selected = state.selected ? DATA.rows.find(function (r) { return r.slug === state.selected; }) : null;
    var html = headerHtml();
    if (state.tab === 'radar') {
      html += controlsHtml('Showing ' + rows.length + ' of ' + DATA.board_size + ' ranked protocols'
        + (state.category !== 'all' ? ' in ' + state.category : '') + (state.wl ? ', watchlist only' : '') + '. Click any point or row for its arithmetic.');
      html += '<div class="chart-wrap"><h2>The valuation map</h2>'
        + '<p class="sub">Each dot is a board protocol: TVL across, implied value up, both log-scaled. The dashed line is the fitted power law; hollow squares are peers that already trade, at their market caps.</p>'
        + scatterSvg()
        + '<div class="legend"><span><span class="sw wl"></span>Watchlist protocol</span><span><span class="sw"></span>Early find below the floor</span>'
        + '<span><span class="sw live"></span>Already trading (peer)</span><span><span class="sw line"></span>Fitted power law</span></div></div>';
      if (selected) html += detailHtml(selected);
      html += '<div id="table-anchor">' + boardHtml(rows) + '</div>';
    } else {
      html += controlsHtml('The fitted peers, largest first.');
      if (selected) html += detailHtml(selected);
      html += liveHtml();
    }
    html += footHtml();
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
    bind();
  }

  function bind() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; writeHash(); renderTableOnly(); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var wl = document.getElementById('wl');
    if (wl) wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); render(); });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); writeHash(); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        var slug = tr.getAttribute('data-slug');
        if (slug) { state.selected = slug; writeHash(); render(); scrollToDetail(); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('svg .pt[data-slug]'), function (pt) {
      pt.addEventListener('click', function () {
        var slug = pt.getAttribute('data-slug');
        if (slug) { state.selected = slug; writeHash(); render(); scrollToDetail(); }
      });
    });
    var close = document.getElementById('close-detail');
    if (close) close.addEventListener('click', function () { state.selected = null; writeHash(); render(); });
  }

  // Typing in the search box re-renders only the table, so the box keeps focus.
  function renderTableOnly() {
    var anchor = document.getElementById('table-anchor');
    if (!anchor || state.tab !== 'radar') { render(); return; }
    var rows = filtered();
    anchor.innerHTML = boardHtml(rows);
    var count = document.querySelector('.count-line');
    if (count) count.textContent = 'Showing ' + rows.length + ' of ' + DATA.board_size + ' ranked protocols. Click any point or row for its arithmetic.';
    Array.prototype.forEach.call(anchor.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        var slug = tr.getAttribute('data-slug');
        if (slug) { state.selected = slug; writeHash(); render(); scrollToDetail(); }
      });
    });
    var q = document.getElementById('q');
    if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  function scrollToDetail() {
    var d = document.getElementById('detail');
    if (d) d.scrollIntoView({ block: 'start' });
  }

  readHash();
  render();
})();
