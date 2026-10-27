/**
 * Interface strings, English and Thai.
 *
 * Both languages sit on the same line so a missing or stale translation is
 * visible while editing, rather than hiding in a second file that drifts.
 *
 * What is deliberately *not* translated:
 *
 *  - Leave type names. They already carry both languages from the seed data
 *    (`label_en` / `label_th`) and are the admin's to edit, not this file's.
 *  - The LINE and push digests. One message goes to everyone, so it is
 *    bilingual by construction rather than per reader.
 *  - Commands, config keys and other things typed into a terminal.
 */

export type Lang = 'en' | 'th';

export const LANGS: Lang[] = ['en', 'th'];

export function isLang(v: unknown): v is Lang {
	return v === 'en' || v === 'th';
}

/** Falls back to English for anything unrecognised, including a NULL column. */
export function toLang(v: unknown): Lang {
	return isLang(v) ? v : 'en';
}

type Entry = { en: string; th: string };

export const STRINGS = {
	// --- chrome ---------------------------------------------------------
	'nav.calendar': { en: 'Calendar', th: 'ปฏิทิน' },
	'nav.me': { en: 'My leave', th: 'การลาของฉัน' },
	'nav.admin': { en: 'Admin', th: 'ผู้ดูแลระบบ' },
	'nav.sections': { en: 'Sections', th: 'เมนู' },
	'nav.skip': { en: 'Skip to content', th: 'ข้ามไปที่เนื้อหา' },
	'nav.signedInAs': { en: 'Signed in as {name}', th: 'เข้าใช้งานในชื่อ {name}' },
	'nav.theme': { en: 'Theme', th: 'ธีม' },
	'foot.build': { en: 'build {version}', th: 'บิลด์ {version}' },

	// --- calendar -------------------------------------------------------
	'cal.title': { en: 'Leave for {month} {year}, one column per day of the week.', th: 'วันลาประจำ {month} {year} หนึ่งคอลัมน์ต่อหนึ่งวันในสัปดาห์' },
	'cal.prevMonth': { en: 'Previous month', th: 'เดือนก่อนหน้า' },
	'cal.nextMonth': { en: 'Next month', th: 'เดือนถัดไป' },
	'cal.jump': { en: 'Jump to a month', th: 'ไปยังเดือน' },
	'cal.month': { en: 'Month', th: 'เดือน' },
	'cal.year': { en: 'Year', th: 'ปี' },
	'cal.go': { en: 'Go', th: 'ไป' },
	'cal.today': { en: 'Today', th: 'วันนี้' },
	'cal.book': { en: 'Book leave', th: 'แจ้งลา' },
	'cal.bookThisDay': { en: 'Book this day', th: 'ลาวันที่เลือก' },
	'cal.holidaysDueShort': { en: '{year} holidays missing', th: 'วันหยุดปี {year} ยังไม่ครบ' },
	'cal.bookOnShort': { en: 'Book leave — {date}', th: 'แจ้งลา — {date}' },
	'cal.months': { en: 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec', th: 'ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.' },
	'cal.seeDay': { en: 'See who is out on {date}', th: 'ดูว่าใครลาวันที่ {date}' },
	'cal.bookOn': { en: 'Book leave on {date}', th: 'แจ้งลาวันที่ {date}' },
	'cal.upcoming': { en: 'Upcoming', th: 'ที่กำลังจะถึง' },
	'cal.nothingUpcoming': { en: 'Nothing booked in the next {days} days.', th: 'ไม่มีการลาใน {days} วันข้างหน้า' },
	'cal.todayCard': { en: 'Today at a glance', th: 'ภาพรวมวันนี้' },
	'cal.awayToday': { en: '{n} person away today|{n} people away today', th: 'วันนี้ลา {n} คน' },
	'cal.allIn': { en: 'Nobody is away today', th: 'วันนี้ไม่มีใครลา' },
	'cal.dayOff': { en: 'Not a working day', th: 'วันนี้เป็นวันหยุด' },
	'cal.awaySoon': { en: '+{n} in the next 7 days', th: '+{n} คน ใน 7 วันข้างหน้า' },
	'cal.youAway': { en: 'You are on leave until {date}', th: 'คุณลาถึงวันที่ {date}' },
	'cal.youNext': { en: 'Your next leave: {when} · in {n} day|Your next leave: {when} · in {n} days', th: 'การลาครั้งถัดไปของคุณ: {when} · อีก {n} วัน' },
	'cal.youTomorrow': { en: 'Your next leave: {when} · tomorrow', th: 'การลาครั้งถัดไปของคุณ: {when} · พรุ่งนี้' },
	'cal.youNone': { en: 'Nothing of yours booked in the next {days} days', th: 'คุณยังไม่มีการลาใน {days} วันข้างหน้า' },
	'cal.upcomingAll': { en: 'Show all upcoming', th: 'แสดงทั้งหมด' },
	'cal.upcomingWindow': { en: 'Next {days} days, from today', th: '{days} วันข้างหน้า นับจากวันนี้' },
	'cal.more': { en: '+{n} more', th: 'อีก {n}' },
	'cal.until': { en: 'until {date}', th: 'ถึง {date}' },
	'cal.dayCount': { en: '{n} day|{n} days', th: '{n} วัน' },
	'cal.seeAll': { en: 'See the {n} person away on {date}|See all {n} people away on {date}', th: 'ดูทั้ง {n} คนที่ลาวันที่ {date}' },
	'cal.whoIsOut': { en: 'Who is out', th: 'ใครลาบ้าง' },
	// Used when today's list is empty too, where "nobody *else*" has nothing to
	// be else to.
	'cal.byDay': { en: 'Leave by day', th: 'วันลาแยกตามวัน' },
	'cal.emptyMonth': { en: 'Nobody is on leave this month.', th: 'เดือนนี้ไม่มีใครลา' },
	'cal.nobodyOn': { en: 'Nobody is away.', th: 'ไม่มีใครลา' },
	'cal.entryLabel': { en: '{name} — {type}{part}, {date}', th: '{name} — {type}{part}, {date}' },
	'cal.markAm': { en: ' ½am', th: ' ½เช้า' },
	'cal.markPm': { en: ' ½pm', th: ' ½บ่าย' },
	'cal.halfAm': { en: ', morning only', th: ' เฉพาะเช้า' },
	'cal.halfPm': { en: ', afternoon only', th: ' เฉพาะบ่าย' },

	// --- entry popup ----------------------------------------------------
	'popup.details': { en: 'Leave details', th: 'รายละเอียดการลา' },
	'popup.close': { en: 'Close', th: 'ปิด' },
	'popup.when': { en: 'When', th: 'ช่วงวันที่' },
	'popup.type': { en: 'Type', th: 'ประเภท' },
	'popup.days': { en: 'Days', th: 'จำนวนวัน' },
	'popup.note': { en: 'Note', th: 'หมายเหตุ' },
	'popup.edit': { en: 'Edit', th: 'แก้ไข' },
	'popup.remove': { en: 'Remove', th: 'ลบ' },
	'popup.readonly': { en: 'Only the person who booked this — or an admin — can change it.', th: 'เฉพาะผู้ที่แจ้งลาหรือผู้ดูแลระบบเท่านั้นที่แก้ไขได้' },

	// --- booking form ---------------------------------------------------
	'book.type': { en: 'Leave type', th: 'ประเภทการลา' },
	'book.for': { en: 'Booking for', th: 'แจ้งลาให้' },
	'book.forMe': { en: 'Me ({name})', th: 'ตัวเอง ({name})' },
	'book.forHelp': { en: 'Counted against their allowance. They get a notification if they have them on.', th: 'หักจากวันลาของคนนั้น และจะได้รับการแจ้งเตือนหากเปิดไว้' },
	'book.from': { en: 'From', th: 'ตั้งแต่' },
	'book.to': { en: 'To', th: 'ถึง' },
	'book.balanceShort': { en: '{type}: only {remaining} left — not enough for this', th: '{type}: เหลือเพียง {remaining} วัน ไม่พอสำหรับการลานี้' },
	'book.balanceNone': { en: '{type}: none left — not enough for this', th: '{type}: ไม่เหลือสิทธิ์แล้ว ไม่พอสำหรับการลานี้' },
	'book.balance': { en: '{type}: {remaining} left → {after} after this', th: '{type}: เหลือ {remaining} วัน → หลังลานี้ {after} วัน' },
	'book.bookDays': { en: 'Book {days} day|Book {days} days', th: 'ลา {days} วัน' },
	'book.cancel': { en: 'Cancel', th: 'ยกเลิก' },
	'book.addNote': { en: 'Add a note', th: 'เพิ่มหมายเหตุ' },
	'book.noteHeading': { en: 'Note', th: 'หมายเหตุ' },
	'book.lastDay': { en: 'Last day', th: 'วันสุดท้าย' },
	'book.firstDay': { en: 'First day', th: 'วันแรก' },
	'book.untilNoon': { en: 'Until noon', th: 'ถึงเที่ยง' },
	'book.fromNoon': { en: 'From noon', th: 'เริ่มตอนบ่าย' },
	'book.allDay': { en: 'All day', th: 'ทั้งวัน' },
	'book.afternoon': { en: 'Afternoon', th: 'บ่าย' },
	'book.morning': { en: 'Morning', th: 'เช้า' },
	'book.dayPart': { en: 'Part of the day', th: 'ช่วงเวลา' },
	'book.date': { en: 'Date', th: 'วันที่' },
	'book.severalDays': { en: 'Several days', th: 'หลายวัน' },
	'book.howLong': { en: 'How long', th: 'ระยะเวลา' },
	'book.oneDay': { en: 'One day', th: 'วันเดียว' },
	'book.fullDay': { en: 'Full day', th: 'เต็มวัน' },
	'book.note': { en: 'Note (optional)', th: 'หมายเหตุ (ไม่บังคับ)' },
	'book.shareNote': { en: 'Share the note with the team', th: 'แชร์หมายเหตุกับทีม' },
	'book.noteHelp': { en: 'Otherwise only you and admins can read it. The dates and leave type are on the shared calendar either way.', th: 'หากไม่แชร์ จะเห็นเฉพาะคุณและผู้ดูแลระบบ วันที่และประเภทการลาแสดงบนปฏิทินส่วนกลางเสมอ' },
	'book.submit': { en: 'Book leave', th: 'แจ้งลา' },
	'book.save': { en: 'Save changes', th: 'บันทึกการแก้ไข' },
	'book.discard': { en: 'Discard changes', th: 'ยกเลิกการแก้ไข' },
	'book.days': { en: '{days} day|{days} days', th: '{days} วัน' },
	'book.pageTitle': { en: 'Book leave', th: 'แจ้งลา' },
	'book.coverage': { en: 'Also away on {date}: {names} — with you, {out} of {headcount}', th: 'วันที่ {date} มีคนลาด้วย: {names} — รวมคุณ {out} จาก {headcount} คน' },
	'book.coverageFor': { en: 'Also away on {date}: {names} — with {who}, {out} of {headcount}', th: 'วันที่ {date} มีคนลาด้วย: {names} — รวม {who} {out} จาก {headcount} คน' },
	'book.coverageMore': { en: '{names} and {more} more', th: '{names} และอีก {more} คน' },

	// --- my leave -------------------------------------------------------
	'me.title': { en: 'My leave', th: 'การลาของฉัน' },
	'me.settings': { en: 'Settings', th: 'การตั้งค่า' },
	'me.earlierIn': { en: 'Earlier in {year}', th: 'ก่อนหน้านี้ในปี {year}' },
	'me.showCancelled': { en: '{n} cancelled booking|{n} cancelled bookings', th: 'การลาที่ยกเลิก {n} รายการ' },
	'me.nothingNext': { en: 'Nothing booked ahead', th: 'ยังไม่มีวันลาที่จะถึง' },
	'me.underWay': { en: 'On leave now, until {date}', th: 'กำลังลาอยู่ ถึง {date}' },
	'me.nextTomorrow': { en: 'Next leave · tomorrow', th: 'ลาครั้งถัดไป · พรุ่งนี้' },
	'me.nextIn': { en: 'Next leave · in {n} day|Next leave · in {n} days', th: 'ลาครั้งถัดไป · อีก {n} วัน' },
	'me.days': { en: '{n} day|{n} days', th: '{n} วัน' },
	'me.daysOver': { en: 'day over|days over', th: 'วันที่เกินสิทธิ์' },
	'me.now': { en: 'now', th: 'ตอนนี้' },
	'me.notePrivate': { en: 'private', th: 'ส่วนตัว' },
	'me.noteShared': { en: 'shared', th: 'แชร์กับทีม' },
	'flash.settingsSaved': { en: 'Settings saved.', th: 'บันทึกการตั้งค่าแล้ว' },
	'me.daysLeft': { en: 'day left|days left', th: 'วันคงเหลือ' },
	'me.daysTaken': { en: 'day taken|days taken', th: 'วันที่ใช้ไป' },
	'me.noAllowance': { en: 'Not counted against an allowance', th: 'ไม่นับรวมในสิทธิ์วันลา' },
	'me.byMonth': { en: 'Days off by month', th: 'วันลาแยกตามเดือน' },
	'me.byMonthNone': { en: 'No days off in {year} yet.', th: 'ยังไม่มีวันลาในปี {year}' },
	'me.byMonthHelp': { en: 'Counted in the month each day falls in, so leave across New Year shows in both years here, though the balance charges it to the year it starts in.', th: 'นับตามเดือนที่วันนั้นอยู่ การลาคร่อมปีใหม่จึงแสดงในทั้งสองปี แต่ยอดคงเหลือจะหักในปีที่เริ่มลา' },
	'me.usedOf': { en: '{used} used of {allotted}', th: 'ใช้ไป {used} จาก {allotted}' },
	'me.meterLabel': { en: '{used} of {allotted} days used', th: 'ใช้ไป {used} จาก {allotted} วัน' },
	'me.upcoming': { en: 'Upcoming', th: 'ที่กำลังจะถึง' },
	'me.nothingBooked': { en: 'Nothing booked.', th: 'ยังไม่มีการลา' },
	'me.nothingYet': { en: 'Nothing yet.', th: 'ยังไม่มีข้อมูล' },
	'me.cancelled': { en: 'Cancelled', th: 'ยกเลิกแล้ว' },
	'me.calendar': { en: 'Calendar', th: 'ปฏิทิน' },
	'me.weekStartHelp': { en: 'Which day the month grid starts on. Weekends stay Saturday and Sunday either way.', th: 'เลือกว่าปฏิทินเริ่มต้นที่วันใด ไม่ว่าเลือกแบบใด วันหยุดสุดสัปดาห์ยังคงเป็นเสาร์และอาทิตย์' },
	'me.weekStart': { en: 'Week starts on', th: 'สัปดาห์เริ่มวัน' },
	'me.monday': { en: 'Monday first', th: 'เริ่มวันจันทร์' },
	'me.sunday': { en: 'Sunday first', th: 'เริ่มวันอาทิตย์' },
	'me.save': { en: 'Save', th: 'บันทึก' },
	'me.displayName': { en: 'Display name', th: 'ชื่อที่แสดง' },
	'me.displayNameHelp': { en: 'This is the name shown on the shared calendar.', th: 'ชื่อนี้จะแสดงบนปฏิทินส่วนกลาง' },
	'me.language': { en: 'Language', th: 'ภาษา' },
	'me.languageHelp': { en: 'Applies everywhere you sign in, not just this browser.', th: 'มีผลทุกอุปกรณ์ที่คุณเข้าใช้งาน ไม่ใช่เฉพาะเบราว์เซอร์นี้' },
	'me.english': { en: 'English', th: 'อังกฤษ' },
	'me.thai': { en: 'ไทย', th: 'ไทย' },

	// --- browser notifications -------------------------------------------
	'push.title': { en: 'Browser notifications', th: 'การแจ้งเตือนในเบราว์เซอร์' },
	'push.help': { en: 'One notification at 09:00, Monday to Friday, listing who is out that day. Nothing is sent on weekends, public holidays, or days when nobody is away.', th: 'แจ้งเตือนเวลา 09:00 น. วันจันทร์ถึงศุกร์ ว่าวันนั้นใครลาบ้าง จะไม่แจ้งเตือนในวันหยุดสุดสัปดาห์ วันหยุดนักขัตฤกษ์ หรือวันที่ไม่มีใครลา' },
	'push.on': { en: 'Turn on', th: 'เปิด' },
	'push.nudge': { en: 'Get a notification at 09:00 on weekdays when someone is away.', th: 'รับการแจ้งเตือนเวลา 09:00 น. ในวันทำงานเมื่อมีคนลา' },
	'push.nudgeIos': { en: 'To get a notification at 09:00 when someone is away, add this site to your Home Screen.', th: 'หากต้องการรับการแจ้งเตือนเวลา 09:00 น. เมื่อมีคนลา ให้เพิ่มเว็บนี้ไปยังหน้าจอโฮม' },
	'push.how': { en: 'How', th: 'วิธีทำ' },
	'push.later': { en: 'Not now', th: 'ไว้ทีหลัง' },
	'push.off': { en: 'Turn off', th: 'ปิด' },
	'push.test': { en: 'Send a test', th: 'ส่งทดสอบ' },
	'push.ios': { en: 'On iPhone and iPad, notifications work only once this site is installed: tap Share, then Add to Home Screen, and turn them on from there.', th: 'บน iPhone และ iPad ต้องติดตั้งเว็บนี้ก่อนจึงจะแจ้งเตือนได้: แตะแชร์ แล้วเลือก "เพิ่มไปยังหน้าจอโฮม" แล้วจึงเปิดการแจ้งเตือนจากที่นั่น' },
	'push.stateOn': { en: 'On for this browser.', th: 'เปิดอยู่สำหรับเบราว์เซอร์นี้' },
	'push.stateOff': { en: 'Off for this browser.', th: 'ปิดอยู่สำหรับเบราว์เซอร์นี้' },
	'push.blocked': { en: 'Blocked. Notifications are switched off for this site in your browser settings.', th: 'ถูกบล็อก การแจ้งเตือนของเว็บนี้ถูกปิดไว้ในการตั้งค่าเบราว์เซอร์' },
	'push.unsupported': { en: 'This browser cannot show notifications.', th: 'เบราว์เซอร์นี้แสดงการแจ้งเตือนไม่ได้' },
	'push.tabOnly': { en: 'Not available in a Safari tab.', th: 'ใช้งานในแท็บ Safari ไม่ได้' },
	'push.asking': { en: 'Asking for permission…', th: 'กำลังขออนุญาต…' },
	'push.sending': { en: 'Sending…', th: 'กำลังส่ง…' },
	'push.sent': { en: 'Sent. It should appear in a moment.', th: 'ส่งแล้ว รอสักครู่จะปรากฏขึ้น' },
	'push.failed': { en: 'Could not send a test.', th: 'ส่งทดสอบไม่สำเร็จ' },
	'push.refused': { en: 'The server would not accept this subscription.', th: 'เซิร์ฟเวอร์ไม่รับการลงทะเบียนนี้' },
	'push.enableFailed': { en: 'Could not turn notifications on.', th: 'เปิดการแจ้งเตือนไม่สำเร็จ' },

	// --- edit page ------------------------------------------------------
	'edit.back': { en: 'Back', th: 'ย้อนกลับ' },
	'edit.statusNow': { en: 'On leave now, until {date}', th: 'กำลังลาอยู่ ถึง {date}' },
	'edit.statusTomorrow': { en: 'Tomorrow', th: 'พรุ่งนี้' },
	'edit.statusIn': { en: 'In {n} day|In {n} days', th: 'อีก {n} วัน' },
	'edit.statusPast': { en: 'Taken', th: 'ลาไปแล้ว' },
	'edit.factDays': { en: 'Days', th: 'จำนวนวัน' },
	'edit.factNote': { en: 'Note', th: 'หมายเหตุ' },
	'edit.factBalance': { en: 'Balance', th: 'สิทธิ์คงเหลือ' },
	'edit.factAway': { en: 'Also away', th: 'คนอื่นที่ลาด้วย' },
	'edit.balanceIn': { en: '{type}: {remaining} left in {year}', th: '{type}: เหลือ {remaining} วันในปี {year}' },
	'edit.balanceOver': { en: '{type}: {over} over in {year}', th: '{type}: เกินสิทธิ์ {over} วันในปี {year}' },
	'edit.pageTitle': { en: 'Booking', th: 'การลา' },
	'edit.noAllowance': { en: 'No allowance — not counted', th: 'ไม่มีสิทธิ์จำกัด ไม่นับวัน' },
	'edit.nobodyElse': { en: 'Nobody else', th: 'ไม่มีใคร' },
	'edit.awayOn': { en: '{name} ({dates})', th: '{name} (วันที่ {dates})' },
	'edit.noNote': { en: 'None', th: 'ไม่มี' },
	'edit.history': { en: 'History', th: 'ประวัติ' },
	'edit.edit': { en: 'Edit', th: 'แก้ไข' },
	'edit.removeAsk': { en: 'Remove…', th: 'ลบ…' },
	'edit.remove': { en: 'Remove', th: 'ลบ' },
	'edit.removeHelp': { en: 'Cancelling returns {days} day to the balance|Cancelling returns {days} days to the balance and takes the entry off the shared calendar. The record is kept, marked cancelled, rather than deleted.', th: 'การยกเลิกจะคืนโควตา {days} วัน และนำรายการออกจากปฏิทินส่วนกลาง ระบบจะเก็บประวัติไว้โดยทำเครื่องหมายว่ายกเลิก ไม่ได้ลบทิ้ง' },
	'edit.removeButton': { en: 'Remove this leave', th: 'ลบการลานี้' },
	'me.bookedBy': { en: 'Booked for you by {name}', th: '{name} แจ้งลาให้คุณ' },
	'me.changedBy': { en: 'Changed by {name}', th: '{name} แก้ไข' },
	'me.removedBy': { en: 'Removed by {name}', th: '{name} ยกเลิก' },
	'edit.byOtherCreated': { en: '{name} booked this for you · {when}', th: '{name} แจ้งลานี้ให้คุณ · {when}' },
	'edit.byOtherChanged': { en: 'Last changed by {name} · {when}', th: '{name} แก้ไขล่าสุด · {when}' },
	'edit.onBehalf': { en: 'You are looking at {name}\'s booking as an admin.', th: 'คุณกำลังดูการลาของ {name} ในฐานะผู้ดูแลระบบ' },
	'edit.days': { en: '{days} day|{days} days', th: '{days} วัน' },

	// --- per-person page --------------------------------------------------
	'user.leaveIn': { en: 'Leave in {year}', th: 'การลาในปี {year}' },
	'user.nothing': { en: 'Nothing booked.', th: 'ไม่มีการลา' },
	'nav.year': { en: 'Go to {year}', th: 'ไปที่ปี {year}' },

	// --- admin ------------------------------------------------------------
	'admin.title': { en: 'Admin', th: 'ผู้ดูแลระบบ' },
	'admin.people': { en: 'People', th: 'พนักงาน' },
	'admin.notifications': { en: 'Notifications', th: 'การแจ้งเตือน' },
	'admin.activity': { en: 'Activity', th: 'ประวัติการเปลี่ยนแปลง' },
	'admin.yearEnd': { en: 'Unused leave', th: 'วันลาคงเหลือ' },
	'admin.tileYearEnd': { en: '{n} days of {type} unbooked', th: '{type}ยังไม่ได้ใช้ {n} วัน' },
	'admin.yearEndHead': { en: '{type} leave not yet booked in {year}', th: '{type}ที่ยังไม่ได้แจ้งลาในปี {year}' },
	'admin.yearEndHelp': { en: 'Allowance less everything booked to start in {year}, taken or still ahead. This app carries nothing over into the next year.', th: 'สิทธิ์ลาหักด้วยการลาทั้งหมดที่เริ่มในปี {year} ทั้งที่ลาไปแล้วและที่จองไว้ ระบบนี้ไม่ยกยอดวันลาไปปีถัดไป' },
	'admin.yearEndTotal': { en: '{people} of {active} people have days left — {days} days in all.', th: 'มี {people} จาก {active} คนที่ยังมีวันลาเหลือ รวม {days} วัน' },
	'admin.yearEndNone': { en: 'Everyone has booked all of it.', th: 'ทุกคนแจ้งลาครบแล้ว' },
	'admin.yearEndNoType': { en: 'There is no annual leave type with an allowance, so there is nothing to report.', th: 'ไม่มีประเภทลาพักร้อนที่มีสิทธิ์ลา จึงไม่มีอะไรให้รายงาน' },
	'admin.allowance': { en: 'Allowance', th: 'สิทธิ์' },
	'admin.booked': { en: 'Booked', th: 'แจ้งแล้ว' },
	'admin.leftCol': { en: 'Left', th: 'คงเหลือ' },
	'admin.remindHead': { en: 'Reminder', th: 'การแจ้งเตือน' },
	'admin.remindPlanned': { en: 'Everyone with days left gets a notification on the first weekday of November, once. Only people with notifications on can be reached; tell the others yourself.', th: 'ทุกคนที่ยังมีวันลาเหลือจะได้รับการแจ้งเตือนในวันทำการแรกของเดือนพฤศจิกายน ครั้งเดียว เฉพาะคนที่เปิดการแจ้งเตือนไว้เท่านั้น คนอื่นกรุณาแจ้งเอง' },
	'admin.remindSent': { en: 'Sent on {date} — {n} person reached.|Sent on {date} — {n} people reached.', th: 'ส่งเมื่อ {date} ถึง {n} คน' },
	'admin.remindFailed': { en: 'Tried on {date}, and failed: {error}', th: 'พยายามส่งเมื่อ {date} แต่ไม่สำเร็จ: {error}' },
	'admin.remindEmpty': { en: 'Checked on {date}: nobody had days left.', th: 'ตรวจเมื่อ {date}: ไม่มีใครมีวันลาเหลือ' },
	'admin.remindNow': { en: 'Send now instead', th: 'ส่งตอนนี้เลย' },
	'admin.remindRetry': { en: 'Try again', th: 'ลองอีกครั้ง' },
	'admin.remindNowHelp': { en: 'Sends this year\'s reminder today. November\'s then does not go out.', th: 'ส่งการแจ้งเตือนของปีนี้วันนี้ แล้วจะไม่ส่งซ้ำในเดือนพฤศจิกายน' },
	'admin.remindOff': { en: 'Notifications are not set up on the server, so nobody can be reminded.', th: 'ยังไม่ได้ตั้งค่าการแจ้งเตือนบนเซิร์ฟเวอร์ จึงแจ้งเตือนใครไม่ได้' },
	'flash.remindSent': { en: 'Reminder sent to {n} person.|Reminder sent to {n} people.', th: 'ส่งการแจ้งเตือนถึง {n} คนแล้ว' },
	'flash.remindDone': { en: 'This year\'s reminder has already gone out.', th: 'ส่งการแจ้งเตือนของปีนี้ไปแล้ว' },
	'flash.remindEmpty': { en: 'Nobody has days left, so nothing was sent.', th: 'ไม่มีใครมีวันลาเหลือ จึงไม่ได้ส่ง' },
	'flash.remindOff': { en: 'Notifications are not set up on the server.', th: 'ยังไม่ได้ตั้งค่าการแจ้งเตือนบนเซิร์ฟเวอร์' },
	'flash.remindFailed': { en: 'The reminder could not be sent.', th: 'ส่งการแจ้งเตือนไม่สำเร็จ' },
	'admin.sections': { en: 'Admin sections', th: 'ส่วนต่าง ๆ ของผู้ดูแลระบบ' },
	'admin.awayToday': { en: 'Away today', th: 'ลาวันนี้' },
	'admin.nobody': { en: 'Nobody', th: 'ไม่มีใคร' },
	'admin.notifyOn': { en: 'Notifications on', th: 'เปิดการแจ้งเตือน' },
	'admin.ofPeople': { en: 'of {total}', th: 'จาก {total} คน' },
	'admin.notSetUp': { en: 'Not set up', th: 'ยังไม่ได้ตั้งค่า' },
	'admin.lastDigest': { en: '09:00 notification', th: 'แจ้งเตือน 09:00 น.' },
	'admin.digestToday': { en: 'Sent today', th: 'ส่งแล้ววันนี้' },
	'admin.digestFailedToday': { en: 'Failed today', th: 'ส่งไม่สำเร็จวันนี้' },
	'admin.digestLast': { en: 'Last sent {date}', th: 'ส่งล่าสุด {date}' },
	'admin.digestNone': { en: 'Not sent yet', th: 'ยังไม่เคยส่ง' },
	'admin.changesWeek': { en: 'Changes, 7 days', th: 'การเปลี่ยนแปลง 7 วัน' },
	'admin.tilePeople': { en: '{n} active, {count} admin|{n} active, {count} admins', th: 'ใช้งาน {n} คน ผู้ดูแล {count} คน' },
	'admin.tileTypes': { en: '{n} offered', th: 'เปิดให้เลือก {n} ประเภท' },
	'admin.tileTypesRetired': { en: '{n} offered, {retired} retired', th: 'เปิดให้เลือก {n} เลิกใช้ {retired}' },
	'admin.tileHolidays': { en: '{y1}: {n1} · {y2}: {n2}', th: 'ปี {y1}: {n1} วัน · ปี {y2}: {n2} วัน' },
	'admin.tileNotify': { en: 'Push {push} · LINE {line}', th: 'เบราว์เซอร์ {push} · LINE {line}' },
	'admin.on': { en: 'on', th: 'เปิด' },
	'admin.off': { en: 'off', th: 'ปิด' },
	'admin.tileExport': { en: 'A CSV for any range up to a year', th: 'ไฟล์ CSV ช่วงใดก็ได้ไม่เกินหนึ่งปี' },
	'admin.tileActivity': { en: '{n} change|{n} changes', th: '{n} รายการ' },
	'admin.allowances': { en: 'Allowances for {year}', th: 'วันลาปี {year}' },
	'admin.peopleHelp': { en: "Days used of the days allotted, per person, for {year}. An allowance nobody has set comes from the leave type's default, and is what the booking check enforces. Red is over the allowance.", th: 'จำนวนวันที่ใช้ไปจากวันลาที่ได้รับของแต่ละคนในปี {year} ค่าที่ยังไม่มีใครตั้งมาจากค่าเริ่มต้นของประเภทการลา และเป็นค่าที่ระบบใช้ตรวจตอนลา สีแดงคือเกินสิทธิ์' },
	'admin.usedOf': { en: '{used} of {allotted} days used', th: 'ใช้ไป {used} จาก {allotted} วัน' },
	'admin.usedOver': { en: '{used} of {allotted} days used, {over} over', th: 'ใช้ไป {used} จาก {allotted} วัน เกินสิทธิ์ {over} วัน' },
	'admin.usedOnly': { en: '{used} days taken, no allowance', th: 'ลาไป {used} วัน ไม่มีโควตา' },
	'admin.othersChanged': { en: "Changes others made to {name}'s leave", th: 'การเปลี่ยนแปลงที่ผู้อื่นทำกับการลาของ {name}' },
	'admin.othersChangedHelp': { en: 'Bookings an admin made, moved or removed for them — the latest {n}. Their own changes are not listed.', th: 'การลาที่ผู้ดูแลระบบสร้าง ย้าย หรือยกเลิกแทน — ล่าสุด {n} รายการ ไม่รวมที่เจ้าตัวแก้ไขเอง' },
	'admin.othersNone': { en: 'Nobody else has changed their leave.', th: 'ยังไม่มีผู้อื่นแก้ไขการลาของคนนี้' },
	'admin.othersAll': { en: 'Everything around them in Activity', th: 'ดูทั้งหมดในประวัติการเปลี่ยนแปลง' },
	'admin.setOneType': { en: 'Set one type for everyone', th: 'ตั้งค่าประเภทเดียวให้ทุกคน' },
	'admin.edit': { en: 'Edit', th: 'แก้ไข' },
	'admin.editPerson': { en: 'Edit {name}', th: 'แก้ไข {name}' },
	'admin.left': { en: 'Left', th: 'ลาออกแล้ว' },
	'admin.roleStatus': { en: 'Role and status', th: 'บทบาทและสถานะ' },
	'admin.activeHelp': { en: 'Untick when someone leaves: they drop off the calendar and the 09:00 notification, and their history stays.', th: 'เอาเครื่องหมายออกเมื่อพนักงานลาออก จะไม่แสดงในปฏิทินและการแจ้งเตือน 09:00 น. แต่ประวัติยังอยู่' },
	'admin.viewLeave': { en: 'See their leave', th: 'ดูวันลาของพนักงาน' },
	'admin.noAllowance': { en: 'Not counted — no allowance', th: 'ไม่นับ — ไม่มีสิทธิ์วันลา' },
	'admin.defaultDaysN': { en: '{n} days by default', th: 'ค่าเริ่มต้น {n} วัน' },
	'admin.cancel': { en: 'Cancel', th: 'ยกเลิก' },
	'admin.holidayCount': { en: '{n} holiday in {year}|{n} holidays in {year}', th: 'วันหยุดปี {year} {n} วัน' },
	'admin.holidaysNone': { en: 'No holidays entered for {year}.', th: 'ยังไม่มีวันหยุดของปี {year}' },
	'admin.notificationsHelp': { en: 'Sent at 09:00 Asia/Bangkok, Monday to Friday, when someone is away; a week-ahead one goes out on Monday mornings. Preview runs the real job without sending.', th: 'ส่งเวลา 09:00 น. ตามเวลาไทย วันจันทร์ถึงศุกร์ เมื่อมีคนลา และสรุปสัปดาห์ในเช้าวันจันทร์ การดูตัวอย่างใช้ระบบจริงแต่ไม่ส่ง' },
	'admin.pushChannel': { en: 'Browser push', th: 'แจ้งเตือนผ่านเบราว์เซอร์' },
	'admin.pushStatus': { en: '{n} of {total} people, on {browsers} browsers', th: '{n} จาก {total} คน บน {browsers} เบราว์เซอร์' },
	'admin.pushMissing': { en: 'Not set up on the server', th: 'ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์' },
	'admin.lineChannel': { en: 'LINE group', th: 'กลุ่ม LINE' },
	'admin.sendTitle': { en: 'Preview or send', th: 'ดูตัวอย่างหรือส่ง' },
	'flash.personSaved': { en: 'Saved {name}.', th: 'บันทึกข้อมูลของ {name} แล้ว' },
	'flash.unknownPerson': { en: 'Nobody by that address has signed in.', th: 'ยังไม่มีผู้ใช้อีเมลนี้เข้าสู่ระบบ' },
	'admin.days': { en: 'Days', th: 'จำนวนวัน' },
	'admin.setForEveryone': { en: 'Set for everyone (active)', th: 'ตั้งค่าให้ทุกคน (ที่ยังใช้งาน)' },
	'admin.person': { en: 'Person', th: 'พนักงาน' },
	'admin.isAdmin': { en: 'Admin', th: 'ผู้ดูแลระบบ' },
	'admin.isActive': { en: 'Active', th: 'ใช้งานอยู่' },
	'admin.save': { en: 'Save', th: 'บันทึก' },
	'admin.types': { en: 'Leave types', th: 'ประเภทการลา' },
	'admin.typesHelp': { en: 'Untick "Offered" to retire a type: it leaves the booking form, and bookings already made with it stay as they are. Only a type nobody has ever booked can be deleted. Default days seed each person\'s allowance for a year they have no quota row in yet; change existing allowances under People.', th: 'เอาเครื่องหมาย "เปิดให้เลือก" ออกเพื่อเลิกใช้ประเภทนั้น จะไม่แสดงในแบบฟอร์มการลาอีก แต่การลาที่บันทึกไว้แล้วยังอยู่เหมือนเดิม ลบได้เฉพาะประเภทที่ยังไม่เคยมีใครลา จำนวนวันเริ่มต้นใช้กำหนดสิทธิ์ของปีที่ยังไม่มีโควตา หากต้องการแก้สิทธิ์ที่มีอยู่แล้วให้แก้ที่ส่วนพนักงาน' },
	'admin.typeCode': { en: 'Code', th: 'รหัส' },
	'admin.typeCodeHelp': { en: 'Fixed once added — it names the type in the API.', th: 'แก้ไขไม่ได้หลังเพิ่ม เพราะใช้อ้างอิงใน API' },
	'admin.labelTh': { en: 'Thai name', th: 'ชื่อภาษาไทย' },
	'admin.labelEn': { en: 'English name', th: 'ชื่อภาษาอังกฤษ' },
	'admin.color': { en: 'Colour', th: 'สี' },
	'admin.defaultDays': { en: 'Default days', th: 'จำนวนวันเริ่มต้น' },
	'admin.order': { en: 'Order', th: 'ลำดับ' },
	'admin.countsQuota': { en: 'counts against an allowance', th: 'หักจากสิทธิ์วันลา' },
	'admin.offered': { en: 'Offered', th: 'เปิดให้เลือก' },
	'admin.retired': { en: 'Retired', th: 'เลิกใช้แล้ว' },
	'admin.holidaysDue': {
		en: '{year} has only its {have} fixed-date holidays so far. Add the announced Buddhist holidays, substitution days and company days, so nobody is charged leave on them.',
		th: 'ปี {year} มีเพียงวันหยุดประจำ {have} วัน เพิ่มวันหยุดทางพุทธศาสนา วันหยุดชดเชย และวันหยุดของบริษัทที่ประกาศแล้ว เพื่อไม่ให้ใครถูกหักวันลาในวันเหล่านั้น',
	},
	'admin.holidaysAdd': { en: 'Add holidays', th: 'เพิ่มวันหยุด' },
	'admin.bookings': { en: '{n} booking|{n} bookings', th: 'ลา {n} รายการ' },
	'admin.addType': { en: 'Add a leave type', th: 'เพิ่มประเภทการลา' },
	'admin.removeHolidayAsk': { en: 'Bookings over this day will cost a day more.', th: 'การลาที่คร่อมวันนี้จะนับเพิ่มอีกหนึ่งวัน' },
	'admin.removeHolidayButton': { en: 'Remove holiday', th: 'ลบวันหยุด' },
	'admin.deleteTypeAsk': { en: 'Nobody has booked it, so nothing else changes.', th: 'ยังไม่มีใครใช้ประเภทนี้ จึงไม่มีผลกับข้อมูลอื่น' },
	'admin.deleteTypeButton': { en: 'Delete type', th: 'ลบประเภท' },
	'admin.editType': { en: 'Edit {label}', th: 'แก้ไข{label}' },
	'admin.deleteType': { en: 'Delete {label}', th: 'ลบ {label}' },
	'admin.holidays': { en: 'Holidays', th: 'วันหยุด' },
	'admin.holidaysHelp': { en: 'Days that do not draw down anyone\'s quota. Thai lunar holidays and substitution days are announced yearly — add them here as they land.', th: 'วันที่ไม่หักโควตาของใคร วันหยุดตามจันทรคติและวันหยุดชดเชยของไทยประกาศเป็นรายปี เพิ่มได้ที่นี่เมื่อประกาศออกมา' },
	'admin.date': { en: 'Date', th: 'วันที่' },
	'admin.name': { en: 'Name', th: 'ชื่อ' },
	'admin.nameExample': { en: 'For example, Makha Bucha', th: 'เช่น วันมาฆบูชา' },
	'admin.add': { en: 'Add', th: 'เพิ่ม' },
	'admin.import': { en: 'Import a list', th: 'นำเข้าเป็นรายการ' },
	'admin.importHelp': { en: 'One per line: a date, then a name. Commas and tabs work too, so a column pasted from a spreadsheet is fine. Lines starting with # are ignored. Nothing is written unless every line reads correctly.', th: 'บรรทัดละหนึ่งวัน: วันที่ตามด้วยชื่อ ใช้เครื่องหมายจุลภาคหรือแท็บก็ได้ จึงวางจากสเปรดชีตได้เลย บรรทัดที่ขึ้นต้นด้วย # จะถูกข้าม ระบบจะไม่บันทึกอะไรเลยหากมีบรรทัดใดอ่านไม่ได้' },
	'admin.previewButton': { en: 'Preview', th: 'ดูตัวอย่าง' },
	'admin.previewTitle': { en: 'Check before importing', th: 'ตรวจสอบก่อนนำเข้า' },
	'admin.previewErrors': { en: 'Fix these lines first — nothing is imported while any line cannot be read:', th: 'แก้บรรทัดเหล่านี้ก่อน — ระบบจะไม่นำเข้าหากยังมีบรรทัดที่อ่านไม่ได้:' },
	'admin.previewLine': { en: 'Line {line}:', th: 'บรรทัด {line}:' },
	'admin.previewNew': { en: 'new', th: 'ใหม่' },
	'admin.previewRenamed': { en: 'renames “{was}”', th: 'เปลี่ยนชื่อจาก “{was}”' },
	'admin.previewSame': { en: 'already there', th: 'มีอยู่แล้ว' },
	'admin.previewBookings': { en: 'Bookings on these days', th: 'การลาในวันเหล่านี้' },
	'admin.previewNoBookings': { en: 'Nobody has leave booked on a new holiday, so nobody’s balance changes.', th: 'ไม่มีใครลาตรงกับวันหยุดใหม่ ยอดวันลาของทุกคนจึงไม่เปลี่ยน' },
	'admin.previewAffected': { en: 'These were booked before the holiday existed and were charged for it. Importing can recount them for you, or leave them for you to open one by one.', th: 'รายการเหล่านี้ลาไว้ก่อนที่จะมีวันหยุดนี้ จึงถูกหักวันไปแล้ว การนำเข้าสามารถคำนวณใหม่ให้ หรือปล่อยไว้ให้คุณเปิดแก้ทีละรายการ' },
	'admin.previewRecount': { en: 'Also recount {n} booking|Also recount these {n} bookings', th: 'คำนวณวันลาใหม่ให้ {n} รายการนี้ด้วย' },
	'admin.previewCharged': { en: '{n} day charged|{n} days charged', th: 'ถูกหัก {n} วัน' },
	'admin.previewImport': { en: 'Import {n} holiday|Import {n} holidays', th: 'นำเข้า {n} วัน' },
	'admin.previewNothing': { en: 'Every line is already there — nothing to import.', th: 'ทุกบรรทัดมีอยู่แล้ว — ไม่มีอะไรต้องนำเข้า' },
	'admin.previewAgain': { en: 'Preview again', th: 'ดูตัวอย่างอีกครั้ง' },
	'admin.previewCancel': { en: 'Back to holidays', th: 'กลับไปหน้าวันหยุด' },
	'admin.removeHoliday': { en: 'Remove {label} on {date}', th: 'ลบ {label} วันที่ {date}' },
	'admin.channelToken': { en: 'Channel token', th: 'โทเคนของแชนแนล' },
	'admin.group': { en: 'Group', th: 'กลุ่ม' },
	'admin.tokenSet': { en: 'Set', th: 'ตั้งค่าแล้ว' },
	'admin.tokenMissing': { en: 'Not set up on the server', th: 'ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์' },
	'admin.groupMissing': { en: 'Not known yet — add the LINE bot to the group, then post any message there', th: 'ยังไม่ทราบ — เพิ่มบอท LINE เข้ากลุ่ม แล้วส่งข้อความใดก็ได้ในกลุ่ม' },
	'admin.setupHow': { en: 'How to set it up', th: 'วิธีตั้งค่า' },
	'admin.setupPush': { en: 'Push needs a VAPID key pair on the server: npm run vapid, then wrangler secret put VAPID_PRIVATE_KEY and set VAPID_PUBLIC_KEY.', th: 'การแจ้งเตือนต้องมีคู่คีย์ VAPID บนเซิร์ฟเวอร์: npm run vapid แล้ว wrangler secret put VAPID_PRIVATE_KEY และตั้งค่า VAPID_PUBLIC_KEY' },
	'admin.setupLine': { en: 'LINE needs its channel token on the server (wrangler secret put LINE_CHANNEL_ACCESS_TOKEN) and LINE_ENABLED set to "1".', th: 'LINE ต้องมีโทเคนของช่องทางบนเซิร์ฟเวอร์ (wrangler secret put LINE_CHANNEL_ACCESS_TOKEN) และตั้งค่า LINE_ENABLED เป็น "1"' },
	'admin.weekAhead': { en: 'Week ahead', th: 'สัปดาห์ถัดไป' },
	'admin.resend': { en: 'Resend if already sent', th: 'ส่งซ้ำแม้เคยส่งแล้ว' },
	'admin.preview': { en: 'Preview', th: 'ดูตัวอย่าง' },
	'admin.sendNow': { en: 'Send now', th: 'ส่งเดี๋ยวนี้' },
	'admin.lineDisabled': { en: 'LINE is switched off, so a send reaches browser subscribers only.', th: 'ปิดการแจ้งเตือนผ่าน LINE ไว้ การส่งจึงถึงเฉพาะผู้ที่เปิดแจ้งเตือนในเบราว์เซอร์' },
	'admin.lineIncomplete': { en: 'LINE is not fully set up, so a send reaches browser subscribers only. The daily post goes out at 09:00 Asia/Bangkok, Monday to Friday; the week-ahead one on Monday mornings.', th: 'ยังตั้งค่า LINE ไม่ครบ การส่งจึงถึงเฉพาะผู้ที่เปิดแจ้งเตือนในเบราว์เซอร์ การแจ้งประจำวันส่งเวลา 09:00 น. วันจันทร์ถึงศุกร์ ส่วนสรุปสัปดาห์ส่งเช้าวันจันทร์' },
	'admin.recentRuns': { en: 'Recent runs', th: 'การส่งล่าสุด' },
	'admin.nothingYet': { en: 'Nothing yet.', th: 'ยังไม่มีข้อมูล' },
	'admin.out': { en: '{n} out', th: 'ลา {n} คน' },
	'admin.auditHelp': { en: 'Every booking created, edited or cancelled, and by whom. Notes are recorded as present or absent, never copied here.', th: 'ทุกการเพิ่ม แก้ไข และยกเลิกการลา พร้อมผู้ที่ทำ ระบบบันทึกเพียงว่ามีหมายเหตุหรือไม่ ไม่ได้คัดลอกข้อความหมายเหตุมาเก็บไว้' },
	'audit.created': { en: 'Created', th: 'สร้าง' },
	'audit.edited': { en: 'Edited', th: 'แก้ไข' },
	'audit.cancelled': { en: 'Cancelled', th: 'ยกเลิก' },
	'audit.restored': { en: 'Restored', th: 'กู้คืน' },
	'audit.typeChanged': { en: 'leave type changed', th: 'เปลี่ยนประเภทการลา' },
	'audit.noteAdded': { en: 'note added', th: 'เพิ่มหมายเหตุ' },
	'audit.noteRemoved': { en: 'note removed', th: 'ลบหมายเหตุ' },
	'audit.notePrivate': { en: 'note made private', th: 'ตั้งหมายเหตุเป็นส่วนตัว' },
	'audit.noteShared': { en: 'note shared', th: 'แชร์หมายเหตุ' },
	'audit.noChange': { en: 'no visible change', th: 'ไม่มีการเปลี่ยนแปลงที่เห็นได้' },
	'audit.onBehalf': { en: "{actor} → {subject}'s booking", th: '{actor} → การลาของ {subject}' },

	// --- telling a booking's owner what someone else did to it ------------
	// A push in the owner's own language, unlike the digest: it is one message
	// to one person.
	'notice.created': { en: '{actor} booked leave for you', th: '{actor} แจ้งลาให้คุณ' },
	'notice.edited': { en: '{actor} changed your leave', th: '{actor} แก้ไขการลาของคุณ' },
	'notice.cancelled': { en: '{actor} removed your leave', th: '{actor} ยกเลิกการลาของคุณ' },
	'notice.restored': { en: '{actor} put your leave back', th: '{actor} กู้คืนการลาของคุณ' },
	'notice.yearEnd': { en: '{days} day of {type} leave left in {year}|{days} days of {type} leave left in {year}', th: '{type}เหลือ {days} วันในปี {year}' },
	'notice.yearEndBody': { en: 'Book them before the year ends.', th: 'อย่าลืมแจ้งลาก่อนสิ้นปี' },

	// --- flashes and validation -------------------------------------------
	// {type} is the English leave-type name and {typeTh} the Thai one; each
	// language picks the label that belongs with the rest of its sentence.
	'flash.booked': { en: 'Booked {days} day of {type} leave.|Booked {days} days of {type} leave.', th: 'บันทึก{typeTh} {days} วันแล้ว' },
	'flash.updated': { en: 'Updated to {days} day of {type} leave.|Updated to {days} days of {type} leave.', th: 'แก้ไขเป็น{typeTh} {days} วันแล้ว' },
	'flash.cancelled': { en: 'Booking cancelled.', th: 'ยกเลิกการลาแล้ว' },
	'flash.alreadyCancelled': { en: 'That booking was already cancelled.', th: 'การลานี้ถูกยกเลิกไปแล้ว' },
	'flash.undo': { en: 'Undo', th: 'เลิกทำ' },
	'flash.restored': { en: 'Booking restored.', th: 'กู้คืนการลาแล้ว' },
	'flash.undone': { en: 'Change undone.', th: 'เลิกทำการเปลี่ยนแปลงแล้ว' },
	'flash.nothingToUndo': { en: 'There is nothing to undo on that booking.', th: 'ไม่มีการเปลี่ยนแปลงให้เลิกทำในการลานี้' },
	'flash.undoExpired': { en: 'That change is too old to undo — edit the booking instead.', th: 'การเปลี่ยนแปลงนี้เก่าเกินกว่าจะเลิกทำได้ กรุณาแก้ไขการลาแทน' },
	'flash.cancelledRebook': { en: 'That booking is cancelled. Book it again instead of editing it.', th: 'การลานี้ถูกยกเลิกแล้ว กรุณาแจ้งลาใหม่แทนการแก้ไข' },
	'flash.cancelledNoEdit': { en: 'That booking is cancelled and cannot be edited.', th: 'การลานี้ถูกยกเลิกแล้ว จึงแก้ไขไม่ได้' },
	'flash.gone': { en: 'That booking no longer exists.', th: 'ไม่พบการลานี้แล้ว' },
	'err.notFound': { en: 'Not found', th: 'ไม่พบหน้านี้' },
	'err.notFoundDetail': { en: 'No such page.', th: 'ไม่มีหน้านี้' },
	'err.adminsOnly': { en: 'Admins only', th: 'เฉพาะผู้ดูแลระบบ' },
	'err.adminsOnlyDetail': { en: 'Ask an admin to grant you access.', th: 'กรุณาขอสิทธิ์จากผู้ดูแลระบบ' },
	'err.server': { en: 'Something went wrong', th: 'เกิดข้อผิดพลาด' },
	'err.serverDetail': { en: 'The server hit an error. Try again shortly; if it keeps happening, tell an admin.', th: 'เซิร์ฟเวอร์เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง หากยังเกิดซ้ำ กรุณาแจ้งผู้ดูแลระบบ' },
	'err.home': { en: 'Go to the calendar', th: 'ไปที่ปฏิทิน' },
	'flash.notYours': { en: 'That is not your booking.', th: 'นี่ไม่ใช่การลาของคุณ' },
	'flash.bookedFor': { en: 'Booked {days} day of {type} leave for {name}.|Booked {days} days of {type} leave for {name}.', th: 'บันทึก{typeTh}ให้ {name} {days} วันแล้ว' },
	'flash.forAdminsOnly': { en: 'Only an admin can book leave for someone else.', th: 'เฉพาะผู้ดูแลระบบเท่านั้นที่แจ้งลาให้ผู้อื่นได้' },
	'flash.forUnknown': { en: 'Pick someone from the list.', th: 'กรุณาเลือกคนจากรายการ' },
	'flash.cancelledWhileEditing': { en: 'That booking was cancelled while you were editing it.', th: 'การลานี้ถูกยกเลิกระหว่างที่คุณกำลังแก้ไข' },
	'flash.nameUpdated': { en: 'Name updated.', th: 'อัปเดตชื่อแล้ว' },
	'flash.nameEmpty': { en: 'Display name cannot be empty.', th: 'ชื่อที่แสดงต้องไม่ว่าง' },
	'flash.langUpdated': { en: 'Language updated.', th: 'เปลี่ยนภาษาแล้ว' },
	'flash.langBad': { en: 'Pick a language that is offered.', th: 'กรุณาเลือกภาษาที่มีให้' },
	'flash.weekMonday': { en: 'Weeks now start on Monday.', th: 'สัปดาห์เริ่มต้นวันจันทร์แล้ว' },
	'flash.weekSunday': { en: 'Weeks now start on Sunday.', th: 'สัปดาห์เริ่มต้นวันอาทิตย์แล้ว' },
	'flash.weekBad': { en: 'Pick either Monday or Sunday.', th: 'กรุณาเลือกวันจันทร์หรือวันอาทิตย์' },

	'flash.badRequest': { en: 'Bad request.', th: 'คำขอไม่ถูกต้อง' },
	'flash.badDate': { en: 'Bad date.', th: 'วันที่ไม่ถูกต้อง' },
	'flash.daysRange': { en: 'Days must be between 0 and 365.', th: 'จำนวนวันต้องอยู่ระหว่าง 0 ถึง 365' },
	'flash.unknownType': { en: 'Unknown leave type.', th: 'ไม่พบประเภทการลานี้' },
	'flash.typeBadCode': { en: 'The code must be 2–24 lowercase letters, digits or _, starting with a letter.', th: 'รหัสต้องเป็นตัวอักษรภาษาอังกฤษพิมพ์เล็ก ตัวเลข หรือ _ ยาว 2–24 ตัว และขึ้นต้นด้วยตัวอักษร' },
	'flash.typeBadLabel': { en: 'Both names are required, up to {max} characters each.', th: 'ต้องกรอกชื่อทั้งสองภาษา ไม่เกิน {max} ตัวอักษร' },
	'flash.typeBadColor': { en: 'Pick a colour.', th: 'กรุณาเลือกสี' },
	'flash.typeBadOrder': { en: 'Order must be a whole number from 0 to 999.', th: 'ลำดับต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 999' },
	'flash.typeCodeTaken': { en: 'The code {code} is already used.', th: 'รหัส {code} ถูกใช้แล้ว' },
	'flash.typeAdded': { en: 'Added {label}.', th: 'เพิ่ม {label} แล้ว' },
	'flash.typeSaved': { en: 'Saved {label}.', th: 'บันทึก {label} แล้ว' },
	'flash.typeLastActive': { en: 'At least one leave type has to stay offered.', th: 'ต้องเปิดใช้ประเภทการลาไว้อย่างน้อยหนึ่งประเภท' },
	'flash.typeDeleted': { en: 'Deleted {label}.', th: 'ลบ {label} แล้ว' },
	'flash.typeInUse': { en: '{label} has bookings, so it cannot be deleted without hiding them. Retire it instead: untick "Offered".', th: '{label} มีการลาที่บันทึกไว้แล้ว หากลบจะทำให้รายการเหล่านั้นหายไป ให้เลิกใช้แทนโดยเอาเครื่องหมายที่ "เปิดให้เลือก" ออก' },
	'flash.onlyAdmin': { en: 'You are the only admin — promote someone else first.', th: 'คุณเป็นผู้ดูแลระบบคนเดียว กรุณาตั้งผู้ดูแลระบบคนอื่นก่อน' },
	'flash.quotasBulk': { en: 'Set quota for {n} active user.|Set quota for {n} active users.', th: 'ตั้งโควตาให้ผู้ใช้งาน {n} คนแล้ว' },
	'flash.wouldPost': { en: 'Would post about {n} person.|Would post about {n} people.', th: 'จะแจ้งเตือนเกี่ยวกับ {n} คน' },
	'flash.wouldNotPost': { en: 'Would not post: {reason}.', th: 'จะไม่แจ้งเตือน: {reason}' },
	'flash.pushTitle': { en: 'Notification title: {title}', th: 'หัวข้อการแจ้งเตือน: {title}' },
	'flash.sentTo': { en: 'Sent to {channels} about {n} person.|Sent to {channels} about {n} people.', th: 'ส่งไปยัง {channels} เกี่ยวกับ {n} คน' },
	'flash.sendFailed': { en: 'Send failed — {error}', th: 'ส่งไม่สำเร็จ — {error}' },
	'flash.nothingSent': { en: 'Nothing sent: {reason}.', th: 'ไม่ได้ส่ง: {reason}' },
	'flash.nothingToImport': { en: 'Nothing to import.', th: 'ไม่มีข้อมูลให้นำเข้า' },
	'flash.importFailed': { en: 'Nothing was imported.', th: 'ไม่ได้นำเข้าข้อมูลใดเลย' },
	'flash.importEmpty': { en: 'No holidays found in that list.', th: 'ไม่พบวันหยุดในรายการนั้น' },
	'flash.exportOrder': { en: 'The export’s start date is after its end date.', th: 'วันเริ่มต้นของการส่งออกอยู่หลังวันสิ้นสุด' },
	'flash.exportTooLong': { en: 'An export can cover at most {n} days.', th: 'ส่งออกได้ไม่เกิน {n} วัน' },
	'admin.pushOn': { en: 'Notifications on · {n} browser|Notifications on · {n} browsers', th: 'เปิดการแจ้งเตือน · {n} เบราว์เซอร์' },
	'admin.pushOff': { en: 'Notifications off', th: 'ไม่ได้เปิดการแจ้งเตือน' },
	'admin.auditWho': { en: 'Person', th: 'บุคคล' },
	'admin.auditAnyone': { en: 'Anyone', th: 'ทุกคน' },
	'admin.auditAction': { en: 'Action', th: 'การกระทำ' },
	'admin.auditAnyAction': { en: 'Any action', th: 'ทุกการกระทำ' },
	'admin.auditFilter': { en: 'Filter', th: 'กรอง' },
	'admin.auditClear': { en: 'Clear', th: 'ล้าง' },
	'admin.auditNone': { en: 'No changes match.', th: 'ไม่พบรายการที่ตรงกัน' },
	'admin.auditNewer': { en: 'Newer', th: 'ใหม่กว่า' },
	'admin.auditOlder': { en: 'Older', th: 'เก่ากว่า' },
	'admin.auditPage': { en: 'Page {n}', th: 'หน้า {n}' },
	'admin.export': { en: 'Export for HR', th: 'ส่งออกให้ฝ่ายบุคคล' },
	'admin.exportHelp': { en: 'A spreadsheet of the leave between two dates. A booking that crosses an edge is counted only for its days inside. People who have left are included; notes never are.', th: 'ไฟล์สเปรดชีตของการลาระหว่างสองวันที่ การลาที่คร่อมขอบช่วงจะนับเฉพาะวันที่อยู่ในช่วง รวมพนักงานที่ลาออกแล้ว แต่ไม่รวมบันทึกใด ๆ' },
	'admin.exportFrom': { en: 'From', th: 'ตั้งแต่' },
	'admin.exportTo': { en: 'To', th: 'ถึง' },
	'admin.exportKind': { en: 'Rows', th: 'แถว' },
	'admin.exportSummary': { en: 'One per person per leave type', th: 'หนึ่งแถวต่อคนต่อประเภทการลา' },
	'admin.exportBookings': { en: 'One per booking', th: 'หนึ่งแถวต่อการลาแต่ละครั้ง' },
	'admin.exportButton': { en: 'Download CSV', th: 'ดาวน์โหลด CSV' },
	'flash.recounted': { en: 'Recounted {n} booking that crossed a new holiday.|Recounted {n} bookings that crossed a new holiday.', th: 'คำนวณวันลาใหม่ {n} รายการที่ตรงกับวันหยุดใหม่' },
	'flash.imported': { en: 'Imported {n} holiday, {from} to {to}.|Imported {n} holidays, {from} to {to}.', th: 'นำเข้าวันหยุด {n} วัน ตั้งแต่ {from} ถึง {to}' },
	'flash.holidayNeedsBoth': { en: 'Need a valid date and a label.', th: 'ต้องระบุวันที่และชื่อให้ถูกต้อง' },
	'flash.holidayAdded': { en: 'Added {date}.', th: 'เพิ่ม {date} แล้ว' },
	'flash.holidayRemoved': { en: 'Removed {date}.', th: 'ลบ {date} แล้ว' },
	'flash.line': { en: 'LINE', th: 'LINE' },
	'flash.browsers': { en: '{n} browser|{n} browsers', th: 'เบราว์เซอร์ {n} เครื่อง' },

	'status.sent': { en: 'sent', th: 'ส่งแล้ว' },
	'status.skipped_empty': { en: 'nobody is out', th: 'ไม่มีใครลา' },
	'status.skipped_holiday': { en: 'a public holiday', th: 'เป็นวันหยุดนักขัตฤกษ์' },
	'status.skipped_weekend': { en: 'a weekend', th: 'เป็นวันหยุดสุดสัปดาห์' },
	'status.skipped_not_monday': { en: 'not a Monday', th: 'ไม่ใช่วันจันทร์' },
	'status.skipped_duplicate': { en: 'already sent for that day', th: 'ส่งไปแล้วสำหรับวันนั้น' },
	'status.disabled': { en: 'the channel is switched off', th: 'ช่องทางนี้ถูกปิดไว้' },
	'status.not_configured': { en: 'no channel is configured', th: 'ยังไม่ได้ตั้งค่าช่องทางแจ้งเตือน' },
	'status.no_subscribers': { en: 'nobody has subscribed', th: 'ยังไม่มีใครเปิดรับการแจ้งเตือน' },
	'status.dry_run': { en: 'preview only', th: 'ดูตัวอย่างเท่านั้น' },
	'status.failed': { en: 'the send failed', th: 'ส่งไม่สำเร็จ' },

	'error.pickType': { en: 'Pick a leave type.', th: 'กรุณาเลือกประเภทการลา' },
	'error.badStart': { en: 'Start date is not a valid date.', th: 'วันที่เริ่มต้นไม่ถูกต้อง' },
	'error.badEnd': { en: 'End date is not a valid date.', th: 'วันที่สิ้นสุดไม่ถูกต้อง' },
	'error.badHalf': { en: 'Half-day value must be full, am, or pm.', th: 'ค่าครึ่งวันต้องเป็น full, am หรือ pm เท่านั้น' },
	'error.unknownType': { en: 'Unknown leave type.', th: 'ไม่พบประเภทการลานี้' },
	'error.retiredType': { en: 'That leave type is no longer offered. Pick another.', th: 'ประเภทการลานี้เลิกใช้แล้ว กรุณาเลือกประเภทอื่น' },
	'error.endBeforeStart': { en: 'The end date is before the start date.', th: 'วันที่สิ้นสุดอยู่ก่อนวันที่เริ่มต้น' },
	'error.tooLong': { en: 'That range is longer than a year.', th: 'ช่วงวันลายาวเกินหนึ่งปี' },
	'error.notAWorkingDay': { en: 'That day is a weekend or a public holiday.', th: 'วันนั้นเป็นวันหยุดสุดสัปดาห์หรือวันหยุดนักขัตฤกษ์' },
	'error.noWorkingDays': { en: 'That range has no working days in it.', th: 'ช่วงวันที่เลือกไม่มีวันทำงานเลย' },
	'error.halfOnMultiDay': { en: 'A multi-day booking cannot start in the morning only or end in the afternoon only.', th: 'การลาหลายวันไม่สามารถเริ่มเฉพาะเช้าหรือสิ้นสุดเฉพาะบ่ายได้' },
	'error.tooFarBack': { en: 'That start date is more than {days} days in the past. Ask an admin to add it.', th: 'วันที่เริ่มต้นย้อนหลังเกิน {days} วัน กรุณาแจ้งผู้ดูแลระบบ' },
	'error.tooFarAhead': { en: 'That end date is too far in the future — check the year.', th: 'วันที่สิ้นสุดอยู่ไกลเกินไป กรุณาตรวจสอบปี' },
	'error.overlap': { en: 'You already have leave booked over {start} – {end}.', th: 'คุณมีการลาอยู่แล้วในช่วง {start} – {end}' },
	'error.noneLeft': { en: 'No {type} leave left for {year}.', th: 'ไม่เหลือโควตา{typeTh}สำหรับปี {year} แล้ว' },
	'error.notEnough': { en: 'Not enough {type} leave left: {days} day requested, {left} remaining.|Not enough {type} leave left: {days} days requested, {left} remaining.', th: 'โควตา{typeTh}ไม่พอ: ขอ {days} วัน เหลือ {left} วัน' },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

/**
 * A message the domain can return without knowing who will read it.
 *
 * Validation happens in pure functions that have no idea which language the
 * request came in on, so they name the message and supply its numbers; the
 * route renders it at the edge, where the reader is known.
 */
export interface Message {
	key: StringKey;
	vars?: Record<string, string | number>;
}

export const msg = (key: StringKey, vars?: Record<string, string | number>): Message => ({ key, vars });

/**
 * Look up one string.
 *
 * Placeholders are `{name}` and are replaced by key, so a translation may
 * reorder them — Thai often puts the number after the noun where English puts
 * it before.
 *
 * A value may carry two forms separated by a pipe, singular first:
 *
 *     '{days} day|{days} days'
 *
 * The caller passes `count` to choose between them. Thai has no plural, so its
 * side of these entries is a single form and the pipe simply never appears —
 * which is the point of doing it per language rather than in the call site.
 * A pipe with no `count` falls back to the plural, the safer default for a
 * number that is usually not one.
 */
export function tm(lang: Lang, m: Message): string {
	return t(lang, m.key, m.vars);
}

export function t(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
	const entry = STRINGS[key] as Entry | undefined;
	// A key assembled at runtime — `audit.${action}` — could name a row written
	// by an older version of this app. Showing the key is ugly; throwing takes
	// the whole page down for one unrecognised word.
	if (!entry) return String(key);
	let text = entry[lang] ?? entry.en;
	if (text.includes('|')) {
		const [one, many] = text.split('|');
		text = vars?.count === 1 ? one : many;
	}
	if (vars) {
		for (const [name, value] of Object.entries(vars)) {
			// split/join rather than replaceAll: this module is reachable from the
			// browser bundle's type graph, which targets ES2020.
			text = text.split(`{${name}}`).join(String(value));
		}
	}
	return text;
}

/**
 * Look up one string's raw value, pipe and placeholders untouched.
 *
 * A template that crosses into the browser — handed to client-side JS as a
 * `data-*` attribute for it to fill in itself — has to keep both the singular
 * and the plural side, because the count it will choose between is only known
 * once the page is live, not at render time. Collapsing the pipe here, the way
 * `t()` does, would bake in a choice before the client ever sees the number.
 */
export function tRaw(lang: Lang, key: StringKey): string {
	const entry = STRINGS[key] as Entry | undefined;
	if (!entry) return String(key);
	return entry[lang] ?? entry.en;
}
