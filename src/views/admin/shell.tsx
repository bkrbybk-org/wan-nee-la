import type { Child } from 'hono/jsx';
import type { User } from '../../types.ts';
import { FlashBanner, Layout } from '../layout.tsx';
import { BackLink } from '../parts.tsx';
import { BellIcon, BellRingIcon, ChevronLeftIcon } from '../icons.tsx';
import { useT } from '../../i18n/context.tsx';
import { t as translate, toLang } from '../../i18n/strings.ts';
import type { StringKey } from '../../i18n/strings.ts';

/*
 * The admin area: an overview at /admin and one page per job.
 *
 * It was one page — quotas, leave types, holidays, LINE, the export and the
 * trail stacked in a single scroll, six thousand pixels on a laptop and ten on
 * a phone, with two forms and two Save buttons per person. Saving one form
 * dropped whatever had been typed into the other, and the page grew with every
 * hire. Now the overview answers "is anything wrong?" and each section is its
 * own page: shorter, linkable, and still plain HTML forms that work without
 * JavaScript.
 */

export type AdminSection = 'people' | 'types' | 'holidays' | 'notifications' | 'yearend' | 'export' | 'activity';

export const SECTIONS: { key: AdminSection; href: string; label: StringKey }[] = [
	{ key: 'people', href: '/admin/people', label: 'admin.people' },
	{ key: 'types', href: '/admin/types', label: 'admin.types' },
	{ key: 'holidays', href: '/admin/holidays', label: 'admin.holidays' },
	{ key: 'notifications', href: '/admin/notifications', label: 'admin.notifications' },
	{ key: 'yearend', href: '/admin/year-end', label: 'admin.yearEnd' },
	{ key: 'export', href: '/admin/export', label: 'admin.export' },
	{ key: 'activity', href: '/admin/activity', label: 'admin.activity' },
];

export interface ShellProps {
	user: User;
	version?: string;
	/** Absent on the overview, which has no tab row. */
	section?: AdminSection;
	/** Beside the heading — a year switcher, where the page has a year. */
	headExtra?: Child;
	/** A page under a section — one person — names itself, and links back to the section. */
	heading?: string;
	error?: string;
	notice?: string;
	children?: Child;
}

/** Every admin page: the layout, the flash, the heading and — on a section — the tab row. */
export function AdminShell({ user, version, section, headExtra, heading: own, error, notice, children }: ShellProps) {
	const lang = toLang(user.lang);
	const sectionName = section ? translate(lang, SECTIONS.find((s) => s.key === section)!.label) : translate(lang, 'admin.title');
	const heading = own ?? sectionName;
	const title = section ? `${own ? `${own} · ` : ''}${sectionName} · ${translate(lang, 'admin.title')}` : heading;
	return (
		<Layout title={title} user={user} active="admin" version={version}>
			<FlashBanner error={error} notice={notice} />
			{section ? <AdminTabs current={section} /> : null}
			{own && section ? <BackLink href={SECTIONS.find((s) => s.key === section)!.href} label={sectionName} /> : null}
			<div class="page-head">
				<h1>{heading}</h1>
				{headExtra}
			</div>
			{children}
		</Layout>
	);
}

/**
 * The way between sections, and back to the overview. Links, so every section
 * has its own URL; a row of chips that scrolls sideways on a phone rather than
 * wrapping into three lines above the content.
 */
export function AdminTabs({ current }: { current: AdminSection }) {
	const t = useT();
	return (
		<nav class="admin-tabs" aria-label={t('admin.sections')}>
			<a href="/admin" class="admin-back" aria-label={t('admin.title')}>
				<ChevronLeftIcon />
				<span>{t('admin.title')}</span>
			</a>
			{SECTIONS.map((s) => (
				<a href={s.href} class={s.key === current ? 'admin-tab on' : 'admin-tab'} aria-current={s.key === current ? 'page' : undefined}>
					{t(s.label)}
				</a>
			))}
		</nav>
	);
}


/**
 * Whether someone gets the 09:00 notification. A count of browsers, nothing
 * about them — which push service or device is not a roster fact.
 */
export function PushState({ n }: { n: number }) {
	const t = useT();
	return n > 0 ? (
		<span class="push-state on" title={t('admin.pushOn', { n })}>
			<BellRingIcon />
			<span class="push-text">{t('admin.pushOn', { n })}</span>
		</span>
	) : (
		<span class="push-state muted" title={t('admin.pushOff')}>
			<BellIcon />
			<span class="push-text">{t('admin.pushOff')}</span>
		</span>
	);
}
