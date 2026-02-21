// LocalStorage-based storage for calendar comments and icons.
// Avoids requiring new Supabase tables.

const COMMENTS_KEY = 'duo-journal-calendar-comments';
const ICONS_KEY = 'duo-journal-calendar-icons';

// ── Calendar Comments ─────────────────────────────────────

function loadComments(): Record<string, Record<string, string>> {
  try {
    const raw = localStorage.getItem(COMMENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistComments(data: Record<string, Record<string, string>>) {
  localStorage.setItem(COMMENTS_KEY, JSON.stringify(data));
}

export function getLocalCalendarComment(userId: string, date: string): string {
  const all = loadComments();
  return all[userId]?.[date] ?? '';
}

export function saveLocalCalendarComment(userId: string, date: string, comment: string) {
  const all = loadComments();
  if (!all[userId]) all[userId] = {};
  if (comment.trim()) {
    all[userId][date] = comment;
  } else {
    delete all[userId][date];
  }
  persistComments(all);
}

export function getLocalCommentsForMonth(
  userId: string,
  year: number,
  month: number
): Map<string, string> {
  const all = loadComments();
  const userComments = all[userId] ?? {};
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const map = new Map<string, string>();
  for (const [date, comment] of Object.entries(userComments)) {
    if (date.startsWith(prefix)) {
      map.set(date, comment);
    }
  }
  return map;
}

// ── Calendar Icons ────────────────────────────────────────

function loadIcons(): Record<string, Record<string, string[]>> {
  try {
    const raw = localStorage.getItem(ICONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistIcons(data: Record<string, Record<string, string[]>>) {
  localStorage.setItem(ICONS_KEY, JSON.stringify(data));
}

export function getLocalCalendarIcons(userId: string, date: string): string[] {
  const all = loadIcons();
  return all[userId]?.[date] ?? [];
}

export function saveLocalCalendarIcons(userId: string, date: string, icons: string[]) {
  const all = loadIcons();
  if (!all[userId]) all[userId] = {};
  if (icons.length > 0) {
    all[userId][date] = icons;
  } else {
    delete all[userId][date];
  }
  persistIcons(all);
}

export function getLocalIconsForMonth(
  userId: string,
  year: number,
  month: number
): Map<string, string[]> {
  const all = loadIcons();
  const userIcons = all[userId] ?? {};
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const map = new Map<string, string[]>();
  for (const [date, icons] of Object.entries(userIcons)) {
    if (date.startsWith(prefix)) {
      map.set(date, icons);
    }
  }
  return map;
}
