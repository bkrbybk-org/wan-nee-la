#!/usr/bin/env node
// Unit tests for src/i18n/strings.ts — lookup, placeholders, plurals, and the
// health of the catalogue itself.
// Run: npm run test:i18n
import { STRINGS, isLang, t, tm, toLang, msg } from '../src/i18n/strings.ts';

let failures = 0;
const check = (name, cond, detail) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` -> ${detail}`}`);
	if (!cond) failures++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- lookup ----------------------------------------------------------------

eq('English by default', t('en', 'nav.calendar'), 'Calendar');
eq('Thai when asked', t('th', 'nav.calendar'), 'ปฏิทิน');
eq('language guard accepts en', isLang('en'), true);
eq('language guard rejects anything else', isLang('kr'), false);
eq('an unknown stored language falls back to English', toLang(null), 'en');
eq('and so does a nonsense one', toLang('klingon'), 'en');

// A key can be assembled at runtime (`audit.${action}`), so an unrecognised one
// must not take the page down.
eq('an unknown key returns itself rather than throwing', t('en', 'no.such.key'), 'no.such.key');

// --- placeholders ----------------------------------------------------------

eq('placeholders are filled', t('en', 'nav.signedInAs', { name: 'Mai' }), 'Signed in as Mai');
eq('and in Thai', t('th', 'nav.signedInAs', { name: 'Mai' }), 'เข้าใช้งานในชื่อ Mai');
// Thai often orders the number and the noun differently, which is the whole
// reason these are named rather than positional.
check('Thai may reorder them', t('th', 'me.usedOf', { used: 3, allotted: 15 }).startsWith('ใช้ไป'), t('th', 'me.usedOf', { used: 3, allotted: 15 }));
eq('a missing var is left alone', t('en', 'nav.signedInAs'), 'Signed in as {name}');

// --- plurals ---------------------------------------------------------------

eq('count of one takes the singular', t('en', 'edit.days', { count: 1, days: 1 }), '1 day');
eq('anything else takes the plural', t('en', 'edit.days', { count: 3, days: 3 }), '3 days');
eq('zero is plural', t('en', 'edit.days', { count: 0, days: 0 }), '0 days');
// A half-day is not one day, and English says "0.5 days".
eq('a half day is plural', t('en', 'edit.days', { count: 0.5, days: '0.5' }), '0.5 days');
eq('no count given falls back to the plural', t('en', 'edit.days', { days: 2 }), '2 days');
// Thai has no plural form: one side only, and the pipe never appears.
eq('Thai is unaffected by count', t('th', 'edit.days', { count: 1, days: 1 }), '1 วัน');
check('and carries no pipe', !t('th', 'edit.days', { count: 3, days: 3 }).includes('|'), 'pipe leaked into Thai');

// --- domain messages -------------------------------------------------------

eq('a domain message renders at the edge', tm('en', msg('error.pickType')), 'Pick a leave type.');
eq('in the reader\'s language', tm('th', msg('error.pickType')), 'กรุณาเลือกประเภทการลา');
eq(
	'with its numbers',
	tm('en', msg('error.tooFarBack', { days: 90 })),
	'That start date is more than 90 days in the past. Ask an admin to add it.',
);

// --- the catalogue itself --------------------------------------------------
//
// These are the checks that catch a half-finished translation, which is the
// failure mode of every string catalogue.

const entries = Object.entries(STRINGS);
check('the catalogue is not empty', entries.length > 100, `${entries.length} keys`);

const missingThai = entries.filter(([, v]) => !v.th || v.th.trim() === '').map(([k]) => k);
eq(`every key has Thai (${entries.length} keys)`, missingThai.length, 0);
check('and none is missing English', entries.filter(([, v]) => !v.en?.trim()).length === 0, 'missing English');

// An untranslated Thai value that is identical to the English one is usually an
// oversight. A handful are legitimately the same — proper nouns, mostly.
const SAME_ON_PURPOSE = new Set(['me.thai', 'flash.line', 'cal.entryLabel']);
const identical = entries.filter(([k, v]) => v.en === v.th && !SAME_ON_PURPOSE.has(k)).map(([k]) => k);
eq('no Thai value is a copy of the English', identical.length, 0, identical.join(', '));

// "(s)" is the shortcut this catalogue replaced with a real plural form.
const lazy = entries.filter(([, v]) => /\(s\)/.test(v.en)).map(([k]) => k);
eq('no English string falls back to "(s)"', lazy.length, 0, lazy.join(', '));

// Both sides of a plural must use the same placeholders, or one form silently
// renders a literal {brace}.
const mismatched = entries.filter(([, v]) => {
	if (!v.en.includes('|')) return false;
	const [one, many] = v.en.split('|');
	const names = (s) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
	return names(one) !== names(many);
});
eq('plural forms agree on their placeholders', mismatched.length, 0);

console.log(failures === 0 ? '\nAll i18n tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
