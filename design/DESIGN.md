# Luna design direction

Source of truth for how Luna looks. Claude reads this before any UI work (`luna-design` skill)
and updates it when the owner decides something about the look.

## Status

Direction: **waiting on the owner's references** (2 or 3 apps or sites whose look they like).
Until then, follow the interim rules below. When references arrive, study them as described in
`.claude/skills/luna-design/SKILL.md` section 2 and replace "Interim rules" with a real direction
and token table.

## What Luna is, for design purposes

- One user, mostly on a phone, several short glances a day: morning briefing, money, lists,
  talking to Luna. Desktop is a second, wider layout.
- The cockpit is about numbers and short text: mail count, money changes, stats, open tasks.
- Luna herself has a persona; chat is where personality may show. The cockpit should be calm.
- German UI first, English second. German words are long; layouts must wrap gracefully.

## Audit of the current UI (2026-10-03)

Why it reads as AI-made, in `apps/personal-luna/src/style.css`:

- Navy-to-purple radial gradient page background; purple-to-cyan gradients on three buttons.
- Uppercase, letter-spaced eyebrow label above the title ("PERSONAL LUNA").
- Every block is the same translucent rounded card with the same border; four equal cards in a row.
- No tokens: 18 raw hex colors in `style.css`, more inside components, 6 different radii.
- System font stack, bold for every heading and button; numbers not set in tabular figures.
- Empty states say what is missing but offer no next step.

## Interim rules (until references arrive)

- No decorative gradients, no glass blur, no uppercase eyebrows.
- Introduce tokens (`--color-*`, `--space-*`, `--radius-*`, `--font-*`) in `:root` before restyling.
- Not every block is a card. Group with spacing and type first; use a surface only to separate
  things that are interactive or truly separate.
- Hierarchy through size and weight contrast: one large number per tile, quiet labels.
- Money and counts in tabular figures; positive and negative colors only where they carry meaning.
- One accent color, used for the primary action and the current navigation item only.

## References

See `design/references/sources.md`.
