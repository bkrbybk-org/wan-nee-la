import type { Child } from 'hono/jsx';
import type { User } from '../types.ts';
import { AdminIcon, CalendarIcon, ChevronLeftIcon, ChevronRightIcon, PersonIcon } from './icons.tsx';
import { LangProvider, useT } from '../i18n/context.tsx';
import { toLang, type StringKey } from '../i18n/strings.ts';

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
export const THEME_SCRIPT = `(function(){
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
	/**
	 * Lets the page own the window's height instead of growing past it. Only
	 * the calendar asks for this: a month that runs off the bottom of the
	 * screen is not a month you can read at a glance.
	 */
	fitViewport?: boolean;
	children?: Child;
}

/** Up to two letters for the avatar, e.g. "Somchai Pong" -> "SP". */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function sections(user: User): { href: string; label: StringKey; key: Section; Icon: typeof CalendarIcon }[] {
	const items = [
		{ href: '/', label: 'nav.calendar' as const, key: 'calendar' as const, Icon: CalendarIcon },
		{ href: '/me', label: 'nav.me' as const, key: 'me' as const, Icon: PersonIcon },
	];
	return user.is_admin
		? [...items, { href: '/admin', label: 'nav.admin' as const, key: 'admin' as const, Icon: AdminIcon }]
		: items;
}

export function Layout({ title, user, active, version, fitViewport, children }: LayoutProps) {
	const nav = sections(user);
	const lang = toLang(user.lang);

	return (
		<LangProvider value={lang}>
			<LayoutShell
				title={title}
				user={user}
				active={active}
				version={version}
				fitViewport={fitViewport}
				nav={nav}
				lang={lang}
			>
				{children}
			</LayoutShell>
		</LangProvider>
	);
}

/**
 * The page itself, inside the language provider.
 *
 * Split out so `useT` can be called here — a component cannot read a context
 * its own render supplies, only one an ancestor did.
 */
function LayoutShell({
	title,
	user,
	active,
	version,
	fitViewport,
	nav,
	lang,
	children,
}: LayoutProps & { nav: ReturnType<typeof sections>; lang: ReturnType<typeof toLang> }) {
	const t = useT();

	return (
		<html lang={lang}>
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
				{/* `use-credentials` is not optional here: the manifest is same-origin
				    but behind Cloudflare Access, and without it the browser fetches
				    it anonymously, gets the login redirect, and quietly treats the
				    app as uninstallable — which on iOS means no notifications at
				    all, since only an installed web app may subscribe. */}
				<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />
				<link rel="apple-touch-icon" href="/icon-180.png" />
				{/* Must run before first paint — see THEME_SCRIPT. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
				{/* Enhancement only — every page works with this blocked. */}
				<script src="/app.js" defer></script>
			</head>
			<body class={fitViewport ? 'fit-viewport' : ''}>
				<a class="skip-link" href="#main">{t('nav.skip')}</a>

				{/* M3 small top app bar. The tabs in it are for desktop; on a phone
				    they are hidden and the bottom navigation bar carries the same
				    destinations, within thumb reach. */}
				<header class="topbar">
					<a class="brand" href="/">
						<span class="brand-mark" aria-hidden="true">🌴</span>
						<span class="brand-name">wan-nee-la</span>
					</a>
					<nav class="nav" aria-label={t('nav.sections')}>
						{nav.map(({ href, label, key, Icon }) => (
							<a href={href} class={active === key ? 'on' : ''} aria-current={active === key ? 'page' : undefined}>
								<Icon class="sm" />
								{t(label)}
							</a>
						))}
					</nav>
					<div class="topbar-end">
						<button type="button" class="icon-btn theme-toggle" data-theme-toggle aria-label={t('nav.theme')}></button>
							{/* The name is shown beside the avatar on a wide screen and hidden
						    on a phone, so the avatar — not the name — carries the spoken
						    identity. The tooltip is how someone confirms which account
						    they are in, and is what the smoke suite checks the session
						    against. */}
						<span class="account-name" aria-hidden="true">{user.display_name}</span>
						<span class="account" title={user.email}>
							<span aria-hidden="true">{initials(user.display_name)}</span>
							<span class="visually-hidden">{t('nav.signedInAs', { name: user.display_name })}</span>
						</span>
					</div>
				</header>

				<main class="wrap" id="main">{children}</main>

				<footer class="foot">
					<span>wan-nee-la</span>
					{version ? <span class="mono">{t('foot.build', { version: version.slice(0, 8) })}</span> : null}
				</footer>

				{/* M3 navigation bar — phones only, hidden at the 768px breakpoint. */}
				<nav class="navbar" aria-label={t('nav.sections')}>
					{nav.map(({ href, label, key, Icon }) => (
						<a
							href={href}
							class={`navbar-item ${active === key ? 'on' : ''}`}
							aria-current={active === key ? 'page' : undefined}
						>
							<span class="navbar-icon"><Icon /></span>
							{t(label)}
						</a>
					))}
				</nav>
			</body>
		</html>
	);
}

/** Previous / next year links, shared by /me and /u/:email. */
export function YearNav({ basePath, year, minYear, maxYear }: { basePath: string; year: number; minYear: number; maxYear: number }) {
	const t = useT();
	return (
		<div class="year-nav">
			{year > minYear ? (
				<a href={`${basePath}?y=${year - 1}`} class="icon-btn" aria-label={t('nav.year', { year: year - 1 })}>
					<ChevronLeftIcon />
				</a>
			) : (
				<span class="icon-btn disabled" aria-hidden="true"><ChevronLeftIcon /></span>
			)}
			<span class="year-nav-current">{year}</span>
			{year < maxYear ? (
				<a href={`${basePath}?y=${year + 1}`} class="icon-btn" aria-label={t('nav.year', { year: year + 1 })}>
					<ChevronRightIcon />
				</a>
			) : (
				<span class="icon-btn disabled" aria-hidden="true"><ChevronRightIcon /></span>
			)}
		</div>
	);
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
