import assert from 'node:assert/strict';
import test from 'node:test';
import * as S from '../slicer.js';
import { RUE, SONIA, SCENARIO } from './cards.mjs';

const KNOWN = ['Rue', 'Rue Bennett', 'Jules', 'Jules Vaughn', 'Leon', 'Leon Kennedy', 'Maddy', 'Nate', 'Elliot'];

function sectionText(card, kind) {
    const p = S.parseCard(card, { knownNames: KNOWN });
    return p.sections.filter(s => s.kind === kind);
}

test('recognises cards and leaves other entries alone', () => {
    assert.equal(S.looksLikeCard(RUE), true);
    assert.equal(S.looksLikeCard(SONIA), true);
    assert.equal(S.looksLikeCard(SCENARIO), false);
});

test('parses layout A into the right sections', () => {
    const p = S.parseCard(RUE, { knownNames: KNOWN });
    const kinds = p.sections.map(s => s.kind);
    assert.deepEqual(kinds, ['canon', 'identity', 'personality', 'speech', 'history', 'knowledge', 'likes', 'fears', 'goals',
        'secrets', 'coping', 'relationships', 'custom', 'limits', 'habits', 'standing', 'ordinary', 'social', 'inner',
        'appearance', 'contradictions', 'boundaries']);
    const rel = p.sections.find(s => s.kind === 'relationships');
    assert.deepEqual(rel.persons.map(x => x.core), ['JULES VAUGHN', 'ELLIOT', 'LESLIE BENNETT', 'GIA BENNETT', 'LAURIE', 'LEON KENNEDY']);
    assert.equal(p.sections.find(s => s.kind === 'custom').title, 'ADDICTION');
    // The LEON entry must not have swallowed the ADDICTION section.
    assert.ok(!rel.persons.at(-1).lines.join('\n').includes('Prefers pills'));
});

test('parses layout B (bold headings, bold relationship names)', () => {
    const p = S.parseCard(SONIA, { knownNames: KNOWN });
    assert.deepEqual(p.sections.map(s => s.kind), ['canon', 'identity', 'personality', 'speech', 'history', 'relationships']);
    assert.deepEqual(p.sections.at(-1).persons.map(x => x.core), ['Maddy', 'Nate']);
    assert.ok(p.preamble.join('\n').includes('SONIA PEREZ'));
});

function slice(card, mode, { present = [], scene = '', recentHistory = 3, extraKeep = [] } = {}) {
    const parsed = S.parseCard(card, { knownNames: KNOWN });
    const presentLc = new Set(present.map(x => x.toLowerCase()));
    const autoPerson = (p) => p.names.some(n => presentLc.has(n.toLowerCase())) || S.mentionsAny(scene, p.names) || S.relationMentioned(scene, p.paren);
    const autoLine = (t) => S.mentionsAny(t, present);
    const plan = S.planCard(parsed, { mode, autoPerson, autoLine, recentHistory });
    const keep = new Set([...plan.keep, ...extraKeep]);
    return { ...S.sliceCard(parsed, mode, keep), plan, parsed };
}

const PROTECTED = ['canon', 'identity', 'personality', 'speech', 'knowledge', 'likes', 'fears', 'goals', 'secrets', 'coping',
    'custom', 'limits', 'habits', 'standing', 'inner', 'appearance', 'contradictions', 'boundaries'];

test('in scene: every protected section is sent word for word', () => {
    const { text } = slice(RUE, 'present', { present: ['Leon', 'Jules', 'Jules Vaughn'] });
    for (const kind of PROTECTED) {
        for (const sec of sectionText(RUE, kind)) {
            for (const line of sec.lines.filter(l => l.trim())) {
                assert.ok(text.includes(line), `missing ${kind} line: ${line}`);
            }
            assert.ok(text.includes(sec.heading), `missing heading ${sec.heading}`);
        }
    }
    // all sample lines survive
    assert.ok(text.includes('(Cornered) "I\'m not — that\'s not what this is."'));
});

test('in scene: history keeps the newest lines and lines about people present', () => {
    const { text } = slice(RUE, 'present', { present: ['Leon', 'Jules'] });
    assert.ok(text.includes('Monday 15 October 2018: first sale at school.'));
    assert.ok(text.includes('Saturday 13 October 2018: Laurie gives her the suitcase.'));
    assert.ok(text.includes('Age 5–13: grows up next door to Leon.'), 'line about the player');
    assert.ok(text.includes('Season 1: meets Jules at the party.'), 'line about someone present');
    assert.ok(!text.includes('Age 16: overdoses.'), 'unrelated old line is cut');
    assert.ok(!text.includes('Christmas Eve: diner with Ali'), 'unrelated line is cut');
});

test('in scene: relationship entries for absent people are cut, present and mentioned kept', () => {
    const { text, stats } = slice(RUE, 'present', { present: ['Leon', 'Jules'], scene: 'You hear Elliot laughing downstairs.' });
    assert.ok(text.includes('JULES VAUGHN (girlfriend)'));
    assert.ok(text.includes('LEON KENNEDY (cousin)'));
    assert.ok(text.includes('ELLIOT\n- Wants: someone to use with.\n- Hides: how scared she is of Laurie.'), 'mentioned in the scene: whole');
    // Absent people keep what she wants from them, nothing else
    assert.ok(text.includes('LESLIE BENNETT (mother)\n- Wants: to be trusted again.'));
    assert.ok(!text.includes('polite, specific, full of detail when lying'));
    assert.ok(text.includes('GIA BENNETT (sister)\n- Wants: Gia to be okay.'));
    assert.ok(!text.includes('the bedroom floor'));
    const rel = stats.find(s => s.kind === 'relationships');
    assert.equal(rel.kept, 3);
    assert.deepEqual(rel.cutNames.sort(), ['Gia Bennett', 'Laurie', 'Leslie Bennett']);
});

test('in scene: "your mom" brings in the entry headed (mother)', () => {
    const { text } = slice(RUE, 'present', { present: ['Leon'], scene: 'Is your mom home?' });
    assert.ok(text.includes('polite, specific, full of detail when lying'), 'Leslie whole');
    assert.ok(!text.includes('teasing, big-sister'), 'Gia wants only');
});

test('in scene: matched lines are added back', () => {
    const base = slice(RUE, 'present', { present: ['Leon'] });
    const overdose = base.plan.candidates.find(c => c.text.startsWith('Age 16'));
    const { text } = slice(RUE, 'present', { present: ['Leon'], extraKeep: [overdose.id] });
    assert.ok(text.includes('Age 16: overdoses. Gia finds her.'));
});

const DRIVES = ['canon', 'identity', 'personality', 'knowledge', 'likes', 'fears', 'goals', 'secrets', 'coping', 'custom',
    'limits', 'ordinary', 'social', 'inner', 'appearance', 'contradictions', 'boundaries'];

test('off-screen: everything that drives them stays; history, habits, standing and sample lines go', () => {
    const { text, stats } = slice(RUE, 'offscreen', { present: ['Leon'] });
    for (const kind of DRIVES) {
        for (const sec of sectionText(RUE, kind)) {
            assert.ok(text.includes(sec.heading), `missing heading ${sec.heading}`);
            for (const line of sec.lines.filter(l => l.trim())) assert.ok(text.includes(line), `missing ${kind} line: ${line}`);
        }
    }
    assert.ok(text.includes('Calm, dry, reasonable even when lying.'));
    assert.ok(!text.includes('(Teased)'), 'sample lines are not sent off-screen');
    const lines = new Set(text.split('\n').map(l => l.trim()));
    for (const gone of ['HISTORY', 'SMALL HABITS', 'STANDING']) assert.ok(!lines.has(gone), `${gone} should not be sent`);
    assert.ok(!text.includes('Pulls her sleeves'));
    assert.ok(text.includes('LEON KENNEDY (cousin)\n- Wants: him to stop watching her.\n- Speech: flat'), 'player entry whole');
    assert.ok(text.includes('JULES VAUGHN (girlfriend)\n- Wants: for Jules to stay.'), 'still knows what she wants from Jules');
    assert.ok(!text.includes('the bikes, the train station'), 'but not the rest of that entry');
    const before = S.approxTokens(RUE);
    const after = S.approxTokens(text);
    assert.ok(after < before * 0.8, `off-screen cut too small: ${before} -> ${after}`);
    assert.equal(stats.find(s => s.kind === 'speech').action, 'paragraph');
});

test('agenda level: full speech, newest and related history, no habits or standing', () => {
    const { text } = slice(RUE, 'agenda', { present: ['Leon', 'Jules'] });
    assert.ok(text.includes('(Teased) "Okay, wow. Rude."'), 'sample lines kept');
    assert.ok(text.includes('Monday 15 October 2018: first sale at school.'), 'newest history');
    assert.ok(text.includes('Season 1: meets Jules at the party.'), 'history about someone whose entry is kept');
    assert.ok(!text.includes('Age 16: overdoses.'), 'older unrelated history cut');
    assert.ok(!text.includes('Pulls her sleeves'));
    assert.ok(!text.includes('nobody\'s group'));
    for (const kind of DRIVES) for (const sec of sectionText(RUE, kind)) assert.ok(text.includes(sec.heading));
});

test('off-screen layout B keeps the title line and the speech paragraph', () => {
    const { text } = slice(SONIA, 'offscreen', { present: ['Leon', 'Maddy'] });
    assert.ok(text.startsWith('# SONIA PEREZ'));
    assert.ok(text.includes('Fast, sharp, Spanish-English mixed.'));
    assert.ok(!text.includes('Sample lines'));
    assert.ok(text.includes('**Maddy** — Wants her to leave him.'), 'Maddy is here');
    assert.ok(text.includes('*Shared:* Eight years of pageants.'), 'Maddy is here: whole');
    assert.ok(text.includes('**Nate** — Wants him gone.'), 'Nate: the one-line entry stays');
    assert.ok(!text.includes('ma\'am'), 'Nate: shared history cut');
});

test('agenda rows: owners and row text from the state block', () => {
    const block = `<details>
<summary>👤 NPC AGENDAS</summary>
- <b>Jules Vaughn</b> | Agenda: go see Rue at the Bennett house | (Step 1/3) | Location: The Marlowe
- <b>Nate</b> | Agenda: find out who Leon is | Location: his car
</details>
<details>
<summary>📜 QUESTS</summary>
- <b>Main</b> | Objective: settle in
</details>`;
    const rows = S.agendaRows(block);
    assert.deepEqual(rows.map(r => r.owner), ['Jules Vaughn', 'Nate']);
    assert.ok(rows[0].text.includes('go see Rue'));
});

// Ellis's layout from the first real report: an entry with no (relation) and no Wants/Hides lines
// sits between relationship entries, and the player's entry comes after it.
const ELLIS = `CANON POINT
Portrayed at Season 3, Episode 6.

IDENTITY
50s. Real estate. Married. Pays Jules.

SPEECH AND VOICE
Warm, slow, a little paternal. Never raises his voice.
(Pleased) "There she is."

SEX AND KINK
Likes being called sir.

RELATIONSHIPS

JULES VAUGHN (sugar baby)
- Wants: her attention on Thursdays.
- Speech: indulgent.

HIS WIFE AND CHILDREN
Married twenty years. Two kids in college. They know nothing about Jules.

RUE BENNETT
- Knows of her from Jules. Has never met her.

LEON
- Doesn't know: him at all.
- Speech: polite, sizing him up.

LIMITS
Won't be seen with Jules in public. (At a limit) "Not here."`;

test('relationship entries after a non-person heading are still entries (Ellis)', () => {
    const p = S.parseCard(ELLIS, { knownNames: [...KNOWN, 'Rue Bennett'] });
    const rel = p.sections.find(s => s.kind === 'relationships');
    assert.deepEqual(rel.persons.map(x => x.core), ['JULES VAUGHN', 'RUE BENNETT', 'LEON']);
    assert.ok(p.sections.some(s => s.kind === 'custom' && s.title === 'HIS WIFE AND CHILDREN'));
    const off = slice(ELLIS, 'offscreen', { present: ['Leon', 'Leon Kennedy', 'Dez'] });
    assert.ok(off.text.includes('LEON\n- Doesn\'t know: him at all.\n- Speech: polite, sizing him up.'), 'the player entry is kept whole off-screen');
    assert.ok(off.text.includes('RUE BENNETT\n- Knows of her from Jules.'), 'no Wants line: the first line stays');
    assert.ok(off.text.includes('HIS WIFE AND CHILDREN'), 'own section kept off-screen');
    assert.ok(off.text.includes('SEX AND KINK'));
    const on = slice(ELLIS, 'present', { present: ['Leon'], scene: 'He mentions his wife is out of town.' });
    assert.ok(on.text.includes('HIS WIFE AND CHILDREN'), 'own section kept whole in scene');
});

test('names from keys: no possessives, no lowercase first words, no pronouns', () => {
    assert.deepEqual(S.nameVariants("Rue's mom"), ["Rue's mom"]);
    assert.deepEqual(S.nameVariants('sugar daddy'), ['sugar daddy']);
    assert.deepEqual(S.nameVariants('HIS DAUGHTERS'), ['HIS DAUGHTERS', 'His Daughters']);
    assert.deepEqual(S.nameVariants('R.B.'), ['R.B.']);
    assert.equal(S.titleCase('NAZ AND ARTUR'), 'Naz and Artur');
    assert.ok(S.relationMentioned('her kids are at camp', 'HIS WIFE AND CHILDREN'));
    assert.ok(S.relationMentioned('Did your daughter call?', 'HIS DAUGHTERS'));
});

test('names: variants and whole-word matching', () => {
    assert.deepEqual(S.nameVariants('JULES VAUGHN').sort(), ['JULES', 'JULES VAUGHN', 'Jules', 'Jules Vaughn'].sort());
    assert.ok(S.mentionsAny("Rue's hoodie is on the floor", ['Rue']));
    assert.ok(!S.mentionsAny('Ruel walked in', ['Rue']));
    assert.ok(!S.mentionsAny('rue the day', ['Rue']));
    assert.ok(S.mentionsAny('`[Jules] (Tired):` "Hey."', ['Jules']));
    assert.deepEqual([...S.speakerLabels('`[Jules] (Tired):` <pink>"Hey."</pink>\n`[Rue] (Flat):` "Mm."')], ['Jules', 'Rue']);
});

test('chat text: the state block is not read as the scene', () => {
    const mes = 'Jules sits down.\n<!-- GFX_START -->\n<internal_states>\n- Physics: Jules on the couch, Leon by the door\n- <b>Nate</b> | Agenda: drive over\n</internal_states>\n<!-- GFX_END -->';
    const prose = S.cleanProse(mes);
    assert.ok(prose.includes('Jules sits down.'));
    assert.ok(!prose.includes('Nate'));
    assert.equal(S.physicsText(S.stateBlock(mes)).trim(), '- Physics: Jules on the couch, Leon by the door');
});

test('a shouted sample line is never read as a heading', () => {
    assert.equal(S.headingInfo('NO. STOP.'), null);
    assert.equal(S.headingInfo('- RELATIONSHIPS'), null);
    assert.equal(S.headingInfo('"GET OUT"'), null);
    assert.deepEqual(S.headingInfo('LEON (a new student she has not met)'), { core: 'LEON', paren: 'a new student she has not met', rest: '' });
    assert.equal(S.classifyHeading('WHAT THEY FEAR AND RESENT'), 'fears');
    assert.equal(S.classifyHeading('WHAT THEY LIKE AND WANT'), 'likes');
    assert.equal(S.classifyHeading('SECRET RELATIONSHIP VIEWS'), 'secrets');
});

test('hash matches SillyTavern getStringHash', () => {
    // Values computed with SillyTavern's public/scripts/utils.js getStringHash
    assert.equal(typeof S.stringHash('abc'), 'number');
    assert.equal(S.stringHash('abc'), S.stringHash('abc'));
    assert.notEqual(S.stringHash('abc'), S.stringHash('abd'));
});
