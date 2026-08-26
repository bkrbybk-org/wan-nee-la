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
	'cal.hint': { en: 'Click any day to book it, or an entry to open it.', th: 'คลิกวันที่ใดก็ได้เพื่อแจ้งลา หรือคลิกรายการเพื่อดูรายละเอียด' },
	'cal.bookOnShort': { en: 'Book leave — {date}', th: 'แจ้งลา — {date}' },
	'cal.months': { en: 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec', th: 'ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.' },
	'cal.seeDay': { en: 'See who is out on {date}', th: 'ดูว่าใครลาวันที่ {date}' },
	'cal.dayCount': { en: '{n} away', th: 'ลา {n} คน' },
	'cal.bookOn': { en: 'Book leave on {date}', th: 'แจ้งลาวันที่ {date}' },
	'cal.upcoming': { en: 'Upcoming', th: 'ที่กำลังจะถึง' },
	'cal.nothingUpcoming': { en: 'Nothing booked in the next {days} days.', th: 'ไม่มีการลาใน {days} วันข้างหน้า' },
	'cal.more': { en: '+{n} more', th: 'อีก {n}' },
	'cal.whoIsOut': { en: 'Who is out', th: 'ใครลาบ้าง' },
	'cal.outToday': { en: 'Out today', th: 'ลาวันนี้' },
	'cal.nobodyToday': { en: 'Nobody is out today.', th: 'วันนี้ไม่มีใครลา' },
	'cal.next7': { en: 'Next 7 days', th: '7 วันข้างหน้า' },
	'cal.nobodyWeek': { en: 'Nobody else is out in the next 7 days.', th: 'ไม่มีคนอื่นลาใน 7 วันข้างหน้า' },
	// Used when today's list is empty too, where "nobody *else*" has nothing to
	// be else to.
	'cal.nobodyAtAll': { en: 'Nobody is out today or in the next 7 days.', th: 'วันนี้และอีก 7 วันข้างหน้าไม่มีใครลา' },
	'cal.byDay': { en: 'Leave by day', th: 'วันลาแยกตามวัน' },
	'cal.emptyMonth': { en: 'Nobody is on leave this month.', th: 'เดือนนี้ไม่มีใครลา' },
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
	'book.from': { en: 'From', th: 'ตั้งแต่' },
	'book.to': { en: 'To', th: 'ถึง' },
	'book.toHelp': { en: 'Leave blank for a single day', th: 'เว้นว่างไว้หากลาวันเดียว' },
	'book.startHalf': { en: 'Start half', th: 'ครึ่งวันแรก' },
	'book.endHalf': { en: 'End half', th: 'ครึ่งวันสุดท้าย' },
	'book.fullDay': { en: 'Full day', th: 'เต็มวัน' },
	'book.am': { en: 'Morning only', th: 'เฉพาะเช้า' },
	'book.pm': { en: 'Afternoon only', th: 'เฉพาะบ่าย' },
	'book.note': { en: 'Note (optional)', th: 'หมายเหตุ (ไม่บังคับ)' },
	'book.shareNote': { en: 'Share this note with the team', th: 'ให้ทุกคนเห็นหมายเหตุนี้' },
	'book.noteHelp': { en: 'Unshared notes are visible only to you and to admins. Either way, the dates and leave type are on the shared calendar.', th: 'หากไม่แชร์ จะเห็นเฉพาะคุณและผู้ดูแลระบบ ไม่ว่ากรณีใด วันที่และประเภทการลาจะแสดงบนปฏิทินส่วนกลางเสมอ' },
	'book.submit': { en: 'Book leave', th: 'แจ้งลา' },
	'book.save': { en: 'Save changes', th: 'บันทึกการแก้ไข' },
	'book.discard': { en: 'Discard changes', th: 'ยกเลิกการแก้ไข' },
	'book.days': { en: '= {days} day|= {days} days', th: 'รวม {days} วัน' },
	'book.pageTitle': { en: 'Book leave', th: 'แจ้งลา' },
	'book.back': { en: 'Back to calendar', th: 'กลับไปที่ปฏิทิน' },
	'book.coverage': { en: '{out} of {headcount} away on {date}: {names}.', th: 'วันที่ {date} จะมีคนลา {out} จาก {headcount} คน: {names}' },
	'book.coverageMore': { en: '{names} and {more} more', th: '{names} และอีก {more} คน' },

	// --- my leave -------------------------------------------------------
	'me.title': { en: 'My leave', th: 'การลาของฉัน' },
	'me.daysLeft': { en: 'day left|days left', th: 'วันคงเหลือ' },
	'me.daysTaken': { en: 'day taken|days taken', th: 'วันที่ใช้ไป' },
	'me.noAllowance': { en: 'No annual allowance', th: 'ไม่มีโควตาประจำปี' },
	'me.usedOf': { en: '{used} used of {allotted}', th: 'ใช้ไป {used} จาก {allotted}' },
	'me.meterLabel': { en: '{used} of {allotted} days used', th: 'ใช้ไป {used} จาก {allotted} วัน' },
	'me.upcoming': { en: 'Upcoming', th: 'ที่กำลังจะถึง' },
	'me.nothingBooked': { en: 'Nothing booked.', th: 'ยังไม่มีการลา' },
	'me.earlier': { en: 'Earlier this year', th: 'ก่อนหน้านี้ในปีนี้' },
	'me.nothingYet': { en: 'Nothing yet.', th: 'ยังไม่มีข้อมูล' },
	'me.cancelled': { en: 'cancelled', th: 'ยกเลิกแล้ว' },
	'me.editOn': { en: 'Edit leave on {when}', th: 'แก้ไขการลา {when}' },
	'me.removeOn': { en: 'Remove leave on {when}', th: 'ลบการลา {when}' },
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
	'push.help': { en: 'One notification each working morning at 08:00, listing who is out that day. Nothing is sent on weekends, public holidays, or days when nobody is away.', th: 'แจ้งเตือนทุกเช้าวันทำงานเวลา 08:00 น. ว่าวันนั้นใครลาบ้าง จะไม่แจ้งเตือนในวันหยุดสุดสัปดาห์ วันหยุดนักขัตฤกษ์ หรือวันที่ไม่มีใครลา' },
	'push.on': { en: 'Turn on', th: 'เปิด' },
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
	'edit.title': { en: 'Edit leave', th: 'แก้ไขการลา' },
	'edit.back': { en: 'Back to my leave', th: 'กลับไปที่การลาของฉัน' },
	'edit.current': { en: 'Currently booked', th: 'ที่บันทึกไว้ตอนนี้' },
	'edit.change': { en: 'Change it', th: 'แก้ไข' },
	'edit.remove': { en: 'Remove', th: 'ลบ' },
	'edit.removeHelp': { en: 'Cancelling returns {days} day to the balance|Cancelling returns {days} days to the balance and takes the entry off the shared calendar. The record is kept, marked cancelled, rather than deleted.', th: 'การยกเลิกจะคืนโควตา {days} วัน และนำรายการออกจากปฏิทินส่วนกลาง ระบบจะเก็บประวัติไว้โดยทำเครื่องหมายว่ายกเลิก ไม่ได้ลบทิ้ง' },
	'edit.removeButton': { en: 'Remove this leave', th: 'ลบการลานี้' },
	'edit.onBehalf': { en: "You are editing {name}'s booking as an admin.", th: 'คุณกำลังแก้ไขการลาของ {name} ในฐานะผู้ดูแลระบบ' },
	'edit.days': { en: '{days} day|{days} days', th: '{days} วัน' },

	// --- per-person page --------------------------------------------------
	'user.leaveIn': { en: 'Leave in {year}', th: 'การลาในปี {year}' },
	'user.nothing': { en: 'Nothing booked.', th: 'ไม่มีการลา' },
	'nav.year': { en: 'Go to {year}', th: 'ไปที่ปี {year}' },

	// --- admin ------------------------------------------------------------
	'admin.title': { en: 'Admin', th: 'ผู้ดูแลระบบ' },
	'admin.quotas': { en: 'Quotas', th: 'โควตาวันลา' },
	'admin.quotasHelp': { en: 'Days allotted per person for {year}. Blank rows default from the leave type.', th: 'จำนวนวันลาที่จัดสรรให้แต่ละคนในปี {year} หากเว้นว่างจะใช้ค่าเริ่มต้นของประเภทการลานั้น' },
	'admin.days': { en: 'Days', th: 'จำนวนวัน' },
	'admin.setForEveryone': { en: 'Set for everyone (active)', th: 'ตั้งค่าให้ทุกคน (ที่ยังใช้งาน)' },
	'admin.person': { en: 'Person', th: 'พนักงาน' },
	'admin.allotted': { en: 'Days allotted', th: 'วันที่จัดสรร' },
	'admin.isAdmin': { en: 'admin', th: 'ผู้ดูแลระบบ' },
	'admin.isActive': { en: 'active', th: 'ใช้งานอยู่' },
	'admin.save': { en: 'Save', th: 'บันทึก' },
	'admin.saveQuotas': { en: 'Save quotas', th: 'บันทึกโควตา' },
	'admin.holidays': { en: 'Holidays', th: 'วันหยุด' },
	'admin.holidaysHelp': { en: 'Days that do not draw down anyone\'s quota. Thai lunar holidays and substitution days are announced yearly — add them here as they land.', th: 'วันที่ไม่หักโควตาของใคร วันหยุดตามจันทรคติและวันหยุดชดเชยของไทยประกาศเป็นรายปี เพิ่มได้ที่นี่เมื่อประกาศออกมา' },
	'admin.date': { en: 'Date', th: 'วันที่' },
	'admin.name': { en: 'Name', th: 'ชื่อ' },
	'admin.nameExample': { en: 'For example, Makha Bucha', th: 'เช่น วันมาฆบูชา' },
	'admin.add': { en: 'Add', th: 'เพิ่ม' },
	'admin.import': { en: 'Import a list', th: 'นำเข้าเป็นรายการ' },
	'admin.importHelp': { en: 'One per line: a date, then a name. Commas and tabs work too, so a column pasted from a spreadsheet is fine. Lines starting with # are ignored. Nothing is written unless every line reads correctly.', th: 'บรรทัดละหนึ่งวัน: วันที่ตามด้วยชื่อ ใช้เครื่องหมายจุลภาคหรือแท็บก็ได้ จึงวางจากสเปรดชีตได้เลย บรรทัดที่ขึ้นต้นด้วย # จะถูกข้าม ระบบจะไม่บันทึกอะไรเลยหากมีบรรทัดใดอ่านไม่ได้' },
	'admin.importButton': { en: 'Import', th: 'นำเข้า' },
	'admin.removeHoliday': { en: 'Remove {label} on {date}', th: 'ลบ {label} วันที่ {date}' },
	'admin.line': { en: 'LINE notification', th: 'การแจ้งเตือนผ่าน LINE' },
	'admin.lineHelp': { en: 'Posts once each morning at 08:00 Asia/Bangkok listing who is out that day. Weekends, public holidays, and days with nobody on leave are skipped — LINE bills a group push per member, so silence is cheaper than "nobody is out today".', th: 'โพสต์ทุกเช้าเวลา 08:00 น. ตามเวลาไทย ว่าวันนั้นใครลาบ้าง ระบบจะข้ามวันหยุดสุดสัปดาห์ วันหยุดนักขัตฤกษ์ และวันที่ไม่มีใครลา เพราะ LINE คิดค่าส่งตามจำนวนสมาชิกในกลุ่ม การเงียบไว้จึงถูกกว่าการบอกว่า "วันนี้ไม่มีใครลา"' },
	'admin.channelToken': { en: 'Channel token', th: 'โทเคนของแชนแนล' },
	'admin.group': { en: 'Group', th: 'กลุ่ม' },
	'admin.tokenSet': { en: 'set', th: 'ตั้งค่าแล้ว' },
	'admin.weekAhead': { en: 'week ahead', th: 'สัปดาห์ถัดไป' },
	'admin.resend': { en: 'resend if already logged', th: 'ส่งซ้ำแม้เคยส่งแล้ว' },
	'admin.preview': { en: 'Preview', th: 'ดูตัวอย่าง' },
	'admin.sendNow': { en: 'Send now', th: 'ส่งเดี๋ยวนี้' },
	'admin.lineIncomplete': { en: 'LINE is not fully set up, so a send reaches browser subscribers only. The daily post goes out at 08:00 Asia/Bangkok; the week-ahead one on Monday mornings.', th: 'ยังตั้งค่า LINE ไม่ครบ การส่งจึงถึงเฉพาะผู้ที่เปิดแจ้งเตือนในเบราว์เซอร์ การแจ้งประจำวันส่งเวลา 08:00 น. ส่วนสรุปสัปดาห์ส่งเช้าวันจันทร์' },
	'admin.recentRuns': { en: 'Recent runs', th: 'การส่งล่าสุด' },
	'admin.nothingYet': { en: 'Nothing yet.', th: 'ยังไม่มีข้อมูล' },
	'admin.out': { en: '{n} out', th: 'ลา {n} คน' },
	'admin.recentChanges': { en: 'Recent changes', th: 'การเปลี่ยนแปลงล่าสุด' },
	'admin.auditHelp': { en: 'Every booking created, edited or cancelled, and by whom. Notes are recorded as present or absent, never copied here.', th: 'ทุกการเพิ่ม แก้ไข และยกเลิกการลา พร้อมผู้ที่ทำ ระบบบันทึกเพียงว่ามีหมายเหตุหรือไม่ ไม่ได้คัดลอกข้อความหมายเหตุมาเก็บไว้' },
	'audit.created': { en: 'created', th: 'สร้าง' },
	'audit.edited': { en: 'edited', th: 'แก้ไข' },
	'audit.cancelled': { en: 'cancelled', th: 'ยกเลิก' },
	'audit.typeChanged': { en: 'leave type changed', th: 'เปลี่ยนประเภทการลา' },
	'audit.noteAdded': { en: 'note added', th: 'เพิ่มหมายเหตุ' },
	'audit.noteRemoved': { en: 'note removed', th: 'ลบหมายเหตุ' },
	'audit.notePrivate': { en: 'note made private', th: 'ตั้งหมายเหตุเป็นส่วนตัว' },
	'audit.noteShared': { en: 'note shared', th: 'แชร์หมายเหตุ' },
	'audit.noChange': { en: 'no visible change', th: 'ไม่มีการเปลี่ยนแปลงที่เห็นได้' },
	'audit.onBehalf': { en: "{actor} → {subject}'s booking", th: '{actor} → การลาของ {subject}' },

	// --- flashes and validation -------------------------------------------
	// {type} is the English leave-type name and {typeTh} the Thai one; each
	// language picks the label that belongs with the rest of its sentence.
	'flash.booked': { en: 'Booked {days} day of {type} leave.|Booked {days} days of {type} leave.', th: 'บันทึก{typeTh} {days} วันแล้ว' },
	'flash.updated': { en: 'Updated to {days} day of {type} leave.|Updated to {days} days of {type} leave.', th: 'แก้ไขเป็น{typeTh} {days} วันแล้ว' },
	'flash.cancelled': { en: 'Booking cancelled.', th: 'ยกเลิกการลาแล้ว' },
	'flash.alreadyCancelled': { en: 'That booking was already cancelled.', th: 'การลานี้ถูกยกเลิกไปแล้ว' },
	'flash.cancelledRebook': { en: 'That booking is cancelled. Book it again instead of editing it.', th: 'การลานี้ถูกยกเลิกแล้ว กรุณาแจ้งลาใหม่แทนการแก้ไข' },
	'flash.cancelledNoEdit': { en: 'That booking is cancelled and cannot be edited.', th: 'การลานี้ถูกยกเลิกแล้ว จึงแก้ไขไม่ได้' },
	'flash.gone': { en: 'That booking no longer exists.', th: 'ไม่พบการลานี้แล้ว' },
	'flash.notYours': { en: 'That is not your booking.', th: 'นี่ไม่ใช่การลาของคุณ' },
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
	'flash.onlyAdmin': { en: 'You are the only admin — promote someone else first.', th: 'คุณเป็นผู้ดูแลระบบคนเดียว กรุณาตั้งผู้ดูแลระบบคนอื่นก่อน' },
	'flash.userUpdated': { en: 'Updated {email}.', th: 'อัปเดต {email} แล้ว' },
	'flash.quotasSaved': { en: 'Quotas saved for {email}.', th: 'บันทึกโควตาของ {email} แล้ว' },
	'flash.quotasBulk': { en: 'Set quota for {n} active user.|Set quota for {n} active users.', th: 'ตั้งโควตาให้ผู้ใช้งาน {n} คนแล้ว' },
	'flash.wouldPost': { en: 'Would post about {n} person.|Would post about {n} people.', th: 'จะแจ้งเตือนเกี่ยวกับ {n} คน' },
	'flash.wouldNotPost': { en: 'Would not post: {reason}.', th: 'จะไม่แจ้งเตือน: {reason}' },
	'flash.sentTo': { en: 'Sent to {channels} about {n} person.|Sent to {channels} about {n} people.', th: 'ส่งไปยัง {channels} เกี่ยวกับ {n} คน' },
	'flash.sendFailed': { en: 'Send failed — {error}', th: 'ส่งไม่สำเร็จ — {error}' },
	'flash.nothingSent': { en: 'Nothing sent: {reason}.', th: 'ไม่ได้ส่ง: {reason}' },
	'flash.nothingToImport': { en: 'Nothing to import.', th: 'ไม่มีข้อมูลให้นำเข้า' },
	'flash.importFailed': { en: 'Nothing was imported.', th: 'ไม่ได้นำเข้าข้อมูลใดเลย' },
	'flash.importEmpty': { en: 'No holidays found in that list.', th: 'ไม่พบวันหยุดในรายการนั้น' },
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
	'status.not_configured': { en: 'no channel is configured', th: 'ยังไม่ได้ตั้งค่าช่องทางแจ้งเตือน' },
	'status.no_subscribers': { en: 'nobody has subscribed', th: 'ยังไม่มีใครเปิดรับการแจ้งเตือน' },
	'status.dry_run': { en: 'preview only', th: 'ดูตัวอย่างเท่านั้น' },
	'status.failed': { en: 'the send failed', th: 'ส่งไม่สำเร็จ' },

	'error.pickType': { en: 'Pick a leave type.', th: 'กรุณาเลือกประเภทการลา' },
	'error.badStart': { en: 'Start date is not a valid date.', th: 'วันที่เริ่มต้นไม่ถูกต้อง' },
	'error.badEnd': { en: 'End date is not a valid date.', th: 'วันที่สิ้นสุดไม่ถูกต้อง' },
	'error.badHalf': { en: 'Half-day value must be full, am, or pm.', th: 'ค่าครึ่งวันต้องเป็น full, am หรือ pm เท่านั้น' },
	'error.unknownType': { en: 'Unknown leave type.', th: 'ไม่พบประเภทการลานี้' },
	'error.endBeforeStart': { en: 'The end date is before the start date.', th: 'วันที่สิ้นสุดอยู่ก่อนวันที่เริ่มต้น' },
	'error.tooLong': { en: 'That range is longer than a year.', th: 'ช่วงวันลายาวเกินหนึ่งปี' },
	'error.notAWorkingDay': { en: 'That day is a weekend or a public holiday.', th: 'วันนั้นเป็นวันหยุดสุดสัปดาห์หรือวันหยุดนักขัตฤกษ์' },
	'error.noWorkingDays': { en: 'That range has no working days in it.', th: 'ช่วงวันที่เลือกไม่มีวันทำงานเลย' },
	'error.halfOnMultiDay': { en: 'A multi-day booking cannot start in the morning only or end in the afternoon only.', th: 'การลาหลายวันไม่สามารถเริ่มเฉพาะเช้าหรือสิ้นสุดเฉพาะบ่ายได้' },
	'error.tooFarBack': { en: 'That start date is more than {days} days in the past. Ask an admin to add it.', th: 'วันที่เริ่มต้นย้อนหลังเกิน {days} วัน กรุณาแจ้งผู้ดูแลระบบ' },
	'error.tooFarAhead': { en: 'That end date is too far in the future — check the year.', th: 'วันที่สิ้นสุดอยู่ไกลเกินไป กรุณาตรวจสอบปี' },
	'error.overlap': { en: 'You already have leave booked over {start} – {end}.', th: 'คุณมีการลาอยู่แล้วในช่วง {start} – {end}' },
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
