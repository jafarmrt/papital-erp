export interface DailyWorkLog {
  id: number;
  user_id: number;
  userId?: number;
  username: string;
  user_full_name?: string;
  userFullName?: string;
  date: string;
  date_iso?: string;
  dateIso?: string;
  start_time: string;
  startTime?: string;
  end_time: string;
  endTime?: string;
  work_hours: number;
  workHours?: number;
  work_mode: 'onsite' | 'remote';
  workMode?: 'onsite' | 'remote';
  title: string;
  content: string;
  project_id?: number;
  projectId?: number;
  project_name?: string;
  projectName?: string;
  tags?: string[];
  mentions?: number[]; // array of user IDs
  visibility: 'public' | 'managers' | 'mentioned_only' | 'custom' | 'private';
  allowed_users?: number[]; // user IDs allowed
  allowedUsers?: number[];
  status?: 'submitted' | 'reviewed';
  manager_notes?: string;
  managerNotes?: string;
  created_at?: string;
  createdAt?: string;
}

export interface AppNotification {
  id: number;
  user_id: number;
  userId?: number;
  sender_id?: number;
  senderId?: number;
  sender_name?: string;
  senderName?: string;
  type: 'mention' | 'work_log_review' | 'system';
  title: string;
  message: string;
  link?: string;
  is_read: number;
  isRead?: number;
  created_at?: string;
  createdAt?: string;
}

export interface CalendarEventItem {
  id: string | number;
  date: string;
  title: string;
  subtitle?: string;
  type: 'crm_followup' | 'crm_close' | 'daily_log' | 'event';
  color?: string;
  raw?: unknown;
}
