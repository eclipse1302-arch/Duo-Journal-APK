import { supabase } from './supabase';
import type { TimetableCourse } from '../types';

// ===================== 【核心修改】固定直连地址，彻底避开魔搭WebVPN =====================
// 强制所有环境（魔搭Web/原生APP）都使用 能直接访问校园CAS的直连后端地址
// 这是你之前成功爬取的关键地址，不会触发WebVPN重写
const DIRECT_API_BASE = 'https://eclipse1302-duo-journal.ms.show';

const BASE_URL = (() => {
  // 最高优先级：魔搭环境变量配置（可直接在魔搭后台设置，无需改代码）
  const envBase = import.meta.env.VITE_TIMETABLE_API_BASE as string | undefined;
  if (envBase && envBase.trim()) {
    return envBase.trim().replace(/\/$/, '');
  }

  // ===================== 【关键】强制使用直连地址，禁用魔搭动态域名 =====================
  // 取消 window.location 动态获取（魔搭此域名会触发WebVPN）
  return DIRECT_API_BASE;
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
      headers: {
        'Content-Type': 'application/json',
        // ===================== 【优化】添加请求头，绕过CAS非安全连接检测 =====================
        'Origin': DIRECT_API_BASE,
        'Referer': DIRECT_API_BASE,
        'Sec-Fetch-Mode': 'cors',
      },
      body: JSON.stringify(body),
      // 魔搭网络添加超时，避免卡死
      signal: AbortSignal.timeout(15000),
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