/** The answer of `GET /daily-logs/stats` (counted in SQL over the logs the user sees; v9.0.249, TD-630) */
export interface DailyLogStats {
  today_hours: number;
  my_total_logs: number;
  my_total_hours: number;
  total_logs: number;
  onsite_count: number;
  remote_count: number;
  my_mentions_count: number;
}

export const EMPTY_DAILY_LOG_STATS: DailyLogStats = {
  today_hours: 0, my_total_logs: 0, my_total_hours: 0, total_logs: 0, onsite_count: 0, remote_count: 0, my_mentions_count: 0,
};
