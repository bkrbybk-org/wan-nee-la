/**
 * Single client bundle. Both modules are progressive enhancement — every page
 * works with this file blocked.
 *
 * Order matters: booking.ts wires up the form's live preview first, so the
 * `change` event calendar.ts fires when prefilling a date has a listener to
 * reach.
 */
import './booking.ts';
import './calendar.ts';
