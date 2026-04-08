(function() {
  'use strict';

  const DATA    = 'https://data-api.polymarket.com';
  const GAMMA   = 'https://gamma-api.polymarket.com';
  const P       = 'https://florida.shaunpatrickstewart.workers.dev/?url=';
  const REFRESH = 30000;

  const TAB_DESCS = {
    week:  'Uncertain markets resolving this week — all categories, volume &gt;$20K. Best short-term plays.',
    day48: 'Closing within 48 hours — sports, politics, news, crypto. Fast in-and-out trades.',
    swing: '7 to 30-day holds — high-volume uncertain markets worth sitting on for larger gains.',
    forex: 'Currency &amp; financial prediction markets — dollar, gold, crypto prices, exchange rates.',
  };

  // ── Tab switching
  window.pmSwitchTab = function(pane, btn) {
    document.querySelectorAll('#pm-root .tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('#pm-root .tab').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + pane).classList.add('active');
    btn.classList.add('active');
    const countEl = document.getElementById('pm-count-' + pane);
    if (countEl) document.getElementById('scanner-count').textContent = countEl.textContent;
    document.getElementById('pm-tab-desc').innerHTML = TAB_DESCS[pane] || '';
  };

  // ── Keyboard shortcut
  document.addEventListener('keydown', e => {
    if (e.key === 'r' || e.key === 'R') {
      if (document.activeElement.tagName === 'INPUT') return;
      refresh();
    }
  });

  // ── Proxy fetch
  async function pf(url) {
    const r = await fetch(P + encodeURIComponent(url));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function toArr(r) {
    if (Array.isArray(r))              return r;
    if (r && Array.isArray(r.data))    return r.data;
    if (r && Array.isArray(r.results)) return r.results;
    return [];
  }

  // ── Formatting
  function fmt(n) {
    n = parseFloat(n) || 0;
    if (Math.abs(n) >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
    return '$' + Math.abs(n).toFixed(0);
  }
  function days(s)  { return !s ? 9999 : Math.ceil((new Date(s)-new Date())/86400000) }
  function hours(s) { return !s ? 9999 : Math.ceil((new Date(s)-new Date())/3600000) }

  function timeLabel(m) {
    const h = hours(m.endDateIso||m.endDate), d = days(m.endDateIso||m.endDate);
    if (h<=0)  return '<span style="color:#ff4455">EXPIRED</span>';
    if (h<=24) return '<span style="color:#ff4455">' +h+ 'h</span>';
    if (d<=3)  return '<span style="color:#ffcc44">' +d+ 'd</span>';
    if (d<=7)  return '<span style="color:#ccaa44">' +d+ 'd</span>';
    return '<span style="color:#2a2a2a">' +d+ 'd</span>';
  }

  function pctColor(p) {
    if (p>=0.5) return '#00ff88';
    if (p>=0.35) return '#ffcc44';
    return '#88aaff';
  }

  function getBest(m) {
    let pr=[], oc=[];
    try { pr = JSON.parse(m.outcomePrices||'[]').map(Number) } catch(e){}
    try { oc = JSON.parse(m.outcomes||'["Yes","No"]') }        catch(e){}
    let bi=0, bd=1;
    pr.forEach((p,i)=>{ const d=Math.abs(p-.5); if(p>=.05&&p<=.95&&d<bd){bd=d;bi=i;} });
    return { price: pr[bi]||0, outcome: (oc[bi]||'Yes').toUpperCase() };
  }

  function getHighConf(m) {
    let pr=[], oc=[];
    try { pr = JSON.parse(m.outcomePrices||'[]').map(Number) } catch(e){}
    try { oc = JSON.parse(m.outcomes||'["Yes","No"]') }        catch(e){}
    for (let i=0; i<pr.length; i++) {
      if (pr[i]>=0.82 && pr[i]<=0.97) return { price: pr[i], outcome: (oc[i]||'Yes').toUpperCase() };
    }
    return null;
  }

  const FOREX_RE = /\b(usd|eur|gbp|jpy|cny|cad|aud|nzd|chf|mxn|brl|inr|krw|dollar|euro|pound|yen|yuan|franc|peso|rupee|ruble|won|exchange.?rate|forex|currency|devaluat|xau|gold.price|silver.price|oil.price|bitcoin|ethereum|btc|eth|crypto.price|\busd\/|\beur\/|\bgbp\/|\/usd\b|\/eur\b)/i;

  // ── DATA FETCHERS
  async function fetchAllWallets() {
    const [all, month, week] = await Promise.all([
      pf(DATA+'/v1/leaderboard?timePeriod=ALL&orderBy=PNL&limit=50'),
      pf(DATA+'/v1/leaderboard?timePeriod=month&orderBy=PNL&limit=50'),
      pf(DATA+'/v1/leaderboard?timePeriod=week&orderBy=PNL&limit=50'),
    ]);
    const map = new Map();
    [...toArr(all),...toArr(month),...toArr(week)].forEach(w=>{
      const key = w.proxyWallet||w.address||w.userName; if(!key) return;
      const ex = map.get(key);
      if (!ex || parseFloat(w.pnl||0)>parseFloat(ex.pnl||0)) map.set(key,w);
    });
    return [...map.values()].sort((a,b)=>{
      const ra = parseFloat(a.vol||0)>0 ? parseFloat(a.pnl||0)/parseFloat(a.vol||0) : 0;
      const rb = parseFloat(b.vol||0)>0 ? parseFloat(b.pnl||0)/parseFloat(b.vol||0) : 0;
      return rb-ra;
    });
  }

  async function fetchAllMarkets() {
    return toArr(await pf(GAMMA+'/markets?active=true&closed=false&limit=500&order=volume&ascending=false'));
  }

  async function fetchForex() {
    const [fx,curr] = await Promise.all([
      pf(GAMMA+'/markets?active=true&closed=false&tag=forex&limit=200').then(toArr).catch(()=>[]),
      pf(GAMMA+'/markets?active=true&closed=false&tag=currencies&limit=200').then(toArr).catch(()=>[]),
    ]);
    const map = new Map();
    [...fx,...curr].forEach(m=>{ if(m.id) map.set(m.id,m); });
    return [...map.values()]
      .filter(m=>FOREX_RE.test(m.question||m.title||m.slug||''))
      .sort((a,b)=>parseFloat(b.volumeNum||0)-parseFloat(a.volumeNum||0));
  }

  async function fetchPositions(addr) {
    try {
      return toArr(await pf(DATA+'/positions?user='+addr+'&sizeThreshold=0&sortBy=CASHPNL&sortDirection=DESC&limit=8'));
    } catch(e) { return []; }
  }

  // ── RENDER: Header stats
  function renderHeaderStats(wallets, allMarkets) {
    const totalPnl = wallets.reduce((s,w)=>s+parseFloat(w.pnl||0),0);
    const topPnl   = parseFloat(wallets[0]?.pnl||0);
    const uncertain = allMarkets.filter(m=>{
      let p=[]; try{p=JSON.parse(m.outcomePrices||'[]').map(Number)}catch(e){}
      return p.some(v=>v>=0.25&&v<=0.75) && parseFloat(m.volumeNum||0)>25000;
    }).length;
    document.getElementById('hdr-stats').innerHTML = [
      ['Wallets',        wallets.length],
      ['Combined PnL',   '<span class="green">'+fmt(totalPnl)+'</span>'],
      ['Top Wallet',     '<span class="green">'+fmt(topPnl)+'</span>'],
      ['Active Markets', allMarkets.length],
      ['Uncertain Plays','<span class="yellow">'+uncertain+'</span>'],
    ].map(([l,v])=>'<div class="stat"><div class="val">'+v+'</div><div class="lbl">'+l+'</div></div>').join('');
  }

  // ── RENDER: Copy Signals (walletPositions = [{w, pos}] pre-fetched)
  function renderSignals(walletPositions) {
    let signals=[];
    walletPositions.forEach(({w,pos})=>{
      const addr = w.proxyWallet||w.address||'';
      const name = (w.userName||addr.slice(0,10)||'anon').slice(0,20);
      const walletPnl = parseFloat(w.pnl||0);
      const walletRoi = parseFloat(w.vol||0)>0 ? (walletPnl/parseFloat(w.vol))*100 : 0;
      pos.filter(p=>{
        const pr=parseFloat(p.curPrice||p.price||0);
        return pr>=0.20&&pr<=0.80;
      }).slice(0,2).forEach(p=>{
        const pr  = parseFloat(p.curPrice||p.price||0);
        const oc  = (p.outcome||'').toUpperCase();
        const pEv = parseFloat(w.winRate||50)/100;
        const ev  = pEv*(1-pr)-(1-pEv)*pr;
        signals.push({ name, walletPnl, walletRoi, title:p.title||'', outcome:oc, price:pr, cashPnl:parseFloat(p.cashPnl||0), ev, addr });
      });
    });

    signals.sort((a,b)=>Math.abs(a.price-.5)-Math.abs(b.price-.5));
    document.getElementById('sig-count').textContent = '('+signals.length+')';

    if (!signals.length) {
      document.getElementById('pm-signals').innerHTML='<div class="empty">No uncertain positions on top wallets right now — market conditions change fast, check back soon.</div>';
      return;
    }

    const html = signals.slice(0,18).map(s=>{
      const cls  = s.outcome==='YES' ? 'by' : 'bn';
      const unc  = (0.5-Math.abs(s.price-0.5))/0.5*100;
      const uncW = Math.round(unc*0.7)+10;
      const evH  = s.ev>=0
        ? '<span class="ev-pos">EV+'+s.ev.toFixed(3)+'</span>'
        : '<span class="ev-neg">EV'+s.ev.toFixed(3)+'</span>';
      const roiS = s.walletRoi>=0
        ? '<span class="green">+'+s.walletRoi.toFixed(1)+'% ROI</span>'
        : '<span class="red">'+s.walletRoi.toFixed(1)+'% ROI</span>';
      return (
        '<div class="signal-card">'+
          '<div class="sig-top">'+
            '<div class="sig-title">'+s.title.slice(0,74)+'</div>'+
            '<div style="flex-shrink:0"><span class="badge '+cls+'">BET '+s.outcome+'</span></div>'+
          '</div>'+
          '<div class="sig-meta">'+
            '<span class="blue">'+s.price.toFixed(3)+'</span>'+
            '<span class="unc-wrap">'+
              '<div class="unc-bar-bg"><div class="unc-bar-fill" style="width:'+uncW+'%"></div></div>'+
              '<span style="color:#444">'+Math.round(unc)+'%</span>'+
            '</span>'+
            evH+
            '<span class="dim">▸</span><span class="blue">'+s.name.slice(0,14)+'</span>'+
            roiS+
          '</div>'+
        '</div>'
      );
    }).join('');
    document.getElementById('pm-signals').innerHTML = html;
  }

  // ── RENDER: Market Scanner tables
  function marketTable(markets, limit) {
    if (!markets.length) return '<div class="empty">No markets matching this filter right now.</div>';
    let html = '<table><tr><th>#</th><th>Market</th><th>Side</th><th>Price</th><th class="hm">Volume</th><th>Expires</th></tr>';
    markets.slice(0,limit||25).forEach((m,i)=>{
      const {price,outcome} = getBest(m);
      const cls = outcome==='YES' ? 'by' : 'bn';
      const vol = parseFloat(m.volumeNum||m.volume||0);
      html += '<tr>'+
        '<td class="dim">'+(i+1)+'</td>'+
        '<td style="max-width:260px">'+(m.question||m.title||'').slice(0,62)+'</td>'+
        '<td><span class="badge '+cls+'">'+outcome+'</span></td>'+
        '<td style="color:'+pctColor(price)+'">'+(price*100).toFixed(0)+'%</td>'+
        '<td class="blue hm">'+fmt(vol)+'</td>'+
        '<td>'+timeLabel(m)+'</td>'+
        '</tr>';
    });
    return html+'</table>';
  }

  function renderScanner(allMarkets, forexMarkets) {
    // Prefer endDate (has time component) over endDateIso (date-only, defaults to midnight UTC)
    const ed = m => m.endDate || m.endDateIso || '';

    const week = allMarkets.filter(m=>{
      const h=hours(ed(m)), vol=parseFloat(m.volumeNum||0);
      if(h<0||h>168||vol<1000) return false;
      let p=[]; try{p=JSON.parse(m.outcomePrices||'[]').map(Number)}catch(e){}
      return p.some(v=>v>=0.15&&v<=0.85);
    }).sort((a,b)=>parseFloat(b.volumeNum||0)-parseFloat(a.volumeNum||0));

    const day48 = allMarkets.filter(m=>{
      const h=hours(ed(m)), vol=parseFloat(m.volumeNum||0);
      if(h<0||h>48||vol<500) return false;
      let p=[]; try{p=JSON.parse(m.outcomePrices||'[]').map(Number)}catch(e){}
      return p.some(v=>v>=0.10&&v<=0.90);
    }).sort((a,b)=>parseFloat(b.volumeNum||0)-parseFloat(a.volumeNum||0));

    const swing = allMarkets.filter(m=>{
      const h=hours(ed(m)), vol=parseFloat(m.volumeNum||0);
      if(h<168||h>720||vol<5000) return false;
      let p=[]; try{p=JSON.parse(m.outcomePrices||'[]').map(Number)}catch(e){}
      return p.some(v=>v>=0.15&&v<=0.85);
    }).sort((a,b)=>parseFloat(b.volumeNum||0)-parseFloat(a.volumeNum||0));

    document.getElementById('tab-week').innerHTML  = marketTable(week,20);
    document.getElementById('tab-day48').innerHTML = marketTable(day48,20);
    document.getElementById('tab-swing').innerHTML = marketTable(swing,15);
    document.getElementById('tab-forex').innerHTML = marketTable(forexMarkets,20);

    // Hidden counts for tab header
    const counts = {week:week.length, day48:day48.length, swing:swing.length, forex:forexMarkets.length};
    Object.entries(counts).forEach(([k,n])=>{
      let el = document.getElementById('pm-count-'+k);
      if (!el) {
        el = document.createElement('span');
        el.id = 'pm-count-'+k;
        el.style.display = 'none';
        document.getElementById('tab-'+k).appendChild(el);
      }
      el.textContent = '('+n+')';
    });
    document.getElementById('scanner-count').textContent = '('+week.length+')';
  }

  // ── RENDER: Near-Certain Income
  async function renderPerformance() {
    try {
      const PERF_URL = 'https://shaunpatrickstewart.github.io/trades/paper_trades.jsonl?_='+Date.now();
      const resp = await fetch(P+encodeURIComponent(PERF_URL));
      const text = await resp.text();
      const trades = text.trim().split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);

      const won  = trades.filter(t=>t.status==='WON');
      const lost = trades.filter(t=>t.status==='LOST');
      const open = trades.filter(t=>t.status==='OPEN');
      const settled = won.length + lost.length;
      const winRate = settled > 0 ? (won.length/settled*100).toFixed(1) : '—';
      const totalPnl = trades.reduce((s,t)=>s+(parseFloat(t.pnl||0)),0);
      const avgWin  = won.length  ? (won.reduce((s,t)=>s+parseFloat(t.pnl||0),0)/won.length).toFixed(2)  : '0.00';
      const avgLoss = lost.length ? (lost.reduce((s,t)=>s+parseFloat(t.pnl||0),0)/lost.length).toFixed(2) : '0.00';

      document.getElementById('perf-count').textContent = '('+settled+' settled)';

      // Fetch live bankroll + extended stats from bot_stats.json
      let bankroll = 1340.0, winStreak = 0, dailyLog = [], organicPnl = 0, paperTopup = 1000, startingBr = 300;
      try {
        const bs = await pf('https://shaunpatrickstewart.github.io/trades/bot_stats.json');
        if (bs) {
          if (bs.bankroll)          bankroll    = bs.bankroll;
          if (bs.win_streak)        winStreak   = bs.win_streak;
          if (bs.daily_log)         dailyLog    = bs.daily_log;
          if (bs.organic_pnl!=null) organicPnl  = bs.organic_pnl;
          if (bs.paper_topup)       paperTopup  = bs.paper_topup;
          if (bs.starting_bankroll) startingBr  = bs.starting_bankroll;
        }
      } catch(e) { /* use fallback */ }

      // Post-filter PnL (Apr 5+) — the meaningful number
      const FILTER_DATE = '2026-04-05';
      const tPfAll = [...won,...lost].filter(t=>(t.timestamp||t.closed_at||'').slice(0,10)>=FILTER_DATE);
      const postFilterPnl = tPfAll.reduce((s,t)=>s+(t.pnl||0),0);
      const postFilterWR  = tPfAll.length ? (tPfAll.filter(t=>t.status==='WON').length/tPfAll.length*100) : 0;
      // Bankroll growth since filters went live (started at ~$222 on Apr 5)
      const brGrowthPct = ((bankroll - 222.26) / 222.26 * 100);

      const stat = (lbl,val,color,sub) =>
        '<div style="background:#f0f0f0;border-radius:4px;padding:6px 8px;text-align:center">'+
        '<div style="font-size:1.1em;font-weight:700;color:'+(color||'#222')+'">'+val+'</div>'+
        '<div style="font-size:0.68em;color:#888;margin-top:2px">'+lbl+'</div>'+
        (sub?'<div style="font-size:0.63em;color:#aaa;margin-top:1px">'+sub+'</div>':'')+
        '</div>';

      let html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">';
      html += stat('BANKROLL', '$'+bankroll.toFixed(2), '#222', '$'+startingBr+' start');
      html += stat('POST-FILTER P&L', (postFilterPnl>=0?'+':'')+fmt(postFilterPnl), postFilterPnl>=0?'#00cc66':'#ee3344', 'since Apr 5 filters');
      html += stat('WIN RATE', postFilterWR.toFixed(1)+'%', postFilterWR>=60?'#00cc66':'#ee3344', tPfAll.length+' settled');
      html += stat('BANKROLL GROWTH', (brGrowthPct>=0?'+':'')+brGrowthPct.toFixed(0)+'%', '#00cc66', 'since filters live');
      html += stat('AVG WIN', '+$'+avgWin, '#00cc66', won.length+' wins');
      html += stat('AVG LOSS', '$'+avgLoss, '#ee3344', lost.length+' losses');
      html += stat('OPEN POSITIONS', open.length, '#888', 'active trades');
      html += stat('WIN STREAK', winStreak > 0 ? winStreak+'&#x1F525;' : winStreak, winStreak>=10?'#ffaa00':'#ccc', 'consecutive');
      html += stat('ORGANIC P&L', (organicPnl>=0?'+$':'$')+Math.abs(organicPnl).toFixed(2), organicPnl>=0?'#00cc66':'#ee3344', 'excl $'+paperTopup+' top-up');
      html += '</div>';

      // Bankroll growth chart from daily_log
      if (dailyLog && dailyLog.length > 1) {
        const minBr = Math.min(...dailyLog.map(d=>d.starting));
        const maxBr = Math.max(...dailyLog.map(d=>d.ending));
        const range = maxBr - minBr || 1;
        const W = 420, H = 60, PAD = 6;
        const pts = dailyLog.map((d,i)=>{
          const x = PAD + (i/(dailyLog.length-1))*(W-PAD*2);
          const y = H - PAD - ((d.ending - minBr)/range)*(H-PAD*2);
          return x.toFixed(1)+','+y.toFixed(1);
        }).join(' ');
        html += '<div style="margin-bottom:10px;background:#080808;border:1px solid #1a1a1a;border-radius:4px;padding:6px 10px">';
        html += '<div style="font-size:0.68em;color:#555;margin-bottom:4px;font-weight:600">BANKROLL GROWTH — $'+startingBr+' → $'+bankroll.toFixed(0)+'</div>';
        html += '<svg width="100%" viewBox="0 0 '+W+' '+H+'" style="display:block">';
        // Zero line
        const zeroY = H - PAD - ((startingBr - minBr)/range)*(H-PAD*2);
        html += '<line x1="'+PAD+'" y1="'+zeroY.toFixed(1)+'" x2="'+(W-PAD)+'" y2="'+zeroY.toFixed(1)+'" stroke="#1a1a1a" stroke-width="1"/>';
        html += '<polyline points="'+pts+'" fill="none" stroke="#00ff88" stroke-width="2" stroke-linejoin="round"/>';
        // Dots + labels
        dailyLog.forEach((d,i)=>{
          const x = PAD + (i/(dailyLog.length-1))*(W-PAD*2);
          const y = H - PAD - ((d.ending - minBr)/range)*(H-PAD*2);
          const pnlC = d.pnl >= 0 ? '#00ff88' : '#ff4444';
          html += '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="3" fill="'+pnlC+'"/>';
          html += '<text x="'+x.toFixed(1)+'" y="'+(H-1)+'" text-anchor="middle" font-size="7" fill="#444">'+d.date.slice(5)+'</text>';
        });
        // End value label
        const lastPt = pts.split(' ').pop().split(',');
        html += '<text x="'+(parseFloat(lastPt[0])+4)+'" y="'+lastPt[1]+'" font-size="8" fill="#00ff88">$'+bankroll.toFixed(0)+'</text>';
        html += '</svg></div>';
      }

      html += '<div style="font-size:0.72em;color:#555;margin-bottom:6px;font-weight:600">ACTIVE ENGINES</div>';
      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
      html += '<span style="background:#fafae0;color:#7a7000;padding:3px 8px;border-radius:3px;font-size:0.75em;font-weight:600">&#9679; NEAR-CERTAIN ('+(won.filter(t=>t.type==="NEAR_CERTAIN").length+lost.filter(t=>t.type==="NEAR_CERTAIN").length)+'W/'+(lost.filter(t=>t.type==="NEAR_CERTAIN").length)+'L)</span>';
      html += '<span style="background:#e6f9f0;color:#007a44;padding:3px 8px;border-radius:3px;font-size:0.75em;font-weight:600">&#9679; WALLET COPY SHORT ('+(won.filter(t=>t.type==="SHORT_TERM").length)+'W/'+(lost.filter(t=>t.type==="SHORT_TERM").length)+'L)</span>';
      html += '<span style="background:#eef0ff;color:#3344cc;padding:3px 8px;border-radius:3px;font-size:0.75em;font-weight:600">&#9679; WALLET COPY LONG ('+(won.filter(t=>t.type==="LONG_TERM").length)+'W/'+(lost.filter(t=>t.type==="LONG_TERM").length)+'L)</span>';
      html += '</div>';

      // ── Realized Breakdown ───────────────────────────────────────
      const now = new Date();

      // Build per-day map from settled trades
      const byDay = {};
      [...won,...lost].forEach(t=>{
        const ts = t.timestamp||t.closed_at||'';
        const day = ts.slice(0,10);
        if (!day) return;
        if (!byDay[day]) byDay[day]={w:0,l:0,pnl:0};
        if (t.status==='WON')  { byDay[day].w++; byDay[day].pnl+=(t.pnl||0); }
        if (t.status==='LOST') { byDay[day].l++; byDay[day].pnl+=(t.pnl||0); }
      });

      // Days with activity, sorted newest first
      const days = Object.keys(byDay).sort().reverse();

      // Slice helpers
      const sinceDays = (n) => {
        const cut = new Date(now); cut.setDate(cut.getDate()-n);
        const cutStr = cut.toISOString().slice(0,10);
        return [...won,...lost].filter(t=>(t.timestamp||t.closed_at||'').slice(0,10)>=cutStr);
      };
      const t24h = sinceDays(1), t7d = sinceDays(7), t30d = sinceDays(30);
      const tPf  = [...won,...lost].filter(t=>(t.timestamp||t.closed_at||'').slice(0,10)>=FILTER_DATE);

      const sumPnl = arr => arr.reduce((s,t)=>s+(t.pnl||0),0);
      const wr = arr => { const s=arr.filter(t=>t.status==='WON').length; const tot=arr.length; return tot?((s/tot)*100).toFixed(0)+'%':'—'; };
      const daysSince = (ds) => {
        const d=new Date(ds); const diff=Math.round((now-d)/(86400000)); return Math.max(diff,1);
      };

      const pf7d   = sumPnl(t7d);
      const pf30d  = sumPnl(t30d);
      const pfPf   = sumPnl(tPf);
      const avgDay7 = t7d.length ? pf7d / Math.min(7, days.filter(d=>d>=(new Date(now.getTime()-7*86400000)).toISOString().slice(0,10)).length||1) : 0;
      const pfDaysCount = daysSince(FILTER_DATE);
      const avgDayPf = pfDaysCount > 0 ? pfPf / pfDaysCount : 0;

      html += '<div style="margin:10px 0 4px;font-size:0.72em;color:#555;font-weight:600;letter-spacing:0.05em">REALIZED P&amp;L — BREAKDOWN</div>';

      // Summary bar
      const bsCell = (label,val,sub,color) =>
        '<div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:4px;padding:6px 10px;min-width:100px;flex:1">'+
        '<div style="font-size:1.0em;font-weight:700;color:'+(color||'#ccc')+'">'+val+'</div>'+
        '<div style="font-size:0.68em;color:#555;margin-top:1px">'+label+'</div>'+
        (sub?'<div style="font-size:0.65em;color:#444;margin-top:1px">'+sub+'</div>':'')+
        '</div>';

      const c = v => v>=0?'#00ff88':'#ff4444';
      const f = v => (v>=0?'+':'')+'$'+Math.abs(v).toFixed(2);

      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
      html += bsCell('last 24h', f(sumPnl(t24h)), wr(t24h)+' WR · '+t24h.length+' settled', c(sumPnl(t24h)));
      html += bsCell('7-day total', f(pf7d), 'avg '+f(avgDay7)+'/day', c(pf7d));
      html += bsCell('30-day total', f(pf30d), t30d.length+' settled', c(pf30d));
      html += bsCell('since filters (Apr 5)', f(pfPf), 'avg '+f(avgDayPf)+'/day · '+wr(tPf)+' WR', c(pfPf));
      html += '</div>';

      // Per-day table (last 10 active days)
      const recentDays = days.slice(0,10);
      if (recentDays.length) {
        html += '<table style="font-size:0.8em"><tr>'+
          '<th style="text-align:left">Date</th>'+
          '<th>Won</th><th>Lost</th>'+
          '<th>Daily P&amp;L</th>'+
          '<th>Running Total</th>'+
          '</tr>';
        let running = 0;
        // Build running total from oldest to newest first
        const allDaysSorted = Object.keys(byDay).sort();
        const runMap = {};
        allDaysSorted.forEach(d=>{ running += byDay[d].pnl; runMap[d]=running; });
        recentDays.forEach(d=>{
          const row = byDay[d];
          const isToday = d === now.toISOString().slice(0,10);
          const pnlC = row.pnl>=0?'#00ff88':'#ff4444';
          const runC = (runMap[d]||0)>=0?'#00ff88':'#ff4444';
          html += '<tr style="'+(isToday?'background:#0a1a0a':'')+'">' +
            '<td style="color:#aaa;font-weight:'+(isToday?'700':'400')+'">'+d+(isToday?' ★':'')+
              (d < FILTER_DATE ? ' <span style="color:#555;font-size:0.75em">(pre-filter)</span>':'')+
            '</td>'+
            '<td style="color:#00ff88;text-align:center">'+row.w+'</td>'+
            '<td style="color:#ff4444;text-align:center">'+row.l+'</td>'+
            '<td style="color:'+pnlC+';font-weight:600;text-align:right">'+(row.pnl>=0?'+':'')+'$'+Math.abs(row.pnl).toFixed(2)+'</td>'+
            '<td style="color:'+runC+';text-align:right">'+(runMap[d]>=0?'+':'')+'$'+Math.abs(runMap[d]).toFixed(2)+'</td>'+
            '</tr>';
        });
        html += '</table>';
      }

      // Recent settled trades (compact, last 5)
      const recent = [...won,...lost].sort((a,b)=>(b.closed_at||b.timestamp||'').localeCompare(a.closed_at||a.timestamp||'')).slice(0,5);
      if (recent.length) {
        html += '<div style="margin:8px 0 3px;font-size:0.7em;color:#444;font-weight:600">LATEST SETTLED</div>';
        html += '<table style="font-size:0.78em"><tr><th>Result</th><th>Market</th><th>Bet</th><th>P&L</th></tr>';
        recent.forEach(t=>{
          const isWon = t.status==='WON';
          const q = (t.market||t.question||t.title||'Unknown market').slice(0,52);
          html += '<tr>'+
            '<td><span class="badge '+(isWon?'by':'bn')+'">'+t.status+'</span></td>'+
            '<td style="max-width:180px">'+q+'</td>'+
            '<td class="dim">$'+parseFloat(t.paper_bet||0).toFixed(2)+'</td>'+
            '<td class="'+(isWon?'green':'red')+'">'+(isWon?'+':'')+fmt(parseFloat(t.pnl||0))+'</td>'+
            '</tr>';
        });
        html += '</table>';
      }
      document.getElementById('pm-performance').innerHTML = html;
    } catch(e) {
      document.getElementById('pm-performance').innerHTML = '<div class="empty">Could not load performance data</div>';
    }
  }

  // ── RENDER: Wallet Leaderboard (walletPositions = [{w, pos}] pre-fetched)
  function renderWallets(wallets, walletPositions) {
    document.getElementById('wallet-count').textContent = '('+wallets.length+')';
    const el = document.getElementById('pm-wallets');

    const rows = walletPositions.map(({w,pos},i)=>{
      const name = (w.userName||(w.proxyWallet||'').slice(0,12)||'anon').slice(0,20);
      const pnl  = parseFloat(w.pnl||0);
      const vol  = parseFloat(w.vol||0);
      const roi  = vol>0?(pnl/vol)*100:0;
      const unc = pos.filter(p=>{ const pr=parseFloat(p.curPrice||p.price||0); return pr>=0.15&&pr<=0.85; }).slice(0,2);
      const posHtml = unc.length
        ? unc.map(p=>{
            const pr=parseFloat(p.curPrice||p.price||0);
            const oc=(p.outcome||'').toUpperCase();
            const cls=oc==='YES'?'by':'bn';
            return '<span class="badge '+cls+'">'+oc+'</span> '+(p.title||'').slice(0,36)+' <span class="dim">@'+pr.toFixed(2)+'</span>';
          }).join('<br>')
        : '<span class="dim">—</span>';
      return {i,name,pnl,roi,vol,posHtml};
    });

    let html = '<table><tr><th>#</th><th>Wallet</th><th>PnL</th><th>ROI</th><th class="hm">Volume</th><th>Current Positions</th></tr>';
    html += rows
      .sort((a,b)=>a.i-b.i)
      .map(({i,name,pnl,roi,vol,posHtml})=>
        '<tr>'+
        '<td class="dim">'+(i+1)+'</td>'+
        '<td>'+name+'</td>'+
        '<td class="green">'+fmt(pnl)+'</td>'+
        '<td style="color:'+(roi>=0?'#00ff88':'#ff4455')+'">'+roi.toFixed(1)+'%</td>'+
        '<td class="dim hm">'+fmt(vol)+'</td>'+
        '<td style="line-height:1.9;font-size:0.84em">'+posHtml+'</td>'+
        '</tr>'
      ).join('');
    el.innerHTML = html+'</table>';
  }

  // ── Capital increase modal
  window.pmSetCapital = async function(slug, outcome, currentBet) {
    const amt = prompt(
      'Increase capital for:\n['+outcome+'] '+slug+'\n\nCurrent bet: $'+currentBet+'\nEnter new bet amount in USD:',
      currentBet
    );
    if (!amt || isNaN(parseFloat(amt))) return;
    const amount = parseFloat(amt);
    try {
      const r = await fetch('http://localhost:8080/capital', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({slug, outcome, amount})
      });
      if (r.ok) {
        const j = await r.json();
        if (j.ok) {
          alert('Capital updated: '+slug+' ['+outcome+'] → $'+amount.toFixed(2)+'\nWill apply next time the bot runs this engine.');
        } else {
          throw new Error(j.error||'unknown error');
        }
      } else {
        throw new Error('HTTP '+r.status);
      }
    } catch(e) {
      alert('Could not reach local bot dashboard.\n\nRun this command in your terminal instead:\npython3 -c "import json; d=json.load(open(\'polybot/capital_overrides.json\')) if __import__(\'os\').path.exists(\'polybot/capital_overrides.json\') else {}; d[\''+slug+'|'+outcome+'\']='+amount+'; json.dump(d,open(\'polybot/capital_overrides.json\',\'w\'),indent=2)"');
    }
  };

  // ── RENDER: Paper Trade Tracker
  async function renderPaperTrades() {
    const el = document.getElementById('paper-trades');
    try {
      const PAPER_URL = 'https://shaunpatrickstewart.github.io/trades/paper_trades.jsonl?v='+Date.now();
      const r = await fetch(P+encodeURIComponent(PAPER_URL));
      if (!r.ok) throw new Error('HTTP '+r.status);
      const raw = await r.text();
      let text = raw;
      if (raw.trim().startsWith('{')&&!raw.trim().startsWith('{"timestamp"')) {
        try { const w=JSON.parse(raw); text=w.body||w.content||w.data||raw; } catch(e){}
      }
      const trades = text.trim().split('\n')
        .filter(l=>l.trim().startsWith('{'))
        .map(l=>{ try{return JSON.parse(l)}catch(e){return null} })
        .filter(Boolean);

      // Dedup by slug+outcome, keep most recent
      const seen = new Map();
      trades.forEach(t=>{
        const key=(t.slug||t.market)+'|'+t.outcome;
        if(!seen.has(key)||t.timestamp>seen.get(key).timestamp) seen.set(key,t);
      });
      const deduped = Array.from(seen.values()).sort((a,b)=>b.timestamp.localeCompare(a.timestamp));

      if (!deduped.length) {
        el.innerHTML='<div class="empty">No paper trades logged yet — bot is running, trades will appear here.</div>';
        document.getElementById('paper-summary').textContent='0 trades';
        return;
      }

      const open   = deduped.filter(t=>t.status==='OPEN');
      const won    = deduped.filter(t=>t.status==='WON');
      const lost   = deduped.filter(t=>t.status==='LOST');

      // Realized P&L = actual wins/losses only
      const realizedPnl   = won.reduce((s,t)=>s+(t.pnl||0),0) + lost.reduce((s,t)=>s+(t.pnl||0),0);
      // Unrealized = potential_profit on still-open trades
      const unrealizedPot = open.reduce((s,t)=>s+(t.potential_profit||0),0);
      const totalBet      = deduped.reduce((s,t)=>s+(t.paper_bet||0),0);

      // Header P&L counter shows REALIZED only
      const pnlEl = document.getElementById('pnl-counter');
      if (won.length+lost.length === 0) {
        pnlEl.textContent = '$0.00 realized';
        pnlEl.className = '';
      } else {
        pnlEl.textContent = (realizedPnl>=0?'+':'')+'$'+Math.abs(realizedPnl).toFixed(2)+' realized';
        pnlEl.className   = realizedPnl>=0?'':'loss';
      }

      document.getElementById('paper-summary').innerHTML =
        '<span class="green">'+open.length+' open</span> &nbsp;|&nbsp; '+
        '<span class="green">'+won.length+' won</span> &nbsp;|&nbsp; '+
        '<span style="color:#ff6655">'+lost.length+' lost</span> &nbsp;|&nbsp; '+
        '<span class="green">$'+totalBet.toFixed(0)+' deployed</span> &nbsp;|&nbsp; '+
        (won.length+lost.length>0
          ? '<span class="green">Realized: '+(realizedPnl>=0?'+':'')+'$'+realizedPnl.toFixed(2)+'</span>'
          : '<span class="dim">No resolved trades yet</span>')+
        ' &nbsp;|&nbsp; '+
        '<span class="yellow">Unrealized est: +$'+unrealizedPot.toFixed(2)+'</span>';

      // Engine breakdown
      const byEngine = {};
      deduped.forEach(t=>{
        const eng = t.type||'UNKNOWN';
        if (!byEngine[eng]) byEngine[eng]={open:0,won:0,lost:0,realPnl:0,unrealized:0};
        if (t.status==='OPEN')  { byEngine[eng].open++; byEngine[eng].unrealized+=(t.potential_profit||0); }
        if (t.status==='WON')   { byEngine[eng].won++;  byEngine[eng].realPnl+=(t.pnl||0); }
        if (t.status==='LOST')  { byEngine[eng].lost++; byEngine[eng].realPnl+=(t.pnl||0); }
      });
      const engColors = {SHORT_TERM:'#00cc66', LONG_TERM:'#88aaff', UNKNOWN:'#888'};
      let engHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;padding:8px 0;border-bottom:1px solid #1a2a1a">';
      Object.entries(byEngine).forEach(([eng,d])=>{
        const c = engColors[eng]||'#888';
        const label = eng==='LONG_TERM'?'WALLET COPY LONG':eng==='SHORT_TERM'?'WALLET COPY SHORT':eng.replace('_',' ');
        const resolved = d.won + d.lost;
        const totalEngBet = deduped.filter(t=>(t.type||'UNKNOWN')===eng).reduce((s,t)=>s+(t.paper_bet||0),0);
        const roi = resolved > 0 && totalEngBet > 0 ? (d.realPnl / totalEngBet * 100) : null;
        const wr  = resolved > 0 ? (d.won / resolved * 100) : null;
        const pnlStr = resolved > 0
          ? (d.realPnl>=0?'<span style="color:#00ff88">+$'+d.realPnl.toFixed(2)+'</span>'
                         :'<span style="color:#ff4444">$'+d.realPnl.toFixed(2)+'</span>')
          : '<span style="color:#444">no resolved</span>';
        const roiStr = roi !== null
          ? '<span style="color:'+(roi>=0?'#00ff88':'#ff4444')+'">ROI '+(roi>=0?'+':'')+roi.toFixed(1)+'%</span>'
          : '<span style="color:#333;font-size:0.75em">ROI: need '+(10-resolved)+' more</span>';
        const wrStr = wr !== null ? '<span style="color:#aaa"> &nbsp; '+wr.toFixed(0)+'% WR</span>' : '';
        engHtml +=
          '<div style="background:#0d0d0d;border:1px solid '+c+'33;border-left:3px solid '+c+';padding:6px 12px;border-radius:4px;min-width:155px">'+
          '<div style="color:'+c+';font-size:0.7em;font-weight:700">'+label+'</div>'+
          '<div style="font-size:0.8em;margin-top:2px">'+d.open+' open &nbsp; '+d.won+'W/'+d.lost+'L</div>'+
          '<div style="font-size:0.8em">Realized: '+pnlStr+'</div>'+
          '<div style="font-size:0.78em;margin-top:2px">'+roiStr+wrStr+'</div>'+
          '<div style="font-size:0.75em;color:#555">Unrealized: +$'+d.unrealized.toFixed(2)+'</div>'+
          '</div>';
      });
      engHtml += '</div>';

      // Trade table
      const engineLabel = t => {
        const s = t.source||t.type||'';
        if (s.startsWith('copy:')) return '<span style="color:#88aaff;font-size:0.75em">COPY: '+s.slice(5).slice(0,14)+'</span>';
        if (t.type==='NEAR_CERTAIN') return '<span style="color:#aaa;font-size:0.75em">NEAR-CERTAIN</span>';
        if (t.type==='SHORT_TERM')   return '<span style="color:#00ff88;font-size:0.75em">COPY SHORT</span>';
        return '<span style="color:#888;font-size:0.75em">'+(t.type||'—')+'</span>';
      };

      let html = engHtml;
      html += '<table><tr>'+
        '<th>#</th><th>Engine</th><th>Market</th><th>Side</th><th>Entry</th>'+
        '<th>Bet</th><th>P&L / Est</th><th class="hm">EV</th>'+
        '<th>Entered</th><th>Resolves</th><th>Status</th><th>+Capital</th>'+
        '</tr>';

      html += deduped.map((t,i)=>{
        const side = (t.outcome||'').toLowerCase()==='yes'
          ?'<span class="badge by">YES</span>'
          :'<span class="badge bn">NO</span>';
        let pnlCell;
        if (t.status==='WON') {
          pnlCell = '<span class="green">+$'+(t.pnl||0).toFixed(2)+'</span>';
        } else if (t.status==='LOST') {
          pnlCell = '<span style="color:#ff4444">$'+(t.pnl||0).toFixed(2)+'</span>';
        } else {
          pnlCell = '<span class="yellow">+$'+(t.potential_profit||0).toFixed(2)+' est</span>';
        }
        const evH = t.ev!=null
          ? (parseFloat(t.ev)>=0
              ?'<span class="ev-pos">EV+'+parseFloat(t.ev).toFixed(3)+'</span>'
              :'<span class="ev-neg">EV'+parseFloat(t.ev).toFixed(3)+'</span>')
          : '<span class="dim">—</span>';
        const stCl = t.status==='OPEN'?'yellow':(t.status==='WON'?'green':'red');
        // Entered date (from timestamp)
        const entered = t.timestamp ? t.timestamp.slice(0,10) : '—';
        // Resolution date
        const resolves = t.end_date || (t.days_left!=null ? 'in '+t.days_left+'d' : '—');
        // Capital button (only for OPEN)
        const capBtn = t.status==='OPEN' && t.slug
          ? '<button onclick="pmSetCapital(\''+t.slug+'\',\''+t.outcome+'\','+(t.paper_bet||5)+')" '+
            'style="background:#111;border:1px solid #333;color:#aaa;padding:2px 6px;cursor:pointer;font-size:0.7em;border-radius:3px">+$</button>'
          : '<span class="dim">—</span>';

        return '<tr class="paper-row">'+
          '<td class="dim">'+(i+1)+'</td>'+
          '<td>'+engineLabel(t)+'</td>'+
          '<td style="max-width:220px">'+(t.market||'').slice(0,55)+'</td>'+
          '<td>'+side+'</td>'+
          '<td class="dim">'+(t.entry_price||0).toFixed(3)+'</td>'+
          '<td>$'+(t.paper_bet||0).toFixed(0)+'</td>'+
          '<td>'+pnlCell+'</td>'+
          '<td class="hm">'+evH+'</td>'+
          '<td class="dim" style="font-size:0.78em">'+entered+'</td>'+
          '<td style="font-size:0.78em;color:'+(t.status==='OPEN'?'#88aaff':'#555')+'">'+resolves+'</td>'+
          '<td><span class="'+stCl+'">'+t.status+'</span></td>'+
          '<td>'+capBtn+'</td>'+
          '</tr>';
      }).join('');

      // Totals row
      html += '<tr style="border-top:1px solid #1a3a1a;background:#090909">'+
        '<td colspan="5" class="dim" style="font-size:0.72em">TOTAL</td>'+
        '<td style="color:#aaa">$'+totalBet.toFixed(0)+'</td>'+
        '<td>'+(realizedPnl>=0?'<span class="green">':'<span style="color:#ff4444">')+
          (realizedPnl>=0?'+':'')+'$'+realizedPnl.toFixed(2)+' realized</span> '+
          '<span class="yellow" style="font-size:0.8em">+$'+unrealizedPot.toFixed(2)+' unrealized</span>'+
        '</td>'+
        '<td colspan="5"></td></tr>';
      el.innerHTML = html+'</table>';

    } catch(e) {
      el.innerHTML='<div class="err">Paper trades unavailable: '+e.message+'</div>';
    }
  }

  // ── RENDER: Daily Audit Panel
  async function renderAudit() {
    const el = document.getElementById('audit-panel');
    if (!el) return;
    try {
      const AUDIT_URL = 'https://shaunpatrickstewart.github.io/trades/audit.json?v='+Date.now();
      const r = await fetch(P+encodeURIComponent(AUDIT_URL));
      if (!r.ok) throw new Error('HTTP '+r.status);
      const a = await r.json();

      const ts = a.generated_at ? new Date(a.generated_at).toLocaleString() : '—';
      const botSt = a.bot_running
        ? '<span class="green">RUNNING</span>'
        : '<span style="color:#ff4444">STOPPED</span>';

      let html = '<div style="font-size:0.75em;color:#555;margin-bottom:8px">Last audit: '+ts+' &nbsp;|&nbsp; Bot: '+botSt+'</div>';

      // Bankroll + $300/day target
      if (a.bankroll) {
        const br = a.bankroll;
        const onTrack = br.on_track;
        const growth = br.total_growth >= 0
          ? '<span style="color:#00ff88">+$'+br.total_growth.toFixed(2)+'</span>'
          : '<span style="color:#ff4444">-$'+Math.abs(br.total_growth).toFixed(2)+'</span>';
        html += '<div style="background:#0a0a0a;border:1px solid #333;border-left:3px solid '+(onTrack?'#00ff88':'#ffaa44')+';padding:8px 12px;margin-bottom:10px;border-radius:4px">';
        html += '<div style="font-weight:700;color:'+(onTrack?'#00ff88':'#ffaa44')+';margin-bottom:4px">$300/DAY TARGET '+(onTrack?'✓ HIT':'— IN PROGRESS')+'</div>';
        html += '<div style="font-size:0.82em;display:flex;gap:20px;flex-wrap:wrap">';
        html += '<span>Bankroll: <b style="color:#fff">$'+br.current_bankroll.toFixed(2)+'</b></span>';
        html += '<span>Started: $'+br.initial_bankroll.toFixed(2)+'</span>';
        html += '<span>Growth: '+growth+'</span>';
        if (br.days_of_data >= 1) {
          html += '<span>7-day avg: <b style="color:'+(br.avg_daily_pnl_7d>=0?'#00ff88':'#ff4444')+'">'+(br.avg_daily_pnl_7d>=0?'+':'')+'$'+br.avg_daily_pnl_7d.toFixed(2)+'/day</b></span>';
          html += '<span>Daily ROI: '+br.daily_roi_pct.toFixed(3)+'%</span>';
          if (!onTrack && br.days_to_target) {
            html += '<span>Est. days to target: <b style="color:#ffaa44">'+br.days_to_target+'d</b></span>';
            html += '<span>Need bankroll: $'+(br.min_bankroll_for_target||'?')+'</span>';
          }
          if (onTrack && br.withdrawable_today > 0) {
            html += '<span>Withdrawable: <b style="color:#00ff88">$'+br.withdrawable_today.toFixed(2)+'</b></span>';
          }
        } else {
          html += '<span style="color:#555">Collecting data — trades need to resolve first</span>';
        }
        html += '</div></div>';
      }

      // Strategy ROI + allocation recommendation
      if (a.engine_summary && a.engine_summary.length) {
        html += '<div style="color:#ffaa44;font-weight:700;margin-bottom:6px">Strategy Performance</div>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
        const ec = {SHORT_TERM:'#00ff88', LONG_TERM:'#88aaff', UNKNOWN:'#555'};
        a.engine_summary.forEach(e=>{
          const c = ec[e.engine]||'#888';
          const roiStr = e.roi_pct !== null && e.roi_pct !== undefined
            ? '<span style="color:'+(e.roi_pct>=0?'#00ff88':'#ff4444')+';font-weight:700">'+(e.roi_pct>=0?'+':'')+e.roi_pct+'%</span>'
            : '<span style="color:#333">need '+(10-e.resolved)+' more</span>';
          const wrStr = e.win_rate_pct !== null && e.win_rate_pct !== undefined
            ? ' &nbsp;<span style="color:#aaa">'+e.win_rate_pct+'% WR</span>' : '';
          html += '<div style="background:#0d0d0d;border-left:2px solid '+c+';padding:4px 8px;font-size:0.78em">'+
            '<div style="color:'+c+';font-weight:700">'+(e.engine==='LONG_TERM'?'WALLET COPY LONG':e.engine==='SHORT_TERM'?'WALLET COPY SHORT':e.engine.replace('_',' '))+'</div>'+
            '<div>'+e.resolved+' resolved | ROI '+roiStr+wrStr+'</div>'+
            '<div>P&amp;L: '+(e.realized_pnl>=0?'<span style="color:#00ff88">+':'<span style="color:#ff4444">')+
            '$'+Math.abs(e.realized_pnl).toFixed(2)+'</span></div>'+
            '</div>';
        });
        html += '</div>';
      }
      if (a.allocation_rec) {
        const ar = a.allocation_rec;
        if (ar.status === 'recommendation_ready') {
          html += '<div style="color:#00ff88;font-weight:700;margin-bottom:4px">Capital Allocation</div>';
          ar.summary.split('\n').forEach(line=>{
            html += '<div style="color:#88cc88;margin-bottom:2px">▸ '+line+'</div>';
          });
        } else {
          html += '<div style="color:#333;font-size:0.78em;margin-bottom:8px">'+
            '⏳ '+ar.message+'</div>';
        }
      }

      if (a.issues && a.issues.length) {
        html += '<div style="color:#ff8844;font-weight:700;margin-bottom:4px">Issues ('+a.issues.length+')</div>';
        a.issues.forEach(s=>{ html += '<div style="color:#ff8844;margin-bottom:3px">⚠ '+s+'</div>'; });
      }
      if (a.warnings && a.warnings.length) {
        a.warnings.forEach(s=>{ html += '<div style="color:#ffcc44;margin-bottom:3px">⚡ '+s+'</div>'; });
      }
      if (a.suggestions && a.suggestions.length) {
        html += '<div style="color:#88aaff;font-weight:700;margin:8px 0 4px">Suggested improvements</div>';
        a.suggestions.forEach(s=>{ html += '<div style="color:#88aaff;margin-bottom:3px">→ '+s+'</div>'; });
      }
      if (a.ok && a.ok.length) {
        html += '<div style="color:#555;font-weight:700;margin:8px 0 4px">Passing</div>';
        a.ok.forEach(s=>{ html += '<div style="color:#2a4a2a;margin-bottom:2px">✓ '+s+'</div>'; });
      }
      el.innerHTML = html || '<div class="dim">No issues found.</div>';
    } catch(e) {
      if (el) el.innerHTML = '<div class="dim">Audit not available yet — runs daily at 8am. ('+ e.message+')</div>';
    }
  }

  // ── TESTING LAB
  async function renderLab() {
    const el = document.getElementById('lab-panel');
    const countEl = document.getElementById('lab-count');
    if (!el) return;
    try {
      const lab = await pf('https://shaunpatrickstewart.github.io/trades/lab.json');
      const exps = lab.experiments || [];
      if (countEl) countEl.textContent = exps.length + ' experiments';

      const statusColor = {
        LIVE:        '#00ff88',
        IN_PROGRESS: '#ffcc00',
        PLANNED:     '#88aaff',
        ANALYZING:   '#ff8844',
        BLOCKED:     '#ff4444',
        COMPLETE:    '#aaaaaa',
      };
      const statusIcon = {
        LIVE: '&#9679; LIVE', IN_PROGRESS: '&#9654; RUNNING', PLANNED: '&#9675; PLANNED',
        ANALYZING: '&#9670; ANALYZING', BLOCKED: '&#9888; BLOCKED', COMPLETE: '&#10003; DONE',
      };
      const priBadge = p =>
        p==='HIGH' ? '<span style="background:#ff4444;color:#fff;padding:1px 5px;border-radius:2px;font-size:0.68em;font-weight:700">HIGH</span>' :
        p==='MEDIUM' ? '<span style="background:#ff8844;color:#fff;padding:1px 5px;border-radius:2px;font-size:0.68em;font-weight:700">MED</span>' :
        p==='LIVE' ? '<span style="background:#00cc66;color:#000;padding:1px 5px;border-radius:2px;font-size:0.68em;font-weight:700">LIVE</span>' : '';

      let html = `<div style="color:#555;font-size:0.7em;margin-bottom:8px">Last updated: ${lab.updated || '—'} — Updated by bot on every strategy change</div>`;
      html += '<div style="display:flex;flex-direction:column;gap:10px">';

      exps.forEach(e => {
        const sc = statusColor[e.status] || '#888';
        const si = statusIcon[e.status] || e.status;
        html += `<div style="background:#0a0a0a;border-left:3px solid ${sc};padding:8px 10px;border-radius:0 4px 4px 0">`;
        html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">`;
        html += `<span style="color:${sc};font-weight:700;font-size:0.82em">${si} &nbsp; ${e.name}</span>`;
        html += `<span>${priBadge(e.priority)}</span>`;
        html += `</div>`;
        html += `<div style="color:#aaa;font-size:0.75em;margin-bottom:3px">${e.hypothesis}</div>`;
        if (e.result) {
          const rc = e.status==='LIVE' ? '#00cc66' : e.status==='BLOCKED' ? '#ff4444' : '#888';
          html += `<div style="color:${rc};font-size:0.72em;margin-top:3px"><b>Result:</b> ${e.result}</div>`;
        } else {
          html += `<div style="color:#555;font-size:0.72em;margin-top:3px"><b>Next:</b> ${e.action}</div>`;
        }
        html += `</div>`;
      });

      html += '</div>';
      el.innerHTML = html;
    } catch(e) {
      if (el) el.innerHTML = '<div class="dim">Lab data unavailable — ('+ e.message+')</div>';
    }
  }

  // ── MAIN REFRESH
  async function refresh() {
    document.getElementById('hdr-updated').textContent =
      'Updated '+new Date().toLocaleTimeString()+' — next in 30s  |  press R to force refresh';
    try {
      const [wallets, allMarkets, forexMarkets] = await Promise.all([
        fetchAllWallets(), fetchAllMarkets(), fetchForex()
      ]);
      renderHeaderStats(wallets, allMarkets);
      renderScanner(allMarkets, forexMarkets);
      renderPerformance();
      // Fetch positions once for top 25, reuse for both Copy Signals and Leaderboard
      const posResults = await Promise.allSettled(wallets.slice(0,25).map(w=>{
        const addr = w.proxyWallet||w.address||'';
        if (!addr) return Promise.resolve({w, pos:[]});
        return fetchPositions(addr).then(pos=>({w,pos})).catch(()=>({w,pos:[]}));
      }));
      const walletPositions = posResults.filter(r=>r.status==='fulfilled').map(r=>r.value);
      renderSignals(walletPositions);
      renderWallets(wallets, walletPositions);
    } catch(e) {
      console.error('Refresh error:', e);
      document.getElementById('hdr-updated').textContent = 'Error: '+e.message+' — press R to retry';
    }
  }

  refresh();
  renderPaperTrades();
  renderAudit();
  renderLab();
  setInterval(refresh, REFRESH);
  setInterval(renderPaperTrades, 1800000);
  setInterval(renderAudit, 3600000);
  setInterval(renderLab, 3600000);

})();
