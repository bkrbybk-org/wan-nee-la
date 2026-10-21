import type { Child } from 'hono/jsx';
import { describeRange, formatDays } from '../domain/dates.ts';
import type { Balance, LeaveEntry } from '../types.ts';
import { ChevronLeftIcon, ChevronRightIcon, DeleteIcon } from './icons.tsx';
import { useLang, useT } from '../i18n/context.tsx';

/*
 * The small pieces every page shares, so a page can't drift into its own way
 * of doing them. They had: six ways back, two orders of Save and Cancel,
 * "3d" beside "3 days", and a delete that asked first beside one that didn't.
 */

/**
 * The way back from a page under another: above the heading, naming where it
 * goes — "‹ My leave", "‹ People" — rather than "Back", which says nothing
 * about where back is.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
	return (
		<a href={href} class="back-link">
			<ChevronLeftIcon />
			{label}
		</a>
	);
}

/**
 * A form's buttons: the way out on the left, the button that commits on the
 * right, at the right-hand edge — the order every form here uses, so the
 * primary button is always in the same place.
 */
export function FormActions({ cancel, children }: { cancel?: Child; children: Child }) {
	return (
		<div class="actions form-actions">
			{cancel}
			{children}
		</div>
	);
}

/** "3 days", "0.5 days", "1 day", "3 วัน" — never "3d", which Thai readers would see in Latin. */
export function DayCount({ n }: { n: number }) {
	const t = useT();
	return <>{t('edit.days', { count: n, days: formatDays(n) })}</>;
}

/**
 * A delete that asks once. The bin opens a confirmation in place; only its
 * button posts. The same shape as Remove… on a booking's page, so every
 * destructive control behaves alike. No script needed.
 */
export function AskOnceDelete({
	action,
	fields,
	label,
	confirm,
	button,
}: {
	action: string;
	fields: Record<string, string>;
	/** What the bin is for, for a screen reader: "Remove Constitution Day". */
	label: string;
	/** One line on what happens. */
	confirm: string;
	button: string;
}) {
	return (
		<details class="ask-once">
			<summary class="icon-btn" aria-label={label} title={label}>
				<DeleteIcon />
			</summary>
			<form method="post" action={action} class="ask-once-form">
				{Object.entries(fields).map(([name, value]) => (
					<input type="hidden" name={name} value={value} />
				))}
				<span class="muted">{confirm}</span>
				<button type="submit" class="btn danger small">
					{button}
				</button>
			</form>
		</details>
	);
}

/**
 * One leave type's balance. An overdrawn one says so — in the error colour,
 * as days over — rather than as a minus sign beside a full bar in the type's
 * own colour, which read as fine. Shared by My leave and a person's page.
 */
export function BalanceCard({ b }: { b: Balance }) {
	const t = useT();
	const lang = useLang();
	const over = b.type.counts_quota && b.remaining < 0;
	const pct = b.allotted > 0 ? Math.min(100, (b.used / b.allotted) * 100) : over ? 100 : 0;
	return (
		<div class={`balance-card ${over ? 'over' : ''}`}>
			<div class="balance-top">
				<span class="dot" style={`--chip: ${b.type.color}`} />
				<span class="balance-label">{lang === 'th' ? b.type.label_th : b.type.label_en}</span>
			</div>
			{b.type.counts_quota ? (
				<>
					<div class="balance-big">
						{formatDays(Math.abs(b.remaining))}
						<span class="unit">{over ? t('me.daysOver', { count: -b.remaining }) : t('me.daysLeft', { count: b.remaining })}</span>
					</div>
					<div class="meter" role="img" aria-label={t('me.meterLabel', { used: formatDays(b.used), allotted: formatDays(b.allotted) })}>
						<span class="meter-fill" style={`width: ${pct}%; --chip: ${b.type.color}`} />
					</div>
					<div class="balance-sub muted">{t('me.usedOf', { used: formatDays(b.used), allotted: formatDays(b.allotted) })}</div>
				</>
			) : (
				<>
					<div class="balance-big">
						{formatDays(b.used)}
						<span class="unit">{t('me.daysTaken', { count: b.used })}</span>
					</div>
					<div class="balance-sub muted">{t('me.noAllowance')}</div>
				</>
			)}
		</div>
	);
}

/**
 * A booking in the list: the whole row is the link to its page, where it can
 * be edited or removed — past ones included, since sick leave is often entered
 * after the fact and then corrected. Every row has the same shape; a note sits
 * on its own line under the dates, with whether colleagues can read it.
 */
export function LeaveRow({
	entry,
	today,
	by,
	linked = true,
	showNote = true,
}: {
	entry: LeaveEntry;
	today: string;
	by?: { name: string; action: string };
	/** False where the reader may not open the booking: someone else's, not as an admin. */
	linked?: boolean;
	/** False on a person's page, which never shows a note to anyone. */
	showNote?: boolean;
}) {
	const t = useT();
	const lang = useLang();
	const cancelled = entry.status === 'cancelled';
	const when = describeRange(entry.start_date, entry.end_date, entry.start_half, entry.end_half, lang);
	const otherYear = entry.start_date.slice(0, 4) !== today.slice(0, 4) ? ` ${entry.start_date.slice(0, 4)}` : '';
	const now = !cancelled && entry.start_date <= today && entry.end_date >= today;
	const body = (
		<>
			<span class="dot" style={`--chip: ${entry.color}`} />
			<span class="my-main">
				<span class="my-when">
					{when}
					{otherYear}
				</span>
				<span class="muted">
					{' '}
					{lang === 'th' ? entry.type_label_th : entry.type_label_en}
					{now ? ` · ${t('me.now')}` : ''}
				</span>
				{/* Who else last touched it: an admin booked it for you, moved it
				    or removed it. The push says so too, for whoever has them on. */}
				{by ? (
					<span class="my-by muted" data-by-other>
						{t(by.action === 'created' ? 'me.bookedBy' : by.action === 'cancelled' ? 'me.removedBy' : 'me.changedBy', { name: by.name })}
					</span>
				) : null}
				{showNote && entry.note ? (
					<span class="my-note muted">
						{entry.note} · {entry.note_private ? t('me.notePrivate') : t('me.noteShared')}
					</span>
				) : null}
			</span>
			<span class="my-days">
				<DayCount n={entry.days_total} />
			</span>
			{cancelled ? <span class="tag">{t('me.cancelled')}</span> : linked ? <ChevronRightIcon class="my-go" /> : null}
		</>
	);
	return (
		<li class={`my-row ${cancelled ? 'cancelled' : ''}`}>
			{cancelled || !linked ? (
				<div class="my-link">{body}</div>
			) : (
				<a class="my-link" href={`/leave/${entry.id}/edit`} aria-label={t('me.editOn', { when: `${when}${otherYear}` })}>
					{body}
				</a>
			)}
		</li>
	);
}
