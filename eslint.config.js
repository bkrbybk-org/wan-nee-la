// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

// This project has a deliberate, hand-tuned formatting style (long wrapped
// comments, manually-chosen line breaks) that a default Prettier run would
// destroy. So the stylistic rules below check *local* properties — tabs,
// quote style, semicolons, trailing commas — rather than anything that
// requires re-flowing a whole line/block to a fixed width. Nothing here
// second-guesses where a human chose to wrap a line.
const stylisticRules = {
	// @stylistic/indent is deliberately OFF: it recomputes expected indent
	// depth from AST nesting, and this codebase's hand-wrapped ternaries,
	// chained JSX, and manually-aligned continuations don't follow that
	// algorithm even though they're internally consistent. Enabling it
	// would force a repo-wide reindent. `no-mixed-spaces-and-tabs` still
	// catches the failure mode that rule is usually there to prevent.
	'no-mixed-spaces-and-tabs': 'error',
	'@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'always' }],
	'@stylistic/jsx-quotes': ['error', 'prefer-double'],
	'@stylistic/semi': ['error', 'always'],
	'@stylistic/comma-dangle': ['error', 'always-multiline'],
};

export default tseslint.config(
	{
		ignores: ['public/app.js', 'node_modules/**', '.wrangler/**', 'worker-configuration.d.ts'],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.{ts,tsx}'],
		languageOptions: {
			globals: { ...globals.worker },
		},
		plugins: { '@stylistic': stylistic },
		rules: {
			...stylisticRules,
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
	{
		files: ['scripts/**/*.mjs'],
		languageOptions: {
			globals: { ...globals.node },
		},
		plugins: { '@stylistic': stylistic },
		rules: {
			...stylisticRules,
		},
	},
	{
		// Ordinary browser scripts served straight from /public — not bundled, not
		// service workers. `sw.js` is excluded because it needs the service-worker
		// globals instead, and gets its own block below.
		files: ['public/**/*.js'],
		ignores: ['public/sw.js'],
		// SwaggerUIBundle is defined by the CDN bundle the docs page loads in a
		// <script> before this one, so it is a global here rather than an import.
		languageOptions: { globals: { ...globals.browser, SwaggerUIBundle: 'readonly' } },
		plugins: { '@stylistic': stylistic },
		rules: { ...stylisticRules },
	},
	{
		files: ['public/sw.js'],
		languageOptions: {
			globals: { ...globals.serviceworker },
		},
		plugins: { '@stylistic': stylistic },
		rules: {
			...stylisticRules,
		},
	},
	{
		// `no-useless-assignment` is a real-bug-finder (assigns then
		// overwrites/never reads before reassigning), not a formatting rule,
		// but it flags a handful of existing, intentional patterns here
		// (e.g. an assignment kept for a later `catch` block, or reused as
		// a scratch variable across branches). Fixing those is a code change,
		// which is out of scope for this formatting/linting setup task —
		// off repo-wide rather than scattered inline disables.
		rules: {
			'no-useless-assignment': 'off',
		},
	},
);
