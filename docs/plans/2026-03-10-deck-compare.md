# Deck Compare Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a deck comparison mode where users load two decks and view a summary diff (category totals + sub-category breakdown) and a side-by-side full table view.

**Architecture:** All code lives in `DeckMatrix.jsx`. The existing `App` component is refactored to extract its table rendering into a reusable `DeckTable` component. A new `CompareLoadScreen` handles fetching two decks in parallel, and `CompareView` renders two tabs: `SummaryDiff` and `SideBySide`. The root `App` manages which screen is active.

**Tech Stack:** React 19, Vite, no test framework — verify each task by running `npm run dev` and loading `vincent_data.json` via the JSON paste method.

---

### Task 1: Extract DeckTable from App

**Files:**
- Modify: `DeckMatrix.jsx`

The current `App` component mixes load-state management with table rendering. Split the table into its own component so it can be reused in side-by-side mode.

**Step 1: Find the table section in App**

In `DeckMatrix.jsx`, the `App` component returns JSX starting with the header div and ending with the table. Everything after `if (!cards) return <LoadScreen ... />` is the table view.

**Step 2: Create DeckTable component**

Extract the table JSX into a new component directly above `App`. It receives `cards`, `deckName`, and `onBack` as props. The `onBack` prop is called when the "← LOAD NEW DECK" button is clicked.

```jsx
function DeckTable({ cards, deckName, onBack }) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState(null);
  const [sortCol, setSortCol] = useState("grand_total");
  const [sortDir, setSortDir] = useState(-1);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [tooltip, setTooltip] = useState({ x: 0, y: 0 });

  // Move ALL existing logic and JSX from App (after the LoadScreen check) here.
  // Replace the inline setCards(null) call with onBack().
}
```

**Step 3: Simplify App to use DeckTable**

```jsx
export default function App() {
  const [screen, setScreen] = useState("load"); // "load" | "deck"
  const [cards, setCards] = useState(null);
  const [deckName, setDeckName] = useState("");

  if (screen === "load") {
    return (
      <LoadScreen onLoad={(c, name) => { setCards(c); setDeckName(name); setScreen("deck"); }} />
    );
  }
  return <DeckTable cards={cards} deckName={deckName} onBack={() => setScreen("load")} />;
}
```

**Step 4: Verify**

Run `npm run dev`, load a deck via JSON paste, confirm the table renders and "← LOAD NEW DECK" returns to the load screen.

**Step 5: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "refactor: extract DeckTable component from App"
```

---

### Task 2: Add Compare Mode Toggle to LoadScreen

**Files:**
- Modify: `DeckMatrix.jsx` — `LoadScreen` component

**Step 1: Add onCompareMode prop to LoadScreen**

`LoadScreen` gets a new `onCompareMode` prop — a callback with no arguments, called when the user clicks COMPARE DECKS.

**Step 2: Add the mode toggle above the existing tabs**

Insert this block at the top of the `LoadScreen` return, above the existing URL/JSON mode tabs:

```jsx
{/* Screen mode toggle */}
<div style={{ display:"flex", gap:8, marginBottom:24 }}>
  <button
    style={{ flex:1, padding:"8px", borderRadius:4, cursor:"pointer", background:"#f1f5f9", color:"#0d1117", border:"1px solid #f1f5f9", fontSize:10, fontFamily:"inherit", fontWeight:700, letterSpacing:"0.08em" }}>
    SINGLE DECK
  </button>
  <button onClick={onCompareMode}
    style={{ flex:1, padding:"8px", borderRadius:4, cursor:"pointer", background:"transparent", color:"#475569", border:"1px solid #1e293b", fontSize:10, fontFamily:"inherit", fontWeight:400, letterSpacing:"0.08em", transition:"all 0.15s" }}
    onMouseEnter={e => { e.currentTarget.style.color="#f1f5f9"; e.currentTarget.style.borderColor="#475569"; }}
    onMouseLeave={e => { e.currentTarget.style.color="#475569"; e.currentTarget.style.borderColor="#1e293b"; }}>
    COMPARE DECKS
  </button>
</div>
```

**Step 3: Pass onCompareMode from App**

In `App`, update the `LoadScreen` usage:

```jsx
<LoadScreen
  onLoad={(c, name) => { setCards(c); setDeckName(name); setScreen("deck"); }}
  onCompareMode={() => setScreen("compare-load")}
/>
```

Add `"compare-load"` to the screen state but leave it rendering nothing for now (the next task fills it in).

**Step 4: Verify**

Run `npm run dev`, confirm the COMPARE DECKS button appears and clicking it shows a blank screen (expected for now).

**Step 5: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "feat: add compare mode toggle to load screen"
```

---

### Task 3: Create CompareLoadScreen

**Files:**
- Modify: `DeckMatrix.jsx` — add `CompareLoadScreen` component

**Step 1: Create the component**

Add `CompareLoadScreen` directly above `LoadScreen`. It accepts `onLoad(cardsA, nameA, cardsB, nameB)` and `onBack` props.

```jsx
function CompareLoadScreen({ onLoad, onBack }) {
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [errorA, setErrorA] = useState("");
  const [errorB, setErrorB] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusA, setStatusA] = useState("");
  const [statusB, setStatusB] = useState("");

  const fetchDeck = async (input, setStatus) => {
    const id = extractDeckId(input);
    if (!id) throw new Error("Couldn't find a deck ID.");
    const apiUrl = `https://api.commandersalt.com/decks?id=${id}`;
    const proxies = [
      { label: "direct", url: apiUrl },
      { label: "proxy 1", url: `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}` },
      { label: "proxy 2", url: `https://corsproxy.io/?${encodeURIComponent(apiUrl)}` },
    ];
    for (const { label, url } of proxies) {
      try {
        setStatus(`Trying ${label}…`);
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (data?.cards) return data;
      } catch {}
    }
    throw new Error("All fetch attempts failed. Try the JSON paste method.");
  };

  const handleLoad = async () => {
    setErrorA(""); setErrorB("");
    let valid = true;
    if (!inputA.trim()) { setErrorA("Required"); valid = false; }
    if (!inputB.trim()) { setErrorB("Required"); valid = false; }
    if (!valid) return;
    setLoading(true);
    const [resA, resB] = await Promise.allSettled([
      fetchDeck(inputA, setStatusA),
      fetchDeck(inputB, setStatusB),
    ]);
    setLoading(false);
    setStatusA(""); setStatusB("");
    if (resA.status === "rejected") { setErrorA(resA.reason.message); }
    if (resB.status === "rejected") { setErrorB(resB.reason.message); }
    if (resA.status === "fulfilled" && resB.status === "fulfilled") {
      const dataA = resA.value, dataB = resB.value;
      onLoad(
        processApiData(dataA), dataA.name || inputA.trim(),
        processApiData(dataB), dataB.name || inputB.trim(),
      );
    }
  };

  const inputStyle = (err) => ({
    width:"100%", boxSizing:"border-box", background:"#111318",
    border:`1px solid ${err ? "#f87171" : "#1e293b"}`, color:"#cbd5e1",
    padding:"10px 12px", borderRadius:4, fontSize:11, fontFamily:"inherit",
    outline:"none", marginBottom:6,
  });

  return (
    <div style={{ minHeight:"100vh", background:"#0d0f14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Courier New', monospace" }}>
      <div style={{ width:520, padding:40 }}>
        <div style={{ fontSize:22, fontWeight:700, color:"#f1f5f9", letterSpacing:"0.06em", marginBottom:6 }}>DECK COMPARE</div>
        <div style={{ height:2, background:"linear-gradient(90deg,#4ade80,#818cf8,#fb923c,#f472b6)", marginBottom:24 }} />

        {/* Back link */}
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:"#334155", fontSize:10, fontFamily:"inherit", cursor:"pointer", letterSpacing:"0.06em", marginBottom:20, padding:0 }}
          onMouseEnter={e => e.currentTarget.style.color="#94a3b8"} onMouseLeave={e => e.currentTarget.style.color="#334155"}>
          ← SINGLE DECK MODE
        </button>

        {[["A", inputA, setInputA, errorA, setErrorA, statusA], ["B", inputB, setInputB, errorB, setErrorB, statusB]].map(([label, val, setVal, err, setErr, status]) => (
          <div key={label} style={{ marginBottom:16 }}>
            <div style={{ fontSize:10, color:"#334155", marginBottom:6, letterSpacing:"0.06em" }}>DECK {label}</div>
            <input value={val} onChange={e => { setVal(e.target.value); setErr(""); }}
              placeholder="URL or 32-character deck ID"
              style={inputStyle(err)} />
            {err && <div style={{ fontSize:11, color:"#f87171", marginBottom:4 }}>{err}</div>}
            {status && <div style={{ fontSize:11, color:"#475569" }}>{status}</div>}
          </div>
        ))}

        <button onClick={handleLoad} disabled={loading || !inputA.trim() || !inputB.trim()}
          style={{ width:"100%", padding:"10px", borderRadius:4, cursor: loading || !inputA.trim() || !inputB.trim() ? "not-allowed" : "pointer", background: loading || !inputA.trim() || !inputB.trim() ? "#111318" : "#f1f5f9", color: loading || !inputA.trim() || !inputB.trim() ? "#334155" : "#0d0f14", border:"1px solid #1e293b", fontSize:11, fontFamily:"inherit", fontWeight:700, letterSpacing:"0.08em", transition:"all 0.15s" }}>
          {loading ? "LOADING…" : "COMPARE DECKS"}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Wire into App**

Add compare state to `App` and render `CompareLoadScreen` when `screen === "compare-load"`:

```jsx
export default function App() {
  const [screen, setScreen] = useState("load");
  const [cards, setCards] = useState(null);
  const [deckName, setDeckName] = useState("");
  const [compareData, setCompareData] = useState(null); // { cardsA, nameA, cardsB, nameB }

  if (screen === "load") {
    return (
      <LoadScreen
        onLoad={(c, name) => { setCards(c); setDeckName(name); setScreen("deck"); }}
        onCompareMode={() => setScreen("compare-load")}
      />
    );
  }
  if (screen === "compare-load") {
    return (
      <CompareLoadScreen
        onLoad={(cA, nA, cB, nB) => { setCompareData({ cardsA: cA, nameA: nA, cardsB: cB, nameB: nB }); setScreen("compare"); }}
        onBack={() => setScreen("load")}
      />
    );
  }
  if (screen === "compare") {
    return <div style={{ color:"#f1f5f9", padding:40 }}>Compare view coming soon…</div>;
  }
  return <DeckTable cards={cards} deckName={deckName} onBack={() => setScreen("load")} />;
}
```

**Step 3: Verify**

Run `npm run dev`. Click COMPARE DECKS, enter two deck IDs (or paste JSON in devtools if needed), confirm both load and "Compare view coming soon…" appears.

**Step 4: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "feat: add CompareLoadScreen with parallel deck fetch"
```

---

### Task 4: Create CompareView Shell with Tabs

**Files:**
- Modify: `DeckMatrix.jsx` — add `CompareView` component

**Step 1: Create CompareView**

Add directly above `App`. Receives `cardsA`, `nameA`, `cardsB`, `nameB`, `onBack`.

```jsx
function CompareView({ cardsA, nameA, cardsB, nameB, onBack }) {
  const [tab, setTab] = useState("diff"); // "diff" | "side"

  return (
    <div style={{ minHeight:"100vh", background:"#0d0f14", color:"#e2e8f0", fontFamily:"'Courier New', monospace" }}>
      {/* Header */}
      <div style={{ padding:"16px 20px 0", borderBottom:"1px solid #1e293b" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:12, marginBottom:8 }}>
          <span style={{ fontSize:16, fontWeight:700, letterSpacing:"0.06em", color:"#f1f5f9" }}>
            {nameA.toUpperCase()}
          </span>
          <span style={{ fontSize:12, color:"#475569" }}>vs</span>
          <span style={{ fontSize:16, fontWeight:700, letterSpacing:"0.06em", color:"#f1f5f9" }}>
            {nameB.toUpperCase()}
          </span>
          <button onClick={onBack}
            style={{ marginLeft:"auto", background:"transparent", color:"#334155", border:"1px solid #1e293b", padding:"2px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"inherit", letterSpacing:"0.06em" }}
            onMouseEnter={e => e.currentTarget.style.color="#94a3b8"}
            onMouseLeave={e => e.currentTarget.style.color="#334155"}>
            ← NEW COMPARISON
          </button>
        </div>

        <div style={{ height:2, background:"linear-gradient(90deg,#4ade80,#818cf8,#fb923c,#f472b6)", marginBottom:0 }} />

        {/* Tabs */}
        <div style={{ display:"flex", gap:0, borderBottom:"1px solid #1e293b" }}>
          {[["diff","SUMMARY DIFF"],["side","SIDE BY SIDE"]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ background:"transparent", border:"none", borderBottom:`2px solid ${tab===key?"#f1f5f9":"transparent"}`, color:tab===key?"#f1f5f9":"#475569", padding:"8px 16px 10px", cursor:"pointer", fontSize:10, fontFamily:"inherit", fontWeight:tab===key?700:400, letterSpacing:"0.06em", marginBottom:-1, transition:"all 0.15s" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ padding:tab==="side"?0:24 }}>
        {tab === "diff"
          ? <SummaryDiff cardsA={cardsA} nameA={nameA} cardsB={cardsB} nameB={nameB} />
          : <SideBySide cardsA={cardsA} nameA={nameA} cardsB={cardsB} nameB={nameB} />
        }
      </div>
    </div>
  );
}
```

**Step 2: Replace placeholder in App**

```jsx
if (screen === "compare") {
  return (
    <CompareView
      cardsA={compareData.cardsA} nameA={compareData.nameA}
      cardsB={compareData.cardsB} nameB={compareData.nameB}
      onBack={() => setScreen("compare-load")}
    />
  );
}
```

Add stub components above `CompareView` so it compiles:

```jsx
function SummaryDiff({ cardsA, nameA, cardsB, nameB }) {
  return <div style={{ color:"#475569" }}>Summary diff coming soon…</div>;
}
function SideBySide({ cardsA, nameA, cardsB, nameB }) {
  return <div style={{ color:"#475569" }}>Side by side coming soon…</div>;
}
```

**Step 3: Verify**

Load two decks, confirm the compare header shows both names, tabs switch without errors.

**Step 4: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "feat: add CompareView shell with tab navigation"
```

---

### Task 5: Implement SummaryDiff

**Files:**
- Modify: `DeckMatrix.jsx` — replace `SummaryDiff` stub

**Step 1: Write a helper to compute deck totals**

Add this helper function above `SummaryDiff`:

```jsx
function computeDeckTotals(cards) {
  const catTotals = {};
  for (const cat of Object.keys(CAT_CONFIG)) {
    catTotals[cat] = Math.round(cards.reduce((s, c) => s + (c.scores[cat]?.score || 0), 0) * 10) / 10;
  }
  const grandTotal = Math.round(cards.reduce((s, c) => s + c.power_total + c.synergy + c.bias + c.manabase, 0) * 10) / 10;
  const synergy = Math.round(cards.reduce((s, c) => s + c.synergy, 0) * 10) / 10;

  // Sub-category totals: { [sub]: { score, count } }
  const subTotals = {};
  for (const card of cards) {
    for (const [cat, catData] of Object.entries(card.scores)) {
      for (const entry of catData.subs || []) {
        const key = entry.combo ? `${cat}::combo::${entry.combo}` : `${cat}::${entry.sub}`;
        if (!subTotals[key]) subTotals[key] = { cat, sub: entry.sub, combo: entry.combo || null, score: 0, count: 0 };
        subTotals[key].score += entry.score;
        subTotals[key].count += 1;
      }
    }
  }

  // Collect all unique bracket flags
  const flags = [...new Set(cards.flatMap(c => c.bracket_flags || []))].sort();

  return { catTotals, grandTotal, synergy, subTotals, flags };
}
```

**Step 2: Replace the SummaryDiff stub**

```jsx
function SummaryDiff({ cardsA, nameA, cardsB, nameB }) {
  const totA = computeDeckTotals(cardsA);
  const totB = computeDeckTotals(cardsB);
  const maxGrand = Math.max(totA.grandTotal, totB.grandTotal, 1);

  const Delta = ({ a, b, decimals = 0 }) => {
    const d = Math.round((a - b) * Math.pow(10, decimals)) / Math.pow(10, decimals);
    if (d === 0) return <span style={{ color:"#334155", fontSize:11 }}>—</span>;
    return (
      <span style={{ fontSize:11, fontWeight:700, color: d > 0 ? "#4ade80" : "#f87171" }}>
        {d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(decimals)}
      </span>
    );
  };

  const ScoreCol = ({ val, max, color }) => {
    const pct = max > 0 ? Math.min(100, (val / max) * 100) : 0;
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:160 }}>
        <div style={{ flex:1, height:6, background:"#1e293b", borderRadius:3, overflow:"hidden" }}>
          <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:3 }} />
        </div>
        <span style={{ color, fontWeight:700, fontSize:12, minWidth:40, textAlign:"right" }}>{val}</span>
      </div>
    );
  };

  // Collect all sub keys present in either deck
  const allSubKeys = [...new Set([...Object.keys(totA.subTotals), ...Object.keys(totB.subTotals)])];

  return (
    <div style={{ maxWidth:900 }}>
      {/* Grand total row */}
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24, padding:"16px 20px", background:"#090b10", borderRadius:6, border:"1px solid #1e293b" }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:10, color:"#fbbf24", fontWeight:700, letterSpacing:"0.08em", marginBottom:4 }}>{nameA.toUpperCase()}</div>
          <ScoreCol val={totA.grandTotal} max={maxGrand} color="#fbbf24" />
        </div>
        <div style={{ textAlign:"center", minWidth:80 }}>
          <div style={{ fontSize:10, color:"#475569", letterSpacing:"0.06em", marginBottom:4 }}>GRAND TOTAL</div>
          <Delta a={totA.grandTotal} b={totB.grandTotal} />
        </div>
        <div style={{ flex:1, textAlign:"right" }}>
          <div style={{ fontSize:10, color:"#fbbf24", fontWeight:700, letterSpacing:"0.08em", marginBottom:4 }}>{nameB.toUpperCase()}</div>
          <ScoreCol val={totB.grandTotal} max={maxGrand} color="#fbbf24" />
        </div>
      </div>

      {/* Synergy row */}
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24, padding:"12px 20px", background:"#090b10", borderRadius:6, border:"1px solid #1e293b" }}>
        <span style={{ flex:1, fontWeight:700, color:"#38bdf8", fontSize:12 }}>{totA.synergy.toFixed(1)}</span>
        <span style={{ minWidth:80, textAlign:"center", fontSize:10, color:"#38bdf8", letterSpacing:"0.06em" }}>SYNERGY</span>
        <div style={{ flex:1, textAlign:"right", display:"flex", justifyContent:"flex-end", alignItems:"center", gap:8 }}>
          <Delta a={totA.synergy} b={totB.synergy} decimals={1} />
          <span style={{ fontWeight:700, color:"#38bdf8", fontSize:12 }}>{totB.synergy.toFixed(1)}</span>
        </div>
      </div>

      {/* Bracket flags */}
      {(totA.flags.length > 0 || totB.flags.length > 0) && (
        <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24, padding:"12px 20px", background:"#090b10", borderRadius:6, border:"1px solid #1e293b" }}>
          <div style={{ flex:1, display:"flex", gap:4, flexWrap:"wrap" }}>
            {totA.flags.map(f => { const cfg = FLAG_CONFIG[f]; return <span key={f} style={{ borderRadius:3, fontSize:9, fontWeight:700, padding:"1px 5px", background:cfg?.bg||"#0f172a", color:cfg?.color||"#94a3b8", border:`1px solid ${cfg?.color||"#94a3b8"}` }}>{cfg?.label||f}</span>; })}
            {totA.flags.length === 0 && <span style={{ color:"#1e293b", fontSize:11 }}>none</span>}
          </div>
          <span style={{ minWidth:80, textAlign:"center", fontSize:10, color:"#e879f9", letterSpacing:"0.06em" }}>FLAGS</span>
          <div style={{ flex:1, display:"flex", gap:4, flexWrap:"wrap", justifyContent:"flex-end" }}>
            {totB.flags.map(f => { const cfg = FLAG_CONFIG[f]; return <span key={f} style={{ borderRadius:3, fontSize:9, fontWeight:700, padding:"1px 5px", background:cfg?.bg||"#0f172a", color:cfg?.color||"#94a3b8", border:`1px solid ${cfg?.color||"#94a3b8"}` }}>{cfg?.label||f}</span>; })}
            {totB.flags.length === 0 && <span style={{ color:"#1e293b", fontSize:11 }}>none</span>}
          </div>
        </div>
      )}

      {/* Category blocks */}
      {Object.entries(CAT_CONFIG).map(([cat, cfg]) => {
        const maxCat = Math.max(totA.catTotals[cat], totB.catTotals[cat], 1);
        const catSubKeys = allSubKeys.filter(k => k.startsWith(`${cat}::`));
        const maxSub = Math.max(...catSubKeys.map(k => Math.max(totA.subTotals[k]?.score||0, totB.subTotals[k]?.score||0)), 1);

        return (
          <div key={cat} style={{ marginBottom:16, borderRadius:6, overflow:"hidden", border:`1px solid ${cfg.color}33` }}>
            {/* Category header */}
            <div style={{ display:"flex", alignItems:"center", gap:16, padding:"12px 20px", background:cfg.bg }}>
              <div style={{ flex:1 }}>
                <ScoreCol val={totA.catTotals[cat]} max={maxCat} color={cfg.color} />
              </div>
              <div style={{ textAlign:"center", minWidth:120 }}>
                <span style={{ fontSize:11, fontWeight:700, color:cfg.color, letterSpacing:"0.08em" }}>{cfg.label.toUpperCase()}</span>
                <div style={{ marginTop:2 }}><Delta a={totA.catTotals[cat]} b={totB.catTotals[cat]} decimals={1} /></div>
              </div>
              <div style={{ flex:1 }}>
                <ScoreCol val={totB.catTotals[cat]} max={maxCat} color={cfg.color} />
              </div>
            </div>

            {/* Sub-category rows */}
            {catSubKeys.map((k, i) => {
              const sA = totA.subTotals[k];
              const sB = totB.subTotals[k];
              const scoreA = sA?.score || 0;
              const scoreB = sB?.score || 0;
              const countA = sA?.count || 0;
              const countB = sB?.count || 0;
              const meta = totA.subTotals[k] || totB.subTotals[k];
              const label = meta.combo ? `↳ ${formatComboLabel(meta.combo)}` : subLabel(meta.sub);
              const pctA = maxSub > 0 ? Math.min(100, (scoreA / maxSub) * 100) : 0;
              const pctB = maxSub > 0 ? Math.min(100, (scoreB / maxSub) * 100) : 0;

              return (
                <div key={k} style={{ display:"flex", alignItems:"center", gap:16, padding:"7px 20px 7px 32px", background: i%2===0 ? "#0d0f14" : "#090b10", borderTop:`1px solid #0f1520` }}>
                  {/* Deck A bar + count */}
                  <div style={{ flex:1, display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ flex:1, height:4, background:"#1e293b", borderRadius:2, overflow:"hidden" }}>
                      <div style={{ width:`${pctA}%`, height:"100%", background: scoreA > 0 ? cfg.color : "transparent", borderRadius:2 }} />
                    </div>
                    <span style={{ color: scoreA > 0 ? cfg.text : "#1e293b", fontSize:10, minWidth:60, textAlign:"right" }}>
                      {scoreA > 0 ? `${scoreA.toFixed(1)} (${countA})` : "—"}
                    </span>
                  </div>
                  {/* Label */}
                  <div style={{ minWidth:160, textAlign:"center", fontSize:10, color: meta.combo ? "#475569" : "#64748b", fontStyle: meta.combo ? "italic" : "normal", letterSpacing:"0.04em" }}>
                    {label}
                  </div>
                  {/* Deck B bar + count */}
                  <div style={{ flex:1, display:"flex", alignItems:"center", gap:8, flexDirection:"row-reverse" }}>
                    <div style={{ flex:1, height:4, background:"#1e293b", borderRadius:2, overflow:"hidden" }}>
                      <div style={{ width:`${pctB}%`, height:"100%", background: scoreB > 0 ? cfg.color : "transparent", borderRadius:2 }} />
                    </div>
                    <span style={{ color: scoreB > 0 ? cfg.text : "#1e293b", fontSize:10, minWidth:60, textAlign:"left" }}>
                      {scoreB > 0 ? `${scoreB.toFixed(1)} (${countB})` : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 3: Verify**

Load two decks, go to SUMMARY DIFF tab. Confirm category bars render, sub-categories appear under each category, counts show correctly, delta arrows point the right direction.

**Step 4: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "feat: implement SummaryDiff with sub-category breakdown"
```

---

### Task 6: Implement SideBySide

**Files:**
- Modify: `DeckMatrix.jsx` — replace `SideBySide` stub

**Step 1: Replace the SideBySide stub**

```jsx
function SideBySide({ cardsA, nameA, cardsB, nameB }) {
  return (
    <div style={{ display:"flex", gap:0, minHeight:"calc(100vh - 120px)" }}>
      <div style={{ flex:1, borderRight:"2px solid #1e293b", overflow:"auto" }}>
        <DeckTable cards={cardsA} deckName={nameA} onBack={null} embedded />
      </div>
      <div style={{ flex:1, overflow:"auto" }}>
        <DeckTable cards={cardsB} deckName={nameB} onBack={null} embedded />
      </div>
    </div>
  );
}
```

**Step 2: Update DeckTable to support embedded mode**

Add an `embedded` prop to `DeckTable`. When `embedded` is true, suppress the "← LOAD NEW DECK" button and shrink the top padding:

```jsx
function DeckTable({ cards, deckName, onBack, embedded = false }) {
  // ... existing state ...

  // In the header div, change:
  // padding:"16px 20px 0"  →  padding: embedded ? "10px 12px 0" : "16px 20px 0"

  // The back button — only render if !embedded:
  {!embedded && (
    <button onClick={onBack} ...>← LOAD NEW DECK</button>
  )}
```

**Step 3: Verify**

Load two decks, switch to SIDE BY SIDE tab. Confirm both tables render independently, sort/search works on each, columns are reasonably readable. (Note: on smaller screens the tables will be narrow — this is acceptable.)

**Step 4: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "feat: implement SideBySide with dual DeckTable"
```

---

### Task 7: Final Polish + Cleanup

**Files:**
- Modify: `DeckMatrix.jsx`

**Step 1: Restore active styling on SINGLE DECK button in LoadScreen**

The SINGLE DECK button in the toggle always appears active. That's correct — but also ensure hovering COMPARE DECKS gives a clear affordance.

**Step 2: Ensure COMPARE DECKS toggle on LoadScreen also has back-from-compare styling**

When the user returns from compare mode to the load screen, the mode toggle should still show SINGLE DECK as active. No state change needed — the toggle always defaults to single.

**Step 3: Final build check**

```bash
npm run build
```

Expected: clean build, no warnings about unused variables (except the pre-existing `front_cards` lint note).

**Step 4: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "feat: deck compare feature complete"
```
