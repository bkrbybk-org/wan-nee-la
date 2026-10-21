import type { User } from '../../types.ts';
import type { NotificationRun } from '../../repo/db.ts';
import { TextField } from '../fields.tsx';
import { useT } from '../../i18n/context.tsx';
import { AdminShell } from './shell.tsx';

export interface NotificationsProps {
	user: User;
	version?: string;
	today: string;
	push: { people: number; active: number; browsers: number } | null;
	line: { enabled: boolean; configured: boolean; groupId: string | null; ready: boolean };
	log: NotificationRun[];
	error?: string;
	notice?: string;
}

/**
 * The 09:00 notification, both channels side by side. The preview and send
 * used to live under "LINE notification", which is switched off — but they
 * send to browsers as well, and that heading said otherwise.
 */
export function AdminNotificationsPage(props: NotificationsProps) {
	return (
		<AdminShell user={props.user} version={props.version} section="notifications" error={props.error} notice={props.notice}>
			<NotificationsBody {...props} />
		</AdminShell>
	);
}

function NotificationsBody({ today, push, line, log }: NotificationsProps) {
	const t = useT();
	return (
		<>
			<section class="card">
				<p class="muted">{t('admin.notificationsHelp')}</p>
				<div class="channel-grid">
					<div class="channel">
						<h3 class="sub">{t('admin.pushChannel')}</h3>
						<p>
							<span class={`tag ${push ? 'good' : ''}`}>{push ? t('admin.on') : t('admin.off')}</span>{' '}
							{push ? t('admin.pushStatus', { n: push.people, total: push.active, browsers: push.browsers }) : t('admin.pushMissing')}
						</p>
					</div>
					<div class="channel">
						<h3 class="sub">{t('admin.lineChannel')}</h3>
						<p>
							<span class={`tag ${line.enabled ? 'good' : ''}`}>{line.enabled ? t('admin.on') : t('admin.off')}</span>{' '}
							{/* Switched off and not set up are different problems, and the
							    note says which one this is. */}
							{!line.enabled ? t('admin.lineDisabled') : !line.ready ? t('admin.lineIncomplete') : null}
						</p>
						<dl class="popup-facts">
							<dt>{t('admin.channelToken')}</dt>
							<dd>{line.configured ? t('admin.tokenSet') : t('admin.tokenMissing')}</dd>
							<dt>{t('admin.group')}</dt>
							<dd class={line.groupId ? 'mono' : ''}>{line.groupId ?? t('admin.groupMissing')}</dd>
						</dl>
					</div>
				</div>
				{/* The commands live behind a disclosure: the page speaks plainly, and
				    whoever sets the server up still finds what to run. */}
				{!push || !line.enabled || !line.ready ? (
					<details class="setup-how">
						<summary class="btn text">{t('admin.setupHow')}</summary>
						{!push ? <p class="muted">{t('admin.setupPush')}</p> : null}
						{!line.enabled || !line.ready ? <p class="muted">{t('admin.setupLine')}</p> : null}
					</details>
				) : null}
			</section>
			<section class="card">
				<h2>{t('admin.sendTitle')}</h2>
				<form method="post" action="/admin/notify/preview" class="row inline">
					<TextField id="preview-date" name="date" label={t('admin.date')} type="date" value={today} />
					<label class="checkline">
						<input type="checkbox" name="kind" value="week" /> {t('admin.weekAhead')}
					</label>
					<button type="submit" class="btn tonal">{t('admin.preview')}</button>
				</form>
				<form method="post" action="/admin/notify/send" class="row inline">
					<TextField id="send-date" name="date" label={t('admin.date')} type="date" value={today} />
					<label class="checkline">
						<input type="checkbox" name="kind" value="week" /> {t('admin.weekAhead')}
					</label>
					<label class="checkline">
						<input type="checkbox" name="force" value="1" /> {t('admin.resend')}
					</label>
					<button type="submit" class="btn primary">{t('admin.sendNow')}</button>
				</form>
			</section>
			<section class="card">
				<h2>{t('admin.recentRuns')}</h2>
				{log.length === 0 ? (
					<p class="muted">{t('admin.nothingYet')}</p>
				) : (
					<ul class="holiday-list">
						{log.map((row) => (
							<li>
								<span class="mono">{row.date}</span>
								<span class="tag">{row.kind}</span>
								<span class="tag">{row.channel}</span>
								<span class={`tag ${row.status === 'failed' ? 'bad' : ''}`}>{row.status}</span>
								<span class="muted">{t('admin.out', { n: row.people })}</span>
								{row.error ? <span class="muted">{row.error}</span> : null}
							</li>
						))}
					</ul>
				)}
			</section>
		</>
	);
}
