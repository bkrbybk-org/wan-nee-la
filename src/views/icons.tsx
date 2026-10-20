/**
 * Icons.
 *
 * Drawn here rather than pulled from an icon font: Material Symbols would mean
 * a request to fonts.googleapis.com on every page, and the whole set weighs
 * far more than the eight glyphs this app uses. These are plain strokes on the
 * 24px grid, sized and coloured by CSS through `currentColor`.
 *
 * Every icon is decorative — each one sits next to a visible text label, or on
 * a control that carries its own aria-label — so they are all aria-hidden.
 */
import type { Child } from 'hono/jsx';

type IconProps = { class?: string };

function Svg({ children, ...props }: IconProps & { children?: Child }) {
	return (
		<svg
			class={`icon ${props.class ?? ''}`}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{children}
		</svg>
	);
}

export const CalendarIcon = (p: IconProps) => (
	<Svg {...p}>
		<rect x="3" y="5" width="18" height="16" rx="3" />
		<path d="M3 10h18M8 3v4M16 3v4" />
	</Svg>
);

export const PersonIcon = (p: IconProps) => (
	<Svg {...p}>
		<circle cx="12" cy="8" r="3.5" />
		<path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
	</Svg>
);

export const AdminIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M5 7h14M5 12h14M5 17h14" />
		<circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
		<circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
		<circle cx="8" cy="17" r="2" fill="currentColor" stroke="none" />
	</Svg>
);

export const PlusIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M12 5v14M5 12h14" />
	</Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M15 5l-7 7 7 7" />
	</Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M9 5l7 7-7 7" />
	</Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M6 9l6 6 6-6" />
	</Svg>
);

export const CloseIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M6 6l12 12M18 6L6 18" />
	</Svg>
);

export const EditIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
	</Svg>
);

export const DeleteIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M5 7h14M10 7V5h4v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
	</Svg>
);

export const BellIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z" />
		<path d="M10 19a2 2 0 0 0 4 0" />
	</Svg>
);

/** Notifications on: the bell with the two strokes that say it is ringing. */
export const BellRingIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z" />
		<path d="M10 19a2 2 0 0 0 4 0" />
		<path d="M3 5.5a9 9 0 0 1 2.2-3M21 5.5a9 9 0 0 0-2.2-3" />
	</Svg>
);

/** Notifications impossible here: blocked in the browser, or no Push API at all. */
export const BellOffIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M8.5 4.2A6 6 0 0 1 18 9c0 2 .4 3.4.9 4.4M17 15H4c.5-.5 2-2 2-6 0-.7.1-1.3.3-1.9" />
		<path d="M10 19a2 2 0 0 0 4 0" />
		<path d="M3 3l18 18" />
	</Svg>
);

/** People, plural — the admin's roster. */
export const UsersIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
		<path d="M2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6" />
	</Svg>
);

export const TagIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M3 12V4h8l10 10-8 8z" />
		<path d="M7.5 8.5h.01" />
	</Svg>
);

export const DownloadIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
	</Svg>
);

/** A clock with its hand turned back: the change history. */
export const HistoryIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7" />
		<path d="M4 4v4.7h4.7M12 8v4l3 2" />
	</Svg>
);

/** A cog: the way to /me/settings. */
export const SettingsIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
		<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
	</Svg>
);

export const CheckIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M5 13l4 4 10-10" />
	</Svg>
);
