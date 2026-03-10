import { useState, useMemo, useEffect } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const CAT_CONFIG = {
  consistency:   { label: "Consistency",    color: "#4ade80", bg: "#052e16", pill: "#14532d", text: "#bbf7d0" },
  interaction:   { label: "Interaction",    color: "#818cf8", bg: "#1e1b4b", pill: "#312e81", text: "#c7d2fe" },
  efficiency:    { label: "Efficiency",     color: "#fb923c", bg: "#431407", pill: "#7c2d12", text: "#fed7aa" },
  winConditions: { label: "Win Conditions", color: "#f472b6", bg: "#500724", pill: "#831843", text: "#fbcfe8" },
};

const SUB_LABELS = {
  tutors: "tutors", draw: "draw", recursion: "recursion", topdeck: "top deck", multipliers: "multipliers",
  spotRemoval: "spot removal", boardWipes: "board wipes", counters: "counterspells", stax: "stax",
  taxes: "taxes", graveyard: "graveyard", evasion: "evasion", otherControl: "other control", discard: "discard",
  fastmana: "fast mana", ramp: "ramp", costReduction: "cost reduction",
  wincon: "win con", combos: "combo", wincon_stompy: "stompy", wincon_burn: "burn",
  wincon_tokens: "tokens", wincon_combat: "combat",
};

// Fallback sub-lists used only if the API doesn't provide subCategories
const CAT_SUBS = {
  consistency:   ["tutors", "draw", "recursion", "topdeck", "multipliers"],
  interaction:   ["spotRemoval", "boardWipes", "counters", "stax", "taxes", "graveyard", "evasion", "otherControl", "discard"],
  efficiency:    ["fastmana", "ramp", "costReduction"],
  winConditions: ["wincon", "combos"],
};

const MANA_CATS = ["landScores", "rockScores", "ritualScores", "landRampScores", "otherScores", "dorkScores", "treasureScores"];

const FLAG_CONFIG = {
  GC:    { label: "GC",   color: "#f97316", bg: "#2d1000", title: "Game Changer" },
  CEDH:  { label: "cEDH", color: "#e879f9", bg: "#2d0a2d", title: "cEDH Staple" },
  COMBO: { label: "∞",    color: "#38bdf8", bg: "#0c2a3d", title: "Early Infinite Combo" },
  MLD:   { label: "MLD",  color: "#f87171", bg: "#2d0a0a", title: "Mass Land Denial" },
  ET:    { label: "ET",   color: "#a78bfa", bg: "#1e1040", title: "Extra Turns" },
};

// ─── Data processing ──────────────────────────────────────────────────────────

function processApiData(data) {
  const cards_raw = data.cards;
  const pl_scoring = data.details.powerLevel.scoring;
  const syn_list = data.details.synergy?.list || {};
  const mana_breakdown = data.details.manabase?.breakdown || {};
  const salt_edhrec = data.details.salt?.scoring?.edhrec?.list || {};
  const brackets_cats = data.details.brackets?.categories || {};
  const front_cards = new Set(Object.entries(cards_raw).filter(([, c]) => c.isFrontFace !== false).map(([id]) => id));

  const resolvedCatSubs = Object.fromEntries(
    Object.keys(CAT_SUBS).map(cat => [cat, pl_scoring[cat]?.subCategories || CAT_SUBS[cat]])
  );

  // Power scores
  const card_scores = {};
  for (const [bigcat, subs] of Object.entries(resolvedCatSubs)) {
    for (const sub of subs) {
      const subdata = pl_scoring[sub];
      if (!subdata?.list || typeof subdata.list !== "object") continue;
      for (const [entry_id, entry_data] of Object.entries(subdata.list)) {
        if (!entry_data || typeof entry_data !== "object") continue;
        const s = entry_data.score || 0;
        if (s <= 0) continue;
        const targets = entry_data.cards || [entry_data.id || entry_id];
        for (const raw_id of targets) {
          const card_id = cards_raw[raw_id]?.frontFaceId || raw_id;
          if (!card_scores[card_id]) card_scores[card_id] = Object.fromEntries(Object.keys(resolvedCatSubs).map(c => [c, { score: 0, subs: [] }]));
          card_scores[card_id][bigcat].score += s;
          const entry = { sub, score: Math.round(s * 100) / 100 };
          if (entry_data.cards) entry.combo = entry_id;
          card_scores[card_id][bigcat].subs.push(entry);
        }
      }
    }
  }

  // Synergy + bias
  function getCardSynergy(card_data) {
    let total = 0, bias = 0;
    for (const etype of ["triggers", "abilities", "replacements", "statics", "enablers"]) {
      for (const entry of Object.values(card_data[etype] || {})) {
        if (!entry || typeof entry !== "object") continue;
        total += entry.conditionScoring?.total || 0;
        for (const src_key of ["sources", "cardsOfSupportingType", "enablers"]) {
          for (const src of entry[src_key] || []) {
            if (src?.supportCondition?.scoreBias) bias += src.supportCondition.scoreBias;
          }
        }
      }
    }
    return [Math.round(total * 10) / 10, Math.round(bias * 100) / 100];
  }

  // Mana producers
  const mana_producers = {};
  for (const cat of MANA_CATS) {
    for (const card_id of Object.keys(mana_breakdown[cat] || {})) {
      const front = cards_raw[card_id]?.frontFaceId || card_id;
      mana_producers[front] = cat.replace("Scores", "");
    }
  }

  // Bracket flags
  const bracket_flags = {};
  const flag_map = { gameChangers: "GC", cedhStaples: "CEDH", earlyGameInfiniteCombos: "COMBO", massLandDenial: "MLD", extraTurns: "ET" };
  for (const [cat, cdata] of Object.entries(brackets_cats)) {
    if (!flag_map[cat]) continue;
    for (const entry of cdata.list || []) {
      if (cat === "earlyGameInfiniteCombos") {
        const combo_cards = pl_scoring.combos?.list?.[entry]?.cards || [];
        for (const cid of combo_cards) {
          const front = cards_raw[cid]?.frontFaceId || cid;
          if (!bracket_flags[front]) bracket_flags[front] = [];
          if (!bracket_flags[front].includes(flag_map[cat])) bracket_flags[front].push(flag_map[cat]);
        }
      } else {
        const front = cards_raw[entry]?.frontFaceId || entry;
        if (!bracket_flags[front]) bracket_flags[front] = [];
        if (!bracket_flags[front].includes(flag_map[cat])) bracket_flags[front].push(flag_map[cat]);
      }
    }
  }

  // Build final card list
  const result = [];
  for (const [cid, cdata] of Object.entries(cards_raw)) {
    if (cdata.isFrontFace === false) continue;
    const scores = card_scores[cid] || Object.fromEntries(Object.keys(CAT_SUBS).map(c => [c, { score: 0, subs: [] }]));
    for (const cat of Object.keys(scores)) scores[cat].score = Math.round(scores[cat].score * 10) / 10;
    const power_total = Math.round(Object.values(scores).reduce((s, v) => s + v.score, 0) * 10) / 10;
    const [synergy, bias] = getCardSynergy(syn_list[cid] || {});
    const manabase = mana_producers[cid] ? 10 : 0;
    result.push({
      id: cid, name: cdata.name,
      isCommander: cdata.isCommander || false,
      salt: cdata.salt || "0",
      imageUri: cdata.imageUri || "",
      types: cdata.types || "",
      count: cdata.count || 1,
      price: cdata.price?.usd || "0",
      scores, power_total, synergy, bias, manabase,
      manabase_cat: mana_producers[cid] || "",
      salt_score: Math.round((salt_edhrec[cid]?.score || 0) * 100) / 100,
      bracket_flags: (bracket_flags[cid] || []).sort(),
    });
  }

  result.sort((a, b) => (b.power_total + b.synergy + b.bias + b.manabase) - (a.power_total + a.synergy + a.bias + a.manabase));
  return result;
}

function extractDeckId(input) {
  const trimmed = input.trim();
  // Raw 32-char hex ID
  if (/^[a-f0-9]{32}$/.test(trimmed)) return trimmed;
  // Any URL containing a 32-char hex segment
  const match = trimmed.match(/[a-f0-9]{32}/);
  return match ? match[0] : null;
}

// ─── UI Components ────────────────────────────────────────────────────────────

function formatComboLabel(id) {
  return id.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function subLabel(sub) {
  if (SUB_LABELS[sub]) return SUB_LABELS[sub];
  // e.g. "wincon_groupslug" -> "groupslug"
  const stripped = sub.startsWith("wincon_") ? sub.slice(7) : sub;
  return stripped.replace(/_/g, " ");
}

function ScoreBar({ score, maxScore, catKey }) {
  const c = CAT_CONFIG[catKey];
  const pct = maxScore > 0 ? Math.min(100, (score / maxScore) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
      <div style={{ flex: 1, height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: c.color, borderRadius: 2, transition: "width 0.2s" }} />
      </div>
      <span style={{ color: score > 0 ? c.color : "#334155", fontSize: 11, fontWeight: 700, minWidth: 32, textAlign: "right" }}>
        {score > 0 ? score.toFixed(1) : "—"}
      </span>
    </div>
  );
}

function SubTooltip({ subs, catKey }) {
  const c = CAT_CONFIG[catKey];
  if (!subs?.length) return null;
  const grouped = [];
  const subTotals = {};
  for (const entry of subs) {
    if (entry.combo) grouped.push({ label: formatComboLabel(entry.combo), score: entry.score, isCombo: true });
    else subTotals[entry.sub] = (subTotals[entry.sub] || 0) + entry.score;
  }
  for (const [sub, score] of Object.entries(subTotals)) grouped.unshift({ label: subLabel(sub), score, isCombo: false });
  return (
    <div style={{
      position: "absolute", zIndex: 200, bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)",
      background: "#0d1117", border: `1px solid ${c.color}66`, borderRadius: 6,
      padding: "8px 10px", minWidth: 170, maxWidth: 260, boxShadow: "0 8px 24px #000000aa", pointerEvents: "none",
    }}>
      <div style={{ fontSize: 10, color: c.color, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 5 }}>{c.label.toUpperCase()}</div>
      {grouped.map(({ label, score, isCombo }, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, marginBottom: 2 }}>
          <span style={{ color: isCombo ? "#64748b" : "#94a3b8", fontStyle: isCombo ? "italic" : "normal", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
            {isCombo ? "↳ " : ""}{label}
          </span>
          <span style={{ fontWeight: 700, color: c.text, flexShrink: 0 }}>{score.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

function ScoreCell({ card, catKey, maxScore }) {
  const [hovered, setHovered] = useState(false);
  const score = card.scores[catKey]?.score || 0;
  const subs = card.scores[catKey]?.subs || [];
  const c = CAT_CONFIG[catKey];
  return (
    <td onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ padding: "6px 10px", verticalAlign: "middle", position: "relative", borderRight: "1px solid #1e293b",
        background: hovered && score > 0 ? c.bg + "55" : "transparent", transition: "background 0.1s" }}>
      <ScoreBar score={score} maxScore={maxScore} catKey={catKey} />
      {hovered && subs.length > 0 && <SubTooltip subs={subs} catKey={catKey} />}
    </td>
  );
}

function Badge({ n, thresholds, decimals = 1 }) {
  const tier = thresholds.find(t => n >= t.min) || thresholds[thresholds.length - 1];
  return (
    <div style={{ borderRadius: 4, display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: tier.bg, color: tier.color, fontWeight: 700, fontSize: 11, padding: "2px 7px",
      border: `1.5px solid ${tier.color}` }}>
      {n > 0 ? n.toFixed(decimals) : "—"}
    </div>
  );
}

const POWER_T  = [{min:40,color:"#4ade80",bg:"#14532d"},{min:20,color:"#818cf8",bg:"#312e81"},{min:10,color:"#fb923c",bg:"#431407"},{min:1,color:"#94a3b8",bg:"#1e293b"},{min:0,color:"#1e293b",bg:"transparent"}];
const SYN_T    = [{min:50,color:"#38bdf8",bg:"#0c2a3d"},{min:20,color:"#7dd3fc",bg:"#0a1e2e"},{min:5,color:"#93c5fd",bg:"#0a1520"},{min:0.1,color:"#64748b",bg:"#0f172a"},{min:0,color:"#1e293b",bg:"transparent"}];
const BIAS_T   = [{min:30,color:"#a78bfa",bg:"#1e1040"},{min:15,color:"#c4b5fd",bg:"#160e33"},{min:5,color:"#ddd6fe",bg:"#100b27"},{min:0.01,color:"#64748b",bg:"#0f172a"},{min:0,color:"#1e293b",bg:"transparent"}];
const GRAND_T  = [{min:150,color:"#fbbf24",bg:"#2d1f00"},{min:80,color:"#f97316",bg:"#2d1000"},{min:40,color:"#e879f9",bg:"#2d0a2d"},{min:10,color:"#94a3b8",bg:"#1e293b"},{min:0,color:"#1e293b",bg:"transparent"}];
const SALT_T   = [{min:1.5,color:"#f87171",bg:"#2d0a0a"},{min:1.0,color:"#fb923c",bg:"#2d1000"},{min:0.5,color:"#fbbf24",bg:"#2d1f00"},{min:0,color:"#94a3b8",bg:"#0f172a"}];

function ManaBadge({ cat }) {
  const colors = { land:"#86efac", rock:"#fde68a", ritual:"#fca5a5", dork:"#6ee7b7", treasure:"#fcd34d", landRamp:"#a5f3fc", other:"#d1d5db" };
  const color = colors[cat] || "#94a3b8";
  return <div style={{ borderRadius:4, display:"inline-flex", alignItems:"center", justifyContent:"center", background:"#1a1a1a", color, fontWeight:700, fontSize:10, padding:"2px 7px", border:`1.5px solid ${color}` }}>{cat || "—"}</div>;
}

function TagsCell({ card }) {
  const tags = [];
  for (const [catKey, catCfg] of Object.entries(CAT_CONFIG)) {
    const catData = card.scores[catKey];
    if (!catData?.subs?.length) continue;
    const subTotals = {};
    let hasCombo = false;
    for (const entry of catData.subs) {
      if (entry.combo) hasCombo = true;
      else subTotals[entry.sub] = (subTotals[entry.sub] || 0) + entry.score;
    }
    for (const sub of Object.keys(subTotals)) {
      tags.push({ label: subLabel(sub), color: catCfg.color, bg: catCfg.pill });
    }
    if (hasCombo) tags.push({ label: "combo", color: catCfg.color, bg: catCfg.pill });
  }
  if (!tags.length) return <span style={{ color: "#1e293b", fontSize: 11 }}>—</span>;
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {tags.map((tag, i) => (
        <span key={i} style={{ borderRadius: 3, fontSize: 9, fontWeight: 700, padding: "1px 5px", background: tag.bg, color: tag.color, border: `1px solid ${tag.color}44`, letterSpacing: "0.04em" }}>
          {tag.label}
        </span>
      ))}
    </div>
  );
}

function BracketFlags({ flags }) {
  if (!flags?.length) return <span style={{ color: "#1e293b", fontSize: 11 }}>—</span>;
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center" }}>
      {flags.map(flag => {
        const cfg = FLAG_CONFIG[flag] || { label: flag, color: "#94a3b8", bg: "#0f172a", title: flag };
        return <span key={flag} title={cfg.title} style={{ borderRadius:3, fontSize:9, fontWeight:700, padding:"1px 5px", background:cfg.bg, color:cfg.color, border:`1px solid ${cfg.color}`, letterSpacing:"0.04em", cursor:"default" }}>{cfg.label}</span>;
      })}
    </div>
  );
}

// ─── Compare Load Screen ──────────────────────────────────────────────────────

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
    if (resA.status === "rejected") setErrorA(resA.reason.message);
    if (resB.status === "rejected") setErrorB(resB.reason.message);
    if (resA.status === "fulfilled" && resB.status === "fulfilled") {
      const dataA = resA.value, dataB = resB.value;
      onLoad(
        processApiData(dataA), dataA.name || inputA.trim(),
        processApiData(dataB), dataB.name || inputB.trim(),
      );
    }
  };

  const inputStyle = (err) => ({
    width: "100%", boxSizing: "border-box", background: "#111318",
    border: `1px solid ${err ? "#f87171" : "#1e293b"}`, color: "#cbd5e1",
    padding: "10px 12px", borderRadius: 4, fontSize: 11, fontFamily: "inherit",
    outline: "none", marginBottom: 6,
  });

  return (
    <div style={{ minHeight: "100vh", background: "#0d0f14", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Courier New', monospace" }}>
      <div style={{ width: 520, padding: 40 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.06em", marginBottom: 6 }}>DECK COMPARE</div>
        <div style={{ height: 2, background: "linear-gradient(90deg,#4ade80,#818cf8,#fb923c,#f472b6)", marginBottom: 24 }} />

        <button onClick={onBack}
          style={{ background: "transparent", border: "none", color: "#334155", fontSize: 10, fontFamily: "inherit", cursor: "pointer", letterSpacing: "0.06em", marginBottom: 20, padding: 0 }}
          onMouseEnter={e => e.currentTarget.style.color = "#94a3b8"}
          onMouseLeave={e => e.currentTarget.style.color = "#334155"}>
          ← SINGLE DECK MODE
        </button>

        {[
          ["A", inputA, setInputA, errorA, setErrorA, statusA],
          ["B", inputB, setInputB, errorB, setErrorB, statusB],
        ].map(([label, val, setVal, err, setErr, status]) => (
          <div key={label} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "#334155", marginBottom: 6, letterSpacing: "0.06em" }}>DECK {label}</div>
            <input value={val} onChange={e => { setVal(e.target.value); setErr(""); }}
              onKeyDown={e => e.key === "Enter" && !loading && handleLoad()}
              placeholder="URL or 32-character deck ID"
              style={inputStyle(err)} />
            {err && <div style={{ fontSize: 11, color: "#f87171", marginBottom: 4 }}>{err}</div>}
            {status && <div style={{ fontSize: 11, color: "#475569" }}>{status}</div>}
          </div>
        ))}

        <button onClick={handleLoad} disabled={loading || !inputA.trim() || !inputB.trim()}
          style={{
            width: "100%", padding: "10px", borderRadius: 4,
            cursor: loading || !inputA.trim() || !inputB.trim() ? "not-allowed" : "pointer",
            background: loading || !inputA.trim() || !inputB.trim() ? "#111318" : "#f1f5f9",
            color: loading || !inputA.trim() || !inputB.trim() ? "#334155" : "#0d0f14",
            border: "1px solid #1e293b", fontSize: 11, fontFamily: "inherit",
            fontWeight: 700, letterSpacing: "0.08em", transition: "all 0.15s",
          }}>
          {loading ? "LOADING…" : "COMPARE DECKS"}
        </button>
      </div>
    </div>
  );
}

// ─── Load Screen ──────────────────────────────────────────────────────────────

function LoadScreen({ onLoad, onCompareMode }) {
  const [input, setInput] = useState("");
  const [jsonInput, setJsonInput] = useState("");
  const [mode, setMode] = useState("url"); // "url" | "json"
  const [loading, setLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState("");
  const [error, setError] = useState("");

  const tryFetch = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const handleLoad = async () => {
    const id = extractDeckId(input);
    if (!id) {
      setError("Couldn't find a deck ID. Paste a CommanderSalt URL or the raw 32-character deck ID.");
      return;
    }
    setLoading(true);
    setError("");
    const apiUrl = `https://api.commandersalt.com/decks?id=${id}`;
    const proxies = [
      { label: "direct", url: apiUrl },
      { label: "proxy 1", url: `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}` },
      { label: "proxy 2", url: `https://corsproxy.io/?${encodeURIComponent(apiUrl)}` },
    ];
    let data = null;
    for (const { label, url } of proxies) {
      try {
        setLoadStatus(`Trying ${label}…`);
        data = await tryFetch(url);
        if (data?.cards) break;
        data = null;
      } catch (e) {
        data = null;
      }
    }
    setLoading(false);
    setLoadStatus("");
    if (!data?.cards) {
      setError("All fetch attempts failed. Try the JSON paste method below — export the deck JSON from CommanderSalt and paste it here.");
      return;
    }
    onLoad(processApiData(data), data.name || id);
  };

  const handleJsonLoad = () => {
    try {
      const data = JSON.parse(jsonInput.trim());
      if (!data.cards) throw new Error("Missing cards data — make sure you're pasting the full CommanderSalt deck JSON.");
      onLoad(processApiData(data), data.name || "Deck");
    } catch (e) {
      setError(e.message.startsWith("Missing") ? e.message : "Invalid JSON — make sure you pasted the complete response.");
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:"#0d0f14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Courier New', monospace" }}>
      <div style={{ width:520, padding:40 }}>
        <div style={{ fontSize:22, fontWeight:700, color:"#f1f5f9", letterSpacing:"0.06em", marginBottom:6 }}>DECK MATRIX</div>
        <div style={{ height:2, background:"linear-gradient(90deg,#4ade80,#818cf8,#fb923c,#f472b6)", marginBottom:24 }} />

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

        {/* Mode tabs */}
        <div style={{ display:"flex", gap:0, marginBottom:20, borderBottom:"1px solid #1e293b" }}>
          {[["url","LOAD BY URL"],["json","PASTE JSON"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); }}
              style={{ background:"transparent", border:"none", borderBottom:`2px solid ${mode===m?"#f1f5f9":"transparent"}`, color:mode===m?"#f1f5f9":"#475569", padding:"6px 16px 8px", cursor:"pointer", fontSize:10, fontFamily:"inherit", fontWeight:mode===m?700:400, letterSpacing:"0.06em", marginBottom:-1, transition:"all 0.15s" }}>
              {label}
            </button>
          ))}
        </div>

        {mode === "url" ? (
          <>
            <div style={{ fontSize:11, color:"#475569", marginBottom:16, lineHeight:1.6 }}>
              Paste a CommanderSalt deck URL or 32-character deck ID.
            </div>
            <div style={{ fontSize:10, color:"#334155", marginBottom:6, letterSpacing:"0.06em" }}>DECK URL OR ID</div>
            <input value={input} onChange={e => { setInput(e.target.value); setError(""); }}
              onKeyDown={e => e.key==="Enter" && !loading && handleLoad()}
              placeholder="https://www.commandersalt.com/details/deck/..."
              style={{ width:"100%", boxSizing:"border-box", background:"#111318", border:`1px solid ${error?"#f87171":"#1e293b"}`, color:"#cbd5e1", padding:"10px 12px", borderRadius:4, fontSize:11, fontFamily:"inherit", outline:"none", marginBottom:8 }} />
            {error && <div style={{ fontSize:11, color:"#f87171", marginBottom:8, lineHeight:1.5 }}>{error}</div>}
            {loadStatus && <div style={{ fontSize:11, color:"#475569", marginBottom:8 }}>{loadStatus}</div>}
            <button onClick={handleLoad} disabled={loading || !input.trim()}
              style={{ width:"100%", padding:"10px", borderRadius:4, cursor:loading||!input.trim()?"not-allowed":"pointer", background:loading||!input.trim()?"#111318":"#f1f5f9", color:loading||!input.trim()?"#334155":"#0d0f14", border:"1px solid #1e293b", fontSize:11, fontFamily:"inherit", fontWeight:700, letterSpacing:"0.08em", transition:"all 0.15s" }}>
              {loading ? "LOADING…" : "LOAD DECK"}
            </button>
            <div style={{ marginTop:24, fontSize:10, color:"#1e293b", letterSpacing:"0.04em" }}>
              EXAMPLE · commandersalt.com/details/deck/84fc60ab523c1f0f0b5093644606e743
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize:11, color:"#475569", marginBottom:16, lineHeight:1.6 }}>
              Open your browser devtools, go to the Network tab, load your CommanderSalt deck page, find the <span style={{ color:"#cbd5e1" }}>api.commandersalt.com/decks?id=…</span> request, copy the response, and paste it below.
            </div>
            <div style={{ fontSize:10, color:"#334155", marginBottom:6, letterSpacing:"0.06em" }}>RAW JSON RESPONSE</div>
            <textarea value={jsonInput} onChange={e => { setJsonInput(e.target.value); setError(""); }}
              placeholder='{"cards": {...}, "details": {...}, ...}'
              style={{ width:"100%", boxSizing:"border-box", background:"#111318", border:`1px solid ${error?"#f87171":"#1e293b"}`, color:"#cbd5e1", padding:"10px 12px", borderRadius:4, fontSize:11, fontFamily:"inherit", outline:"none", marginBottom:8, height:120, resize:"vertical" }} />
            {error && <div style={{ fontSize:11, color:"#f87171", marginBottom:8, lineHeight:1.5 }}>{error}</div>}
            <button onClick={handleJsonLoad} disabled={!jsonInput.trim()}
              style={{ width:"100%", padding:"10px", borderRadius:4, cursor:!jsonInput.trim()?"not-allowed":"pointer", background:!jsonInput.trim()?"#111318":"#f1f5f9", color:!jsonInput.trim()?"#334155":"#0d0f14", border:"1px solid #1e293b", fontSize:11, fontFamily:"inherit", fontWeight:700, letterSpacing:"0.08em", transition:"all 0.15s" }}>
              LOAD FROM JSON
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Deck Table ───────────────────────────────────────────────────────────────

function DeckTable({ cards, deckName, onBack, embedded = false }) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState(null);
  const [sortCol, setSortCol] = useState("grand_total");
  const [sortDir, setSortDir] = useState(-1);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [tooltip, setTooltip] = useState({ x: 0, y: 0 });

  const maxScores = {};
  for (const cat of Object.keys(CAT_CONFIG)) {
    maxScores[cat] = Math.max(...cards.map(c => c.scores[cat]?.score || 0), 1);
  }

  const catTotals = {};
  for (const cat of Object.keys(CAT_CONFIG)) catTotals[cat] = cards.reduce((s, c) => s + (c.scores[cat]?.score || 0), 0);
  catTotals.power_total = Object.values(catTotals).reduce((a, b) => a + b, 0);
  catTotals.synergy = cards.reduce((s, c) => s + (c.synergy || 0), 0);
  catTotals.bias = cards.reduce((s, c) => s + (c.bias || 0), 0);
  catTotals.manabase = cards.reduce((s, c) => s + (c.manabase || 0), 0);
  catTotals.grand_total = cards.reduce((s, c) => s + c.power_total + c.synergy + c.bias + c.manabase, 0);

  let filtered = cards;
  if (search) filtered = filtered.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  if (filterCat) filtered = filtered.filter(c => (c.scores[filterCat]?.score || 0) > 0);
  filtered = [...filtered].sort((a, b) => {
    if (sortCol === "name") return sortDir * a.name.localeCompare(b.name);
    if (sortCol === "power_total") return sortDir * (a.power_total - b.power_total);
    if (sortCol === "synergy") return sortDir * (a.synergy - b.synergy);
    if (sortCol === "bias") return sortDir * (a.bias - b.bias);
    if (sortCol === "manabase") return sortDir * (a.manabase - b.manabase);
    if (sortCol === "grand_total") return sortDir * ((a.power_total + a.synergy + a.bias + a.manabase) - (b.power_total + b.synergy + b.bias + b.manabase));
    if (sortCol === "salt_score") return sortDir * (a.salt_score - b.salt_score);
    if (sortCol === "bracket_flags") return sortDir * ((a.bracket_flags?.length || 0) - (b.bracket_flags?.length || 0));
    return sortDir * ((a.scores[sortCol]?.score || 0) - (b.scores[sortCol]?.score || 0) || a.name.localeCompare(b.name));
  });

  const toggleSort = col => { if (sortCol === col) setSortDir(d => -d); else { setSortCol(col); setSortDir(-1); } };

  const exportCSV = () => {
    const headers = ["Name","Types","Commander","Consistency","Interaction","Efficiency","Win Conditions","Power Total","Synergy","Bias","Manabase","Grand Total","Salt Score","Bracket Flags","Price"];
    const rows = filtered.map(c => [c.name, c.types, c.isCommander ? "Yes" : "", c.scores.consistency?.score??0, c.scores.interaction?.score??0, c.scores.efficiency?.score??0, c.scores.winConditions?.score??0, c.power_total, c.synergy, c.bias, c.manabase, +(c.power_total+c.synergy+c.bias+c.manabase).toFixed(1), c.salt_score, (c.bracket_flags||[]).join("|"), c.price]);
    const esc = v => { const s = String(v??""); return s.includes(",")||s.includes('"')||s.includes("\n") ? `"${s.replace(/"/g,'""')}"` : s; };
    const csv = [headers,...rows].map(r=>r.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download = `${deckName || "deck"}_matrix.csv`;
    a.click();
  };

  const SortArrow = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.2, fontSize: 10, marginLeft: 3 }}>
      {sortCol === col ? (sortDir < 0 ? "▼" : "▲") : "⇅"}
    </span>
  );

  const HEADERS = [
    { key: "name",         label: "CARD NAME" },
    { key: "consistency",  label: "CONSISTENCY",    color: CAT_CONFIG.consistency.color },
    { key: "interaction",  label: "INTERACTION",    color: CAT_CONFIG.interaction.color },
    { key: "efficiency",   label: "EFFICIENCY",     color: CAT_CONFIG.efficiency.color },
    { key: "winConditions",label: "WIN CONDITIONS", color: CAT_CONFIG.winConditions.color },
    { key: "tags",         label: "TAGS",           color: "#64748b" },
    { key: "power_total",  label: "PWR",            color: sortCol === "power_total" ? "#f1f5f9" : "#475569" },
    { key: "synergy",      label: "SYN",            color: "#38bdf8" },
    { key: "bias",         label: "BIAS",           color: "#a78bfa" },
    { key: "manabase",     label: "MANA",           color: "#86efac" },
    { key: "grand_total",  label: "GRAND",          color: "#fbbf24" },
    { key: "salt_score",   label: "SALT",           color: "#f87171" },
    { key: "bracket_flags",label: "FLAGS",          color: "#e879f9" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#0d0f14", color:"#e2e8f0", fontFamily:"'Courier New', monospace" }}
      onMouseMove={e => setTooltip({ x: e.clientX, y: e.clientY })}>

      {hoveredCard && (
        <div style={{ position:"fixed", zIndex:999, pointerEvents:"none", left:tooltip.x+16, top:Math.min(tooltip.y-20,window.innerHeight-300), boxShadow:"0 8px 32px #000000cc", borderRadius:8, overflow:"hidden" }}>
          <img src={hoveredCard} alt="" style={{ width:180, display:"block" }} />
        </div>
      )}

      {/* Header */}
      <div style={{ padding: embedded ? "10px 12px 0" : "16px 20px 0", borderBottom:"1px solid #1e293b" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:12, marginBottom:8 }}>
          <span style={{ fontSize:18, fontWeight:700, letterSpacing:"0.06em", color:"#f1f5f9" }}>{deckName.toUpperCase()}</span>
          <span style={{ fontSize:11, color:"#475569" }}>{cards.reduce((s,c)=>s+c.count,0)} cards ({cards.length} unique)</span>
          {!embedded && (
            <button onClick={() => onBack?.()}
              style={{ marginLeft:"auto", background:"transparent", color:"#334155", border:"1px solid #1e293b", padding:"2px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"inherit", letterSpacing:"0.06em" }}
              onMouseEnter={e => e.currentTarget.style.color="#94a3b8"} onMouseLeave={e => e.currentTarget.style.color="#334155"}>
              ← LOAD NEW DECK
            </button>
          )}
        </div>

        {/* Summary bar */}
        <div style={{ display:"flex", gap:16, marginBottom:10, flexWrap:"wrap" }}>
          {Object.entries(CAT_CONFIG).map(([cat, cfg]) => (
            <div key={cat} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:10, color:cfg.color, fontWeight:700, letterSpacing:"0.06em" }}>{cfg.label.toUpperCase()}</span>
              <span style={{ fontSize:12, color:cfg.color, fontWeight:700 }}>{catTotals[cat]?.toFixed(0)}</span>
            </div>
          ))}
          {[["PWR TOTAL","power_total","#f1f5f9"],["SYNERGY","synergy","#38bdf8"],["BIAS","bias","#a78bfa"],["MANA","manabase","#86efac"],["GRAND TOTAL","grand_total","#fbbf24"]].map(([label, key, color]) => (
            <div key={key} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:10, color, fontWeight:700, letterSpacing:"0.06em" }}>{label}</span>
              <span style={{ fontSize:12, color, fontWeight:700 }}>{catTotals[key]?.toFixed(key==="bias"?1:0)}</span>
            </div>
          ))}
        </div>

        <div style={{ height:2, background:"linear-gradient(90deg,#4ade80,#818cf8,#fb923c,#f472b6)", marginBottom:10 }} />

        {/* Controls */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", paddingBottom:12, alignItems:"center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ background:"#111318", border:"1px solid #1e293b", color:"#cbd5e1", padding:"5px 10px", borderRadius:4, fontSize:11, fontFamily:"inherit", outline:"none", width:160 }} />
          {[null, ...Object.keys(CAT_CONFIG)].map(cat => {
            const cfg = cat ? CAT_CONFIG[cat] : null;
            const active = filterCat === cat;
            const count = cat ? filtered.filter(c => (c.scores[cat]?.score||0) > 0).length : cards.length;
            return (
              <button key={cat||"all"} onClick={() => setFilterCat(cat)}
                style={{ background:active?(cfg?.color||"#f1f5f9"):"transparent", color:active?"#0d1117":(cfg?.color||"#94a3b8"), border:`1px solid ${active?(cfg?.color||"#f1f5f9"):"#1e293b"}`, padding:"4px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"inherit", fontWeight:active?700:400, letterSpacing:"0.06em", transition:"all 0.15s" }}>
                {cat ? `${cfg.label.toUpperCase()} (${count})` : `ALL (${cards.length})`}
              </button>
            );
          })}
          <button onClick={exportCSV}
            style={{ marginLeft:"auto", background:"transparent", color:"#475569", border:"1px solid #1e293b", padding:"4px 12px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"inherit", letterSpacing:"0.06em", transition:"all 0.15s" }}
            onMouseEnter={e=>{e.currentTarget.style.color="#f1f5f9";e.currentTarget.style.borderColor="#475569";}}
            onMouseLeave={e=>{e.currentTarget.style.color="#475569";e.currentTarget.style.borderColor="#1e293b";}}>
            ↓ EXPORT CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <colgroup>
            <col style={{width:"12%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/>
            <col style={{width:"10%"}}/><col style={{width:"14%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/>
            <col style={{width:"5%"}}/><col style={{width:"6%"}}/><col style={{width:"6%"}}/><col style={{width:"5%"}}/>
          </colgroup>
          <thead>
            <tr style={{ background:"#0d0f14", borderBottom:"2px solid #1e293b", position:"sticky", top:0, zIndex:10 }}>
              {HEADERS.map(({ key, label, color }) => (
                <th key={key} onClick={() => toggleSort(key)}
                  style={{ textAlign:"left", padding:"10px 10px", cursor:"pointer", userSelect:"none",
                    color: sortCol === key ? (color || "#f1f5f9") : (color || "#475569"),
                    fontSize:10, fontWeight:700, letterSpacing:"0.08em", borderRight:"1px solid #1e293b",
                    background: sortCol === key ? "#ffffff08" : "transparent" }}>
                  {label}<SortArrow col={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((card, i) => (
              <tr key={card.id} style={{ background: i%2===0?"transparent":"#090b10", borderBottom:"1px solid #0f1520" }}>
                <td style={{ padding:"6px 8px", verticalAlign:"middle", borderRight:"1px solid #1e293b" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <div onMouseEnter={() => setHoveredCard(card.imageUri)} onMouseLeave={() => setHoveredCard(null)}
                      style={{ width:6, height:6, borderRadius:"50%", flexShrink:0, background:card.isCommander?"#fbbf24":"#1e293b", boxShadow:card.isCommander?"0 0 6px #fbbf24":"none", cursor:"crosshair" }} />
                    <span style={{ color:card.isCommander?"#fef3c7":"#cbd5e1", fontWeight:card.isCommander?700:400, fontSize:11 }}>{card.name}</span>
                  </div>
                </td>
                {["consistency","interaction","efficiency","winConditions"].map(cat => (
                  <ScoreCell key={cat} card={card} catKey={cat} maxScore={maxScores[cat]} />
                ))}
                <td style={{ padding:"5px 8px", verticalAlign:"middle", borderRight:"1px solid #1e293b" }}>
                  <TagsCell card={card} />
                </td>
                <td style={{ padding:"6px 8px", textAlign:"center", verticalAlign:"middle", borderRight:"1px solid #1e293b" }}>
                  <Badge n={card.power_total} thresholds={POWER_T} />
                </td>
                <td style={{ padding:"6px 8px", textAlign:"center", verticalAlign:"middle", borderRight:"1px solid #1e293b" }}>
                  <Badge n={card.synergy} thresholds={SYN_T} />
                </td>
                <td style={{ padding:"6px 8px", textAlign:"center", verticalAlign:"middle", borderRight:"1px solid #1e293b" }}>
                  <Badge n={card.bias} thresholds={BIAS_T} decimals={2} />
                </td>
                <td style={{ padding:"6px 8px", textAlign:"center", verticalAlign:"middle", borderRight:"1px solid #1e293b" }}>
                  {card.manabase > 0 ? <ManaBadge cat={card.manabase_cat} /> : <span style={{ color:"#1e293b", fontSize:11 }}>—</span>}
                </td>
                <td style={{ padding:"6px 8px", textAlign:"center", verticalAlign:"middle", borderRight:"1px solid #1e293b" }}>
                  <Badge n={card.power_total+card.synergy+card.bias+card.manabase} thresholds={GRAND_T} />
                </td>
                <td style={{ padding:"6px 8px", textAlign:"center", verticalAlign:"middle", borderRight:"1px solid #1e293b" }}>
                  {card.salt_score > 0 ? <Badge n={card.salt_score} thresholds={SALT_T} decimals={2} /> : <span style={{ color:"#1e293b", fontSize:11 }}>—</span>}
                </td>
                <td style={{ padding:"6px 8px", textAlign:"center", verticalAlign:"middle" }}>
                  <BracketFlags flags={card.bracket_flags} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop:"2px solid #1e293b", background:"#090b10" }}>
              <td style={{ padding:"8px 10px", fontSize:10, color:"#475569", letterSpacing:"0.06em", borderRight:"1px solid #1e293b" }}>
                SHOWING {filtered.length}/{cards.length}
              </td>
              {Object.keys(CAT_CONFIG).map(cat => (
                <td key={cat} style={{ padding:"8px 10px", textAlign:"right", fontSize:11, fontWeight:700, color:CAT_CONFIG[cat].color, borderRight:"1px solid #1e293b", paddingRight:16 }}>
                  {filtered.reduce((s,c)=>s+(c.scores[cat]?.score||0),0).toFixed(1)}
                </td>
              ))}
              <td style={{ borderRight:"1px solid #1e293b" }} />
              {[["power_total","#f1f5f9",1],["synergy","#38bdf8",1],["bias","#a78bfa",2],["manabase","#86efac",0],["grand_total","#fbbf24",1]].map(([key,color,dec]) => (
                <td key={key} style={{ padding:"8px 10px", textAlign:"center", fontSize:11, fontWeight:700, color, borderRight:"1px solid #1e293b" }}>
                  {filtered.reduce((s,c)=>s+(key==="grand_total"?c.power_total+c.synergy+c.bias+c.manabase:(c[key]||0)),0).toFixed(dec)}
                </td>
              ))}
              <td style={{ padding:"8px 10px", textAlign:"center", fontSize:10, color:"#475569" }}>
                {filtered.filter(c=>c.bracket_flags?.length>0).length} flagged
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Compare View ─────────────────────────────────────────────────────────────

function computeDeckTotals(cards) {
  const catTotals = {};
  for (const cat of Object.keys(CAT_CONFIG)) {
    catTotals[cat] = Math.round(cards.reduce((s, c) => s + (c.scores[cat]?.score || 0), 0) * 10) / 10;
  }
  const grandTotal = Math.round(cards.reduce((s, c) => s + c.power_total + c.synergy + c.bias + c.manabase, 0) * 10) / 10;
  const synergy = Math.round(cards.reduce((s, c) => s + c.synergy, 0) * 10) / 10;

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

  const flags = [...new Set(cards.flatMap(c => c.bracket_flags || []))].sort();
  return { catTotals, grandTotal, synergy, subTotals, flags };
}

function SummaryDiff({ cardsA, nameA, cardsB, nameB }) {
  const totA = computeDeckTotals(cardsA);
  const totB = computeDeckTotals(cardsB);
  const maxGrand = Math.max(totA.grandTotal, totB.grandTotal, 1);

  const Delta = ({ a, b, decimals = 0 }) => {
    const d = Math.round((a - b) * Math.pow(10, decimals)) / Math.pow(10, decimals);
    if (d === 0) return <span style={{ color: "#334155", fontSize: 11 }}>—</span>;
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: d > 0 ? "#4ade80" : "#f87171" }}>
        {d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(decimals)}
      </span>
    );
  };

  const ScoreBar = ({ val, max, color }) => {
    const pct = max > 0 ? Math.min(100, (val / max) * 100) : 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160 }}>
        <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
        </div>
        <span style={{ color, fontWeight: 700, fontSize: 12, minWidth: 40, textAlign: "right" }}>{val}</span>
      </div>
    );
  };

  const allSubKeys = [...new Set([...Object.keys(totA.subTotals), ...Object.keys(totB.subTotals)])];

  return (
    <div style={{ maxWidth: 900 }}>

      {/* Grand total */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, padding: "16px 20px", background: "#090b10", borderRadius: 6, border: "1px solid #1e293b" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#fbbf24", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>{nameA.toUpperCase()}</div>
          <ScoreBar val={totA.grandTotal} max={maxGrand} color="#fbbf24" />
        </div>
        <div style={{ textAlign: "center", minWidth: 100 }}>
          <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.06em", marginBottom: 4 }}>GRAND TOTAL</div>
          <Delta a={totA.grandTotal} b={totB.grandTotal} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#fbbf24", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4, textAlign: "right" }}>{nameB.toUpperCase()}</div>
          <ScoreBar val={totB.grandTotal} max={maxGrand} color="#fbbf24" />
        </div>
      </div>

      {/* Synergy */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, padding: "12px 20px", background: "#090b10", borderRadius: 6, border: "1px solid #1e293b" }}>
        <span style={{ flex: 1, fontWeight: 700, color: "#38bdf8", fontSize: 12 }}>{totA.synergy.toFixed(1)}</span>
        <div style={{ minWidth: 100, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#38bdf8", letterSpacing: "0.06em", marginBottom: 2 }}>SYNERGY</div>
          <Delta a={totA.synergy} b={totB.synergy} decimals={1} />
        </div>
        <div style={{ flex: 1, textAlign: "right", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
          <Delta a={totB.synergy} b={totA.synergy} decimals={1} />
          <span style={{ fontWeight: 700, color: "#38bdf8", fontSize: 12 }}>{totB.synergy.toFixed(1)}</span>
        </div>
      </div>

      {/* Bracket flags */}
      {(totA.flags.length > 0 || totB.flags.length > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, padding: "12px 20px", background: "#090b10", borderRadius: 6, border: "1px solid #1e293b" }}>
          <div style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {totA.flags.length > 0
              ? totA.flags.map(f => { const cfg = FLAG_CONFIG[f] || { label: f, color: "#94a3b8", bg: "#0f172a" }; return <span key={f} title={cfg.title} style={{ borderRadius: 3, fontSize: 9, fontWeight: 700, padding: "1px 5px", background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}` }}>{cfg.label}</span>; })
              : <span style={{ color: "#1e293b", fontSize: 11 }}>none</span>}
          </div>
          <span style={{ minWidth: 100, textAlign: "center", fontSize: 10, color: "#e879f9", letterSpacing: "0.06em" }}>FLAGS</span>
          <div style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {totB.flags.length > 0
              ? totB.flags.map(f => { const cfg = FLAG_CONFIG[f] || { label: f, color: "#94a3b8", bg: "#0f172a" }; return <span key={f} title={cfg.title} style={{ borderRadius: 3, fontSize: 9, fontWeight: 700, padding: "1px 5px", background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}` }}>{cfg.label}</span>; })
              : <span style={{ color: "#1e293b", fontSize: 11 }}>none</span>}
          </div>
        </div>
      )}

      {/* Category blocks */}
      {Object.entries(CAT_CONFIG).map(([cat, cfg]) => {
        const maxCat = Math.max(totA.catTotals[cat], totB.catTotals[cat], 1);
        const catSubKeys = allSubKeys.filter(k => k.startsWith(`${cat}::`));
        const maxSub = Math.max(...catSubKeys.map(k => Math.max(totA.subTotals[k]?.score || 0, totB.subTotals[k]?.score || 0)), 1);

        return (
          <div key={cat} style={{ marginBottom: 12, borderRadius: 6, overflow: "hidden", border: `1px solid ${cfg.color}33` }}>
            {/* Category header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 20px", background: cfg.bg }}>
              <div style={{ flex: 1 }}>
                <ScoreBar val={totA.catTotals[cat]} max={maxCat} color={cfg.color} />
              </div>
              <div style={{ textAlign: "center", minWidth: 140 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color, letterSpacing: "0.08em" }}>{cfg.label.toUpperCase()}</div>
                <div style={{ marginTop: 2 }}><Delta a={totA.catTotals[cat]} b={totB.catTotals[cat]} decimals={1} /></div>
              </div>
              <div style={{ flex: 1 }}>
                <ScoreBar val={totB.catTotals[cat]} max={maxCat} color={cfg.color} />
              </div>
            </div>

            {/* Sub-category rows */}
            {catSubKeys.map((k, i) => {
              const sA = totA.subTotals[k];
              const sB = totB.subTotals[k];
              const scoreA = Math.round((sA?.score || 0) * 10) / 10;
              const scoreB = Math.round((sB?.score || 0) * 10) / 10;
              const countA = sA?.count || 0;
              const countB = sB?.count || 0;
              const meta = sA || sB;
              const label = meta.combo ? `↳ ${formatComboLabel(meta.combo)}` : subLabel(meta.sub);
              const pctA = maxSub > 0 ? Math.min(100, (scoreA / maxSub) * 100) : 0;
              const pctB = maxSub > 0 ? Math.min(100, (scoreB / maxSub) * 100) : 0;

              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 16, padding: "6px 20px 6px 32px", background: i % 2 === 0 ? "#0d0f14" : "#090b10", borderTop: "1px solid #0f1520" }}>
                  {/* Deck A */}
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${pctA}%`, height: "100%", background: scoreA > 0 ? cfg.color : "transparent", borderRadius: 2 }} />
                    </div>
                    <span style={{ color: scoreA > 0 ? cfg.text : "#1e293b", fontSize: 10, minWidth: 70, textAlign: "right" }}>
                      {scoreA > 0 ? `${scoreA} (${countA})` : "—"}
                    </span>
                  </div>
                  {/* Label */}
                  <div style={{ minWidth: 140, textAlign: "center", fontSize: 10, color: meta.combo ? "#475569" : "#64748b", fontStyle: meta.combo ? "italic" : "normal", letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label}
                  </div>
                  {/* Deck B */}
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexDirection: "row-reverse" }}>
                    <div style={{ flex: 1, height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${pctB}%`, height: "100%", background: scoreB > 0 ? cfg.color : "transparent", borderRadius: 2 }} />
                    </div>
                    <span style={{ color: scoreB > 0 ? cfg.text : "#1e293b", fontSize: 10, minWidth: 70, textAlign: "left" }}>
                      {scoreB > 0 ? `${scoreB} (${countB})` : "—"}
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

function SideBySide({ cardsA, nameA, cardsB, nameB }) {
  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 110px)" }}>
      <div style={{ flex: 1, borderRight: "2px solid #1e293b", overflow: "auto" }}>
        <DeckTable cards={cardsA} deckName={nameA} onBack={null} embedded />
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <DeckTable cards={cardsB} deckName={nameB} onBack={null} embedded />
      </div>
    </div>
  );
}

function CompareView({ cardsA, nameA, cardsB, nameB, onBack }) {
  const [tab, setTab] = useState("diff"); // "diff" | "side"

  return (
    <div style={{ minHeight: "100vh", background: "#0d0f14", color: "#e2e8f0", fontFamily: "'Courier New', monospace" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 0", borderBottom: "1px solid #1e293b" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.06em", color: "#f1f5f9" }}>
            {nameA.toUpperCase()}
          </span>
          <span style={{ fontSize: 12, color: "#475569" }}>vs</span>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.06em", color: "#f1f5f9" }}>
            {nameB.toUpperCase()}
          </span>
          <button onClick={onBack}
            style={{ marginLeft: "auto", background: "transparent", color: "#334155", border: "1px solid #1e293b", padding: "2px 10px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit", letterSpacing: "0.06em" }}
            onMouseEnter={e => e.currentTarget.style.color = "#94a3b8"}
            onMouseLeave={e => e.currentTarget.style.color = "#334155"}>
            ← NEW COMPARISON
          </button>
        </div>

        <div style={{ height: 2, background: "linear-gradient(90deg,#4ade80,#818cf8,#fb923c,#f472b6)", marginBottom: 0 }} />

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1e293b" }}>
          {[["diff", "SUMMARY DIFF"], ["side", "SIDE BY SIDE"]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{
                background: "transparent", border: "none",
                borderBottom: `2px solid ${tab === key ? "#f1f5f9" : "transparent"}`,
                color: tab === key ? "#f1f5f9" : "#475569",
                padding: "8px 16px 10px", cursor: "pointer", fontSize: 10,
                fontFamily: "inherit", fontWeight: tab === key ? 700 : 400,
                letterSpacing: "0.06em", marginBottom: -1, transition: "all 0.15s",
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ padding: tab === "side" ? 0 : 24 }}>
        {tab === "diff"
          ? <SummaryDiff cardsA={cardsA} nameA={nameA} cardsB={cardsB} nameB={nameB} />
          : <SideBySide cardsA={cardsA} nameA={nameA} cardsB={cardsB} nameB={nameB} />
        }
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("load"); // "load" | "deck" | "compare-load" | "compare"
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
        onLoad={(cA, nA, cB, nB) => {
          setCompareData({ cardsA: cA, nameA: nA, cardsB: cB, nameB: nB });
          setScreen("compare");
        }}
        onBack={() => setScreen("load")}
      />
    );
  }
  if (screen === "compare") {
    return (
      <CompareView
        cardsA={compareData.cardsA} nameA={compareData.nameA}
        cardsB={compareData.cardsB} nameB={compareData.nameB}
        onBack={() => setScreen("compare-load")}
      />
    );
  }
  return <DeckTable cards={cards} deckName={deckName} onBack={() => setScreen("load")} />;
}
