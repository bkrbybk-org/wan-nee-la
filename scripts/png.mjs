/**
 * Just enough PNG for screenshot comparison, with nothing installed.
 *
 * Reads what Chrome's Page.captureScreenshot writes — 8-bit RGB or RGBA,
 * non-interlaced — and writes RGBA. Node's zlib does the compression and the
 * chunk CRCs; the rest is the five scanline filters from the PNG spec.
 */

import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode to `{ width, height, data }`, data being RGBA bytes. */
export function decodePng(buf) {
	if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
	let width = 0;
	let height = 0;
	let channels = 0;
	const idat = [];
	for (let at = 8; at < buf.length; ) {
		const len = buf.readUInt32BE(at);
		const type = buf.toString('latin1', at + 4, at + 8);
		const body = buf.subarray(at + 8, at + 8 + len);
		if (type === 'IHDR') {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			const depth = body[8];
			const colour = body[9];
			if (depth !== 8 || body[12] !== 0) throw new Error(`unsupported PNG: depth ${depth}, interlace ${body[12]}`);
			channels = { 2: 3, 6: 4 }[colour];
			if (!channels) throw new Error(`unsupported PNG colour type ${colour}`);
		} else if (type === 'IDAT') idat.push(body);
		else if (type === 'IEND') break;
		at += 12 + len;
	}
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const pixels = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const out = pixels.subarray(y * stride, (y + 1) * stride);
		const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
		for (let i = 0; i < stride; i++) {
			const a = i >= channels ? out[i - channels] : 0;
			const b = prev ? prev[i] : 0;
			const c = prev && i >= channels ? prev[i - channels] : 0;
			let v = line[i];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[i] = v & 0xff;
		}
	}
	if (channels === 4) return { width, height, data: pixels };
	const data = Buffer.alloc(width * height * 4);
	for (let p = 0, q = 0; p < pixels.length; p += 3, q += 4) {
		data[q] = pixels[p];
		data[q + 1] = pixels[p + 1];
		data[q + 2] = pixels[p + 2];
		data[q + 3] = 255;
	}
	return { width, height, data };
}

function chunk(type, body) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, 'latin1');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
	return Buffer.concat([head, body, crc]);
}

/** Encode RGBA, unfiltered. */
export function encodePng({ width, height, data }) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Compare two images. A pixel differs when any channel is off by more than
 * `tolerance` — text antialiasing moves a channel by a few units between
 * Chrome versions, and a wrong colour or a moved box moves it by far more.
 * Returns the share of pixels that differ and an image of where: the expected
 * image washed out, with the differing pixels in red.
 */
export function diffPng(expected, actual, tolerance = 48) {
	if (expected.width !== actual.width || expected.height !== actual.height) {
		return { ratio: 1, sizeMismatch: `${expected.width}×${expected.height} vs ${actual.width}×${actual.height}`, image: null };
	}
	const out = Buffer.alloc(expected.data.length);
	let differing = 0;
	for (let i = 0; i < expected.data.length; i += 4) {
		const off =
			Math.abs(expected.data[i] - actual.data[i]) > tolerance ||
			Math.abs(expected.data[i + 1] - actual.data[i + 1]) > tolerance ||
			Math.abs(expected.data[i + 2] - actual.data[i + 2]) > tolerance;
		if (off) {
			differing++;
			out[i] = 255;
			out[i + 1] = 0;
			out[i + 2] = 0;
		} else {
			const grey = (expected.data[i] + expected.data[i + 1] + expected.data[i + 2]) / 3;
			out[i] = out[i + 1] = out[i + 2] = 200 + grey * 0.2;
		}
		out[i + 3] = 255;
	}
	return { ratio: differing / (expected.width * expected.height), image: { width: expected.width, height: expected.height, data: out } };
}
