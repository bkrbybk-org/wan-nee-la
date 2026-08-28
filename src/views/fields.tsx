/**
 * Material 3 filled text fields.
 *
 * The label sits inside the container and shrinks to the top once the field
 * holds something — that is the whole point of the component, and it is done
 * in CSS with `:placeholder-shown`, so it works with scripting off.
 *
 * Two consequences worth knowing before using these:
 *
 *  - The input's real `placeholder` is always a single space. A visible
 *    placeholder would sit exactly where the resting label sits, and would
 *    also defeat `:placeholder-shown`, pinning every label to the top. Pass
 *    the hint as `support` instead; it renders under the field, which is where
 *    M3 puts supporting text anyway.
 *  - `<input type="date">` and `<select>` never match `:placeholder-shown` —
 *    they always display something — so they are marked `tf-fixed` and keep
 *    the label raised permanently rather than flickering.
 *
 * `invalid` paints the M3 error state — error-coloured label and active line —
 * and, more usefully, exposes it as `aria-invalid` and pulls focus to the
 * field. The sentence explaining what went wrong is not repeated here: it is
 * already at the top of the page, and printing it twice on a five-field form
 * reads as two separate problems.
 */
import type { Child } from 'hono/jsx';
import { ChevronDownIcon } from './icons.tsx';

/** Passed straight through to the input — `data-*` hooks for the client script. */
type Extras = Record<string, string | number | undefined>;

interface TextFieldProps {
	id: string;
	name: string;
	label: Child;
	type?: 'text' | 'date' | 'number';
	value?: string | number;
	required?: boolean;
	maxlength?: number;
	step?: string;
	min?: string;
	max?: string;
	support?: Child;
	class?: string;
	extra?: Extras;
	/** The field the last submission was rejected over. See the note above. */
	invalid?: boolean;
}

export function TextField(props: TextFieldProps) {
	const { id, name, label, type = 'text', value, required, maxlength, step, min, max, support, extra, invalid } = props;
	const fixed = type === 'date';
	return (
		<div class={`tf ${fixed ? 'tf-fixed' : ''} ${invalid ? 'tf-error' : ''} ${props.class ?? ''}`}>
			<input
				class="tf-input"
				id={id}
				name={name}
				type={type}
				value={value as string}
				required={required}
				maxlength={maxlength}
				step={step}
				min={min}
				max={max}
				placeholder=" "
				aria-invalid={invalid ? 'true' : undefined}
				autofocus={invalid}
				{...(extra ?? {})}
			/>
			<label class="tf-label" for={id}>{label}</label>
			{support ? <span class="tf-support">{support}</span> : null}
		</div>
	);
}

interface SelectFieldProps {
	id: string;
	name: string;
	label: Child;
	required?: boolean;
	support?: Child;
	class?: string;
	extra?: Extras;
	/** Applied to the wrapper rather than the control — client-script hooks that
	    need to show or hide the whole field. */
	fieldExtra?: Extras;
	/** The field the last submission was rejected over. See the note above. */
	invalid?: boolean;
	children?: Child;
}

export function SelectField(props: SelectFieldProps) {
	const { id, name, label, required, support, extra, fieldExtra, invalid, children } = props;
	return (
		<div class={`tf tf-fixed ${invalid ? 'tf-error' : ''} ${props.class ?? ''}`} {...(fieldExtra ?? {})}>
			<select
				class="tf-input"
				id={id}
				name={name}
				required={required}
				aria-invalid={invalid ? 'true' : undefined}
				autofocus={invalid}
				{...(extra ?? {})}
			>
				{children}
			</select>
			<label class="tf-label" for={id}>{label}</label>
			<ChevronDownIcon class="tf-select-arrow" />
			{support ? <span class="tf-support">{support}</span> : null}
		</div>
	);
}
