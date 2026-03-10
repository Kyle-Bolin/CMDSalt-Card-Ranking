# Upgrades Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an UPGRADES tab to CompareView that suggests category-matched card swaps from the stronger deck to the weaker deck, filtered by WotC bracket safety.

**Architecture:** A single new `UpgradesTab` component added to `DeckMatrix.jsx` above `CompareView`. It contains a pure `computeUpgrades(weakCards, weakMeta, strongCards)` function and renders results. `CompareView` gains a third tab "UPGRADES" and passes all props through. No new state or files needed.

**Tech Stack:** React 19, Vite. No test framework — verify manually with `vincent_data.json` via JSON paste.

---

### Task 1: Add `computeUpgrades` helper and `UpgradesTab` stub

**Files:**
- Modify: `DeckMatrix.jsx`

**Context:** The card data structure from `processApiData`:
- `card.id` — unique string identifier
- `card.name` — display name
- `card.isCommander` — boolean
- `card.scores` — `{ consistency: { score, subs }, interaction: { score, subs }, efficiency: { score, subs }, winConditions: { score, subs } }`
- `card.power_total` — sum of all category scores
- `card.synergy`, `card.bias`, `card.manabase` — additional score components
- `card.bracket_flags` — array of strings from `["GC", "MLD", "ET", "COMBO"]`

`metaA` / `metaB` from `extractDeckMeta`:
- `.wotcBracket` — integer (1-4), the WotC bracket ceiling

`CAT_CONFIG` keys: `consistency`, `interaction`, `efficiency`, `winConditions`

**Bracket flag minimum bracket map:**
- `GC` → min bracket 3
- `MLD` → min bracket 4
- `ET` → min bracket 4
- `COMBO` → min bracket 4

**Step 1: Add `computeUpgrades` function**

Add this function directly above where you'll place `UpgradesTab` (before `CompareView`):

```jsx
const FLAG_MIN_BRACKET = { GC: 3, MLD: 4, ET: 4, COMBO: 4 };

function computeUpgrades(weakCards, weakMeta, strongCards) {
  const weakIds = new Set(weakCards.map(c => c.id));
  const weakBracket = weakMeta?.wotcBracket ?? 4;

  // Helper: which category contributes most to this card's power_total
  function dominantCat(card) {
    let best = null, bestScore = -1;
    for (const cat of Object.keys(CAT_CONFIG)) {
      const s = card.scores[cat]?.score || 0;
      if (s > bestScore) { bestScore = s; best = cat; }
    }
    return best;
  }

  // Helper: is this card bracket-safe to add to the weak deck?
  function bracketSafe(card) {
    for (const flag of card.bracket_flags || []) {
      const minBracket = FLAG_MIN_BRACKET[flag] ?? 0;
      if (minBracket > weakBracket) return false;
    }
    return true;
  }

  const grandTotal = c => c.power_total + c.synergy + c.bias + c.manabase;

  const results = {};

  for (const cat of Object.keys(CAT_CONFIG)) {
    // Candidates: in strong deck, not in weak deck, dominant cat matches, bracket safe
    const candidates = strongCards
      .filter(c => !weakIds.has(c.id) && dominantCat(c) === cat && bracketSafe(c))
      .sort((a, b) => (b.scores[cat]?.score || 0) - (a.scores[cat]?.score || 0));

    // Cuts: in weak deck, dominant cat matches, not a commander
    const cuts = weakCards
      .filter(c => !c.isCommander && dominantCat(c) === cat)
      .sort((a, b) => grandTotal(a) - grandTotal(b));

    const swaps = [];
    const usedCuts = new Set();

    for (const candidate of candidates) {
      if (swaps.length >= 5) break;
      // Find the next unused cut
      const cut = cuts.find(c => !usedCuts.has(c.id));
      if (!cut) break;
      const netGain = candidate.power_total - cut.power_total;
      if (netGain <= 0) continue;
      usedCuts.add(cut.id);
      swaps.push({
        cardIn: candidate,
        cardOut: cut,
        catScore: Math.round((candidate.scores[cat]?.score || 0) * 10) / 10,
        cutScore: Math.round((cut.scores[cat]?.score || 0) * 10) / 10,
        netGain: Math.round(netGain * 10) / 10,
      });
    }

    if (swaps.length > 0) results[cat] = swaps;
  }

  return results;
}
```

**Step 2: Add `UpgradesTab` stub**

Add directly below `computeUpgrades`, above `CompareView`:

```jsx
function UpgradesTab({ cardsA, metaA, cardsB, metaB }) {
  return <div style={{ color: "#475569", fontFamily: "'Courier New', monospace", padding: 20 }}>Upgrades coming soon…</div>;
}
```

**Step 3: Build check**

```bash
npm run build
```

Expected: clean build.

**Step 4: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "feat: add computeUpgrades helper and UpgradesTab stub"
```

---

### Task 2: Add UPGRADES tab to CompareView

**Files:**
- Modify: `DeckMatrix.jsx` — `CompareView` component

**Context:** `CompareView` currently has two tabs: `"diff"` and `"side"`. The tab array is:
```jsx
{[["diff", "SUMMARY DIFF"], ["side", "SIDE BY SIDE"]].map(...)}
```
Tab content is rendered in a div with `padding: tab === "side" ? 0 : 24`.

**Step 1: Add "upgrades" to the tab list**

Find the tab array in `CompareView` and change it to:

```jsx
{[["diff", "SUMMARY DIFF"], ["side", "SIDE BY SIDE"], ["upgrades", "UPGRADES"]].map(([key, label]) => (
```

**Step 2: Update tab content rendering**

Find the tab content div and update it:

```jsx
{/* Tab content */}
<div style={{ padding: tab === "side" ? 0 : 24 }}>
  {tab === "diff" && <SummaryDiff cardsA={cardsA} nameA={nameA} cardsB={cardsB} nameB={nameB} />}
  {tab === "side" && <SideBySide cardsA={cardsA} nameA={nameA} cardsB={cardsB} nameB={nameB} />}
  {tab === "upgrades" && <UpgradesTab cardsA={cardsA} metaA={metaA} cardsB={cardsB} metaB={metaB} />}
</div>
```

**Step 3: Build and verify tab appears**

```bash
npm run build
```

Load two decks, confirm the UPGRADES tab appears and shows the stub text when clicked.

**Step 4: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "feat: add UPGRADES tab to CompareView"
```

---

### Task 3: Implement UpgradesTab component

**Files:**
- Modify: `DeckMatrix.jsx` — replace `UpgradesTab` stub

**Step 1: Replace the UpgradesTab stub with the full implementation**

```jsx
function UpgradesTab({ cardsA, metaA, cardsB, metaB }) {
  const grandTotalA = cardsA.reduce((s, c) => s + c.power_total + c.synergy + c.bias + c.manabase, 0);
  const grandTotalB = cardsB.reduce((s, c) => s + c.power_total + c.synergy + c.bias + c.manabase, 0);

  // Determine which deck is weaker
  const BALANCE_THRESHOLD = 5;
  const balanced = Math.abs(grandTotalA - grandTotalB) <= BALANCE_THRESHOLD;
  const weakIsA = grandTotalA <= grandTotalB;
  const weakCards = weakIsA ? cardsA : cardsB;
  const weakMeta  = weakIsA ? metaA  : metaB;
  const weakName  = weakIsA ? "DECK A" : "DECK B";
  const strongCards = weakIsA ? cardsB : cardsA;

  if (balanced) {
    return (
      <div style={{ color: "#4ade80", fontFamily: "'Courier New', monospace", padding: 20, fontSize: 12 }}>
        ✓ Decks are already balanced — grand totals within {BALANCE_THRESHOLD} points.
      </div>
    );
  }

  const upgrades = computeUpgrades(weakCards, weakMeta, strongCards);
  const hasAny = Object.keys(upgrades).length > 0;

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Header */}
      <div style={{ marginBottom: 20, padding: "10px 16px", background: "#090b10", borderRadius: 6, border: "1px solid #1e293b", fontSize: 11, color: "#94a3b8" }}>
        Suggesting upgrades for{" "}
        <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{weakName}</span>
        {" "}— lower grand total ({Math.round(weakIsA ? grandTotalA : grandTotalB)} vs {Math.round(weakIsA ? grandTotalB : grandTotalA)})
        {weakMeta?.wotcBracket != null && (
          <span style={{ marginLeft: 8, color: "#475569" }}>· staying within WotC B{weakMeta.wotcBracket}</span>
        )}
      </div>

      {!hasAny && (
        <div style={{ color: "#475569", fontSize: 12 }}>No beneficial category-matched swaps found within bracket constraints.</div>
      )}

      {/* Category sections */}
      {Object.entries(CAT_CONFIG).map(([cat, cfg]) => {
        const swaps = upgrades[cat];
        if (!swaps?.length) return null;
        return (
          <div key={cat} style={{ marginBottom: 16, borderRadius: 6, overflow: "hidden", border: `1px solid ${cfg.color}33` }}>
            {/* Category header */}
            <div style={{ padding: "10px 16px", background: cfg.bg, fontSize: 10, fontWeight: 700, color: cfg.color, letterSpacing: "0.08em" }}>
              {cfg.label.toUpperCase()} — {swaps.length} SWAP{swaps.length > 1 ? "S" : ""}
            </div>

            {/* Swap rows */}
            {swaps.map((swap, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: i % 2 === 0 ? "#0d0f14" : "#090b10", borderTop: "1px solid #0f1520" }}>
                {/* Card in */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#f1f5f9", fontWeight: 700, marginBottom: 2 }}>{swap.cardIn.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: cfg.color, fontWeight: 700 }}>{swap.catScore}</span>
                    {(swap.cardIn.bracket_flags || []).map(f => {
                      const fc = FLAG_CONFIG[f]; return fc ? (
                        <span key={f} title={fc.title} style={{ borderRadius: 3, fontSize: 8, fontWeight: 700, padding: "1px 4px", background: fc.bg, color: fc.color, border: `1px solid ${fc.color}` }}>{fc.label}</span>
                      ) : null;
                    })}
                  </div>
                </div>

                {/* Arrow + delta */}
                <div style={{ textAlign: "center", minWidth: 80 }}>
                  <div style={{ fontSize: 10, color: "#334155", marginBottom: 2 }}>replaces</div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#4ade80" }}>▲ +{swap.netGain.toFixed(1)}</span>
                </div>

                {/* Card out */}
                <div style={{ flex: 1, textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{swap.cardOut.name}</div>
                  <span style={{ fontSize: 10, color: "#334155" }}>{swap.cutScore > 0 ? swap.cutScore.toFixed(1) : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Build check**

```bash
npm run build
```

Expected: clean build.

**Step 3: Verify manually**

Load two decks with different power levels via the JSON paste method (use `vincent_data.json` for one deck). Go to the UPGRADES tab. Confirm:
- Header shows the correct weaker deck name and grand totals
- Category sections appear only for categories with valid swaps
- Each swap row shows card-in on the left, card-out on the right, net gain in the middle
- Bracket flags appear on card-in when present

**Step 4: Commit**

```bash
git add DeckMatrix.jsx
git commit -m "feat: implement UpgradesTab with category-matched bracket-safe swaps"
```
