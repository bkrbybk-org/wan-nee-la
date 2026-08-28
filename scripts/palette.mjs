#!/usr/bin/env node
/**
 * Generates the Material 3 tonal palettes in public/app.css.
 *
 * M3 builds every colour role from a handful of tonal palettes — a fixed hue
 * and chroma sampled at tones 0-100 — and then maps tones onto roles
 * (primary = tone 40 in light, tone 80 in dark, and so on). The reference
 * implementation uses Google's HCT space; this uses OKLCh, which is also
 * perceptually uniform and is available with no dependency. The tones it
 * produces are within a couple of points of HCT's, which matters not at all
 * for contrast — every pair is checked against WCAG below rather than assumed.
 *
 * Run: node scripts/palette.mjs        (prints the token blocks and the audit)
 */

import { readFileSync } from 'node:fs';

// --- OKLCh -> sRGB ---------------------------------------------------------

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function oklchToSrgb(L, C, hDeg) {
	const h = (hDeg * Math.PI) / 180;
	const a = C * Math.cos(h);
	const b = C * Math.sin(h);

	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;

	const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

	const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	return [lr, lg, lb].map((v) => {
		const c = clamp01(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
		return Math.round(c * 255);
	});
}

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * One tone of a palette.
 *
 * M3 tones are CIE L* values, not OKLab's L — they are different scales
 * (L* 50 is OKLab L 0.60), so tone 6 read as OKLab 0.06 would come out very
 * nearly black. Convert through luminance: L* -> Y, and for a grey OKLab's
 * L is the cube root of Y.
 *
 * Chroma is reduced at the extremes because a highly saturated colour cannot
 * be that light or that dark in sRGB — pushing it anyway just clips a channel
 * and skews the hue.
 */
function tone(hue, chroma, t) {
	// The extremes are pure by definition in M3 — a tinted "white" would show
	// up as a colour cast on every filled button's label.
	if (t <= 0) return '#000000';
	if (t >= 100) return '#ffffff';
	const y = t > 8 ? ((t + 16) / 116) ** 3 : t / 903.3;
	const L = Math.cbrt(y);
	const falloff = 1 - Math.abs(L - 0.6) / 0.62;
	return hex(oklchToSrgb(L, chroma * Math.max(0.12, falloff), hue));
}

// Seed hue 262 keeps the blue the app already used. Secondary is the same hue
// desaturated, tertiary is rotated towards teal for accents that must not read
// as "primary action".
const PALETTES = {
	p: { hue: 262, chroma: 0.15 },   // primary
	s: { hue: 262, chroma: 0.05 },   // secondary
	t: { hue: 196, chroma: 0.09 },   // tertiary
	e: { hue: 27, chroma: 0.17 },    // error
	n: { hue: 262, chroma: 0.006 },  // neutral
	nv: { hue: 262, chroma: 0.018 }, // neutral variant
};

const TONES = [0, 4, 6, 10, 12, 17, 20, 22, 24, 30, 40, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 100];

const P = {};
for (const [name, { hue, chroma }] of Object.entries(PALETTES)) {
	P[name] = {};
	for (const t of TONES) P[name][t] = tone(hue, chroma, t);
}

// --- contrast --------------------------------------------------------------

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(h) {
	const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
	const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
	return (x + 0.05) / (y + 0.05);
}

// --- role maps -------------------------------------------------------------

const light = {
	primary: P.p[40], 'on-primary': P.p[100], 'primary-container': P.p[90], 'on-primary-container': P.p[10],
	secondary: P.s[40], 'on-secondary': P.s[100], 'secondary-container': P.s[90], 'on-secondary-container': P.s[10],
	tertiary: P.t[40], 'on-tertiary': P.t[100], 'tertiary-container': P.t[90], 'on-tertiary-container': P.t[10],
	error: P.e[40], 'on-error': P.e[100], 'error-container': P.e[90], 'on-error-container': P.e[10],
	// M3 also names background/on-background; this app paints the page from
	// `surface` and never uses them, and a role nothing references is a role
	// nobody keeps correct.
	surface: P.n[98], 'on-surface': P.n[10],
	'surface-variant': P.nv[90], 'on-surface-variant': P.nv[30],
	outline: P.nv[50], 'outline-variant': P.nv[80],
	'surface-container-lowest': P.n[100], 'surface-container-low': P.n[96],
	'surface-container': P.n[94], 'surface-container-high': P.n[92], 'surface-container-highest': P.n[90],
	'inverse-surface': P.n[20], 'inverse-on-surface': P.n[95], 'inverse-primary': P.p[80],
	scrim: P.n[0],
};

const dark = {
	primary: P.p[80], 'on-primary': P.p[20], 'primary-container': P.p[30], 'on-primary-container': P.p[90],
	secondary: P.s[80], 'on-secondary': P.s[20], 'secondary-container': P.s[30], 'on-secondary-container': P.s[90],
	tertiary: P.t[80], 'on-tertiary': P.t[20], 'tertiary-container': P.t[30], 'on-tertiary-container': P.t[90],
	error: P.e[80], 'on-error': P.e[20], 'error-container': P.e[30], 'on-error-container': P.e[90],
	surface: P.n[6], 'on-surface': P.n[90],
	'surface-variant': P.nv[30], 'on-surface-variant': P.nv[80],
	outline: P.nv[60], 'outline-variant': P.nv[30],
	'surface-container-lowest': P.n[4], 'surface-container-low': P.n[10],
	'surface-container': P.n[12], 'surface-container-high': P.n[17], 'surface-container-highest': P.n[22],
	'inverse-surface': P.n[90], 'inverse-on-surface': P.n[20], 'inverse-primary': P.p[40],
	scrim: P.n[0],
};

function block(map) {
	return Object.entries(map).map(([k, v]) => `\t--md-${k}: ${v};`).join('\n');
}

// Every pair the stylesheet actually paints. AA is 4.5 for body text, 3.0 for
// large text and for UI outlines against their background.
const PAIRS = [
	['on-surface', 'surface', 4.5], ['on-surface-variant', 'surface', 4.5],
	['on-surface', 'surface-container', 4.5], ['on-surface-variant', 'surface-container', 4.5],
	['on-surface-variant', 'surface-container-high', 4.5],
	['on-surface', 'surface-container-highest', 4.5], ['on-surface-variant', 'surface-container-highest', 4.5],
	['on-primary', 'primary', 4.5],
	['on-primary-container', 'primary-container', 4.5],
	['on-secondary-container', 'secondary-container', 4.5],
	['on-tertiary-container', 'tertiary-container', 4.5],
	['on-error-container', 'error-container', 4.5],
	['error', 'surface', 4.5], ['error', 'surface-container', 4.5],
	// A text field in its error state: the container is surface-container-highest
	// and both the label and the active line turn error-coloured.
	['error', 'surface-container-highest', 4.5],
	['primary', 'surface', 4.5], ['primary', 'surface-container', 4.5],
	['inverse-on-surface', 'inverse-surface', 4.5],
	['outline', 'surface', 3], ['outline', 'surface-container', 3],
	['primary', 'surface-container-highest', 3],
	// .card, .cell, .balance-card, .who-block, .agenda-view and .booking all
	// paint this as their background and set both body and secondary text on
	// top of it, same as the other surface-container tones above.
	['on-surface', 'surface-container-low', 4.5], ['on-surface-variant', 'surface-container-low', 4.5],
];

let bad = 0;
for (const [scheme, map] of [['light', light], ['dark', dark]]) {
	for (const [fg, bg, min] of PAIRS) {
		const r = contrast(map[fg], map[bg]);
		const ok = r >= min;
		if (!ok) bad++;
		console.error(`${ok ? 'ok  ' : 'FAIL'} ${scheme.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
	}
}

// --- calendar chip: colour-mix against on-surface text ---------------------

/*
 * The chip background isn't a role pair — it's `color-mix(in srgb, <chip> 24%,
 * var(--md-chip-base))`, a leave type's own colour blended into a surface
 * tone. That mix falls outside what PAIRS can express, so it needs its own
 * arithmetic: replicate the browser's srgb color-mix (linear interpolation
 * per channel, in gamma-encoded sRGB, no linear-light conversion) and check
 * the result against the on-surface text the chip actually carries.
 *
 * These five hexes are seed data (migrations/0002_seed.sql and
 * migrations/0009_medical_leave.sql, the `color` column of `leave_types`),
 * not something derived from the token system above. An admin cannot edit
 * them today, so this is a guard on the theme staying legible against a fixed
 * palette, not a validator of arbitrary user input.
 */
const LEAVE_TYPE_COLORS = {
	annual: '#2563eb',
	sick: '#dc2626',
	personal: '#7c3aed',
	unpaid: '#64748b',
	medical: '#059669',
};

const CHIP_BASE_ROLE = { light: 'surface-container-lowest', dark: 'surface-container-high' };

function srgbColorMix(hexA, pctA, hexB) {
	const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
	const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
	const mixed = a.map((v, i) => Math.round(v * pctA + b[i] * (1 - pctA)));
	return hex(mixed);
}

for (const [scheme, map] of [['light', light], ['dark', dark]]) {
	const base = map[CHIP_BASE_ROLE[scheme]];
	for (const [code, colour] of Object.entries(LEAVE_TYPE_COLORS)) {
		const mixed = srgbColorMix(colour, 0.24, base);
		const r = contrast(map['on-surface'], mixed);
		const ok = r >= 4.5;
		if (!ok) bad++;
		console.error(`${ok ? 'ok  ' : 'FAIL'} ${scheme.padEnd(5)} chip ${code.padEnd(8)} on-surface on ${mixed}: ${r.toFixed(2)} (min 4.5)`);
	}
}

// --- the stylesheet must actually hold these values ------------------------

/*
 * Checking the generated palette against WCAG proves nothing on its own: the
 * numbers under test have to be the numbers the browser paints. So read
 * public/app.css back and compare. A hex edited by hand into the stylesheet —
 * the obvious way to "just darken that one border" — fails here rather than
 * silently leaving the audit above describing a palette nobody ships.
 *
 * Three blocks carry roles: the light :root, the dark media query, and the
 * explicit [data-theme="dark"] override. The last two must agree with each
 * other as well; they are duplicated because custom properties cannot be
 * composed, and a drifting copy is exactly what that duplication risks.
 */
function tokensIn(css, header) {
	const start = css.indexOf(header);
	if (start === -1) throw new Error(`block not found in app.css: ${header}`);
	const body = css.slice(start + header.length, css.indexOf('}', start));
	const found = {};
	for (const m of body.matchAll(/--md-([a-z-]+):\s*(#[0-9a-f]{6});/g)) found[m[1]] = m[2];
	return found;
}

function compare(label, want, got) {
	let wrong = 0;
	for (const [role, value] of Object.entries(want)) {
		if (got[role] === undefined) {
			console.error(`FAIL ${label}: --md-${role} is missing`);
			wrong++;
		} else if (got[role] !== value) {
			console.error(`FAIL ${label}: --md-${role} is ${got[role]}, generated ${value}`);
			wrong++;
		}
	}
	if (wrong === 0) console.error(`ok   ${label}: ${Object.keys(want).length} roles match`);
	return wrong;
}

const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
bad += compare('app.css light', light, tokensIn(css, ':root {'));
bad += compare('app.css dark (media query)', dark, tokensIn(css, ':root:not([data-theme="light"]) {'));
bad += compare('app.css dark (data-theme)', dark, tokensIn(css, ':root[data-theme="dark"] {'));

console.log('/* light */\n' + block(light));
console.log('\n/* dark */\n' + block(dark));
console.error(bad === 0 ? '\nall checks pass' : `\n${bad} check(s) fail`);
process.exitCode = bad === 0 ? 0 : 1;
