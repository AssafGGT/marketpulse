const { useState, useEffect, useRef, useCallback } = React;

const CORS_PROXY = "https://api.allorigins.win/get?url=";
const CACHE_KEY = "marketpulse_v3";
const SEEN_KEY = "marketpulse_seen_v3";
const MAX_NEWS = 120;

const RSS_SOURCES = [
  { name: "Benzinga", url: "https://www.benzinga.com/feed" },
  { name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/businessNews" },
  { name: "Seeking Alpha", url: "https://seekingalpha.com/market_currents.xml" },
];

const CATEGORY_CONFIG = {
  upgrade:   { label: "UPGRADE",   icon: "↑", color: "#22c55e", bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.2)" },
  downgrade: { label: "DOWNGRADE", icon: "↓", color: "#ef4444", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)" },
  earnings:  { label: "EARNINGS",  icon: "◈", color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)" },
  macro:     { label: "MACRO",     icon: "◎", color: "#38bdf8", bg: "rgba(56,189,248,0.08)",  border: "rgba(56,189,248,0.2)" },
  corporate: { label: "CORP",      icon: "⬡", color: "#a78bfa", bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.2)" },
  breaking:  { label: "BREAKING",  icon: "●", color: "#fb923c", bg: "rgba(251,146,60,0.08)",  border: "rgba(251,146,60,0.2)" },
  analysis:  { label: "ANALYSIS",  icon: "◇", color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.2)" },
};

const SOURCE_COLORS = { "Benzinga":"#38bdf8", "MarketWatch":"#fb923c", "Reuters":"#f87171", "Seeking Alpha":"#fbbf24" };

const MOCK_NEWS = [
  { id:"m1", title:"NVDA: Analyst Raises Price Target to $1,200, Maintains Buy Rating", source:"Benzinga", time:new Date(Date.now()-90000), category:"upgrade", ticker:"NVDA", isNew:false, url:"#" },
  { id:"m2", title:"Apple Reports Q1 Earnings Beat; Revenue Up 8% Year-Over-Year", source:"Reuters", time:new Date(Date.now()-300000), category:"earnings", ticker:"AAPL", isNew:false, url:"#" },
  { id:"m3", title:"Microsoft Announces $10 Billion Share Buyback Program", source:"MarketWatch", time:new Date(Date.now()-600000), category:"corporate", ticker:"MSFT", isNew:false, url:"#" },
  { id:"m4", title:"Tesla Downgraded to Neutral at Goldman; Target Cut to $185", source:"Benzinga", time:new Date(Date.now()-900000), category:"downgrade", ticker:"TSLA", isNew:false, url:"#" },
  { id:"m5", title:"Fed Minutes: Officials Signal Caution on Rate Cuts Ahead", source:"Reuters", time:new Date(Date.now()-1200000), category:"macro", ticker:null, isNew:false, url:"#" },
  { id:"m6", title:"META Initiates $50B Buyback; Q4 Revenue Beats Estimates", source:"MarketWatch", time:new Date(Date.now()-1500000), category:"earnings", ticker:"META", isNew:false, url:"#" },
];

function timeAgo(date) {
  const s = Math.floor((new Date() - date) / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

function classifyNews(title) {
  const t = title.toLowerCase();
  if (t.includes("upgrade") || t.includes("raises price") || t.includes("buy rating") || t.includes("outperform")) return "upgrade";
  if (t.includes("downgrade") || (t.includes("cut") && t.includes("target")) || t.includes("underperform")) return "downgrade";
  if (t.includes("earnings") || t.includes("revenue") || t.includes("beats") || t.includes("eps") || t.includes("profit") || /q[1-4]/.test(t)) return "earnings";
  if (t.includes("fed") || t.includes("rate") || t.includes("inflation") || t.includes("gdp") || t.includes("opec") || t.includes("tariff")) return "macro";
  if (t.includes("buyback") || t.includes("merger") || t.includes("acquisition") || t.includes("dividend") || t.includes("ceo")) return "corporate";
  if (t.includes("breaking") || t.includes("halt") || t.includes("alert")) return "breaking";
  return "analysis";
}

function extractTicker(title) {
  const skip = new Set(["THE","AND","FOR","FROM","WITH","AFTER","OVER","AMID","THAT","THIS","WILL","HAVE","BEEN","MORE","THAN","YEAR","RATE","CUTS","SAID","SAYS","WHY","HOW","WHAT","NEW","NOW","ITS","ALL","ARE","NOT","BUT","HAS","CAN","MAY","WAY","ONE","TWO","TOP","OIL","GAS","USD","GDP","IPO","ETF","CEO","CFO","SEC","FED"]);
  const matches = title.match(/\b([A-Z]{2,5})\b/g);
  if (!matches) return null;
  return matches.find(m => !skip.has(m)) || null;
}

function makeId(sourceName, title) {
  let hash = 0;
  const str = sourceName + title;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return sourceName.slice(0,3) + "_" + Math.abs(hash).toString(36);
}

function parseRSSItems(xmlText, sourceName) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const seen = new Set();
    const results = [];
    for (const item of doc.querySelectorAll("item")) {
      const title = (item.querySelector("title")?.textContent || "")
        .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
      if (!title || title.length < 10) continue;
      const id = makeId(sourceName, title);
      if (seen.has(id)) continue;
      seen.add(id);
      const link = item.querySelector("link")?.textContent || "#";
      const pubDate = item.querySelector("pubDate")?.textContent;
      results.push({
        id, title, source: sourceName,
        time: pubDate ? new Date(pubDate) : new Date(),
        category: classifyNews(title),
        ticker: extractTicker(title),
        isNew: true, url: link,
      });
      if (results.length >= 10) break;
    }
    return results;
  } catch { return []; }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw).map(n => ({ ...n, time: new Date(n.time), isNew: false }));
  } catch { return null; }
}

function saveCache(news) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(news.slice(0, MAX_NEWS))); } catch {}
}

function loadSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveSeen(ids) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-800))); } catch {}
}
function App() {
  const cached = loadCache();
  const [news, setNews] = useState(cached && cached.length > 0 ? cached : MOCK_NEWS);
  const [filter, setFilter] = useState("all");
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [newCount, setNewCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [now, setNow] = useState(new Date());
  const [flashIds, setFlashIds] = useState(new Set());
  const audioCtx = useRef(null);
  const seenIds = useRef(loadSeen());
  const intervalRef = useRef(null);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { saveCache(news); }, [news]);

  const playAlert = useCallback(() => {
    if (!soundEnabled) return;
    try {
      if (!audioCtx.current) audioCtx.current = new AudioContext();
      const ctx = audioCtx.current;
      [660, 880, 1100].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq; osc.type = "sine";
        gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.25);
        osc.start(ctx.currentTime + i * 0.1); osc.stop(ctx.currentTime + i * 0.1 + 0.25);
      });
    } catch {}
  }, [soundEnabled]);

  const sendNotification = useCallback((item) => {
    if (!alertsEnabled || Notification.permission !== "granted") return;
    const cat = CATEGORY_CONFIG[item.category] || {};
    new Notification(`${cat.icon || "◈"} ${item.ticker ? item.ticker + " · " : ""}${item.source}`, {
      body: item.title, icon: "icons/icon-192.png", vibrate: [100, 50, 100], tag: item.id,
    });
  }, [alertsEnabled]);

  const requestAlerts = async () => {
    if (!("Notification" in window)) { alert("הדפדפן לא תומך בהתראות"); return; }
    const perm = await Notification.requestPermission();
    setAlertsEnabled(perm === "granted");
    if (perm === "granted") playAlert();
  };

  const fetchFeeds = useCallback(async () => {
    setRefreshing(true);
    let allFetched = [];
    for (const src of RSS_SOURCES) {
      try {
        const resp = await fetch(`${CORS_PROXY}${encodeURIComponent(src.url)}`);
        const data = await resp.json();
        const items = parseRSSItems(data.contents, src.name);
        allFetched = [...allFetched, ...items];
      } catch {}
    }

    // Deduplicate by id across all sources
    const dedupMap = new Map();
    for (const item of allFetched) {
      if (!dedupMap.has(item.id)) dedupMap.set(item.id, item);
    }
    const deduped = [...dedupMap.values()];
    deduped.sort((a, b) => b.time - a.time);

    const fresh = deduped.filter(item => !seenIds.current.has(item.id));

    if (fresh.length > 0) {
      fresh.forEach(item => seenIds.current.add(item.id));
      saveSeen(seenIds.current);

      const freshIds = new Set(fresh.map(i => i.id));
      setFlashIds(freshIds);
      setTimeout(() => setFlashIds(new Set()), 4000);

      setNews(prev => {
        const existingIds = new Set(prev.map(n => n.id));
        const trulyNew = fresh.filter(n => !existingIds.has(n.id));
        const merged = [...trulyNew, ...prev];
        // Deduplicate merged list
        const seen = new Set();
        const unique = merged.filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; });
        unique.sort((a, b) => b.time - a.time);
        return unique.slice(0, MAX_NEWS);
      });

      setNewCount(c => c + fresh.length);
      fresh.slice(0, 3).forEach((item, i) => {
        setTimeout(() => { playAlert(); sendNotification(item); }, i * 400);
      });
    }
    setLastUpdate(new Date());
    setRefreshing(false);
  }, [playAlert, sendNotification]);

  const startLive = () => { setIsLive(true); setNewCount(0); fetchFeeds(); intervalRef.current = setInterval(fetchFeeds, 60000); };
  const stopLive = () => { setIsLive(false); clearInterval(intervalRef.current); };
  useEffect(() => () => clearInterval(intervalRef.current), []);

  const getAiSummary = async () => {
    setAiLoading(true); setAiSummary("");
    const headlines = news.slice(0, 12).map(n => `- ${n.title}`).join("\n");
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000,
          messages: [{ role: "user", content: `You are a sharp financial analyst. Summarize these market headlines in 3-4 concise bullet points. Focus on key themes and actionable insights.\n\nHeadlines:\n${headlines}` }] }),
      });
      const data = await resp.json();
      setAiSummary(data.content?.[0]?.text || "No summary available.");
    } catch { setAiSummary("Failed to fetch summary."); }
    setAiLoading(false);
  };

  // FILTER — זה הקריטי שתוקן
  const filtered = news.filter(item => {
    if (filter === "all") return true;
    return item.category === filter;
  });

  const marketOpen = (() => {
    const d = new Date();
    const day = d.getUTCDay();
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    return day >= 1 && day <= 5 && mins >= 870 && mins < 1230;
  })();

  return React.createElement('div', { style:{ minHeight:"100vh", background:"#080b12", color:"#e2e8f0", fontFamily:"'Inter',-apple-system,sans-serif" } },

    // HEADER
    React.createElement('div', { style:{ background:"rgba(8,11,18,0.97)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"0 16px", position:"sticky", top:0, zIndex:100, height:56, display:"flex", alignItems:"center", justifyContent:"space-between" } },
      React.createElement('div', { style:{ display:"flex", alignItems:"center", gap:10 } },
        React.createElement('div', { style:{ width:32, height:32, borderRadius:8, background:"linear-gradient(135deg,#0ea5e9,#6366f1)", display:"flex", alignItems:"center", justifyContent:"center" } },
          React.createElement('span', { style:{ fontSize:13, fontWeight:900, color:"#fff" } }, "MP")
        ),
        React.createElement('div', null,
          React.createElement('div', { style:{ fontSize:15, fontWeight:700, color:"#f1f5f9", letterSpacing:"-0.3px" } }, "MarketPulse"),
          React.createElement('div', { style:{ fontSize:10, color:"#475569" } }, "Live News Feed")
        )
      ),
      React.createElement('div', { style:{ display:"flex", alignItems:"center", gap:8 } },
        React.createElement('div', { style:{ display:"flex", alignItems:"center", gap:5, background: marketOpen?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)", border:`1px solid ${marketOpen?"rgba(34,197,94,0.25)":"rgba(239,68,68,0.25)"}`, borderRadius:20, padding:"3px 9px" } },
          React.createElement('div', { style:{ width:6, height:6, borderRadius:"50%", background: marketOpen?"#22c55e":"#ef4444", boxShadow: marketOpen?"0 0 6px #22c55e":"none" } }),
          React.createElement('span', { style:{ fontSize:10, fontWeight:600, color: marketOpen?"#22c55e":"#ef4444" } }, marketOpen?"OPEN":"CLOSED")
        ),
        React.createElement('div', { style:{ fontSize:11, color:"#334155", fontVariantNumeric:"tabular-nums" } }, now.toLocaleTimeString("en-US",{hour12:false}))
      )
    ),

    // CONTENT
    React.createElement('div', { style:{ maxWidth:640, margin:"0 auto", padding:"12px 12px 40px" } },

      // CONTROLS
      React.createElement('div', { style:{ display:"flex", gap:8, marginBottom:12, alignItems:"center", flexWrap:"wrap" } },
        React.createElement('button', { onClick: isLive?stopLive:startLive, style:{ display:"flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:8, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600, background: isLive?"rgba(239,68,68,0.12)":"linear-gradient(135deg,#0ea5e9,#6366f1)", color: isLive?"#ef4444":"#fff" } },
          React.createElement('div', { style:{ width:6, height:6, borderRadius:"50%", background: isLive?"#ef4444":"#fff", animation: isLive&&!refreshing?"livePulse 1.5s infinite":"none" } }),
          isLive?(refreshing?"Fetching...":"Stop Live"):"Go Live"
        ),
        React.createElement('button', { onClick:requestAlerts, style:{ padding:"8px 12px", borderRadius:8, border:`1px solid ${alertsEnabled?"rgba(34,197,94,0.3)":"rgba(255,255,255,0.08)"}`, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:500, background: alertsEnabled?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.04)", color: alertsEnabled?"#22c55e":"#64748b" } }, alertsEnabled?"🔔 On":"🔔 Off"),
        React.createElement('button', { onClick:()=>setSoundEnabled(s=>!s), style:{ padding:"8px 12px", borderRadius:8, border:`1px solid ${soundEnabled?"rgba(251,191,36,0.3)":"rgba(255,255,255,0.08)"}`, cursor:"pointer", fontFamily:"inherit", fontSize:12, background: soundEnabled?"rgba(251,191,36,0.08)":"rgba(255,255,255,0.04)", color: soundEnabled?"#fbbf24":"#64748b" } }, soundEnabled?"🔊":"🔇"),
        React.createElement('button', { onClick:getAiSummary, disabled:aiLoading, style:{ padding:"8px 12px", borderRadius:8, border:"1px solid rgba(167,139,250,0.3)", cursor:aiLoading?"wait":"pointer", fontFamily:"inherit", fontSize:12, fontWeight:500, background:"rgba(167,139,250,0.08)", color:"#a78bfa", opacity:aiLoading?0.6:1 } }, aiLoading?"✦ Analyzing...":"✦ AI Brief"),
        newCount>0&&React.createElement('div', { style:{ marginLeft:"auto", background:"rgba(251,146,60,0.1)", color:"#fb923c", border:"1px solid rgba(251,146,60,0.2)", borderRadius:20, padding:"4px 10px", fontSize:11, fontWeight:700 } }, `+${newCount} new`)
      ),

      // AI SUMMARY
      aiSummary&&React.createElement('div', { style:{ background:"rgba(167,139,250,0.05)", border:"1px solid rgba(167,139,250,0.12)", borderRadius:12, padding:"14px 16px", marginBottom:12 } },
        React.createElement('div', { style:{ display:"flex", alignItems:"center", gap:6, marginBottom:10 } },
          React.createElement('span', { style:{ fontSize:11, fontWeight:600, color:"#a78bfa" } }, "✦ AI Market Brief"),
          React.createElement('button', { onClick:()=>setAiSummary(""), style:{ marginLeft:"auto", background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:16, padding:0, lineHeight:1 } }, "×")
        ),
        React.createElement('div', { style:{ fontSize:12, lineHeight:1.75, color:"#cbd5e1", whiteSpace:"pre-wrap" } }, aiSummary)
      ),

      // FILTER TABS
      React.createElement('div', { style:{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:12, alignItems:"center" } },
        React.createElement('button', { onClick:()=>setFilter("all"), style:{ padding:"5px 11px", borderRadius:6, border:`1px solid ${filter==="all"?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.06)"}`, background:filter==="all"?"rgba(255,255,255,0.1)":"transparent", color:filter==="all"?"#f1f5f9":"#475569", fontSize:11, fontWeight:filter==="all"?700:400, cursor:"pointer", fontFamily:"inherit" } }, "All"),
        ...Object.entries(CATEGORY_CONFIG).map(([cat,c])=>
          React.createElement('button', { key:cat, onClick:()=>setFilter(cat), style:{ padding:"5px 10px", borderRadius:6, border:`1px solid ${filter===cat?c.border:"rgba(255,255,255,0.06)"}`, background:filter===cat?c.bg:"transparent", color:filter===cat?c.color:"#475569", fontSize:11, fontWeight:filter===cat?700:400, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s" } }, c.icon+" "+c.label)
        ),
        React.createElement('div', { style:{ marginLeft:"auto", fontSize:10, color:"#334155" } },
          filtered.length + " items · " + lastUpdate.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})
        )
      ),

      // NEWS LIST
      React.createElement('div', { style:{ display:"flex", flexDirection:"column", gap:2 } },
        filtered.length===0&&React.createElement('div', { style:{ textAlign:"center", padding:"48px 0", color:"#334155" } },
          React.createElement('div', { style:{ fontSize:24, marginBottom:8 } }, "◇"),
          React.createElement('div', { style:{ fontSize:13 } }, "No news in this category")
        ),
        filtered.map((item)=>{
          const cat = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.analysis;
          const srcColor = SOURCE_COLORS[item.source] || "#64748b";
          const isFlashing = flashIds.has(item.id);
          return React.createElement('div', {
            key: item.id,
            onClick: ()=>item.url&&item.url!=="#"&&window.open(item.url,"_blank"),
            style:{ background:isFlashing?"rgba(14,165,233,0.07)":"rgba(255,255,255,0.02)", border:`1px solid ${isFlashing?"rgba(14,165,233,0.18)":"rgba(255,255,255,0.05)"}`, borderLeft:`3px solid ${isFlashing?"#0ea5e9":cat.color}`, borderRadius:8, padding:"12px 14px", cursor:item.url!=="#"?"pointer":"default", transition:"all 0.3s", animation:isFlashing?"flashIn 0.4s ease":"none", marginBottom:2 },
            onMouseEnter:e=>e.currentTarget.style.background="rgba(255,255,255,0.04)",
            onMouseLeave:e=>e.currentTarget.style.background=isFlashing?"rgba(14,165,233,0.07)":"rgba(255,255,255,0.02)",
          },
            React.createElement('div', { style:{ display:"flex", alignItems:"center", gap:6, marginBottom:7 } },
              React.createElement('span', { style:{ fontSize:9, fontWeight:700, letterSpacing:"0.5px", color:cat.color, background:cat.bg, border:`1px solid ${cat.border}`, padding:"2px 7px", borderRadius:4 } }, cat.icon+" "+cat.label),
              item.ticker&&React.createElement('span', { style:{ fontSize:10, fontWeight:700, color:"#94a3b8", background:"rgba(148,163,184,0.08)", border:"1px solid rgba(148,163,184,0.15)", padding:"2px 7px", borderRadius:4 } }, item.ticker),
              isFlashing&&React.createElement('span', { style:{ fontSize:9, fontWeight:700, color:"#0ea5e9", background:"rgba(14,165,233,0.1)", border:"1px solid rgba(14,165,233,0.25)", padding:"2px 7px", borderRadius:4, marginLeft:"auto" } }, "NEW")
            ),
            React.createElement('div', { style:{ fontSize:13, lineHeight:1.55, color:"#e2e8f0", fontWeight:450, marginBottom:8 } }, item.title),
            React.createElement('div', { style:{ display:"flex", alignItems:"center", gap:8 } },
              React.createElement('span', { style:{ fontSize:10, fontWeight:600, color:srcColor } }, item.source),
              React.createElement('span', { style:{ fontSize:10, color:"#334155" } }, "·"),
              React.createElement('span', { style:{ fontSize:10, color:"#475569" } }, timeAgo(item.time)),
              item.url&&item.url!=="#"&&React.createElement('span', { style:{ marginLeft:"auto", fontSize:11, color:"#334155" } }, "↗")
            )
          );
        })
      ),

      React.createElement('div', { style:{ marginTop:32, textAlign:"center", color:"#1e293b", fontSize:10 } },
        "MarketPulse · Benzinga · Reuters · MarketWatch · Seeking Alpha"
      )
    ),

    React.createElement('style', null, `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');
      *{box-sizing:border-box} body{-webkit-font-smoothing:antialiased}
      @keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(1.4)}}
      @keyframes flashIn{0%{opacity:0.3;transform:translateY(-6px)}100%{opacity:1;transform:translateY(0)}}
      ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}
    `)
  );
}

ReactDOM.render(React.createElement(App), document.getElementById('root'));
