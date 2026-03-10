# Deck Compare Feature — Design Doc
_2026-03-10_

## Overview

Add a deck comparison mode to DeckMatrix that lets users load two CommanderSalt decks and view their differences across the 4 main scoring categories.

## Entry Point

The existing `LoadScreen` gets a mode toggle at the top: **SINGLE DECK** / **COMPARE DECKS**. Selecting Compare routes to a new `CompareLoadScreen`. The existing single-deck flow is unchanged.

## CompareLoadScreen

Two URL/ID inputs stacked vertically, labeled DECK A and DECK B. A single "LOAD BOTH" button fetches both in parallel using the existing proxy-fallback fetch logic. Per-deck error handling — if one fails, show which one and allow retry without clearing the other input.

## CompareView

Rendered after both decks load. Shows both deck names in the header with a "← LOAD NEW COMPARISON" back button. Two tabs:

### Tab 1: Summary Diff

- **Header row:** grand total and synergy for each deck side-by-side with a delta (`▲ +134` / `▼ -22`)
- **Bracket flags row:** flag pills for each deck side-by-side (GC, cEDH, COMBO, etc.)
- **Category blocks** (one per each of the 4 main categories):
  - Top row: category total score for each deck with a delta, shown as opposing bars
  - Indented below: every sub-category that appears in either deck, showing score and card count per deck, color-coded by their parent category color
  - Sub-categories with zero contribution in a deck are shown dimmed rather than hidden

### Tab 2: Side by Side

Two full matrix tables (the existing card table) rendered next to each other inside a horizontally scrollable container. Each has its own deck name header. All existing table functionality (sort, search, filter, CSV export) works independently per deck.

## Data Flow

`processApiData` is called twice in parallel (once per deck URL) — no changes to existing processing logic. `CompareView` receives two processed card arrays and renders them against each other.

## Components (new)

- `CompareLoadScreen` — two-input load form with parallel fetch
- `CompareView` — tabbed container with header
- `SummaryDiff` — summary diff tab content
- `SideBySide` — two matrix table instances side by side

## Out of Scope

- Comparing more than 2 decks
- Highlighting cards shared between decks in the side-by-side view
- Saving/permalinking comparisons
