// Card Slicer for SillyTavern.
// Sends only the parts of a character card that matter for the current scene.
// It changes the lorebook text after SillyTavern has picked which entries to send, so which
// entries activate (keywords, Constant, Vector Storage) is never affected.

import {
    looksLikeCard, parseCard, planCard, sliceCard, nameVariants, titleCase, mentionsAny, relationMentioned,
    cleanProse, stateBlock, speakerLabels, physicsText, agendaRows, sigWords, overlap, stringHash, approxTokens,
} from './slicer.js';

const MODULE = 'cardSlicer';
const LOG = '[Card Slicer]';

const DEFAULTS = Object.freeze({
    enabled: true,
    mode: 'report', // 'report': work out the cut and show it, change nothing. 'cut': send the sliced cards.
    lookBack: 1, // earlier replies read to decide who is in the scene (the Physics row covers people who stay silent)
    recentHistory: 3, // newest HISTORY lines always kept
    useVectors: true, // match lines to the scene with Vector Storage's embedder
    topK: 4, // matched lines and entries added per card
    voiceLines: 3, // sample lines an off-screen character keeps
    threshold: 0.4, // similarity needed for a match
    neverSlice: '',
    aliases: '',
});

const runtime = {
    dryRun: false,
    genType: '',
    synced: new Map(),
    lastReport: null,
};

function ctx() {
    return SillyTavern.getContext();
}

function settings() {
    const all = ctx().extensionSettings;
    if (!all[MODULE] || typeof all[MODULE] !== 'object') all[MODULE] = {};
    const s = all[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = v;
    }
    return s;
}

function save() {
    ctx().saveSettingsDebounced();
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
}

function parseList(text) {
    return String(text ?? '').split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
}

/** "Card title = name, name" per line. */
function parseAliases(text) {
    const out = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const at = line.indexOf('=');
        if (at < 1) continue;
        const match = line.slice(0, at).trim().toLowerCase();
        const names = line.slice(at + 1).split(',').map(x => x.trim()).filter(Boolean);
        if (match && names.length) out.push({ match, names });
    }
    return out;
}

// ---------------------------------------------------------------- who a card is

function entryNames(entry, aliases) {
    const names = new Set();
    const addAll = (raw) => {
        for (const n of nameVariants(raw)) {
            names.add(n);
            if (n === n.toLowerCase()) names.add(titleCase(n));
        }
    };
    for (const k of Array.isArray(entry.key) ? entry.key : []) {
        const key = String(k ?? '').trim();
        if (!key || key.startsWith('/')) continue; // regex keys
        addAll(key);
    }
    addAll(entry.comment || '');
    // A name line at the top of the card, like "# AARON JACOBS — *Minor*" or "Jules Vaughn"
    const firstLine = (String(entry.content ?? '').split(/\r?\n/).find(l => l.trim()) || '').trim();
    if (/^#{1,6}\s/.test(firstLine)) addAll(firstLine.replace(/^#+\s*/, ''));
    else if (firstLine.length <= 60 && !/[.!?]$/.test(firstLine) && !/\b(?:CANON|IDENTITY|PERSONALITY|SPEECH)\b/.test(firstLine)) addAll(firstLine);

    const lowered = [...names].map(n => n.toLowerCase());
    const title = String(entry.comment || '').trim().toLowerCase();
    for (const a of aliases) {
        if (a.match === title || lowered.includes(a.match)) a.names.forEach(addAll);
    }
    return [...names];
}

// ---------------------------------------------------------------- the scene

function readScene(chat, lookBack) {
    const msgs = Array.isArray(chat) ? chat : [];
    let u = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m && m.is_user && !m.is_system) {
            u = i;
            break;
        }
    }
    const userText = u >= 0 ? String(msgs[u].mes ?? '') : '';
    const replies = [];
    for (let i = (u >= 0 ? u : msgs.length) - 1; i >= 0 && replies.length < Math.max(1, lookBack); i--) {
        const m = msgs[i];
        if (!m || m.is_user || m.is_system) continue;
        replies.push(String(m.mes ?? ''));
    }
    const replyProse = replies.map(cleanProse);
    const block = replies.length ? stateBlock(replies[0]) : '';
    const physics = physicsText(block);
    const labels = new Set([...speakerLabels(replyProse.join('\n'))].map(x => x.toLowerCase()));
    return {
        userText,
        sceneText: [userText, ...replyProse, physics].join('\n'),
        queryText: [userText, replyProse[0] || ''].join('\n').trim().slice(-3000),
        labels,
        agenda: agendaRows(block),
    };
}

// ---------------------------------------------------------------- matching

function vectorConfig(c) {
    const v = c.extensionSettings?.vectors;
    if (!v || !v.source) return null;
    const src = String(v.source);
    const urls = c.textCompletionSettings?.server_urls || {};
    const alt = v.use_alt_endpoint ? String(v.alt_endpoint_url || '') : '';
    switch (src) {
        case 'ollama': {
            const apiUrl = alt || urls.ollama;
            if (!apiUrl || !v.ollama_model) return null;
            return { source: src, model: v.ollama_model, apiUrl, keep: !!v.ollama_keep };
        }
        case 'llamacpp': {
            const apiUrl = alt || urls.llamacpp;
            return apiUrl ? { source: src, apiUrl } : null;
        }
        case 'vllm': {
            const apiUrl = alt || urls.vllm;
            return apiUrl ? { source: src, apiUrl, model: v.vllm_model } : null;
        }
        case 'transformers':
            return { source: src };
        case 'openai':
        case 'openrouter':
        case 'togetherai':
        case 'cohere':
        case 'electronhub':
        case 'chutes':
        case 'nanogpt':
            return { source: src, model: v[`${src}_model`] };
        default:
            return null;
    }
}

async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

/** Keeps one embedding collection per card, holding every line that can be matched. Re-embeds only when the card changes. */
async function syncCollection(cid, items, vcfg) {
    const signature = stringHash(items.map(i => i.hash).sort().join(','));
    if (runtime.synced.get(cid) === signature) return;
    const savedRaw = await post('/api/vector/list', { ...vcfg, collectionId: cid });
    const saved = new Set((Array.isArray(savedRaw) ? savedRaw : []).map(Number));
    const wanted = new Set(items.map(i => i.hash));
    const toInsert = items.filter(i => !saved.has(i.hash));
    const toDelete = [...saved].filter(h => !wanted.has(h));
    if (toInsert.length) await post('/api/vector/insert', { ...vcfg, collectionId: cid, items: toInsert });
    if (toDelete.length) await post('/api/vector/delete', { ...vcfg, collectionId: cid, hashes: toDelete });
    runtime.synced.set(cid, signature);
}

async function vectorMatch(needs, queryText, vcfg, s) {
    if (!queryText.trim()) {
        for (const w of needs) w.matched = new Set();
        return;
    }
    const ids = [];
    for (const w of needs) {
        const cid = `cardslicer_${stringHash(`${w.entry.world}|${w.entry.uid}|${vcfg.source}|${vcfg.model || ''}`)}`;
        w.cid = cid;
        w.hashToIds = new Map();
        const items = new Map();
        for (const m of w.plan.matchable) {
            const h = stringHash(m.text);
            if (!items.has(h)) items.set(h, { hash: h, text: m.text, index: items.size });
            const list = w.hashToIds.get(h) || [];
            list.push(m.id);
            w.hashToIds.set(h, list);
        }
        await syncCollection(cid, [...items.values()], vcfg);
        ids.push(cid);
    }
    const res = await post('/api/vector/query-multi', {
        ...vcfg,
        collectionIds: ids,
        searchText: queryText,
        topK: Math.max(12, ids.length * 12),
        threshold: Number(s.threshold) || 0,
    });
    const topK = Math.max(0, Number(s.topK) || 0);
    for (const w of needs) {
        const cand = new Set(w.plan.candidates.map(c => c.id));
        const picked = new Set();
        for (const h of res?.[w.cid]?.hashes || []) {
            for (const id of w.hashToIds.get(Number(h)) || []) {
                if (cand.has(id) && picked.size < topK) picked.add(id);
            }
        }
        w.matched = picked;
    }
}

function keywordMatch(w, queryText, s, exclude) {
    const q = sigWords(queryText, exclude);
    const topK = Math.max(0, Number(s.topK) || 0);
    const scored = w.plan.candidates
        .map(c => ({ c, n: overlap(sigWords(c.text, exclude), q) }))
        .filter(x => x.n >= 2)
        .sort((a, b) => b.n - a.n)
        .slice(0, topK);
    w.matched = new Set(scored.map(x => x.c.id));
}

// ---------------------------------------------------------------- main step

async function onScanDone(args) {
    try {
        if (!args || !args.state || args.state.next !== 0) return; // only once the scan has finished
        const s = settings();
        if (!s.enabled) return;
        const activated = args.activated && args.activated.entries;
        if (!(activated instanceof Map) || activated.size === 0) return;
        await processScan(args, activated, s);
    } catch (err) {
        console.error(LOG, 'failed, cards were sent whole', err);
    }
}

async function processScan(args, activated, s) {
    const c = ctx();
    const aliases = parseAliases(s.aliases);
    const never = new Set(parseList(s.neverSlice).map(x => x.toLowerCase()));
    const player = nameVariants(c.name1 || '');
    const playerLc = new Set(player.map(x => x.toLowerCase()));
    const scene = readScene(c.chat, Number(s.lookBack) || 1);

    // Every card in the active lorebooks, so relationship headings and the scene can be read against all of them.
    const pool = Array.isArray(args.sortedEntries) && args.sortedEntries.length ? args.sortedEntries : [...activated.values()];
    const registry = [];
    for (const e of pool) {
        if (!e || e.disable || typeof e.content !== 'string' || !looksLikeCard(e.content)) continue;
        registry.push({ world: e.world, uid: e.uid, names: entryNames(e, aliases) });
    }
    const isPresent = (names) => names.some(n => scene.labels.has(n.toLowerCase())) || mentionsAny(scene.sceneText, names);
    const presentLc = new Set(playerLc);
    const presentVariants = [...player];
    for (const r of registry) {
        r.present = isPresent(r.names);
        if (r.present) {
            r.names.forEach(n => presentLc.add(n.toLowerCase()));
            presentVariants.push(...r.names);
        }
    }
    const byName = new Map();
    for (const r of registry) for (const n of r.names) byName.set(n.toLowerCase(), r);

    // NPC Agendas: whose row it is, and who is named in someone else's row.
    const rowsFor = (names) => {
        const lc = new Set(names.map(n => n.toLowerCase()));
        return scene.agenda.filter(row => nameVariants(row.owner).some(v => lc.has(v.toLowerCase())));
    };
    for (const r of registry) {
        r.rows = rowsFor(r.names);
        r.namedIn = scene.agenda.filter(row => !r.rows.includes(row) && mentionsAny(row.text, r.names));
    }
    const knownNames = [...new Set([...registry.flatMap(r => r.names), ...player])];
    const excludeWords = new Set([...presentLc].flatMap(n => n.split(/\s+/)));

    const personNames = (p) => {
        const set = new Set(p.names || []);
        for (const n of p.names || []) {
            const r = byName.get(n.toLowerCase());
            if (r) r.names.forEach(x => set.add(x));
        }
        return [...set];
    };

    const report = { mode: s.mode, matcher: 'not needed', present: [], agenda: [], cards: [] };
    const work = [];

    for (const entry of activated.values()) {
        if (!entry || typeof entry.content !== 'string' || !looksLikeCard(entry.content)) continue;
        let reg = registry.find(r => r.world === entry.world && r.uid === entry.uid);
        if (!reg) {
            reg = { names: entryNames(entry, aliases) };
            reg.present = isPresent(reg.names);
            reg.rows = rowsFor(reg.names);
            reg.namedIn = scene.agenda.filter(row => !reg.rows.includes(row) && mentionsAny(row.text, reg.names));
        }
        const display = String(entry.comment || reg.names[0] || `Entry ${entry.uid}`);
        const namesLc = reg.names.map(n => n.toLowerCase());
        if (namesLc.some(n => playerLc.has(n))) {
            report.cards.push({ display, status: 'player' });
            continue;
        }
        if (never.has(display.trim().toLowerCase()) || namesLc.some(n => never.has(n))) {
            report.cards.push({ display, status: 'never' });
            continue;
        }
        const parsed = parseCard(entry.content, { knownNames });
        // A card whose name can't be found is never treated as off-screen.
        const unnamed = reg.names.length === 0;
        // Active: their row involves Leon, someone in the scene or another carded character, or someone's row names them.
        const others = registry.filter(o => o !== reg && !(o.world === entry.world && o.uid === entry.uid)).flatMap(o => o.names);
        const involved = [...player, ...presentVariants, ...others];
        const rowBody = (row) => row.text.replace(/^[^|]*\|/, ''); // the row without its owner's name
        const active = reg.namedIn.length > 0 || reg.rows.some(row => mentionsAny(rowBody(row), involved));
        const routine = !active && reg.rows.length > 0;
        const mode = reg.present || unnamed ? 'present' : (active ? 'active' : 'offscreen');
        if (reg.present) report.present.push(display);
        else if (active) report.agenda.push(display);

        const autoPerson = (p) => {
            const names = personNames(p);
            if (names.some(n => presentLc.has(n.toLowerCase()))) return true; // the player, or someone in the scene
            if (mentionsAny(scene.sceneText, names)) return true; // named in the scene
            if (reg.rows.some(row => mentionsAny(row.text, names))) return true; // their own agenda row names this person
            const other = names.map(n => byName.get(n.toLowerCase())).find(Boolean);
            if (other && other.rows.some(row => mentionsAny(row.text, reg.names))) return true; // that person's row names them
            // "mom" for a heading marked (mother), "wife" for HIS WIFE AND CHILDREN
            return relationMentioned(scene.queryText, `${p.paren} ${p.core}`);
        };
        // History lines about anyone whose entry is kept whole (the player, the scene, their agenda) stay too.
        const lineNames = [...presentVariants];
        for (const sec of parsed.sections) {
            for (const p of sec.persons) if (autoPerson(p)) lineNames.push(...personNames(p));
        }
        const autoLine = (text) => mentionsAny(text, lineNames);
        const plan = planCard(parsed, { mode, autoPerson, autoLine, recentHistory: Number(s.recentHistory) || 0 });
        work.push({ entry, display, names: reg.names, unnamed, routine, parsed, mode, plan, matched: null });
    }

    // Match the rest against the scene.
    const needs = work.filter(w => w.mode === 'present' && w.plan.candidates.length);
    if (needs.length) {
        report.matcher = 'keywords';
        let vectorsDone = false;
        if (s.useVectors) {
            const vcfg = vectorConfig(c);
            if (!vcfg) {
                report.matcher = 'keywords (Vector Storage has no embedding source this can use)';
            } else {
                try {
                    await vectorMatch(needs, scene.queryText, vcfg, s);
                    vectorsDone = true;
                    report.matcher = `embeddings (${vcfg.source}${vcfg.model ? `, ${vcfg.model}` : ''})`;
                } catch (err) {
                    console.warn(LOG, 'embedding match failed, using keywords', err);
                    report.matcher = 'keywords (embedding request failed, see browser console)';
                }
            }
        }
        if (!vectorsDone) for (const w of needs) keywordMatch(w, scene.queryText, s, excludeWords);
    }

    for (const w of work) {
        const keep = new Set([...w.plan.keep, ...(w.matched || [])]);
        const { text, stats } = sliceCard(w.parsed, w.mode, keep, { voiceLines: Number(s.voiceLines) || 0, playerNames: player });
        const before = approxTokens(w.entry.content);
        const speech = w.parsed.sections.find(x => x.kind === 'speech');
        const safe = !!text && (!speech || text.includes(speech.heading.trim()));
        // Nothing to cut (a small card): send the original as it is, no warning.
        const unchanged = safe && approxTokens(text) >= before;
        const finalText = unchanged ? w.entry.content : text;
        const after = safe ? approxTokens(finalText) : before;
        w.result = { text: finalText, stats, before, after, safe, unchanged };
        report.cards.push({
            display: w.display, status: w.mode, before, after, safe, unchanged, stats, text: w.result.text,
            names: w.names, unnamed: w.unnamed, routine: w.routine,
            matched: w.matched ? w.matched.size : 0,
        });
    }

    if (s.mode === 'cut') {
        for (const w of work) if (w.result.safe && !w.result.unchanged) w.entry.content = w.result.text;
    }

    if (!runtime.dryRun && runtime.genType !== 'quiet') {
        runtime.lastReport = report;
        renderReport(report);
    }
}

// ---------------------------------------------------------------- report

function summarize(card) {
    if (card.unchanged) return 'Nothing to cut, sent as it is';
    const parts = [];
    for (const st of card.stats || []) {
        if (st.kind === 'relationships' && st.total) {
            if (st.kept < st.total) {
                const cut = st.cutNames.slice(0, 6).join(', ') + (st.cutNames.length > 6 ? ', …' : '');
                parts.push(`Relationships ${st.kept} whole, ${st.total - st.kept} wants only (${cut})`);
            }
        } else if (st.action === 'trimmed') {
            parts.push(`${st.label} ${st.kept}/${st.total} lines`);
        } else if (st.action === 'voice') {
            parts.push(`${st.label}: ${st.kept}/${st.total} sample lines`);
        }
    }
    const dropped = (card.stats || []).filter(st => st.action === 'dropped' && st.kind !== 'relationships').map(st => st.label);
    if (dropped.length) parts.push(`Not sent: ${dropped.join(', ')}`);
    return parts.length ? parts.join(' · ') : 'Nothing cut';
}

function renderReport(r) {
    const el = $('#card_slicer_report');
    if (!el.length) return;
    if (!r) {
        el.html('<div class="card-slicer-muted">Nothing yet. Send a message and the cut for that turn shows here.</div>');
        return;
    }
    const sliced = r.cards.filter(x => x.status === 'present' || x.status === 'active' || x.status === 'offscreen');
    const saved = sliced.reduce((a, x) => a + (x.safe ? x.before - x.after : 0), 0);
    const before = sliced.reduce((a, x) => a + x.before, 0);
    const head = [
        r.mode === 'cut'
            ? `<b>Cut</b>: about ${saved.toLocaleString()} of ${before.toLocaleString()} card tokens left out this turn.`
            : `<b>Report only</b>: nothing was cut. Cutting would have left out about ${saved.toLocaleString()} of ${before.toLocaleString()} card tokens.`,
        `In the scene: ${r.present.length ? escapeHtml(r.present.join(', ')) : 'no carded character'}`,
        `Active off-screen: ${r.agenda && r.agenda.length ? escapeHtml(r.agenda.join(', ')) : 'nobody'}`,
        `Matching: ${escapeHtml(r.matcher)}`,
    ];
    const rows = r.cards.map((x) => {
        if (x.status === 'player') return `<div class="card-slicer-card"><b>${escapeHtml(x.display)}</b> <span class="card-slicer-tag">your character</span> <span class="card-slicer-muted">sent whole</span></div>`;
        if (x.status === 'never') return `<div class="card-slicer-card"><b>${escapeHtml(x.display)}</b> <span class="card-slicer-tag">never slice</span> <span class="card-slicer-muted">sent whole</span></div>`;
        const tag = x.status === 'present' ? 'in scene' : x.status === 'active' ? 'off-screen, active' : (x.routine ? 'off-screen, routine' : 'off-screen');
        let warn = x.safe ? '' : '<div class="card-slicer-warn">Card not recognised cleanly, so it was sent whole.</div>';
        if (x.unnamed) warn += '<div class="card-slicer-warn">No name found for this card, so it is always treated as in the scene. Add it under Extra names.</div>';
        const matched = x.status === 'present' && x.matched ? ` · ${x.matched} matched to the scene` : '';
        const found = x.names && x.names.length ? `<div class="card-slicer-muted">Looked for as: ${escapeHtml(x.names.join(', '))}</div>` : '';
        return `<div class="card-slicer-card">
            <div><b>${escapeHtml(x.display)}</b> <span class="card-slicer-tag">${tag}</span> <span class="card-slicer-muted">≈${x.before.toLocaleString()} → ${x.after.toLocaleString()} tokens${matched}</span></div>
            <div class="card-slicer-muted">${escapeHtml(summarize(x))}</div>${warn}${found}
            <details><summary>Text ${r.mode === 'cut' && x.safe ? 'sent' : 'that would be sent'}</summary><pre class="card-slicer-pre">${escapeHtml(x.text)}</pre></details>
        </div>`;
    });
    el.html(`<div class="card-slicer-head">${head.join('<br>')}</div>${rows.join('') || '<div class="card-slicer-muted">No character cards were sent this turn.</div>'}`);
}

// ---------------------------------------------------------------- settings panel

function settingsHtml() {
    return `
<div id="card_slicer_settings" class="card-slicer">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Card Slicer</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div id="card_slicer_warning" class="card-slicer-warn" style="display:none"></div>
      <label class="checkbox_label"><input type="checkbox" id="cs_enabled"><span>Enabled</span></label>
      <label for="cs_mode">Mode</label>
      <select id="cs_mode" class="text_pole">
        <option value="report">Report only: show the cut, send cards whole</option>
        <option value="cut">Cut: send the sliced cards</option>
      </select>
      <div class="card-slicer-grid">
        <label for="cs_lookback" title="How many earlier replies are read to decide who is in the scene">Replies read for who's here</label>
        <input id="cs_lookback" type="number" min="1" max="6" step="1" class="text_pole">
        <label for="cs_recent" title="The newest HISTORY lines of an in-scene character are always sent">Newest history lines always kept</label>
        <input id="cs_recent" type="number" min="0" max="20" step="1" class="text_pole">
        <label for="cs_topk" title="Extra history lines and relationship entries added per card when they match the scene">Matches added per card</label>
        <input id="cs_topk" type="number" min="0" max="20" step="1" class="text_pole">
        <label for="cs_voice" title="Sample lines an off-screen character keeps, so a cutaway or a text still sounds like them">Voice lines kept off-screen</label>
        <input id="cs_voice" type="number" min="0" max="20" step="1" class="text_pole">
        <label for="cs_threshold" title="How close a line must be to the scene to count as a match (0 to 1)">Match threshold</label>
        <input id="cs_threshold" type="number" min="0" max="1" step="0.05" class="text_pole">
      </div>
      <label class="checkbox_label"><input type="checkbox" id="cs_vectors"><span>Match with Vector Storage's embedder (keywords if it can't be reached)</span></label>
      <label for="cs_never">Never slice these cards (one name or title per line)</label>
      <textarea id="cs_never" class="text_pole" rows="2" placeholder="Example: Jules Vaughn (this grey text is only an example)"></textarea>
      <label for="cs_aliases">Extra names (one card per line: title = name, name)</label>
      <textarea id="cs_aliases" class="text_pole" rows="2" placeholder="Example: Fezco O'Neill = Fez, Fezco"></textarea>
      <hr>
      <b>Last turn</b>
      <div id="card_slicer_report"></div>
    </div>
  </div>
</div>`;
}

function bindSettings() {
    const s = settings();
    $('#cs_enabled').prop('checked', !!s.enabled).on('change', function () { s.enabled = !!this.checked; save(); });
    $('#cs_mode').val(s.mode).on('change', function () { s.mode = this.value === 'cut' ? 'cut' : 'report'; save(); });
    $('#cs_lookback').val(s.lookBack).on('input', function () { s.lookBack = Math.min(6, Math.max(1, parseInt(this.value, 10) || 1)); save(); });
    $('#cs_recent').val(s.recentHistory).on('input', function () { s.recentHistory = Math.min(20, Math.max(0, parseInt(this.value, 10) || 0)); save(); });
    $('#cs_topk').val(s.topK).on('input', function () { s.topK = Math.min(20, Math.max(0, parseInt(this.value, 10) || 0)); save(); });
    $('#cs_voice').val(s.voiceLines).on('input', function () { s.voiceLines = Math.min(20, Math.max(0, parseInt(this.value, 10) || 0)); save(); });
    $('#cs_threshold').val(s.threshold).on('input', function () { const v = parseFloat(this.value); s.threshold = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.4; save(); });
    $('#cs_vectors').prop('checked', !!s.useVectors).on('change', function () { s.useVectors = !!this.checked; save(); });
    $('#cs_never').val(s.neverSlice).on('input', function () { s.neverSlice = this.value; save(); });
    $('#cs_aliases').val(s.aliases).on('input', function () { s.aliases = this.value; save(); });
}

jQuery(() => {
    const c = ctx();
    settings();
    $('#extensions_settings2').append(settingsHtml());
    bindSettings();
    renderReport(null);

    if (!c.eventTypes.WORLDINFO_SCAN_DONE) {
        $('#card_slicer_warning').text('This SillyTavern version is too old for Card Slicer (it needs the lorebook scan event from 1.13 or later).').show();
        return;
    }
    c.eventSource.on(c.eventTypes.GENERATION_STARTED, (type, _options, dryRun) => {
        runtime.genType = String(type ?? '');
        runtime.dryRun = !!dryRun;
    });
    if (typeof c.eventSource.makeLast === 'function') c.eventSource.makeLast(c.eventTypes.WORLDINFO_SCAN_DONE, onScanDone);
    else c.eventSource.on(c.eventTypes.WORLDINFO_SCAN_DONE, onScanDone);
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => {
        runtime.lastReport = null;
        renderReport(null);
    });
    console.log(LOG, 'loaded');
});
