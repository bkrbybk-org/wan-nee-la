export interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
	CF_VERSION_METADATA: { id: string; tag: string; timestamp: string };
	ACCESS_TEAM_DOMAIN: string;
	ACCESS_AUD: string;
	DEV_AUTH_BYPASS: string;
	DEV_EMAIL: string;
	/** LINE Messaging API. Set with `wrangler secret put` — never in wrangler.jsonc. */
	LINE_CHANNEL_ACCESS_TOKEN: string;
	LINE_CHANNEL_SECRET: string;
	/** Optional pin. Normally the group id is captured by /line/webhook into app_config. */
	LINE_GROUP_ID: string;
	/**
	 * Web Push (VAPID). The public key is not a secret — it is handed to every
	 * browser that subscribes — so it lives in wrangler.jsonc. The private key
	 * is set with `wrangler secret put`; anyone holding it can push to every
	 * subscriber. Generate a pair with `node scripts/vapid-keys.mjs`.
	 */
	VAPID_PUBLIC_KEY: string;
	VAPID_PRIVATE_KEY: string;
	/** Contact for the push services, e.g. `mailto:ops@example.com`. */
	VAPID_SUBJECT: string;
}

export type Half = 'full' | 'am' | 'pm';
export type LeaveStatus = 'confirmed' | 'cancelled';

export interface User {
	email: string;
	display_name: string;
	is_admin: number;
	active: number;
	/** 0 = Sunday, 1 = Monday. Presentation only — see migrations/0003. */
	week_start: number;
	created_at: string;
}

export interface LeaveType {
	id: number;
	code: string;
	label_th: string;
	label_en: string;
	color: string;
	default_days: number;
	counts_quota: number;
	sort_order: number;
}

export interface LeaveRequest {
	id: string;
	user_email: string;
	leave_type_id: number;
	start_date: string;
	end_date: string;
	start_half: Half;
	end_half: Half;
	days_total: number;
	note: string | null;
	status: LeaveStatus;
	created_at: string;
	cancelled_at: string | null;
}

/** A leave row joined with the display fields the calendar and lists need. */
export interface LeaveEntry extends LeaveRequest {
	display_name: string;
	type_code: string;
	type_label_en: string;
	type_label_th: string;
	color: string;
}

export interface Quota {
	user_email: string;
	year: number;
	leave_type_id: number;
	days_allotted: number;
}

/** One row of the personal dashboard. */
export interface Balance {
	type: LeaveType;
	allotted: number;
	used: number;
	remaining: number;
}

export interface Holiday {
	date: string;
	label: string;
}
