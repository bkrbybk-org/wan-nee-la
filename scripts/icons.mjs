#!/usr/bin/env node
/**
 * Draws the app icons.
 *
 * A web app manifest needs real PNGs — SVG icons are still not honoured
 * everywhere, and iOS ignores them outright — so these are rasterised here
 * rather than committed as opaque binaries nobody can regenerate or explain.
 * No image library: each pixel is tested against the shapes, drawn at 4× and
 * averaged down for antialiasing, then written as PNG with zlib, which Node
 * already has.
 *
 *     npm run icons
 *
 * The shapes come from src/views/logo.ts, the same description the header
 * and the browser-tab icon render as SVG, so the two cannot drift.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { LOGO_COLORS, LOGO_PAGE, LOGO_PALM, LOGO_SIZE, LOGO_TILE } from '../src/views/logo.ts';

const SS = 4; // supersampling factor

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// --- geometry --------------------------------------------------------------

/**
 * A path's subpaths as polylines. Only absolute M, C and Z, which is all
 * logo.ts uses; each cubic is cut into straight steps fine enough that the
 * 4× supersampling cannot see the joins.
 */
function flatten(d) {
	const tokens = d.match(/[MCZ]|-?\d*\.?\d+/g) ?? [];
	const paths = [];
	let current = null;
	let i = 0;
	const num = () => Number(tokens[i++]);
	while (i < tokens.length) {
		const cmd = tokens[i++];
		if (cmd === 'M') {
			current = [[num(), num()]];
			paths.push(current);
		} else if (cmd === 'C') {
			// Repeated coordinate groups continue the same command, as in SVG.
			while (i < tokens.length && !/[MCZ]/.test(tokens[i])) {
				const [x0, y0] = current[current.length - 1];
				const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
				for (let s = 1; s <= 24; s++) {
					const t = s / 24, u = 1 - t;
					current.push([
						u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
						u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
					]);
				}
			}
		} else if (cmd === 'Z') {
			current?.push(current[0]);
		} else {
			throw new Error(`logo path: unsupported command ${cmd}`);
		}
	}
	return paths;
}

/** Even-odd test against one closed polyline. */
function inside(poly, x, y) {
	let hit = false;
	for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
		const [xa, ya] = poly[a], [xb, yb] = poly[b];
		if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) hit = !hit;
	}
	return hit;
}

/** Distance from a point to a polyline — a stroke with round caps for free. */
function distance(poly, x, y) {
	let best = Infinity;
	for (let k = 1; k < poly.length; k++) {
		const [x0, y0] = poly[k - 1], [x1, y1] = poly[k];
		const dx = x1 - x0, dy = y1 - y0;
		const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
		best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
	}
	return best;
}

/** Whether logo-space point (x, y) is inside a shape from logo.ts. */
function covers(shape, x, y) {
	if (shape.kind === 'rect') {
		const { x: rx, y: ry, w, h, r } = shape;
		if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
		const cx = Math.max(rx + r, Math.min(rx + w - r, x));
		const cy = Math.max(ry + r, Math.min(ry + h - r, y));
		return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
	}
	if (!shape.polys) {
		shape.polys = flatten(shape.d);
		// Most pixels are nowhere near a curve; a box test first keeps a 2048px
		// canvas from testing every one of them against every segment.
		const pts = shape.polys.flat();
		const grow = shape.kind === 'stroke' ? shape.width / 2 : 0;
		shape.box = [
			Math.min(...pts.map((p) => p[0])) - grow,
			Math.min(...pts.map((p) => p[1])) - grow,
			Math.max(...pts.map((p) => p[0])) + grow,
			Math.max(...pts.map((p) => p[1])) + grow,
		];
	}
	const [x0, y0, x1, y1] = shape.box;
	if (x < x0 || x > x1 || y < y0 || y > y1) return false;
	// Each subpath on its own, then unioned: the leaves meet at the trunk, and
	// an even-odd test over all of them at once would punch a hole there.
	if (shape.kind === 'fill') return shape.polys.some((p) => inside(p, x, y));
	return shape.polys.some((p) => distance(p, x, y) <= shape.width / 2);
}

/**
 * Paint shapes, in order, onto a supersampled canvas. A shape with
 * `erase: true` clears what is under it instead — how the badge cuts the palm
 * out of the page.
 */
function paint(big, layers, inset) {
	const px = new Uint8Array(big * big * 4);
	const pad = big * inset;
	const scale = (big - pad * 2) / LOGO_SIZE;
	for (let y = 0; y < big; y++) {
		for (let x = 0; x < big; x++) {
			// Pixel centre, in logo units.
			const lx = (x + 0.5 - pad) / scale;
			const ly = (y + 0.5 - pad) / scale;
			for (const { shape, color, erase } of layers) {
				if (!covers(shape, lx, ly)) continue;
				const i = (y * big + x) * 4;
				if (erase) {
					px[i + 3] = 0;
				} else {
					[px[i], px[i + 1], px[i + 2]] = color;
					px[i + 3] = 255;
				}
			}
		}
	}
	return px;
}

/** Average each SS×SS block down to one pixel — the only antialiasing here. */
function downsample(src, size) {
	const out = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let r = 0, g = 0, b = 0, a = 0;
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const i = ((y * SS + sy) * size * SS + (x * SS + sx)) * 4;
					// Weight colour by coverage so transparent pixels do not drag
					// the hue towards black at the edges.
					const alpha = src[i + 3];
					r += src[i] * alpha;
					g += src[i + 1] * alpha;
					b += src[i + 2] * alpha;
					a += alpha;
				}
			}
			const o = (y * size + x) * 4;
			out[o] = a ? Math.round(r / a) : 0;
			out[o + 1] = a ? Math.round(g / a) : 0;
			out[o + 2] = a ? Math.round(b / a) : 0;
			out[o + 3] = Math.round(a / (SS * SS));
		}
	}
	return out;
}

// --- PNG container ---------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buf) {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function png(rgba, size) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // truecolour with alpha
	// Each scanline is prefixed with its filter type; 0 means none, which
	// compresses fine for flat colour and keeps this readable.
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0;
		Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

// --- the mark --------------------------------------------------------------

const colorOf = (shape) => rgb(LOGO_COLORS[shape.kind === 'stroke' ? shape.stroke : shape.fill]);

/**
 * @param size    final pixel size
 * @param inset   fraction of the canvas left empty around the tile — maskable
 *                icons are cropped to a circle by the launcher, so the art has
 *                to sit inside the safe zone
 * @param badge   the notification badge: Android draws it as a silhouette from
 *                the alpha channel alone, so it is the page in white with the
 *                palm cut out of it, and no tile
 */
function icon(size, { inset = 0, badge = false } = {}) {
	const layers = badge
		? [
			...LOGO_PAGE.map((shape) => ({ shape, color: [255, 255, 255] })),
			...LOGO_PALM.map((shape) => ({ shape, erase: true })),
		]
		: [LOGO_TILE, ...LOGO_PAGE, ...LOGO_PALM].map((shape) => ({ shape, color: colorOf(shape) }));
	return png(downsample(paint(size * SS, layers, inset), size), size);
}

const files = [
	['public/icon-192.png', icon(192)],
	['public/icon-512.png', icon(512)],
	// Launchers crop maskable icons to whatever shape they like; keeping the art
	// inside the middle 80% is what stops the tile losing its corners.
	['public/icon-maskable-512.png', icon(512, { inset: 0.1 })],
	['public/icon-180.png', icon(180)],
	// The browser-tab icon where SVG favicons are not honoured.
	['public/icon-32.png', icon(32)],
	['public/badge.png', icon(96, { badge: true })],
];

for (const [path, data] of files) {
	writeFileSync(path, data);
	console.log(`${path}  ${data.length} bytes`);
}
