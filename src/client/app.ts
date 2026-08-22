/**
 * Single client bundle. Both modules are progressive enhancement — every page
 * works with this file blocked.
 *
 * Order matters: booking.ts wires up the form's live preview first, so the
 * `change` event calendar.ts fires when prefilling a date has a listener to
 * reach. ripple.ts is decoration and delegates from the document, so it can go
 * anywhere.
 */
import './booking.ts';
import './ripple.ts';
import './push.ts';
import './calendar.ts';
import './drag.ts';
