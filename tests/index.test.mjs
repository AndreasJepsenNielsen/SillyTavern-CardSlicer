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

async function runScan({ user = 'I hold up the wine. "Housewarming. Sort of."', next = 0, type = 'normal' } = {}) {
    context.chat = [
        { is_user: false, is_system: false, mes: 'Your new floor at The Marlowe is quiet.' },
        { is_user: true, is_system: false, mes: 'I knock on the door across the hall.' },
        { is_user: false, is_system: false, mes: REPLY },
        { is_user: true, is_system: false, mes: user },
    ];
    const entries = freshEntries();
    const activated = new Map(entries.map(e => [`${e.world}.${e.uid}`, e]));
    for (const f of listeners.generation_started) await f(type, {}, false);
    const args = { state: { current: 1, next, loopCount: 1 }, activated: { entries: activated, text: '' }, sortedEntries: entries };
    for (const f of listeners.worldinfo_scan_done) await f(args);
    return Object.fromEntries(entries.map(e => [e.comment, e.content]));
}

function setSettings(extra) {
    context.extensionSettings.cardSlicer = { enabled: true, mode: 'cut', lookBack: 2, recentHistory: 3, useVectors: true, topK: 4, threshold: 0.4, neverSlice: '', aliases: '', ...extra };
}

test('keyword path: Jules in scene is trimmed, Rue off-screen is cut down, others untouched', async () => {
    setSettings({ useVectors: false });
    const out = await runScan();
    // Jules: everything protected kept, history trimmed, absent relationships cut
    assert.ok(out['Jules Vaughn'].includes('(Cornered) "Can you just — not. Please."'));
    assert.ok(out['Jules Vaughn'].includes('LIMITS'));
    assert.ok(out['Jules Vaughn'].includes('Sunday 14 October 2024: buys new canvases.'));
    assert.ok(!out['Jules Vaughn'].includes('Age 17: moves to East Highland'), 'old unrelated line cut');
    assert.ok(out['Jules Vaughn'].includes('LEON (new neighbour)'));
    assert.ok(!out['Jules Vaughn'].includes('ELLIS (sugar daddy)'));
    // Rue was only in the state block, so she is off-screen
    assert.ok(!out['Rue Bennett'].includes('(Teased)'));
    assert.ok(out['Rue Bennett'].includes('Calm, dry, reasonable even when lying.'));
    assert.ok(out['Rue Bennett'].length < RUE.length * 0.6);
    // Untouched
    assert.equal(out.Scenario, SCENARIO);
    assert.equal(out['Leon Kennedy'], LEON_CARD);
    assert.equal(fetchLog.length, 0, 'no network calls with embeddings off');
    const report = elements.get('#card_slicer_report')._html;
    assert.ok(report.includes('In the scene: Jules Vaughn'));
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
    const out = await runScan();
    assert.ok(!out['Rue Bennett'].includes('(Teased)'));
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
