import type { Child } from 'hono/jsx';
import type { User } from '../types.ts';
import { AdminIcon, CalendarIcon, ChevronLeftIcon, ChevronRightIcon, PersonIcon } from './icons.tsx';

/**
 * Theme switching, inlined into <head> on purpose.
 *
 * The stored choice has to be applied before the first paint, otherwise the
 * page renders in the system theme and then flips — an external script cannot
 * do that without either blocking on a network round trip or flashing. It is
 * small enough that inlining it on every page costs less than the extra
 * request would.
 *
 * Three states: "system" (the default) stamps nothing and lets
 * prefers-color-scheme decide; "light" and "dark" stamp data-theme and win.
 */
const THEME_SCRIPT = `(function(){
var KEY='wnl-theme',ORDER=['system','light','dark'],root=document.documentElement;
var S='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">';
var ICON={
system:S+'<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>',
light:S+'<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>',
dark:S+'<path d="M20 13.5A8.5 8.5 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5z"/></svg>'};
var LABEL={system:'System',light:'Light',dark:'Dark'};
function read(){try{var v=localStorage.getItem(KEY);return ORDER.indexOf(v)>-1?v:'system';}catch(e){return 'system';}}
function apply(m){if(m==='light'||m==='dark'){root.setAttribute('data-theme',m);}else{root.removeAttribute('data-theme');}}
root.setAttribute('data-js','1');
apply(read());
document.addEventListener('DOMContentLoaded',function(){
var btn=document.querySelector('[data-theme-toggle]');
if(!btn)return;
function paint(){var m=read();btn.innerHTML=ICON[m];var t='Theme: '+LABEL[m]+'. Click to change.';btn.title=t;btn.setAttribute('aria-label',t);}
paint();
btn.addEventListener('click',function(){
var next=ORDER[(ORDER.indexOf(read())+1)%ORDER.length];
try{localStorage.setItem(KEY,next);}catch(e){}
apply(next);paint();
});
});
})();`;

type Section = 'calendar' | 'me' | 'admin';

interface LayoutProps {
	title: string;
	user: User;
	active: Section;
	version?: string;
	children?: Child;
}

/** Up to two letters for the avatar, e.g. "Somchai Pong" -> "SP". */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function sections(user: User): { href: string; label: string; key: Section; Icon: typeof CalendarIcon }[] {
	const items = [
		{ href: '/', label: 'Calendar', key: 'calendar' as const, Icon: CalendarIcon },
		{ href: '/me', label: 'My leave', key: 'me' as const, Icon: PersonIcon },
	];
	return user.is_admin ? [...items, { href: '/admin', label: 'Admin', key: 'admin' as const, Icon: AdminIcon }] : items;
}

export function Layout({ title, user, active, version, children }: LayoutProps) {
	const nav = sections(user);

	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				{/* viewport-fit=cover so the navigation bar can respect the iPhone home indicator */}
				<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
				<meta name="color-scheme" content="light dark" />
				{/* Tints the browser chrome on Android to match the app bar. */}
				<meta name="theme-color" content="#f8f9fb" media="(prefers-color-scheme: light)" />
				<meta name="theme-color" content="#131314" media="(prefers-color-scheme: dark)" />
				<title>{title} · wan-nee-la</title>
				<link rel="stylesheet" href="/app.css" />
				<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>🌴</text></svg>" />
				{/* Must run before first paint — see THEME_SCRIPT. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
				{/* Enhancement only — every page works with this blocked. */}
				<script src="/app.js" defer></script>
			</head>
			<body>
				<a class="skip-link" href="#main">Skip to content</a>

				{/* M3 small top app bar. The tabs in it are for desktop; on a phone
				    they are hidden and the bottom navigation bar carries the same
				    destinations, within thumb reach. */}
				<header class="topbar">
					<a class="brand" href="/">
						<span class="brand-mark" aria-hidden="true">🌴</span>
						<span class="brand-name">wan-nee-la</span>
					</a>
					<nav class="nav" aria-label="Sections">
						{nav.map(({ href, label, key, Icon }) => (
							<a href={href} class={active === key ? 'on' : ''} aria-current={active === key ? 'page' : undefined}>
								<Icon class="sm" />
								{label}
							</a>
						))}
					</nav>
					<div class="topbar-end">
						<button type="button" class="icon-btn theme-toggle" data-theme-toggle aria-label="Theme"></button>
							{/* The name is shown beside the avatar on a wide screen and hidden
						    on a phone, so the avatar — not the name — carries the spoken
						    identity. The tooltip is how someone confirms which account
						    they are in, and is what the smoke suite checks the session
						    against. */}
						<span class="account-name" aria-hidden="true">{user.display_name}</span>
						<span class="account" title={user.email}>
							<span aria-hidden="true">{initials(user.display_name)}</span>
							<span class="visually-hidden">Signed in as {user.display_name}</span>
						</span>
					</div>
				</header>

				<main class="wrap" id="main">{children}</main>

				<footer class="foot">
					<span>wan-nee-la</span>
					{version ? <span class="mono">build {version.slice(0, 8)}</span> : null}
				</footer>

				{/* M3 navigation bar — phones only, hidden at the 768px breakpoint. */}
				<nav class="navbar" aria-label="Sections">
					{nav.map(({ href, label, key, Icon }) => (
						<a
							href={href}
							class={`navbar-item ${active === key ? 'on' : ''}`}
							aria-current={active === key ? 'page' : undefined}
						>
							<span class="navbar-icon"><Icon /></span>
							{label}
						</a>
					))}
				</nav>
			</body>
		</html>
	);
}

/** Previous / next year links, shared by /me and /u/:email. */
export function YearNav({ basePath, year, minYear, maxYear }: { basePath: string; year: number; minYear: number; maxYear: number }) {
	return (
		<div class="year-nav">
			{year > minYear ? (
				<a href={`${basePath}?y=${year - 1}`} class="icon-btn" aria-label={`Go to ${year - 1}`}>
					<ChevronLeftIcon />
				</a>
			) : (
				<span class="icon-btn disabled" aria-hidden="true"><ChevronLeftIcon /></span>
			)}
			<span class="year-nav-current">{year}</span>
			{year < maxYear ? (
				<a href={`${basePath}?y=${year + 1}`} class="icon-btn" aria-label={`Go to ${year + 1}`}>
					<ChevronRightIcon />
				</a>
			) : (
				<span class="icon-btn disabled" aria-hidden="true"><ChevronRightIcon /></span>
			)}
		</div>
	);
}

export function Banner({ kind, children }: { kind: 'error' | 'ok'; children?: Child }) {
	return <div class={`banner ${kind}`}>{children}</div>;
}

/** Full-page message for the states where there is no session to render a nav for. */
export function ErrorPage({ title, detail }: { title: string; detail: string }) {
	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
				<title>{title} · wan-nee-la</title>
				<link rel="stylesheet" href="/app.css" />
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</head>
			<body>
				<main class="wrap">
					<div class="card centered">
						<h1>{title}</h1>
						<p class="muted">{detail}</p>
					</div>
				</main>
			</body>
		</html>
	);
}
