import type { Child } from 'hono/jsx';
import type { User } from '../types.ts';

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
var ICON={system:'◐',light:'☀',dark:'☾'},LABEL={system:'System',light:'Light',dark:'Dark'};
function read(){try{var v=localStorage.getItem(KEY);return ORDER.indexOf(v)>-1?v:'system';}catch(e){return 'system';}}
function apply(m){if(m==='light'||m==='dark'){root.setAttribute('data-theme',m);}else{root.removeAttribute('data-theme');}}
root.setAttribute('data-js','1');
apply(read());
document.addEventListener('DOMContentLoaded',function(){
var btn=document.querySelector('[data-theme-toggle]');
if(!btn)return;
function paint(){var m=read();btn.textContent=ICON[m];var t='Theme: '+LABEL[m]+'. Click to change.';btn.title=t;btn.setAttribute('aria-label',t);}
paint();
btn.addEventListener('click',function(){
var next=ORDER[(ORDER.indexOf(read())+1)%ORDER.length];
try{localStorage.setItem(KEY,next);}catch(e){}
apply(next);paint();
});
});
})();`;

interface LayoutProps {
	title: string;
	user: User;
	active: 'calendar' | 'me' | 'admin';
	version?: string;
	children?: Child;
}

export function Layout({ title, user, active, version, children }: LayoutProps) {
	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				{/* viewport-fit=cover so the sticky nav can respect the iPhone home indicator */}
				<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
				<meta name="color-scheme" content="light dark" />
				<title>{title} · wan-nee-la</title>
				<link rel="stylesheet" href="/app.css" />
				<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>🌴</text></svg>" />
				{/* Must run before first paint — see THEME_SCRIPT. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
				{/* Enhancement only — every page works with this blocked. */}
				<script src="/booking.js" defer></script>
			</head>
			<body>
				<header class="topbar">
					<a class="brand" href="/">
						<span class="brand-mark">🌴</span>
						<span class="brand-name">wan-nee-la</span>
					</a>
					<nav class="nav">
						<a href="/" class={active === 'calendar' ? 'on' : ''}>Calendar</a>
						<a href="/me" class={active === 'me' ? 'on' : ''}>My leave</a>
						{user.is_admin ? (
							<a href="/admin" class={active === 'admin' ? 'on' : ''}>Admin</a>
						) : null}
					</nav>
					<button type="button" class="theme-toggle" data-theme-toggle aria-label="Theme">◐</button>
					<span class="who" title={user.email}>{user.display_name}</span>
				</header>

				<main class="wrap">{children}</main>

				<footer class="foot">
					<span>wan-nee-la</span>
					{version ? <span class="mono">build {version.slice(0, 8)}</span> : null}
				</footer>
			</body>
		</html>
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
