export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar: string;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  user_id: string;
  date: string;
  content: string;
  media_urls?: string[];
  created_at: string;
  updated_at: string;
}

export interface CalendarComment {
  id: string;
  user_id: string;
  date: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarIcon {
  id: string;
  user_id: string;
  date: string;
  icons: string[];
  created_at: string;
  updated_at: string;
}

export interface AIComment {
  id: string;
  entry_id: string;
  user_id: string;
  comment: string;
  score: number | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIChatMessage {
  id: string;
  ai_comment_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface PartnerRequest {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: 'pending' | 'accepted' | 'break_pending';
  break_requester_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerRequestWithProfiles extends PartnerRequest {
  from_profile: Profile;
  to_profile: Profile;
}

export const AVATAR_OPTIONS = ['🌸', '🌊', '🌺', '🌿', '🌙', '⭐', '🦋', '🌻', '🍃', '🔥', '💜', '🧸'];

export const CALENDAR_ICONS = [
  { emoji: '❤️', label: '爱心', description: '情人节/恋爱' },
  { emoji: '🎂', label: '蛋糕', description: '生日' },
  { emoji: '🧨', label: '爆竹', description: '春节' },
  { emoji: '✈️', label: '飞机', description: '旅游' },
  { emoji: '📝', label: '试卷', description: '考试' },
  { emoji: '🍿', label: '爆米花', description: '看电影' },
  { emoji: '💍', label: '戒指', description: '结婚纪念日' },
  { emoji: '🎁', label: '礼物盒', description: '惊喜/收到礼物' },
  { emoji: '🍴', label: '刀叉', description: '一起吃大餐/探店' },
  { emoji: '☕', label: '咖啡杯', description: '喝咖啡/烹饪' },
  { emoji: '🎮', label: '游戏手柄', description: '一起打游戏' },
  { emoji: '🎤', label: '麦克风', description: '去KTV唱歌' },
  { emoji: '🎵', label: '音符', description: '听演唱会' },
  { emoji: '🏠', label: '房子', description: '搬家/大扫除' },
  { emoji: '🐾', label: '宠物脚印', description: '宠物相关' },
  { emoji: '💊', label: '药丸', description: '生病/互相照顾' },
  { emoji: '🏥', label: '医院', description: '看病/体检' },
  { emoji: '🏋️', label: '哑铃', description: '一起健身' },
  { emoji: '👟', label: '跑鞋', description: '户外运动' },
  { emoji: '💻', label: '笔记本电脑', description: '加班/工作成就' },
  { emoji: '📸', label: '照相机', description: '拍写真/拍照' },
];
