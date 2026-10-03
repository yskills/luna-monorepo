---
name: luna-design
description: How to design and restyle Luna UI so it does not look AI-generated - work from the owner's reference apps, keep tokens in design/DESIGN.md, screenshot and critique before shipping. Use for any change to Luna's Vue views, components or CSS.
---

# Luna design

Luna's first cockpit was judged "looks very AI": navy-to-purple radial gradient, uppercase
eyebrow labels, a purple-to-cyan gradient button, identical rounded translucent cards. The fix is
not more decoration. It is a specific direction taken from real products the owner likes, applied
through a small token system, and checked with screenshots.

Read `design/DESIGN.md` first. It is the source of truth for direction and tokens. Also load the
`frontend-design` skill for general craft; where the two disagree, `DESIGN.md` wins because it
encodes the owner's taste.

## 1. Start from references, not from a blank page

The owner's references live in `design/references/` (screenshots, plus `sources.md` with URLs and
what they liked about each). If there are none for the screen you're building, ask the owner for
2 or 3 apps they like before inventing a look, and meanwhile follow `DESIGN.md`.

To capture a reference URL as images:

```
node .claude/scripts/shoot.mjs --out design/references/<name> https://example.com
```

Cloud sessions can only reach hosts the environment's network policy allows; when a site is
blocked, ask the owner for a screenshot instead.

## 2. Study a reference like a designer

For each reference, write down in `DESIGN.md` (not in chat) what makes it work, as measurable
facts rather than adjectives:

- Palette: background, surfaces, text levels, one or two accents, semantic colors, as hex.
- Type: family (or the closest free, self-hostable one), size scale, weights, letter-spacing,
  where they use numerals and how (tabular figures for money).
- Spacing: the base unit and scale; how dense the layout is; content max width.
- Shape and depth: radii per element type, borders vs. shadows, how surfaces separate.
- Layout: grid, navigation pattern on phone vs. desktop, what the first screen shows.
- Detail: hover/focus/pressed states, empty states, motion (duration, easing, what moves).

"Copy" means taking these structural decisions: layout, rhythm, type scale, density, color
relationships. Never copy logos, brand marks, illustrations, product names or proprietary fonts.

## 3. Turn it into tokens, then build

- All colors, type sizes, spacing, radii and shadows are CSS custom properties in
  `apps/personal-luna/src/style.css` `:root`, mirrored in `DESIGN.md`. Components use tokens only;
  a raw hex in a component is a bug.
- Fonts must be self-hosted (CSP allows no third-party origins): add the woff2 files to the app,
  never a Google Fonts link.
- Phone first (390 px wide): Luna is used mostly on the phone. Desktop is the second layout,
  not a stretched phone.
- Data is the hero on the cockpit: numbers large with tabular figures, labels quiet.

## 4. The AI-look checklist (reject on sight)

- Gradients used as decoration (backgrounds, buttons, text). Especially purple/blue/cyan.
- Every section in an identical rounded card with the same border, shadow and padding.
- Tracked-out ALL-CAPS eyebrow labels above headings.
- One radius on everything; one shadow on everything.
- Glassmorphism (translucent blurred cards) without a reason.
- Emoji or generic icons as decoration; icons that don't label an action.
- Default system font stack with no deliberate choice; bold everywhere.
- Copy that describes the UI ("Here you can see your...") instead of the content.
- Fade-and-slide on every element; hover effects on things that aren't clickable.
- Empty states that only say "nothing here" instead of offering the next action.

## 5. Check your own work

1. Run the app and screenshot every changed screen at phone and desktop size (`ui-screenshots`
   skill). Look at the images yourself first.
2. Hand the screenshots, `design/DESIGN.md` and the matching references to the `design-critic`
   agent. Fix everything it rates as blocking.
3. Repeat until the critic has no blocking findings, at most three rounds, then say in the PR what
   is still open.
4. Before calling it done, remove one thing (Chanel's rule): the decoration you'd miss least.

Parts of this skill are adapted from everything-claude-code (MIT, Affaan Mustafa):
`frontend-design-direction`, `rules/web/design-quality.md` and `design-system`.
