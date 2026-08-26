/**
 * The current reader's language, available to any component without threading
 * it through every prop.
 *
 * Hono's JSX implements context for server rendering, and rendering here is
 * synchronous, so a provider high in the tree reaches every component below it
 * within that one render — there is no shared mutable state between requests.
 */
import { createContext, useContext } from 'hono/jsx';
import { t, type Lang, type StringKey } from './strings.ts';

const LangContext = createContext<Lang>('en');

export const LangProvider = LangContext.Provider;

/** The reader's language, for the few places that need it directly (dates, `<html lang>`). */
export function useLang(): Lang {
	return useContext(LangContext);
}

/**
 * A translator bound to the current reader.
 *
 * Named `useT` rather than exposing `t` directly so a component cannot
 * accidentally translate into the default language by forgetting an argument.
 */
export function useT(): (key: StringKey, vars?: Record<string, string | number>) => string {
	const lang = useContext(LangContext);
	return (key, vars) => t(lang, key, vars);
}
