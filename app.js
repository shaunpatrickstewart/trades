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
  function renderDailyIncome(allMarkets) {
    const ed = m => m.endDate || m.endDateIso || '';
    const hits = allMarkets.filter(m=>{
      const h=hours(ed(m));
      if(h<0||h>168) return false;
      if(parseFloat(m.volumeNum||0)<200) return false;
      return getHighConf(m)!==null;
    }).sort((a,b)=>hours(ed(a))-hours(ed(b)));

    document.getElementById('dc-count').textContent = '('+hits.length+')';
    if (!hits.length) {
      document.getElementById('pm-daily').innerHTML='<div class="empty">No near-certain markets this week — all outcomes genuinely uncertain right now.</div>';
      return;
    }
    let html = '<table><tr><th>#</th><th>Market</th><th>Side</th><th>Conf</th><th>Profit/$1</th><th>Expires</th></tr>';
    hits.slice(0,20).forEach((m,i)=>{
      const hc  = getHighConf(m);
      const cls = hc.outcome==='YES' ? 'by' : 'bn';
      const profit = ((1-hc.price)/hc.price).toFixed(3);
      html += '<tr>'+
        '<td class="dim">'+(i+1)+'</td>'+
        '<td style="max-width:200px">'+(m.question||m.title||'').slice(0,58)+'</td>'+
        '<td><span class="badge '+cls+'">'+hc.outcome+'</span></td>'+
        '<td class="green">'+(hc.price*100).toFixed(0)+'%</td>'+
        '<td class="green">+$'+profit+'</td>'+
        '<td>'+timeLabel(m)+'</td>'+
        '</tr>';
    });
    document.getElementById('pm-daily').innerHTML = html+'</table>';
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
      const engColors = {SHORT_TERM:'#00ff88', NEAR_CERTAIN:'#ffdd44', LONG_TERM:'#88aaff', UNKNOWN:'#888'};
      let engHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;padding:8px 0;border-bottom:1px solid #1a2a1a">';
      Object.entries(byEngine).forEach(([eng,d])=>{
        const c = engColors[eng]||'#888';
        const label = eng==='LONG_TERM'?'WALLET COPY':eng.replace('_',' ');
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
        if (t.type==='NEAR_CERTAIN') return '<span style="color:#ffdd44;font-size:0.75em">NEAR-CERTAIN</span>';
        if (t.type==='SHORT_TERM')   return '<span style="color:#00ff88;font-size:0.75em">SHORT-TERM</span>';
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
        const ec = {SHORT_TERM:'#00ff88', NEAR_CERTAIN:'#ffdd44', LONG_TERM:'#88aaff', UNKNOWN:'#555'};
        a.engine_summary.forEach(e=>{
          const c = ec[e.engine]||'#888';
          const roiStr = e.roi_pct !== null && e.roi_pct !== undefined
            ? '<span style="color:'+(e.roi_pct>=0?'#00ff88':'#ff4444')+';font-weight:700">'+(e.roi_pct>=0?'+':'')+e.roi_pct+'%</span>'
            : '<span style="color:#333">need '+(10-e.resolved)+' more</span>';
          const wrStr = e.win_rate_pct !== null && e.win_rate_pct !== undefined
            ? ' &nbsp;<span style="color:#aaa">'+e.win_rate_pct+'% WR</span>' : '';
          html += '<div style="background:#0d0d0d;border-left:2px solid '+c+';padding:4px 8px;font-size:0.78em">'+
            '<div style="color:'+c+';font-weight:700">'+(e.engine==='LONG_TERM'?'WALLET COPY':e.engine.replace('_',' '))+'</div>'+
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
      renderDailyIncome(allMarkets);
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
  setInterval(refresh, REFRESH);
  setInterval(renderPaperTrades, 1800000);
  setInterval(renderAudit, 3600000);  // re-check audit hourly

})();
