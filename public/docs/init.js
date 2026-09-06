/**
 * Boots Swagger UI against /openapi.yaml.
 *
 * A separate file rather than an inline <script> because the page is served by
 * the Worker and therefore carries the app's CSP, whose script-src is 'self'
 * plus one hash — the theme script. Inline code here would need a second hash
 * kept in step with this file by hand, and a stale hash fails silently as a
 * blank page. Same-origin src needs neither.
 */
window.addEventListener('DOMContentLoaded', function () {
	SwaggerUIBundle({
		url: '/openapi.yaml',
		dom_id: '#swagger-ui',
		// The layout that ships in the bundle. StandaloneLayout lives in a
		// second file and only adds the topbar's URL box, which would invite
		// pointing this at somebody else's spec.
		layout: 'BaseLayout',
		deepLinking: true,
		// Sorted, because the order operations happen to appear in the source is
		// not an order anyone reads in.
		tagsSorter: 'alpha',
		operationsSorter: 'alpha',
		// "Try it out" is left on: every endpoint here is behind Cloudflare
		// Access, the reader is already signed in, and the browser sends the
		// Access cookie and an Origin header of its own accord — so a request
		// from this page is exactly the request the app expects. Note the push
		// endpoints act on the reader's own browsers, and /api/push/test really
		// does send a notification.
		tryItOutEnabled: true,
		// Nothing is expanded on load. The point of the page is to see what
		// exists before reading any one thing in detail.
		docExpansion: 'list',
		defaultModelsExpandDepth: 0,
	});
});
