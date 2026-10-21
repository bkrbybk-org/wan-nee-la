import type { User } from '../../types.ts';
import { SelectField, TextField } from '../fields.tsx';
import { useT } from '../../i18n/context.tsx';
import { AdminShell } from './shell.tsx';

export function AdminExportPage(props: { user: User; version?: string; today: string; error?: string; notice?: string }) {
	const { user, version, today, error, notice } = props;
	return (
		<AdminShell user={user} version={version} section="export" error={error} notice={notice}>
			<ExportBody today={today} />
		</AdminShell>
	);
}

function ExportBody({ today }: { today: string }) {
	const t = useT();
	return (
		// A plain GET form: the file downloads, and the URL can be bookmarked for
		// the same report next month.
		<section class="card">
			<p class="muted">{t('admin.exportHelp')}</p>
			<form method="get" action="/admin/export.csv" class="row inline">
				<TextField id="export-from" name="from" label={t('admin.exportFrom')} type="date" value={`${today.slice(0, 4)}-01-01`} required />
				<TextField id="export-to" name="to" label={t('admin.exportTo')} type="date" value={`${today.slice(0, 4)}-12-31`} required />
				<SelectField id="export-kind" name="kind" label={t('admin.exportKind')}>
					<option value="summary">{t('admin.exportSummary')}</option>
					<option value="bookings">{t('admin.exportBookings')}</option>
				</SelectField>
				<button type="submit" class="btn tonal">{t('admin.exportButton')}</button>
			</form>
		</section>
	);
}
