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

/** The VAPID public key, or '' when push is not configured — which hides the bell. */
const PushKeyContext = createContext<string>('');

export const PushKeyProvider = PushKeyContext.Provider;

export function usePushKey(): string {
	return useContext(PushKeyContext);
}
