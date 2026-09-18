/**
 * What an admin may submit for a leave type. Pure, like the booking rules next
 * door, and tested by `scripts/test-leave.mjs`.
 *
 * `code` is set once and never edited: it is the `type` field of the
 * `/api/leave` feed, so renaming it would quietly break anything reading that.
 * The labels are what people see, and those can change freely.
 */

import { msg, type Message } from '../i18n/strings.ts';
import { round } from './leave.ts';

export const TYPE_LABEL_MAX = 40;
const CODE = /^[a-z][a-z0-9_]{1,23}$/;
const COLOR = /^#[0-9a-f]{6}$/;

export interface LeaveTypeInput {
	label_th: string;
	label_en: string;
	color: string;
	default_days: number;
	counts_quota: number;
	sort_order: number;
	active: number;
}

export type ParsedType = { ok: true; value: LeaveTypeInput & { code?: string } } | { ok: false; error: Message };

/**
 * Validate the leave-type form. `creating` asks for a code as well; an edit
 * ignores any code it is sent.
 *
 * Checkboxes submit nothing when unticked, so absence means 0 — for `active`
 * that is "retire it", which is why the edit form always renders the box.
 * A new type is always created active: retiring something nobody has seen yet
 * has no purpose.
 */
export function parseLeaveTypeForm(form: Record<string, unknown>, creating: boolean): ParsedType {
	const text = (v: unknown) => String(v ?? '').trim();

	let code: string | undefined;
	if (creating) {
		code = text(form.code).toLowerCase();
		if (!CODE.test(code)) return { ok: false, error: msg('flash.typeBadCode') };
	}

	const label_th = text(form.label_th);
	const label_en = text(form.label_en);
	if (!label_th || !label_en || label_th.length > TYPE_LABEL_MAX || label_en.length > TYPE_LABEL_MAX) {
		return { ok: false, error: msg('flash.typeBadLabel', { max: TYPE_LABEL_MAX }) };
	}

	const color = text(form.color).toLowerCase();
	if (!COLOR.test(color)) return { ok: false, error: msg('flash.typeBadColor') };

	const days = Number(text(form.default_days));
	if (text(form.default_days) === '' || !Number.isFinite(days) || days < 0 || days > 365) {
		return { ok: false, error: msg('flash.daysRange') };
	}

	const order = text(form.sort_order);
	const sort_order = order === '' ? 0 : Number(order);
	if (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 999) {
		return { ok: false, error: msg('flash.typeBadOrder') };
	}

	return {
		ok: true,
		value: {
			...(code === undefined ? {} : { code }),
			label_th,
			label_en,
			color,
			default_days: round(days),
			counts_quota: form.counts_quota === '1' ? 1 : 0,
			sort_order,
			active: creating || form.active === '1' ? 1 : 0,
		},
	};
}
