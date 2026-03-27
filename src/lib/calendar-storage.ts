// Supabase-based storage for calendar comments and icons.
// Data syncs across all devices and users.

import { supabase } from './supabase';

// ── Calendar Comments ─────────────────────────────────────

export async function getCalendarCommentForDate(
  userId: string,
  date: string
): Promise<string> {
  const { data } = await supabase
    .from('calendar_comments')
    .select('comment')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();
  return data?.comment ?? '';
}

export async function saveCalendarCommentForDate(
  userId: string,
  date: string,
  comment: string
): Promise<void> {
  if (!comment.trim()) {
    // Delete if empty
    await supabase
      .from('calendar_comments')
      .delete()
      .eq('user_id', userId)
      .eq('date', date);
    return;
  }

  const { data: existing } = await supabase
    .from('calendar_comments')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('calendar_comments')
      .update({ comment, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('calendar_comments')
      .insert({ user_id: userId, date, comment });
  }
}

export async function getCommentsForMonthFromDB(
  userId: string,
  year: number,
  month: number
): Promise<Map<string, string>> {
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endMonth = month === 11 ? 1 : month + 2;
  const endYear = month === 11 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const { data } = await supabase
    .from('calendar_comments')
    .select('date, comment')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lt('date', endDate);

  const map = new Map<string, string>();
  (data || []).forEach((item) => map.set(item.date, item.comment));
  return map;
}

// ── Calendar Icons ────────────────────────────────────────

export async function getCalendarIconsForDate(
  userId: string,
  date: string
): Promise<string[]> {
  const { data } = await supabase
    .from('calendar_icons')
    .select('icons')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();
  return data?.icons ?? [];
}

export async function saveCalendarIconsForDate(
  userId: string,
  date: string,
  icons: string[]
): Promise<void> {
  if (icons.length === 0) {
    await supabase
      .from('calendar_icons')
      .delete()
      .eq('user_id', userId)
      .eq('date', date);
    return;
  }

  const { data: existing } = await supabase
    .from('calendar_icons')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('calendar_icons')
      .update({ icons, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('calendar_icons')
      .insert({ user_id: userId, date, icons });
  }
}

export async function getIconsForMonthFromDB(
  userId: string,
  year: number,
  month: number
): Promise<Map<string, string[]>> {
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endMonth = month === 11 ? 1 : month + 2;
  const endYear = month === 11 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const { data } = await supabase
    .from('calendar_icons')
    .select('date, icons')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lt('date', endDate);

  const map = new Map<string, string[]>();
  (data || []).forEach((item) => map.set(item.date, item.icons));
  return map;
}
