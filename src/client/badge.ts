/**
 * The installed app's icon shows how many are away today.
 *
 * The morning digest sets it from the service worker (public/sw.js); this keeps
 * it true whenever the calendar is opened on the current month, including the
 * days the digest stays silent because nobody is away — without it, yesterday's
 * number would sit on the icon. The count comes from the Today card, which the
 * server renders only for the current month; on any other page the badge is
 * left as it is.
 *
 * Only where the Badging API exists: an installed app in Chrome, or on iPhone
 * from the Home Screen. Anywhere else this does nothing.
 */

const todayCard = document.querySelector<HTMLElement>('[data-away-today]');
if (todayCard && 'setAppBadge' in navigator) {
	const count = Number(todayCard.dataset.awayToday);
	(count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {
		// Not installed, or not allowed. Nothing on the page depends on it.
	});
}
