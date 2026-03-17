import { supabase } from './supabase';
import type { TimetableCourse } from '../types';

// ── Backend API calls ────────────────────────────────────

interface SyncResponse {
  courses?: Array<{
    course_date: string;
    start_time: string;
    end_time: string;
    course_name: string;
    classroom: string;
    teacher: string;
  }>;
  captcha_required?: boolean;
  captcha_image?: string;
  session_id?: string;
  warning?: string;
  error?: string;
}

/**
 * Call the backend to sync timetable from the university CAS system.
 * May return captcha_required=true on first call if the CAS page has a captcha.
 */
export async function syncTimetable(
  username: string,
  password: string,
  captchaCode?: string,
  sessionId?: string,
): Promise<SyncResponse> {
  const body: Record<string, string> = { username, password };
  if (captchaCode) body.captcha_code = captchaCode;
  if (sessionId) body.session_id = sessionId;

  const resp = await fetch('/api/timetable/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok && !data.captcha_required) {
    throw new Error(data.error || 'Timetable sync failed');
  }
  return data;
}

// ── Supabase DB operations ───────────────────────────────

/**
 * Save an array of courses to Supabase via RPC (POST, avoids PATCH/DELETE).
 * Replaces all existing courses for the current user atomically.
 * Each course has a specific course_date (not recurring day_of_week).
 */
export async function saveTimetableCourses(
  courses: Array<{
    course_date: string;
    start_time: string;
    end_time: string;
    course_name: string;
    classroom: string;
    teacher: string;
  }>,
): Promise<number> {
  // Supabase RPC sends params as JSON; for JSONB param, pass the array directly
  const { data, error } = await supabase.rpc('save_timetable_courses', {
    courses: courses as unknown as string,
  });
  if (error) {
    console.error('[timetable] saveTimetableCourses RPC error:', error);
    throw new Error(error.message || 'Failed to save courses to database');
  }
  return (data as { inserted: number })?.inserted ?? courses.length;
}

/**
 * Get courses for a specific date (exact match on course_date).
 * Returns courses sorted by start_time.
 */
export async function getCoursesForDate(
  userId: string,
  dateStr: string,
): Promise<TimetableCourse[]> {
  // dateStr is "YYYY-MM-DD" - query by exact date
  const { data, error } = await supabase
    .from('timetable_courses')
    .select('*')
    .eq('user_id', userId)
    .eq('course_date', dateStr)
    .order('start_time', { ascending: true });

  if (error) throw error;
  return (data ?? []) as TimetableCourse[];
}

/**
 * Check if user has any timetable courses stored.
 */
export async function hasTimetableCourses(userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('timetable_courses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) return false;
  return (count ?? 0) > 0;
}
