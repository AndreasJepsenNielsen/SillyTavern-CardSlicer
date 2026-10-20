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
    assert.ok(text.includes('ELLIOT'), 'mentioned in the scene');
    assert.ok(!text.includes('LESLIE BENNETT'));
    assert.ok(!text.includes('GIA BENNETT'));
    const rel = stats.find(s => s.kind === 'relationships');
    assert.equal(rel.kept, 3);
    assert.deepEqual(rel.cutNames.sort(), ['Gia Bennett', 'Laurie', 'Leslie Bennett']);
});

test('in scene: "your mom" brings in the entry headed (mother)', () => {
    const { text } = slice(RUE, 'present', { present: ['Leon'], scene: 'Is your mom home?' });
    assert.ok(text.includes('LESLIE BENNETT (mother)'));
    assert.ok(!text.includes('GIA BENNETT'));
});

test('in scene: matched lines are added back', () => {
    const base = slice(RUE, 'present', { present: ['Leon'] });
    const overdose = base.plan.candidates.find(c => c.text.startsWith('Age 16'));
    const { text } = slice(RUE, 'present', { present: ['Leon'], extraKeep: [overdose.id] });
    assert.ok(text.includes('Age 16: overdoses. Gia finds her.'));
});

test('off-screen: only the agreed sections, speech paragraph without samples', () => {
    const { text, stats } = slice(RUE, 'offscreen', { present: ['Leon'] });
    for (const kind of ['canon', 'identity', 'appearance', 'goals', 'secrets', 'knowledge', 'ordinary', 'inner']) {
        for (const sec of sectionText(RUE, kind)) for (const line of sec.lines.filter(l => l.trim())) assert.ok(text.includes(line), `missing ${kind}`);
    }
    assert.ok(text.includes('Calm, dry, reasonable even when lying.'));
    assert.ok(!text.includes('(Teased)'), 'sample lines are not sent off-screen');
    const lines = new Set(text.split('\n').map(l => l.trim()));
    for (const gone of ['PERSONALITY', 'HISTORY', 'WHAT SHE LIKES AND WANTS', 'LIMITS', 'SMALL HABITS', 'ADDICTION', 'COPING MECHANISMS', 'STANDING', 'SOCIAL WORLD', 'CONTRADICTIONS', 'BOUNDARIES']) {
        assert.ok(!lines.has(gone), `${gone} should not be sent`);
    }
    assert.ok(!text.includes('Prefers pills'));
    assert.ok(!text.includes('Pulls her sleeves'));
    assert.ok(text.includes('LEON KENNEDY (cousin)'), 'entry for the player stays');
    assert.ok(!text.includes('JULES VAUGHN'), 'Jules is not in the scene');
    const before = S.approxTokens(RUE);
    const after = S.approxTokens(text);
    assert.ok(after < before * 0.6, `off-screen cut too small: ${before} -> ${after}`);
    assert.equal(stats.find(s => s.kind === 'speech').action, 'paragraph');
});

test('off-screen layout B keeps the title line and the speech paragraph', () => {
    const { text } = slice(SONIA, 'offscreen', { present: ['Leon', 'Maddy'] });
    assert.ok(text.startsWith('# SONIA PEREZ'));
    assert.ok(text.includes('Fast, sharp, Spanish-English mixed.'));
    assert.ok(!text.includes('Sample lines'));
    assert.ok(text.includes('**Maddy** — Wants her to leave him.'));
    assert.ok(!text.includes('**Nate**'));
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
