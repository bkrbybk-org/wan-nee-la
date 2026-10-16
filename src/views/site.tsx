/**
 * Per-deployment facts the shared layout needs, handed down by context.
 *
 * Every page renders the same header, and the header carries the
 * notifications bell, which needs the push public key. Threading that key
 * through each page's props to reach Layout would add a parameter to seven
 * components that never use it; a context is set once where a page is rendered
 * (`page()` in src/index.tsx) and read once in the header.
 */
import { createContext, useContext } from 'hono/jsx';
import { personColor } from './person.ts';

/** The VAPID public key, or '' when push is not configured — which hides the bell. */
const PushKeyContext = createContext<string>('');

export const PushKeyProvider = PushKeyContext.Provider;

export function usePushKey(): string {
	return useContext(PushKeyContext);
}

/**
 * Each person's badge colour, in sign-up order (see `personColors`). Set once by
 * the calendar page, read by every badge on it — the bars, the Upcoming list and
 * the "+N more" panel — so all three agree on who is which colour.
 */
const PersonColorsContext = createContext<ReadonlyMap<string, string>>(new Map());

export const PersonColorsProvider = PersonColorsContext.Provider;

/** The colour for one person; an address with no user row falls back to its hash. */
export function useColorOf(): (email: string) => string {
	const colors = useContext(PersonColorsContext);
	return (email) => colors.get(email) ?? personColor(email);
}
