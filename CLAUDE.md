# CLAUDE.md - AI Assistant Guide

## Project Overview

**Bin & Case Calculator** — a single-page web application for fruit packing warehouse operations. It calculates how many bins to request from CBT based on production metrics like pack codes, case counts, bin weights, accumulator readings, and sizer fullness.

## Domain Context

This calculator supports a **fruit packing line** workflow. The physical process flows like this:

1. **CBT (Central Bin Tippper)** — fruit bins are dumped here to start the line
2. **Wash / Treatment / Dryer** — fruit is cleaned and dried
3. **Sizer** — fruit is sorted by size; "sizer fullness %" indicates how much fruit is currently on the line at this stage
4. **Accumulators** — buffer lanes that hold fruit before it reaches the baggers; if a bagger goes down, the line keeps running and fruit accumulates here instead of stopping. Lines 1 and 4 have 3 accumulators; all other lines have 4.
5. **Baggers** — fruit is bagged into 1 lb, 2 lb, 3 lb, or 5 lb bags
6. **Case packing** — bags are packed into cases that must weigh 30 lbs each, so bags per case = 30 / bag weight (1 lb → 30, 2 lb → 15, 3 lb → 10, 5 lb → 6)
7. **Palletizing** — finished cases are stacked onto pallets (60 cases/pallet normally, 90 cases/pallet on line 4 which has smaller cases)

The calculator's main job is to tell the operator **how many bins to request from CBT** so they can fulfill their case order without over- or under-requesting.

## Repository Structure

```
compac-calculator/
├── README.md              # Minimal project description
├── compac calculator      # Original HTML file (no extension)
├── compac.html            # Same calculator with .html extension
└── CLAUDE.md              # This file
```

`compac calculator` and `compac.html` are near-identical copies of the same HTML file. The `.html` version is the canonical file to edit.

## Tech Stack

- **HTML5 / CSS3 / Vanilla JavaScript** — no frameworks, no libraries, no dependencies
- **No build system** — no npm, no bundler, no transpilation
- **No tests** — no test framework or test files exist
- **Deployment**: open the HTML file directly in a browser or serve from any static web server

## Architecture

Everything lives in a single HTML file (`compac.html`):

- **`<style>`** block (lines 6-51): CSS with a dark terminal aesthetic (black background, green text, DodgerBlue buttons)
- **HTML body** (lines 53-167): 10 input fields (2 dropdowns + 8 number inputs), 6 output fields, Calculate and Reset buttons
- **`<script>`** block (lines 169-291): three functions — `toggleAcc4()`, `calculate()`, and `resetFields()`

### Input Fields (10)

| ID     | Type     | Label                 |
|--------|----------|-----------------------|
| line   | dropdown | Pack line (1-8)       |
| bagwt  | dropdown | Bag weight (1,2,3,5 lb) |
| tcn    | number   | Total cases needed    |
| tbd    | number   | Total bins dumped     |
| tbw    | number   | Total bin weight      |
| tcm    | number   | Total cases made      |
| sizer  | number   | Sizer fullness %      |
| acc1-3 | number   | Accumulator 1-3       |
| acc4   | number   | Accumulator 4 (hidden on lines 1/4) |

### Output Fields (6)

Bins to ask for, Pallets left, Cases left, Cases on line, Average bin weight, Line utilization (%).

### Key Calculation Logic (`calculate()`)

1. **Bag weight selection** derives two values: `bagsPerCase` (30/weight: 30, 15, 10, 6) and `bagp` (bags per % line fullness: 87, 48, 32, 17)
2. **Accumulator average** (`tfull`): averages accumulator fullness — 3 accumulators on lines 1/4, 4 on all other lines. Accumulator 4 field is hidden when line 1 or 4 is selected.
3. **Core formulas**: bags needed, average bin weight, total bags on line, bins to request, cases left, line utilization %
4. All results are integers via `Math.floor()`

### `resetFields()`

Clears all inputs, resets dropdowns to default, shows accumulator 4, and resets all 6 outputs to `*`.

## Code Conventions

- **Variable naming**: short abbreviated names (`i1`-`i11`, `lineVal`, `abw`, `bndd`, etc.) with inline comments explaining purpose
- **No modules or imports** — all code is inline in the HTML
- **Input validation**: all fields must be valid integers; validated with `parseInt()` + `isNaN` check
- **Error handling**: single try-catch in `calculate()` that shows `alert()` on failure
- **Styling**: inline `<style>` block, no external CSS; layout uses fixed-width labels (200px) with inline-block
- **Event handling**: `onclick` attributes on buttons (no `addEventListener`)

## Development Workflow

1. Edit `compac.html` directly
2. Open in a browser to test
3. No build, lint, or test commands to run

## Things to Watch For

- Pack line and bag weight are dropdowns — no free-text entry, prevents invalid values
- Division by zero is possible if `tbd` (total bins dumped) is 0 (used as divisor for average bin weight)
- Lines 1 and 4 have only 3 accumulators; accumulator 4 field is auto-hidden for those lines
- Pallets-left calculation uses 90 cases/pallet on line 4 (smaller cases), 60 on all other lines
