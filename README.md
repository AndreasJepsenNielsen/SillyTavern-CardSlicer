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

A character counts as **in the scene** when their name is in your last message, in the latest reply
(not counting the state block), in a speaker label like `[Jules] (Tired):`, or in the state block's Physics row.

A character off-screen is **active** when their row in the state block's NPC Agendas involves you, someone in
the scene or another carded character, or when someone else's row names them (Ellis's row says he texted Jules:
Jules is active). A row that names nobody (working a shift, running errands) is **routine**.

Nothing that drives a character is ever cut: Personality, Like and Want, Fear and Resent, Limits, Goals, Secrets,
Knowledge, Inner Life, Coping, Ordinary Day, Social World and every section of the character's own (FAITH AND USING, THE GROUP CHAT) are always sent, except sex and kink
sections, which are only sent in the scene (see below). What changes by level:

**In the scene**: the whole card. History keeps its newest lines, every line naming someone whose entry is sent
whole, and up to four more lines that match the scene.

**Off-screen, active**: the whole card. History keeps its newest lines and every line naming someone whose
entry is sent whole.

**Sex and kink sections** (headings with SEX, KINK, TURN-ONS, INTIMACY, EROTIC, NSFW, FETISH or BEDROOM;
not SEXUALITY) are only sent while the character is in the scene. The card template keeps everything from them
that shows in everyday life under Like and Want or Fear and Resent.

**Off-screen, routine or no row**: History the same way as active, Speech and Voice keeps its description and
three sample lines (lines labelled for texts or calls first, then lines to you, then the first ones), and
Small Habits and Standing are left out.

**Relationship entries**, at every level:

- **Whole** for you, for everyone in the scene, for anyone mentioned (a heading marked `(mother)` or
  `HIS WIFE AND CHILDREN` also counts when someone says "mom" or "wife"), for anyone named in their own agenda
  row, for anyone whose agenda row names them, and for entries matched to the scene.
- **Wants and Now lines only** for everyone else, so they still know who they want something from. An entry
  with no Wants or Now line keeps its first line.

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
| Replies read for who's here | 1 | Earlier replies read to decide who is in the scene. The Physics row of the latest state block also counts. |
| Newest history lines always kept | 3 | Recent events are the setup for the story. |
| Matches added per card | 4 | Extra history lines and relationship entries added when they match the scene. |
| Voice lines kept off-screen | 3 | Sample lines a routine or idle off-screen character keeps. |
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
