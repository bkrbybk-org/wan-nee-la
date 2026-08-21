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

export const CheckIcon = (p: IconProps) => (
	<Svg {...p}>
		<path d="M5 13l4 4 10-10" />
	</Svg>
);
