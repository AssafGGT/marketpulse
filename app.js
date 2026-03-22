const { useState, useEffect, useRef, useCallback } = React;

const CORS_PROXY = "https://api.allorigins.win/get?url=";

const RSS_SOURCES = [
  { name: "Benzinga", url: "https://www.benzinga.com/feed", color: "#00d4ff" },
  { name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", color: "#ff6b35" },
  { name: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews", color: "#ff4757" },
  { name: "Seeking Alpha", url: "https://seekingalpha.com/market_currents.xml", color: "#ffd700" },
];

const MOCK_NEWS = [
  { id: "m1", title: "NVDA: Analyst Raises Price Target to $1,200, Maintains Buy Rating", source: "Benzinga", time: new Date(Date.now() - 90000), category: "upgrade", ticker: "NVDA", isNew: true, url: "#" },
  { id: "m2", title: "Apple Reports Q1 Earnings Beat; Revenue Up 8% Year-Over-Year", source: "Reuters", time: new Date(Date.now() - 300000), category: "earnings", ticker: "AAPL", isNew: true, url: "#" },
  { id: "m3", title: "Microsoft Announces $10 Billion Share Buyback Program", source: "MarketWatch", time: new Date(Date.now() - 600000), category: "corporate", ticker: "MSFT", isNew: false, url: "#" },
  { id: "m4", title: "Tesla Downgraded to Neutral at Goldman; Target Cut to $185", source: "Benzinga", time: new Date(Date.now() - 900000), category: "downgrade", ticker: "TSLA", isNew: false, url: "#" },
  { id: "m5", title: "Fed Minutes: Officials Signal Caution on Rate Cuts Ahead", source: "Reuters", time: new Date(Date.now() - 1200000), category: "macro", ticker: null, isNew: false, url: "#" },
  { id: "m6", title: "META Initiates $50B Buyback; Q4 Revenue Beats Estimates by $2.1B", source: "MarketWatch", time: new Date(Date.now() - 1500000), category: "earnings", ticker: "META", isNew: false, url: "#" },
];

const CATEGORY_CONFIG = {
  upgrade:   { label: "⬆ UPGRADE",   color: "#00e676", bg: "rgba(0,230,118,0.10)" },
  downgrade: { label: "⬇ DOWNGRADE", color: "#ff1744", bg: "rgba(255,23,68,0.10)" },
  earnings:  { label: "📊 EARNINGS",  color: "#ffd740", bg: "rgba(255,215,64,0.10)" },
  macro:     { label: "🌍 MACRO",     color: "#40c4ff", bg: "rgba(64,196,255,0.10)" },
  corporate: { label: "🏢 CORPORATE", color: "#e040fb", bg: "rgba(224,64,251,0.10)" },
  breaking:  { label: "🔴 BREAKING",  color: "#ff6d00", bg: "rgba(255,109,0,0.10)" },
  analysis:  { label: "🔍 ANALYSIS",  color: "#b2ff59", bg: "rgba(178,255,89,0.10)" },
};

function timeAgo(date) {
  const s = Math.floor((new Date() - date) / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h";
}

function classifyNews(title) {
  const t = title.toLowerCase();
  if (t.includes("upgrade") || t.includes("raises price") || t.includes("buy rating")) return "upgrade";
  if (t.includes("downgrade") || (t.includes("cut") && t.includes("target")) || t.includes("underperform")) return "downgrade";
  if (t.includes("earnings") || t.includes("revenue") || t.includes("beats") || t.includes("eps") || t.includes("profit")) return "earnings";
  if (t.includes("fed") || t.includes("rate") || t.includes("inflation") || t.includes("gdp") || t.includes("opec")) return "macro";
  if (t.includes("buyback") || t.includes("merger") || t.includes("acquisition") || t.includes("dividend")) return "corporate";
  if (t.includes("breaking") || t.includes("halt")) return "breaking";
  return "analysis";
}

function extractTicker(title) {
  const skip = new Set(["THE","AND","FOR","FROM","WITH","AFTER","OVER","AMID","THAT","THIS","WILL","HAVE","BEEN","MORE","THAN","YEAR","RATE","CUTS","SAID","SAYS","Q1","Q2","Q3","Q4"]);
  const matches = title.match(/\b([A-Z]{2,5})\b/g);
  if (!matches) return null;
  return matches.find(m => !skip.has(m)) || null;
}

function parseRSSItems(xmlText, sourceName) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const items = Array.from(doc.querySelectorAll("item")).slice(0, 10);
    return items.map((item, i) => {
      const title = item.querySelector("title")?.textContent || "";
      const link = item.querySelector("link")?.textContent || "#";
      const pubDate = item.querySelector("pubDate")?.textContent;
      const cleanTitle = title.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
      return {
        id: `${sourceName}-${i}-${Date.now()}-${Math.random()}`,
        title: cleanTitle,
        source: sourceName,
        time: pubDate ? new Date(pubDate) : new Date(),
        category: classifyNews(cleanTitle),
        ticker: extractTicker(cleanTitle),
        isNew: true,
        url: link,
      };
    }).filter(item => item.title.length > 5);
  } catch (e) { return []; }
}
function App() {
  const [news, setNews] = useState(MOCK_NEWS);
  const [filter, setFilter] = useState("all");
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [newCount, setNewCount] = useState(0);
  const [pulseActive, setPulseActive] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(new Date());
  const audioCtx = useRef(null);
  const seenIds = useRef(new Set(MOCK_NEWS.map(n => n.id)));
  const intervalRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const playAlert = useCallback(() => {
    if (!soundEnabled) return;
    try {
      if (!audioCtx.current) audioCtx.current = new AudioContext();
      const ctx = audioCtx.current;
      [880, 1100, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.2);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.2);
      });
    } catch {}
  }, [soundEnabled]);

  const sendNotification = useCallback((item) => {
    if (!alertsEnabled || Notification.permission !== "granted") return;
    const cat = CATEGORY_CONFIG[item.category] || {};
    new Notification(`${cat.label || "📰"} ${item.ticker ? item.ticker + " · " : ""}${item.source}`, {
      body: item.title,
      icon: "icons/icon-192.png",
      vibrate: [200, 100, 200],
      tag: item.id,
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
    let allNew = [];
    for (const src of RSS_SOURCES) {
      try {
        const resp = await fetch(`${CORS_PROXY}${encodeURIComponent(src.url)}`);
        const data = await resp.json();
        allNew = [...allNew, ...parseRSSItems(data.contents, src.name)];
      } catch {}
    }
    const fresh = allNew.filter(item => !seenIds.current.has(item.id));
    if (fresh.length > 0) {
      fresh.forEach(item => seenIds.current.add(item.id));
      setNews(prev => [...fresh, ...prev].slice(0, 80));
      setNewCount(c => c + fresh.length);
      setPulseActive(true);
      setTimeout(() => setPulseActive(false), 2000);
      fresh.slice(0, 3).forEach((item, i) => {
        setTimeout(() => { playAlert(); sendNotification(item); }, i * 300);
      });
    }
    setLastUpdate(new Date());
    setRefreshing(false);
  }, [playAlert, sendNotification]);

  const startLive = () => {
    setIsLive(true); setNewCount(0);
    fetchFeeds();
    intervalRef.current = setInterval(fetchFeeds, 60000);
  };

  const stopLive = () => {
    setIsLive(false);
    clearInterval(intervalRef.current);
  };

  useEffect(() => () => clearInterval(intervalRef.current), []);

  const getAiSummary = async () => {
    setAiLoading(true); setAiSummary("");
    const headlines = news.slice(0, 12).map(n => `- ${n.title}`).join("\n");
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: `You are a sharp financial analyst. Summarize these headlines in 3-4 bullet points with key market themes and actionable insights.\n\nHeadlines:\n${headlines}` }],
        }),
      });
      const data = await resp.json();
      setAiSummary(data.content?.[0]?.text || "לא ניתן לקבל סיכום.");
    } catch { setAiSummary("שגיאה בקבלת סיכום."); }
    setAiLoading(false);
  };

  const filtered = news.filter(item => filter === "all" || item.category === filter);

  return React.createElement('div', { style: { minHeight:"100vh", background:"#0a0b0e", color:"#e8eaf0", fontFamily:"'IBM Plex Mono','Courier New',monospace", paddingBottom:40 } },
    React.createElement('div', { style: { position:"fixed", top:0, left:0, right:0, bottom:0, backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,212,255,0.012) 2px,rgba(0,212,255,0.012) 4px)", pointerEvents:"none", zIndex:0 } }),
    React.createElement('div', { style: { background:"rgba(13,17,23,0.98)", borderBottom:"1px solid rgba(0,212,255,0.15)", padding:"12px 16px", position:"sticky", top:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"space-between" } },
      React.createElement('div', { style: { display:"flex", alignItems:"center", gap:10 } },
        React.createElement('div', { style: { width:9, height:9, borderRadius:"50%", background: isLive ? "#00e676" : "#444", boxShadow: isLive ? "0 0 8px #00e676" : "none", transition:"all 0.3s" } }),
        React.createElement('span', { style: { fontSize:17, fontWeight:700, letterSpacing:"0.1em", color:"#00d4ff" } }, "MARKET", React.createElement('span', { style:{color:"#ff6d00"} }, "PULSE"))
      ),
      React.createElement('div', { style:{textAlign:"right"} },
        React.createElement('div', { style:{fontSize:11, color:"#00d4ff", fontWeight:700} }, now.toLocaleTimeString("en-US",{hour12:false})),
        React.createElement('div', { style:{fontSize:9, color:"#444"} }, lastUpdate.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}) + " last update")
      )
    ),
    React.createElement('div', { style:{maxWidth:680, margin:"0 auto", padding:"12px", position:"relative", zIndex:1} },
      React.createElement('div', { style:{display:"flex", gap:7, flexWrap:"wrap", marginBottom:12, alignItems:"center"} },
        React.createElement('button', { onClick: isLive ? stopLive : startLive, style:{border:"1px solid", padding:"7px 13px", borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"inherit", fontWeight:700, borderColor: isLive?"#ff1744":"#00e676", color: isLive?"#ff1744":"#00e676", background: isLive?"rgba(255,23,68,0.1)":"rgba(0,230,118,0.1)"} }, isLive ? (refreshing ? "⟳ FETCHING..." : "⬛ STOP") : "▶ LIVE"),
        React.createElement('button', { onClick: requestAlerts, style:{border:"1px solid", padding:"7px 13px", borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"inherit", borderColor: alertsEnabled?"#00d4ff":"#333", color: alertsEnabled?"#00d4ff":"#555", background: alertsEnabled?"rgba(0,212,255,0.08)":"transparent"} }, alertsEnabled ? "🔔 ON" : "🔔 OFF"),
        React.createElement('button', { onClick: ()=>setSoundEnabled(s=>!s), style:{border:"1px solid", padding:"7px 13px", borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"inherit", borderColor: soundEnabled?"#ffd700":"#333", color: soundEnabled?"#ffd700":"#555", background: soundEnabled?"rgba(255,215,0,0.08)":"transparent"} }, soundEnabled ? "🔊" : "🔇"),
        React.createElement('button', { onClick: getAiSummary, disabled: aiLoading, style:{border:"1px solid #e040fb", padding:"7px 13px", borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"inherit", color:"#e040fb", background:"rgba(224,64,251,0.08)", opacity: aiLoading?0.6:1} }, aiLoading ? "⟳ AI..." : "✦ AI"),
        newCount > 0 && React.createElement('div', { style:{marginLeft:"auto", background:"rgba(255,109,0,0.15)", color:"#ff6d00", border:"1px solid rgba(255,109,0,0.3)", padding:"4px 10px", borderRadius:4, fontSize:10, fontWeight:700} }, "+" + newCount + " NEW")
      ),
      aiSummary && React.createElement('div', { style:{background:"rgba(224,64,251,0.05)", border:"1px solid rgba(224,64,251,0.15)", borderRadius:6, padding:"12px 14px", marginBottom:12} },
        React.createElement('div', { style:{fontSize:9, color:"#e040fb", letterSpacing:"0.15em", marginBottom:8, fontWeight:700} }, "✦ AI MARKET INTELLIGENCE"),
        React.createElement('div', { style:{fontSize:12, lineHeight:1.7, color:"#d0c4e0", whiteSpace:"pre-wrap"} }, aiSummary)
      ),
      React.createElement('div', { style:{display:"flex", gap:5, flexWrap:"wrap", marginBottom:12} },
        ["all", ...Object.keys(CATEGORY_CONFIG)].map(cat =>
          React.createElement('button', { key:cat, onClick:()=>setFilter(cat), style:{border:"1px solid", padding:"4px 8px", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"inherit", transition:"all 0.15s", borderColor: filter===cat?(cat==="all"?"#fff":CATEGORY_CONFIG[cat]?.color):"rgba(255,255,255,0.07)", color: filter===cat?(cat==="all"?"#fff":CATEGORY_CONFIG[cat]?.color):"#444", background: filter===cat?(cat==="all"?"rgba(255,255,255,0.08)":CATEGORY_CONFIG[cat]?.bg):"transparent", fontWeight: filter===cat?700:400} }, cat==="all"?"ALL":CATEGORY_CONFIG[cat].label)
        )
      ),
      React.createElement('div', { style:{display:"flex", flexDirection:"column", gap:2} },
        filtered.length === 0 && React.createElement('div', { style:{textAlign:"center", padding:"30px", color:"#2a3040", fontSize:11, letterSpacing:"0.12em"} }, "NO NEWS IN THIS CATEGORY"),
        filtered.map((item, idx) => {
          const cat = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.analysis;
          return React.createElement('div', { key:item.id, onClick:()=>item.url&&item.url!=="#"&&window.open(item.url,"_blank"), style:{borderLeft:`3px solid ${cat.color}`, border:"1px solid rgba(255,255,255,0.04)", borderRadius:4, padding:"11px 12px", background: item.isNew?"rgba(0,212,255,0.03)":"rgba(255,255,255,0.015)", cursor: item.url!=="#"?"pointer":"default", animation: idx<3&&item.isNew?"slideIn 0.3s ease":"none"} },
            React.createElement('div', { style:{display:"flex", gap:8, alignItems:"flex-start", marginBottom:6} },
              React.createElement('div', { style:{padding:"2px 6px", borderRadius:3, fontSize:8, fontWeight:700, letterSpacing:"0.05em", whiteSpace:"nowrap", color:cat.color, background:cat.bg} }, cat.label),
              item.ticker && React.createElement('div', { style:{background:"rgba(255,255,255,0.07)", color:"#888", padding:"2px 6px", borderRadius:3, fontSize:9, fontWeight:700} }, item.ticker)
            ),
            React.createElement('div', { style:{fontSize:12, lineHeight:1.55, marginBottom:5, color: item.isNew?"#e8eaf0":"#7a8090", fontWeight: item.isNew?500:400} }, item.title),
            React.createElement('div', { style:{display:"flex", gap:10, fontSize:9, alignItems:"center"} },
              React.createElement('span', { style:{color:"#3a4050"} }, item.source),
              React.createElement('span', { style:{color:"#2a3040"} }, timeAgo(item.time)),
              item.isNew && React.createElement('span', { style:{background:"rgba(0,230,118,0.12)", color:"#00e676", padding:"1px 5px", borderRadius:2, fontWeight:700} }, "NEW")
            )
          );
        })
      ),
      React.createElement('div', { style:{marginTop:24, textAlign:"center", fontSize:8, color:"#1e2430", letterSpacing:"0.1em"} }, "MARKETPULSE · BENZINGA · REUTERS · MARKETWATCH · SEEKING ALPHA")
    ),
    React.createElement('style', null, `@keyframes slideIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } } ::-webkit-scrollbar { width:3px; } ::-webkit-scrollbar-thumb { background:rgba(0,212,255,0.15); }`)
  );
}

ReactDOM.render(React.createElement(App), document.getElementById('root'));
