/**
 * The app's mark: a calendar page with a palm on it — a day, and the day off.
 *
 * One description, read by everything that draws it, so they cannot drift:
 * the header and the browser-tab icon render it as SVG (`logoSvg`), and
 * `scripts/icons.mjs` rasterises the same shapes into the home-screen PNGs and
 * the notification badge. Before this the tab showed a 🌴 emoji that every
 * operating system drew differently, and the home screen a plain calendar.
 *
 * Plain data on a 96-unit square. Paths use only M, C and Z, absolute, which
 * is all the rasteriser understands — keep it that way.
 */

export const LOGO_SIZE = 96;

export const LOGO_COLORS = {
	/** --md-primary, light. */
	tile: '#375ca2',
	page: '#ffffff',
	band: '#dce6f8',
	leaf: '#1d9e75',
	trunk: '#375ca2',
} as const;

export type LogoShape =
	| { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: keyof typeof LOGO_COLORS }
	| { kind: 'fill'; d: string; fill: keyof typeof LOGO_COLORS }
	| { kind: 'stroke'; d: string; width: number; stroke: keyof typeof LOGO_COLORS };

/** The tile behind everything. Left out where the background is not ours. */
export const LOGO_TILE: LogoShape = { kind: 'rect', x: 0, y: 0, w: 96, h: 96, r: 22, fill: 'tile' };

/** The page itself — what the notification badge keeps as its silhouette. */
export const LOGO_PAGE: LogoShape[] = [
	{ kind: 'rect', x: 20, y: 24, w: 56, h: 52, r: 8, fill: 'page' },
	// The header band: rounded along the top with the page, square below.
	{ kind: 'rect', x: 20, y: 24, w: 56, h: 14, r: 8, fill: 'band' },
	{ kind: 'rect', x: 20, y: 31, w: 56, h: 7, r: 0, fill: 'band' },
	// The rings it hangs from.
	{ kind: 'rect', x: 31, y: 17, w: 6, h: 13, r: 3, fill: 'page' },
	{ kind: 'rect', x: 59, y: 17, w: 6, h: 13, r: 3, fill: 'page' },
];

/** The palm, on the page. Cut out of the badge rather than drawn on it. */
export const LOGO_PALM: LogoShape[] = [
	{ kind: 'stroke', d: 'M48 70 C48 60 49 54 52 49', width: 3.5, stroke: 'trunk' },
	{
		kind: 'fill',
		d:
			'M52 49 C46 44 38 45 35 50 C41 48 46 48 52 49 Z ' +
			'M52 49 C55 42 62 40 67 43 C61 44 56 46 52 49 Z ' +
			'M52 49 C58 48 64 52 65 58 C60 54 56 51 52 49 Z',
		fill: 'leaf',
	},
];

function shapeSvg(s: LogoShape): string {
	if (s.kind === 'rect') {
		return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${LOGO_COLORS[s.fill]}"/>`;
	}
	if (s.kind === 'fill') return `<path d="${s.d}" fill="${LOGO_COLORS[s.fill]}"/>`;
	return `<path d="${s.d}" fill="none" stroke="${LOGO_COLORS[s.stroke]}" stroke-width="${s.width}" stroke-linecap="round"/>`;
}

/** The whole mark as one SVG element. Static markup with no input in it. */
export function logoSvg(size?: number): string {
	const dims = size ? ` width="${size}" height="${size}"` : '';
	const body = [LOGO_TILE, ...LOGO_PAGE, ...LOGO_PALM].map(shapeSvg).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_SIZE} ${LOGO_SIZE}"${dims} aria-hidden="true">${body}</svg>`;
}
