#!/usr/bin/env node
/**
 * Draws the app icons.
 *
 * A web app manifest needs real PNGs — SVG icons are still not honoured
 * everywhere, and iOS ignores them outright — so these are rasterised here
 * rather than committed as opaque binaries nobody can regenerate or explain.
 * No image library: the shapes are rectangles and circles, drawn at 4× and
 * averaged down for antialiasing, then written as PNG with zlib, which Node
 * already has.
 *
 *     npm run icons
 *
 * The mark is the same calendar glyph as the in-app icon (src/views/icons.tsx),
 * on the Material primary. Keep the two in step if either changes.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const PRIMARY = [0x37, 0x5c, 0xa2]; // --md-primary, light
const WHITE = [0xff, 0xff, 0xff];
const SS = 4; // supersampling factor

/** A canvas of straight RGBA bytes, drawn with plain shape tests. */
function canvas(size) {
	const px = new Uint8Array(size * size * 4);
	const put = (x, y, [r, g, b], a = 255) => {
		const i = (y * size + x) * 4;
		px[i] = r;
		px[i + 1] = g;
		px[i + 2] = b;
		px[i + 3] = a;
	};
	return {
		size,
		px,
		rect(x0, y0, w, h, color) {
			for (let y = Math.max(0, y0); y < Math.min(size, y0 + h); y++) {
				for (let x = Math.max(0, x0); x < Math.min(size, x0 + w); x++) put(x, y, color);
			}
		},
		/** Rounded rectangle: inside the box, and outside a corner circle only in the corners. */
		roundRect(x0, y0, w, h, r, color) {
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					const dx = x < r ? r - x : x >= w - r ? x - (w - r - 1) : 0;
					const dy = y < r ? r - y : y >= h - r ? y - (h - r - 1) : 0;
					if (dx * dx + dy * dy <= r * r) put(x0 + x, y0 + y, color);
				}
			}
		},
		circle(cx, cy, r, color) {
			for (let y = Math.max(0, cy - r); y <= Math.min(size - 1, cy + r); y++) {
				for (let x = Math.max(0, cx - r); x <= Math.min(size - 1, cx + r); x++) {
					if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, color);
				}
			}
		},
	};
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

/**
 * @param size    final pixel size
 * @param inset   fraction of the canvas left empty around the tile — maskable
 *                icons are cropped to a circle by the launcher, so the art has
 *                to sit inside the safe zone
 * @param tile    draw the coloured tile behind the glyph
 */
function icon(size, { inset = 0, tile = true, glyph = PRIMARY } = {}) {
	const big = size * SS;
	const c = canvas(big);
	const pad = Math.round(big * inset);
	const box = big - pad * 2;

	if (tile) c.roundRect(pad, pad, box, box, Math.round(box * 0.22), PRIMARY);

	// Calendar glyph: body, torn-off top band, and three days.
	const gw = Math.round(box * 0.56);
	const gh = Math.round(gw * 0.86);
	const gx = pad + Math.round((box - gw) / 2);
	const gy = pad + Math.round((box - gh) / 2) + Math.round(box * 0.03);
	const ink = tile ? WHITE : glyph;
	const stroke = Math.max(1, Math.round(gw * 0.09));

	c.roundRect(gx, gy, gw, gh, Math.round(gw * 0.14), ink);
	// Hollow it out, leaving the header band solid.
	const band = Math.round(gh * 0.3);
	c.rect(gx + stroke, gy + band, gw - stroke * 2, gh - band - stroke, tile ? PRIMARY : [0, 0, 0]);
	if (!tile) {
		// On the transparent badge the hollow has to actually be transparent.
		for (let y = gy + band; y < gy + gh - stroke; y++) {
			for (let x = gx + stroke; x < gx + gw - stroke; x++) c.px[(y * big + x) * 4 + 3] = 0;
		}
	}

	// Hanger tabs above the band.
	const tab = Math.round(gw * 0.1);
	c.rect(gx + Math.round(gw * 0.24), gy - tab, stroke, tab * 2, ink);
	c.rect(gx + gw - Math.round(gw * 0.24) - stroke, gy - tab, stroke, tab * 2, ink);

	// Three days on the page.
	const dot = Math.round(gw * 0.07);
	const row = gy + band + Math.round((gh - band) * 0.42);
	for (let i = 0; i < 3; i++) {
		c.circle(gx + Math.round(gw * (0.28 + i * 0.22)), row, dot, ink);
	}

	return png(downsample(c.px, size), size);
}

const files = [
	['public/icon-192.png', icon(192)],
	['public/icon-512.png', icon(512)],
	// Launchers crop maskable icons to whatever shape they like; keeping the art
	// inside the middle 80% is what stops the calendar losing its corners.
	['public/icon-maskable-512.png', icon(512, { inset: 0.1 })],
	['public/icon-180.png', icon(180)],
	// Android draws the badge as a silhouette, so only the alpha channel matters.
	['public/badge.png', icon(96, { tile: false, glyph: WHITE })],
];

for (const [path, data] of files) {
	writeFileSync(path, data);
	console.log(`${path}  ${data.length} bytes`);
}
