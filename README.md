# Card Slicer

A SillyTavern extension that sends only the parts of a character card that matter for the current scene.

It works on lorebook entries written in the character card template (v3 and later: all-caps section headings
such as `SPEECH AND VOICE`, `HISTORY`, `RELATIONSHIPS`). It runs after SillyTavern has picked which entries to
send, so keywords, Constant entries and Vector Storage still decide what activates, exactly as before. Card
Slicer only shortens the text of the cards that were picked.

## Install

1. In SillyTavern, open Extensions (the blocks icon) and click **Install extension**.
2. Paste `https://github.com/AndreasJepsenNielsen/SillyTavern-CardSlicer` and install.
3. Reload the page. **Card Slicer** is in the right-hand column of the Extensions panel.

Updates: Extensions → **Manage extensions** → the update button next to Card Slicer.

It starts in **Report only**: cards are still sent whole, and the panel shows what would have been cut.
Play a turn or two, open **Last turn**, check who it counted as in the scene and read the text it would send.
When it looks right, switch Mode to **Cut**.

## What it sends

A character counts as **in the scene** when their name is in your last message, in the last two replies
(not counting the state block), in a speaker label like `[Jules] (Tired):`, or in the state block's Physics row.

**In the scene**: the whole card, except

- **History**: the three newest lines, every line naming you or someone in the scene, every line naming
  someone mentioned in the scene, and up to four more lines that match the scene.
- **Relationships**: the entries for you, for everyone in the scene, for anyone mentioned (a heading marked
  `(mother)` also counts when someone says "mom"), and matched entries.
- **Ordinary Day and Social World**: only matched lines.

Personality, Speech and Voice with every sample line, Like and Want, Fear and Resent, Limits, Small Habits,
Knowledge, Standing, Inner Life and every other section are always sent whole.

**Off-screen** (the card was picked, but the character isn't in the scene): Canon Point, Identity, Appearance,
Goals, Secrets, Knowledge, Ordinary Day, Inner Life, the opening paragraph of Speech and Voice (no sample lines),
and the relationship entries for you and for whoever is in the scene.

Always sent whole:

- your own character's card (matched by your persona name),
- cards in the **Never slice** list,
- any entry that isn't a character card (scenario, setting, rules, locations),
- a card whose name can't be found (the panel warns you; add it under **Extra names**).

If a card doesn't come out cleanly (for example, the Speech and Voice heading went missing), it is sent whole and
the panel says so.

## Matching

"Matches the scene" uses the embedding source already set up in Vector Storage (your Ollama model). Vector
Storage doesn't need to be switched on for lorebooks, only to have a source picked. Card Slicer keeps its own
small index per card (folders starting with `cardslicer_` under `data/default-user/vectors`) and only embeds
a card again when the card changes.

If the embedder can't be reached, it falls back to matching shared words and says so in the panel.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Mode | Report only | Report only shows the cut. Cut sends it. |
| Replies read for who's here | 2 | Earlier replies read to decide who is in the scene. |
| Newest history lines always kept | 3 | Recent events are the setup for the story. |
| Matches added per card | 4 | Extra history lines and relationship entries added when they match the scene. |
| Match threshold | 0.4 | How close a line has to be to count as a match (0 to 1). Lower adds more. |
| Never slice | empty | Cards always sent whole, one name or entry title per line. |
| Extra names | empty | `Entry title = name, name` when a card goes by names its keys don't list. |

## Good to know

- The lorebook token budget is still counted on the full cards, because SillyTavern counts it before Card Slicer runs.
- The token numbers in the panel are estimates (characters ÷ 3.8).
- Cards in the older field style (Title Case fields like `Real Personality:`) aren't recognised as cards and are left alone.
- The preset only sees what is sent. A section that isn't sent can't be quoted that turn, which is the point,
  but it also means the "rotate through the card" rule rotates through what was sent.
- Nothing is changed in your lorebook files. The cut happens on the copy SillyTavern builds for each prompt.

## Development

`npm test` runs the parser tests and an end-to-end test of `index.js` against a fake SillyTavern (Node 20 or later).
