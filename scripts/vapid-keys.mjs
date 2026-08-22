#!/usr/bin/env node
/**
 * Generate a VAPID keypair for browser push.
 *
 * Run once, ever. Regenerating it invalidates every existing subscription —
 * browsers bind a subscription to the key that created it, so every person
 * would have to turn notifications on again.
 *
 * Uses Node's own WebCrypto rather than a dependency: the private key here is
 * the credential that lets anything push to every subscriber, and it should not
 * pass through a package nobody has read.
 *
 *     npm run vapid
 */

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

const b64url = (bytes) =>
	Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The public key goes out to browsers as the raw uncompressed point; the
// private key is stored as the bare 32-byte scalar, which is the format every
// web-push tool expects.
const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;

console.log(`
VAPID keypair
=============

Public key  (goes in wrangler.local.jsonc — not a secret, every browser gets it):

  ${publicKey}

Private key (a secret — anyone holding it can push to every subscriber):

  ${privateKey}

Next steps:

  1. Put the public key and your contact address in wrangler.local.jsonc:

       "VAPID_PUBLIC_KEY": "${publicKey}",
       "VAPID_SUBJECT": "mailto:you@example.com"

  2. Store the private key as a secret, never in a config file:

       npx wrangler secret put VAPID_PRIVATE_KEY --config wrangler.local.jsonc

  3. Deploy, then turn notifications on from /me.

Do not regenerate this pair later: every existing subscription is bound to it
and would silently stop working.
`);
