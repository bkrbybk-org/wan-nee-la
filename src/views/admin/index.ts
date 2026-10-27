/*
 * The admin area's pages, one file per section, with the shell they share
 * in shell.tsx. It was one file of 1,200 lines until 2026-10-21.
 */
export { type AdminSection } from './shell.tsx';
export { AdminOverviewPage, type OverviewProps } from './overview.tsx';
export { AdminYearEndPage, type YearEndProps } from './yearend.tsx';
export { AdminPeoplePage, AdminPersonPage, OTHERS_SHOWN, type PeopleProps, type PersonProps } from './people.tsx';
export { AdminTypesPage, type TypesProps } from './types.tsx';
export { AdminHolidaysPage, type HolidaysProps } from './holidays.tsx';
export { AdminNotificationsPage, type NotificationsProps } from './notifications.tsx';
export { AdminExportPage } from './export.tsx';
export { AdminActivityPage, AuditItem, type ActivityProps } from './activity.tsx';
export { HolidayPreviewPage } from './holidays-preview.tsx';
