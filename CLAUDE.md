# CLAUDE.md - AI Assistant Guide

## Project Overview

**Bin & Case Calculator** — a single-page web application for warehouse/packaging operations. It calculates how many bins to request from CBT based on production metrics like pack codes, case counts, bin weights, accumulator readings, and sizer fullness.

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
- **HTML body** (lines 53-156): 12 input fields, 6 output fields, Calculate and Reset buttons
- **`<script>`** block (lines 158-266): two functions — `calculate()` and `resetFields()`

### Input Fields (12)

| ID     | Label                 |
|--------|-----------------------|
| line   | Pack line             |
| lspc   | Left side packcode    |
| rspc   | Right side packcode   |
| tcn    | Total cases needed    |
| tbd    | Total bins dumped     |
| tbw    | Total bin weight      |
| tcm    | Total cases made      |
| sizer  | Sizer fullness %      |
| acc1-4 | Accumulator 1-4       |

### Output Fields (6)

Bins to ask for, Pellets left, Cases left, Cases on line, Average bin weight, Line utilization (%).

### Key Calculation Logic (`calculate()`)

1. **Bag count per packcode** (`bagp`): maps right-side packcode (1->87, 2->48, 3->32, 5->17)
2. **Accumulator average** (`tfull`): averages 3 accumulators for lines 1/4, 4 accumulators for all other lines
3. **Core formulas**: bags needed, average bin weight, total bags on line, bins to request, cases left, line utilization %
4. All results are integers via `Math.floor()`

### `resetFields()`

Clears all 12 inputs and resets all 6 outputs to `*`.

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

- The packcode-to-bag mapping only handles values 1, 2, 3, 5 — other values leave `bagp` at 0
- Division by zero is possible if `tbd` (total bins dumped) is 0 (used as divisor for average bin weight)
- Lines 1 and 4 use 3 accumulators; all other lines use 4 — this is intentional domain logic
- Pellets-left calculation uses 90 cases/pallet when `lspc` is 4, otherwise 60
