# Upgrades Tab — Design Doc
_2026-03-10_

## Overview

A new UPGRADES tab in `CompareView` that suggests category-matched card swaps from the stronger deck to bring the weaker deck's power level closer, without violating WotC bracket rules.

## Algorithm

For each of the 4 categories (consistency, interaction, efficiency, winConditions):

1. **Identify the weaker deck** by comparing grand totals (`power_total + synergy + bias + manabase`). The deck with the lower grand total receives suggestions.

2. **Find candidates** — cards in the stronger deck that are NOT in the weaker deck, where that category is the card's highest-scoring category. Sort by that category score descending.

3. **Filter for bracket safety** — exclude candidates whose `bracket_flags` would push the weaker deck above its current WotC bracket ceiling:
   - `GC` flag → raises to WotC B3 (exclude if weaker deck is B2 or lower)
   - `MLD`, `ET`, `COMBO` flags → raises to WotC B4 (exclude if weaker deck is B3 or lower)

4. **Find cuts** — cards in the weaker deck whose highest-scoring category matches, sorted by grand total ascending. Commanders are excluded from cuts.

5. **Pair and rank** — pair each candidate with the next available cut. Only show pairs where `candidate.power_total - cut.power_total > 0` (net gain). Show top 5 per category.

## UI

- New **UPGRADES** tab added to `CompareView` alongside SUMMARY DIFF and SIDE BY SIDE
- Header shows which deck is receiving suggestions and why (e.g. "Suggesting upgrades for DECK A — lower grand total")
- Four category sections, each color-coded by `CAT_CONFIG`
- Each swap row shows:
  - Card-in: name, category score, bracket flags if any
  - Card-out: name, category score
  - Net gain delta (▲ +X.X)
- Categories with no beneficial swaps are hidden
- If the two decks are equal power (or within a small threshold), show a "Decks are already balanced" message

## Bracket Enforcement

The weaker deck's `metaA.wotcBracket` (or `metaB`) is the ceiling. Flag map:
- `GC` → minimum WotC B3
- `MLD` → minimum WotC B4
- `ET` → minimum WotC B4
- `COMBO` → minimum WotC B4

A candidate card is safe if its required minimum bracket ≤ weaker deck's current wotcBracket.

## Components

- `UpgradesTab({ cardsA, metaA, cardsB, metaB })` — computes and renders all swap suggestions
- Pure computation — no new state needed, all derived from props

## Out of Scope

- Suggesting cards not present in either deck
- Simulating synergy impact of swaps
- Multi-swap optimization
