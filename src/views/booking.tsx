import type { LeaveType } from '../types.ts';

/**
 * Booking form. A plain POST form that works with JS disabled — `booking.js`
 * only adds the live day-count preview and the half-day field toggling.
 *
 * `type="date"` gives the native picker on both iOS and Android, which is a far
 * better mobile experience than any date-picker library and costs nothing.
 */
export function BookingForm({ types, today, compact }: { types: readonly LeaveType[]; today: string; compact?: boolean }) {
	return (
		<form method="post" action="/api/leave" class={`booking ${compact ? 'compact' : ''}`} data-booking>
			<div class="field">
				<label for="leaveTypeId">Leave type</label>
				<select id="leaveTypeId" name="leaveTypeId" required>
					{types.map((t) => (
						<option value={String(t.id)}>
							{t.label_en} · {t.label_th}
						</option>
					))}
				</select>
			</div>

			<div class="row">
				<div class="field">
					<label for="startDate">From</label>
					<input type="date" id="startDate" name="startDate" required value={today} data-start />
				</div>
				<div class="field">
					<label for="startHalf">
						Start <span class="muted">half</span>
					</label>
					<select id="startHalf" name="startHalf" data-start-half>
						<option value="full">Full day</option>
						<option value="am">Morning only</option>
						<option value="pm">Afternoon only</option>
					</select>
				</div>
			</div>

			<div class="row">
				<div class="field">
					<label for="endDate">
						To <span class="muted">(blank = same day)</span>
					</label>
					<input type="date" id="endDate" name="endDate" data-end />
				</div>
				<div class="field" data-end-half-field>
					<label for="endHalf">
						End <span class="muted">half</span>
					</label>
					<select id="endHalf" name="endHalf" data-end-half>
						<option value="full">Full day</option>
						<option value="am">Morning only</option>
					</select>
				</div>
			</div>

			<div class="field">
				<label for="note">
					Note <span class="muted">(optional)</span>
				</label>
				<input type="text" id="note" name="note" maxlength={500} placeholder="Family trip" />
			</div>

			<div class="actions">
				<button type="submit" class="btn primary">Book leave</button>
				{/* Filled in by booking.js; stays empty and harmless without it. */}
				<span class="preview" data-preview aria-live="polite"></span>
			</div>
		</form>
	);
}
