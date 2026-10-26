// Runs the real index.js against a fake SillyTavern: events, chat, lorebook entries and the vector API.
import assert from 'node:assert/strict';
import test from 'node:test';
import { RUE, SCENARIO } from './cards.mjs';
import * as S from '../slicer.js';

const JULES = `CANON POINT
Portrayed at Season 3, Episode 6. Nothing after this has happened.

IDENTITY
23. Painter. Lives on the top floor of The Marlowe.

PERSONALITY
1. Alone: paints until four in the morning with the windows open.
9. Crossed: goes very polite, then stops answering texts.

SPEECH AND VOICE
Soft, quick, trails off mid-thought. Swears casually. Gets loud only when cornered.
(Warm) "Hey, you."
(Cornered) "Can you just — not. Please."

HISTORY
Age 11: her mother has her hospitalised.
Age 17: moves to East Highland with her dad.
Season 1: meets Rue at the party.
Season 2: Rue does not get on the train.
Season 3: paints Rue for the show.
Friday 12 October 2024: slaps Rue in the gallery.
Saturday 13 October 2024: Ellis texts about the dinner.
Sunday 14 October 2024: buys new canvases.

RELATIONSHIPS

RUE BENNETT (ex)
- Wants: nothing from her now.
- Speech: clipped.

ELLIS (sugar daddy)
- Wants: his money, not his company.
- Speech: sweet, performed.

AMY VAUGHN (mother)
- Wants: nothing. They have not spoken in years.
- Speech: none; she hangs up.

LEON (new neighbour)
- Doesn't know: him at all.
- Speech: polite, curious, a little guarded.

LIMITS
Won't let anyone watch her paint. (At a limit) "Out. Now. I mean it."

SMALL HABITS
Wipes her thumbs on her jeans.

ORDINARY DAY
Sleeps until noon, paints from dusk.`;

const LEON_CARD = `CANON POINT
Original character.
IDENTITY
Leon Kennedy, 24.
PERSONALITY
Cold.
SPEECH AND VOICE
Short and flat.`;

// ---------------------------------------------------------------- fake SillyTavern

const listeners = {};
const fetchLog = [];
let fetchImpl = async () => ({ ok: true, text: async () => '[]' });

const elements = new Map();
function el(sel) {
    if (!elements.has(sel)) {
        const o = { length: 1, _html: '', html(v) { if (v !== undefined) this._html = v; return this; }, append() { return this; },
            prop() { return this; }, on() { return this; }, val() { return this; }, text() { return this; }, show() { return this; } };
        elements.set(sel, o);
    }
    return elements.get(sel);
}
globalThis.$ = (x) => (typeof x === 'function' ? x() : el(x));
globalThis.jQuery = globalThis.$;
globalThis.fetch = async (url, init) => {
    fetchLog.push({ url, body: JSON.parse(init.body) });
    return fetchImpl(url, JSON.parse(init.body));
};

const context = {
    name1: 'Leon Kennedy',
    chat: [],
    extensionSettings: {},
    textCompletionSettings: { server_urls: { ollama: 'http://192.168.1.20:11434' } },
    saveSettingsDebounced() {},
    getRequestHeaders() { return { 'Content-Type': 'application/json' }; },
    eventTypes: { GENERATION_STARTED: 'generation_started', WORLDINFO_SCAN_DONE: 'worldinfo_scan_done', CHAT_CHANGED: 'chat_id_changed' },
    eventSource: {
        on(e, f) { (listeners[e] ||= []).push(f); },
        makeLast(e, f) { (listeners[e] ||= []).push(f); },
    },
};
globalThis.SillyTavern = { getContext: () => context };

await import('../index.js');

const REPLY = `You knock. The door opens on the second try.
\`[Jules] (Tired, Guarded):\` <pink>"Oh. Hey. You're the guy from down the hall."</pink>
She leans on the frame, paint on her wrists.
<!-- GFX_START -->
<internal_states>
- <b>Rue</b> | Agenda: get home | Location: Bennett house
- Physics: Jules in the doorway, Leon in the hallway
</internal_states>
<!-- GFX_END -->`;

function freshEntries() {
    const mk = (uid, comment, key, content) => ({ uid, world: 'S3E6', comment, key, content, disable: false });
    return [
        mk(1, 'Jules Vaughn', ['Jules', 'Jules Vaughn'], JULES),
        mk(2, 'Rue Bennett', ['Rue', 'Rue Bennett'], RUE),
        mk(3, 'Scenario', ['scenario'], SCENARIO),
        mk(4, 'Leon Kennedy', ['Leon'], LEON_CARD),
    ];
}

const REPLY_NO_AGENDA = REPLY.replace(/^- <b>Rue<\/b>.*\n/m, '');

const REPLY_ALONE = `You unpack the last box. The apartment is quiet.
<!-- GFX_START -->
<internal_states>
<details>
<summary>👤 NPC AGENDAS</summary>
- <b>Jules</b> | Agenda: go see Rue at the Bennett house | Location: The Marlowe
</details>
- Physics: Leon alone in his apartment
</internal_states>
<!-- GFX_END -->`;

async function runScan({ user = 'I hold up the wine. "Housewarming. Sort of."', next = 0, type = 'normal', reply = REPLY, earlier = 0, dryRun = false } = {}) {
    const before = [];
    for (let i = 0; i < earlier; i++) before.push({ is_user: true, is_system: false, mes: 'I nod.' }, { is_user: false, is_system: false, mes: 'Time passes.' });
    context.chat = [
        ...before,
        { is_user: false, is_system: false, mes: 'Your new floor at The Marlowe is quiet.' },
        { is_user: true, is_system: false, mes: 'I knock on the door across the hall.' },
        { is_user: false, is_system: false, mes: reply },
        { is_user: true, is_system: false, mes: user },
    ];
    const entries = freshEntries();
    const activated = new Map(entries.map(e => [`${e.world}.${e.uid}`, e]));
    for (const f of listeners.generation_started) await f(type, {}, dryRun);
    const args = { state: { current: 1, next, loopCount: 1 }, activated: { entries: activated, text: '' }, sortedEntries: entries };
    for (const f of listeners.worldinfo_scan_done) await f(args);
    return Object.fromEntries(entries.map(e => [e.comment, e.content]));
}

function setSettings(extra) {
    context.extensionSettings.cardSlicer = { enabled: true, mode: 'cut', lookBack: 2, recentHistory: 3, useVectors: true, topK: 4, threshold: 0.4, neverSlice: '', aliases: '', steady: false, ...extra };
}

test('keyword path: Jules in scene is trimmed, Rue on a routine row is off-screen, others untouched', async () => {
    setSettings({ useVectors: false });
    const out = await runScan();
    // Jules: everything protected kept, history trimmed, absent people keep their Wants line
    assert.ok(out['Jules Vaughn'].includes('(Cornered) "Can you just — not. Please."'));
    assert.ok(out['Jules Vaughn'].includes('LIMITS'));
    assert.ok(out['Jules Vaughn'].includes('ORDINARY DAY'), 'ordinary day always sent');
    assert.ok(out['Jules Vaughn'].includes('Sunday 14 October 2024: buys new canvases.'));
    assert.ok(!out['Jules Vaughn'].includes('Age 17: moves to East Highland'), 'old unrelated line cut');
    assert.ok(out['Jules Vaughn'].includes('LEON (new neighbour)\n- Doesn\'t know: him at all.\n- Speech: polite'));
    assert.ok(out['Jules Vaughn'].includes('ELLIS (sugar daddy)\n- Wants: his money, not his company.'));
    assert.ok(!out['Jules Vaughn'].includes('sweet, performed'));
    // Rue's row ("get home") names nobody: routine, so the off-screen level with voice lines
    const rue = out['Rue Bennett'];
    assert.ok(rue.includes('(To Leon, ordinary)'), 'voice line to Leon');
    assert.ok(rue.includes('(Teased)'));
    assert.ok(!rue.includes('(Warm)'), 'other sample lines cut');
    assert.ok(!rue.includes('Pulls her sleeves'), 'habits cut');
    assert.ok(!rue.includes('Age 16: overdoses.'), 'older history cut');
    assert.ok(rue.includes('Monday 15 October 2018: first sale at school.'), 'newest history kept');
    assert.ok(rue.includes('Age 5–13: grows up next door to Leon.'), 'history with Leon kept');
    assert.ok(!rue.includes('Season 1: meets Jules at the party.'), 'routine: history about Jules waits until Rue is involved');
    assert.ok(rue.includes('JULES VAUGHN (girlfriend)\n- Wants: for Jules to stay.\n- Hides: the using.'), 'Jules is in the scene: whole');
    // Untouched
    assert.equal(out.Scenario, SCENARIO);
    assert.equal(out['Leon Kennedy'], LEON_CARD);
    assert.equal(fetchLog.length, 0, 'no network calls with embeddings off');
    const report = elements.get('#card_slicer_report')._html;
    assert.ok(report.includes('In the scene: Jules Vaughn'));
    assert.ok(report.includes('Active off-screen: nobody'));
    assert.ok(report.includes('off-screen, routine'));
});

test('no agenda row: Rue keeps what drives her and a few voice lines', async () => {
    setSettings({ useVectors: false });
    const out = await runScan({ reply: REPLY_NO_AGENDA });
    const rue = out['Rue Bennett'];
    assert.ok(!rue.includes('(Lying)'));
    for (const keep of ['PERSONALITY', 'WHAT SHE LIKES AND WANTS', 'WHAT SHE FEARS AND RESENTS', 'LIMITS', 'ADDICTION', 'Prefers pills', 'GOALS', 'INNER LIFE', 'SOCIAL WORLD', 'ORDINARY DAY']) {
        assert.ok(rue.includes(keep), `${keep} kept`);
    }
    assert.ok(rue.includes('Age 5–13: grows up next door to Leon.'), 'history with Leon');
    assert.ok(rue.includes('GIA BENNETT (sister)\n- Wants: Gia to be okay.'));
    assert.ok(!rue.includes('teasing, big-sister'));
    assert.ok(!elements.get('#card_slicer_report')._html.includes('off-screen, routine'));
});

test('agenda pairs: Jules goes to see Rue, both get the middle level and each other\'s entries whole', async () => {
    setSettings({ useVectors: false });
    const out = await runScan({ reply: REPLY_ALONE, user: 'I make coffee.' });
    const report = elements.get('#card_slicer_report')._html;
    assert.ok(report.includes('In the scene: no carded character'));
    assert.ok(report.includes('Active off-screen: Jules Vaughn, Rue Bennett') || report.includes('Active off-screen: Rue Bennett, Jules Vaughn'));
    assert.ok(out['Jules Vaughn'].includes('RUE BENNETT (ex)\n- Wants: nothing from her now.\n- Speech: clipped.'), 'her row names Rue');
    assert.ok(out['Rue Bennett'].includes('JULES VAUGHN (girlfriend)\n- Wants: for Jules to stay.\n- Hides: the using.\n- Speech: quieter'), 'Jules\'s row names Rue');
    assert.ok(out['Rue Bennett'].includes('GIA BENNETT (sister)\n- Wants: Gia to be okay.'));
    assert.ok(!out['Rue Bennett'].includes('teasing, big-sister'));
    assert.ok(out['Jules Vaughn'].includes('(Warm) "Hey, you."'), 'sample lines on agenda');
    assert.ok(out['Jules Vaughn'].includes('Season 1: meets Rue at the party.'), 'history about Rue kept');
});

test('report mode changes nothing', async () => {
    setSettings({ mode: 'report', useVectors: false });
    const out = await runScan();
    assert.equal(out['Jules Vaughn'], JULES);
    assert.equal(out['Rue Bennett'], RUE);
    assert.ok(elements.get('#card_slicer_report')._html.includes('Report only'));
});

test('only the final scan loop is touched', async () => {
    setSettings({ useVectors: false });
    const out = await runScan({ next: 2 });
    assert.equal(out['Jules Vaughn'], JULES);
});

test('mentioning someone brings their card and entries in', async () => {
    setSettings({ useVectors: false });
    const out = await runScan({ user: 'I ask her if Ellis is the guy who keeps calling. And whether Rue still comes by.' });
    assert.ok(out['Jules Vaughn'].includes('ELLIS (sugar daddy)'));
    assert.ok(out['Rue Bennett'].includes('(Teased)'), 'Rue is named, so her full card goes in');
});

test('"your mom" brings in the entry headed (mother)', async () => {
    setSettings({ useVectors: false });
    const out = await runScan({ user: 'Does your mom know you live here?' });
    assert.ok(out['Jules Vaughn'].includes('AMY VAUGHN (mother)'));
});

test('embedding path: syncs once, adds matched lines, then reuses the collection', async () => {
    setSettings({ useVectors: true });
    context.extensionSettings.vectors = { source: 'ollama', ollama_model: 'qwen3-embedding:0.6b', use_alt_endpoint: false, ollama_keep: false };
    fetchLog.length = 0;
    const target = 'Age 11: her mother has her hospitalised.';
    const stored = new Map();
    fetchImpl = async (url, body) => {
        if (url === '/api/vector/list') return { ok: true, text: async () => JSON.stringify([...(stored.get(body.collectionId) || new Map()).keys()]) };
        if (url === '/api/vector/insert') {
            const m = stored.get(body.collectionId) || new Map();
            for (const it of body.items) m.set(it.hash, it.text);
            stored.set(body.collectionId, m);
            return { ok: true, text: async () => 'OK' };
        }
        if (url === '/api/vector/delete') return { ok: true, text: async () => 'OK' };
        if (url === '/api/vector/query-multi') {
            const res = {};
            for (const cid of body.collectionIds) {
                const m = stored.get(cid) || new Map();
                const hit = [...m.entries()].filter(([, t]) => t === target).map(([h]) => h);
                if (hit.length) res[cid] = { hashes: hit, metadata: [] };
            }
            return { ok: true, text: async () => JSON.stringify(res) };
        }
        throw new Error(`unexpected ${url}`);
    };
    const out = await runScan({ user: 'I ask about the hospital thing she mentioned.' });
    assert.ok(out['Jules Vaughn'].includes(target), 'embedding match is added back');
    const q = fetchLog.find(x => x.url === '/api/vector/query-multi');
    assert.equal(q.body.source, 'ollama');
    assert.equal(q.body.model, 'qwen3-embedding:0.6b');
    assert.equal(q.body.apiUrl, 'http://192.168.1.20:11434');
    assert.ok(!q.body.searchText.includes('Agenda'), 'state block is not in the query');
    const inserts = fetchLog.filter(x => x.url === '/api/vector/insert').length;
    assert.equal(inserts, 1, 'only Jules (in scene) is embedded');
    fetchLog.length = 0;
    await runScan({ user: 'I ask about the hospital thing she mentioned.' });
    assert.equal(fetchLog.filter(x => x.url === '/api/vector/insert' || x.url === '/api/vector/list').length, 0, 'second turn reuses the synced collection');
    assert.ok(elements.get('#card_slicer_report')._html.includes('embeddings (ollama, qwen3-embedding:0.6b)'));
});

test('embedding failure falls back to keywords and still slices', async () => {
    setSettings({ useVectors: true });
    context.extensionSettings.vectors = { source: 'ollama', ollama_model: 'other-model', use_alt_endpoint: true, alt_endpoint_url: 'http://10.0.0.9:11434' };
    fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    const out = await runScan({ reply: REPLY_NO_AGENDA });
    assert.ok(!out['Rue Bennett'].includes('(Warm)'));
    assert.ok(elements.get('#card_slicer_report')._html.includes('keywords (embedding request failed'));
});

test('never-slice list and quiet generations', async () => {
    setSettings({ useVectors: false, neverSlice: 'Jules Vaughn' });
    const out = await runScan();
    assert.equal(out['Jules Vaughn'], JULES);
    assert.notEqual(out['Rue Bennett'], RUE);
});

test('a card with no findable name is treated as in the scene', async () => {
    setSettings({ useVectors: false });
    context.chat = [{ is_user: true, mes: 'Hello.' }];
    const e = { uid: 9, world: 'W', comment: '', key: [], content: RUE, disable: false };
    const args = { state: { next: 0 }, activated: { entries: new Map([['W.9', e]]) }, sortedEntries: [e] };
    for (const f of listeners.worldinfo_scan_done) await f(args);
    assert.ok(e.content.includes('(Teased)'), 'sample lines kept');
    assert.ok(elements.get('#card_slicer_report')._html.includes('No name found'));
});

test('sliced texts parse back cleanly (no broken sections)', async () => {
    setSettings({ useVectors: false });
    const out = await runScan();
    for (const t of [out['Jules Vaughn'], out['Rue Bennett']]) {
        assert.ok(S.looksLikeCard(t));
        assert.ok(!/\n{3,}/.test(t));
    }
});

test('a small card with nothing to cut is sent as it is, without a warning', async () => {
    setSettings({ useVectors: false, mode: 'cut' });
    const VIV = `IDENTITY
Vivian, Jules's friend.
PERSONALITY
Warm.
SPEECH AND VOICE
Fast and bright.
(Happy) "Babe!"
RELATIONSHIPS
JULES VAUGHN (friend)
- Wants: Jules happy.
LEON (new neighbour)
- Wants: to meet him.`;
    context.chat = [{ is_user: false, mes: '`[Vivian] (Excited):` "Babe!" Jules laughs.' }, { is_user: true, mes: 'I wave at Vivian.' }];
    const e = { uid: 7, world: 'W', comment: 'Vivian', key: ['Vivian', 'Viv'], content: VIV, disable: false };
    const j = { uid: 8, world: 'W', comment: 'Jules Vaughn', key: ['Jules'], content: JULES, disable: false };
    const args = { state: { next: 0 }, activated: { entries: new Map([['W.7', e], ['W.8', j]]) }, sortedEntries: [e, j] };
    for (const f of listeners.worldinfo_scan_done) await f(args);
    assert.equal(e.content, VIV);
    const html = elements.get('#card_slicer_report')._html;
    assert.ok(html.includes('Nothing to cut, sent as it is'));
    assert.ok(!html.includes('not recognised cleanly'));
});

// ---------------------------------------------------------------- steady cuts (prompt caching)

async function newChat() {
    for (const f of listeners.chat_id_changed) await f();
}

test('steady: the same cast sends byte-identical cards on the next turn, even when the scene text differs', async () => {
    setSettings({ useVectors: false, steady: true });
    await newChat();
    const first = await runScan();
    const second = await runScan({ user: 'I tell her the canvases by the window look new.', earlier: 1 });
    assert.equal(second['Jules Vaughn'], first['Jules Vaughn']);
    assert.equal(second['Rue Bennett'], first['Rue Bennett']);
    assert.ok(elements.get('#card_slicer_report')._html.includes('Steady: 2 of 2 cards sent exactly as last turn'));
});

test('steady: someone newly named is added, and stays added', async () => {
    setSettings({ useVectors: false, steady: true });
    await newChat();
    const first = await runScan();
    assert.ok(!first['Jules Vaughn'].includes('she hangs up'), 'absent mother: wants line only');
    const mom = await runScan({ user: 'Does your mom know you live here?', earlier: 1 });
    assert.ok(mom['Jules Vaughn'].includes('she hangs up'), 'mother named: whole entry');
    const after = await runScan({ user: 'I pour the wine.', earlier: 2 });
    assert.equal(after['Jules Vaughn'], mom['Jules Vaughn'], 'the cut only grows while the level holds');
});

test('steady: a card raised by a mention lingers, then drops after three turns', async () => {
    setSettings({ useVectors: false, steady: true });
    await newChat();
    await runScan({ reply: REPLY_NO_AGENDA });
    const named = await runScan({ reply: REPLY_NO_AGENDA, user: 'Does Rue still come by?', earlier: 1 });
    assert.ok(named['Rue Bennett'].includes('(Warm)'), 'named: full card');
    const t2 = await runScan({ reply: REPLY_NO_AGENDA, earlier: 2 });
    const t3 = await runScan({ reply: REPLY_NO_AGENDA, earlier: 3 });
    assert.equal(t2['Rue Bennett'], named['Rue Bennett'], 'lingers');
    assert.equal(t3['Rue Bennett'], named['Rue Bennett'], 'still lingers');
    const t4 = await runScan({ reply: REPLY_NO_AGENDA, earlier: 4 });
    assert.ok(!t4['Rue Bennett'].includes('(Warm)'), 'drops back after three turns');
});

test('steady: a swipe of the same turn sends the same cards', async () => {
    setSettings({ useVectors: false, steady: true });
    await newChat();
    const a = await runScan({ user: 'Does Rue still come by?' });
    const b = await runScan({ user: 'Does Rue still come by?' });
    assert.deepEqual(b, a);
});

test('steady: an updated card is cut fresh, and a new chat starts fresh', async () => {
    setSettings({ useVectors: false, steady: true });
    await newChat();
    await runScan();
    await runScan({ user: 'Does your mom know you live here?', earlier: 1 });
    await newChat();
    const fresh = await runScan({ earlier: 2 });
    assert.ok(!fresh['Jules Vaughn'].includes('she hangs up'), 'new chat: no carry-over');
});

test('steady: dry runs read last turn but never change it', async () => {
    setSettings({ useVectors: false, steady: true });
    await newChat();
    const first = await runScan();
    await runScan({ user: 'Does your mom know you live here?', earlier: 1, dryRun: true });
    const next = await runScan({ user: 'I pour the wine.', earlier: 1 });
    assert.equal(next['Jules Vaughn'], first['Jules Vaughn'], 'the dry run did not add the mother entry');
});

test('steady off: each turn is cut fresh', async () => {
    setSettings({ useVectors: false, steady: false });
    await newChat();
    await runScan({ user: 'Does your mom know you live here?' });
    const next = await runScan({ user: 'I pour the wine.', earlier: 1 });
    assert.ok(!next['Jules Vaughn'].includes('she hangs up'));
});
