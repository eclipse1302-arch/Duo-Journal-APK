import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';
import type { TimetableCourse } from '../types';

// On native platforms (APK), use the direct backend URL because the
// ModelScope studio wrapper URL always returns HTML, not JSON.
const BASE_URL = (() => {
  if (Capacitor.isNativePlatform()) {
    // Native apps cannot rely on a same-origin proxy.
    return 'https://eclipse1302-duo-journal.ms.show';
  }

  // Web: follow the actual domain the SPA is running on (ms.show vs modelscope wrapper).
  if (typeof window !== 'undefined' && window.location?.host) {
    return `${window.location.protocol}//${window.location.host}`;
  }

  // Fallback.
  return 'https://eclipse1302-duo-journal.ms.show';
})();

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

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/api/timetable/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[timetable] Network error during sync:', err);
    throw new Error(
      'Network error: unable to reach the server. Please check your internet connection and try again.',
    );
  }

  const rawText = await resp.text();
  let data: SyncResponse;
  try {
    data = JSON.parse(rawText) as SyncResponse;
  } catch {
    console.error('[timetable] Non-JSON response:', rawText.slice(0, 500));
    throw new Error(
      `Server returned an invalid response (HTTP ${resp.status}). The timetable API may be unavailable.`,
    );
  }
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
    courses,
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
