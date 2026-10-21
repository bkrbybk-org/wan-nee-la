import { formatDays } from '../../domain/dates.ts';
import type { LeaveType, User } from '../../types.ts';
import { TextField } from '../fields.tsx';
import { AskOnceDelete } from '../parts.tsx';
import { EditIcon } from '../icons.tsx';
import { useLang, useT } from '../../i18n/context.tsx';
import { AdminShell } from './shell.tsx';

export interface TypesProps {
	user: User;
	version?: string;
	types: LeaveType[];
	/** Bookings per type id, any status. A type with none is the only kind that can be deleted. */
	usage: Map<number, number>;
	error?: string;
	notice?: string;
}

/**
 * Leave types, read first: changed perhaps once a year, so each row is a line
 * of facts and its form opens only when asked for.
 */
export function AdminTypesPage(props: TypesProps) {
	return (
		<AdminShell user={props.user} version={props.version} section="types" error={props.error} notice={props.notice}>
			<TypesBody {...props} />
		</AdminShell>
	);
}

function TypesBody({ types, usage }: TypesProps) {
	const t = useT();
	const lang = useLang();
	const typeName = (type: LeaveType) => (lang === 'th' ? type.label_th : type.label_en);
	return (
		<section class="card">
			<p class="muted">{t('admin.typesHelp')}</p>
			<ul class="type-list">
				{types.map((type) => {
					const booked = usage.get(type.id) ?? 0;
					return (
						<li class={type.active ? '' : 'inactive'}>
							<details class="type-row">
								<summary>
									<span class="dot" style={`--chip: ${type.color}`} />
									<strong>{typeName(type)}</strong>
									<span class="muted">{lang === 'th' ? type.label_en : type.label_th}</span>
									<span class="mono muted">{type.code}</span>
									{type.active ? null : <span class="tag">{t('admin.retired')}</span>}
									<span class="type-facts muted">
										{type.counts_quota ? t('admin.defaultDaysN', { n: formatDays(type.default_days) }) : t('admin.noAllowance')} · {t('admin.bookings', { n: booked, count: booked })}
									</span>
									{/* A pencil, as on People: the row's one way to edit. */}
									<span class="icon-btn type-edit" aria-hidden="true">
										<EditIcon />
									</span>
									<span class="visually-hidden">{t('admin.editType', { label: typeName(type) })}</span>
								</summary>
								<form method="post" action="/admin/type" class="type-form">
									<input type="hidden" name="id" value={String(type.id)} />
									<TypeFields type={type} />
									<label class="checkline">
										<input type="checkbox" name="active" value="1" checked={!!type.active} /> {t('admin.offered')}
									</label>
									<button type="submit" class="btn small tonal">{t('admin.save')}</button>
								</form>
								{/* Offered only where it can succeed. The route re-checks, and so
								    does the DELETE itself, in case someone books it meanwhile. */}
								{booked === 0 ? (
									<AskOnceDelete
										action="/admin/type/delete"
										fields={{ id: String(type.id) }}
										label={t('admin.deleteType', { label: typeName(type) })}
										confirm={t('admin.deleteTypeAsk')}
										button={t('admin.deleteTypeButton')}
									/>
								) : null}
							</details>
						</li>
					);
				})}
			</ul>
			<details class="import-block">
				<summary class="btn text">{t('admin.addType')}</summary>
				<form method="post" action="/admin/type" class="type-form">
					<TextField id="type-code" name="code" label={t('admin.typeCode')} maxlength={24} required support={t('admin.typeCodeHelp')} class="type-code" />
					<TypeFields />
					<button type="submit" class="btn tonal">{t('admin.add')}</button>
				</form>
			</details>
		</section>
	);
}

/** The editable half of a leave type, shared by the add form and each row's edit form. */
function TypeFields({ type }: { type?: LeaveType }) {
	const t = useT();
	const key = type ? String(type.id) : 'new';
	return (
		<>
			<TextField id={`type-th-${key}`} name="label_th" label={t('admin.labelTh')} value={type?.label_th} maxlength={40} required />
			<TextField id={`type-en-${key}`} name="label_en" label={t('admin.labelEn')} value={type?.label_en} maxlength={40} required />
			<label class="color-field">
				<span class="muted">{t('admin.color')}</span>
				<input type="color" name="color" value={type?.color ?? '#0891b2'} required />
			</label>
			<TextField
				id={`type-days-${key}`}
				name="default_days"
				label={t('admin.defaultDays')}
				type="number"
				value={type ? formatDays(type.default_days) : '0'}
				step="0.5"
				min="0"
				max="365"
				required
				class="quota-cell"
			/>
			<TextField
				id={`type-order-${key}`}
				name="sort_order"
				label={t('admin.order')}
				type="number"
				value={String(type?.sort_order ?? 9)}
				step="1"
				min="0"
				max="999"
				class="quota-cell"
			/>
			<label class="checkline">
				<input type="checkbox" name="counts_quota" value="1" checked={type ? !!type.counts_quota : true} /> {t('admin.countsQuota')}
			</label>
		</>
	);
}
