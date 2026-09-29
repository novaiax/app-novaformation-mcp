// Ported from the NovaFormation app (src/types/database.ts) — keep both in sync.
export type RecurrenceType = "once" | "daily" | "weekly" | "monthly" | "every_x_days" | "specific_weekdays";

export interface RecurrenceConfig {
  days_of_week?: number[];
  interval_days?: number;
}

export type ModuleItemType = "lesson" | "book" | "exercise" | "objective" | "custom_task";
export type ProgramStatus = "active" | "completed" | "archived";
export type BookStatus = "to_read" | "reading" | "completed" | "abandoned";
export type HabitRecurrence = "daily" | "weekly" | "monthly" | "custom";
export type TaskSource = "custom" | "program" | "habit" | "template";
export type XpSource = "task" | "habit" | "exercise" | "book" | "manual";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type ExerciseGoalType = "sessions" | "minutes" | "score";
export type ExerciseGoalPeriod = "total" | "week" | "month";
export type ActivityStatus = "planned" | "active" | "paused" | "completed" | "archived";
export type ActivityKind = "recurring" | "one_off" | "free";
export type ActivityGoalType = "sessions" | "hours" | "attendance";
export type ActivitySessionStatus = "planned" | "done" | "missed" | "cancelled_self" | "cancelled_organizer" | "postponed";
export type ActivityFrequency = "weekly" | "every_n_days";

export interface HabitRecurrenceConfig {
  days_of_week?: number[]; // 0 (Sunday) - 6 (Saturday)
  day_of_month?: number; // 1-31
  interval_days?: number; // every N days from creation
}

export interface Subtask {
  id: string;
  title: string;
}

export interface SubtaskInstance extends Subtask {
  completed: boolean;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      settings: {
        Row: {
          user_id: string;
          default_task_xp: number;
          default_habit_xp: number;
          default_exercise_xp: number;
          book_completion_xp: number;
          level_base_xp: number;
          level_growth: number;
          week_starts_on: number;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["settings"]["Row"]> & {
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["settings"]["Row"]>;
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          icon: string;
          color: string;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["categories"]["Row"]> & {
          user_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Row"]>;
        Relationships: [];
      };
      programs: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          icon: string;
          color: string;
          description: string;
          duration_weeks: number;
          status: ProgramStatus;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["programs"]["Row"]> & {
          user_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["programs"]["Row"]>;
        Relationships: [];
      };
      program_weeks: {
        Row: {
          id: string;
          program_id: string;
          week_number: number;
          title: string;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_weeks"]["Row"]> & {
          program_id: string;
          week_number: number;
        };
        Update: Partial<Database["public"]["Tables"]["program_weeks"]["Row"]>;
        Relationships: [];
      };
      program_modules: {
        Row: {
          id: string;
          week_id: string;
          title: string;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_modules"]["Row"]> & {
          week_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["program_modules"]["Row"]>;
        Relationships: [];
      };
      module_items: {
        Row: {
          id: string;
          module_id: string;
          type: ModuleItemType;
          title: string;
          description: string;
          ref_book_id: string | null;
          ref_exercise_id: string | null;
          xp_value: number;
          sort_order: number;
          is_completed: boolean;
          completed_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["module_items"]["Row"]> & {
          module_id: string;
          type: ModuleItemType;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["module_items"]["Row"]>;
        Relationships: [];
      };
      books: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          author: string;
          pages: number;
          current_page: number;
          status: BookStatus;
          category_id: string | null;
          notes: string;
          rating: number | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["books"]["Row"]> & {
          user_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["books"]["Row"]>;
        Relationships: [];
      };
      exercises: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          category_id: string | null;
          description: string;
          xp_value: number;
          score_max: number;
          archived: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["exercises"]["Row"]> & {
          user_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["exercises"]["Row"]>;
        Relationships: [];
      };
      exercise_logs: {
        Row: {
          id: string;
          exercise_id: string;
          user_id: string;
          duration_minutes: number;
          score: number | null;
          notes: string;
          completed_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["exercise_logs"]["Row"]> & {
          exercise_id: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["exercise_logs"]["Row"]>;
        Relationships: [];
      };
      exercise_goals: {
        Row: {
          id: string;
          user_id: string;
          exercise_id: string;
          type: ExerciseGoalType;
          target: number;
          period: ExerciseGoalPeriod;
          deadline: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["exercise_goals"]["Row"]> & {
          user_id: string;
          exercise_id: string;
          type: ExerciseGoalType;
          target: number;
        };
        Update: Partial<Database["public"]["Tables"]["exercise_goals"]["Row"]>;
        Relationships: [];
      };
      exercise_goal_achievements: {
        Row: {
          id: string;
          user_id: string;
          exercise_id: string;
          goal_id: string | null;
          log_id: string | null;
          type: ExerciseGoalType;
          target: number;
          period: ExerciseGoalPeriod;
          period_key: string;
          value_before: number;
          value_after: number;
          reached_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["exercise_goal_achievements"]["Row"]> & {
          user_id: string;
          exercise_id: string;
          type: ExerciseGoalType;
          target: number;
          period: ExerciseGoalPeriod;
          period_key: string;
          value_before: number;
          value_after: number;
        };
        Update: Partial<Database["public"]["Tables"]["exercise_goal_achievements"]["Row"]>;
        Relationships: [];
      };
      skills: {
        Row: {
          id: string; user_id: string; name: string; icon: string; color: string;
          sort_order: number; created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["skills"]["Row"]> & { user_id: string; name: string };
        Update: Partial<Database["public"]["Tables"]["skills"]["Row"]>;
        Relationships: [];
      };
      activities: {
        Row: {
          id: string; user_id: string; name: string; category_id: string | null;
          description: string; icon: string; color: string; status: ActivityStatus;
          kind: ActivityKind; start_date: string; end_date: string | null;
          planned_minutes: number; usual_time: string | null; place: string;
          organizer: string; url: string | null; goal_type: ActivityGoalType | null;
          goal_target: number | null; sort_order: number;
          schedule_refreshed_until: string | null; past_schedule_generated: boolean;
          created_at: string; updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["activities"]["Row"]> & { user_id: string; name: string };
        Update: Partial<Database["public"]["Tables"]["activities"]["Row"]>;
        Relationships: [];
      };
      activity_recurrence_rules: {
        Row: {
          id: string; activity_id: string; user_id: string; valid_from: string;
          valid_until: string | null; anchor_date: string | null;
          frequency: ActivityFrequency; week_interval: number;
          weekdays: number[]; times_per_week: number | null; interval_days: number;
          start_time: string | null; planned_minutes: number | null; created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["activity_recurrence_rules"]["Row"]> & {
          activity_id: string; user_id: string; valid_from: string;
        };
        Update: Partial<Database["public"]["Tables"]["activity_recurrence_rules"]["Row"]>;
        Relationships: [];
      };
      activity_sessions: {
        Row: {
          id: string; activity_id: string; user_id: string; recurrence_rule_id: string | null;
          source: "manual" | "generated"; occurrence_date: string | null;
          session_date: string; start_time: string | null; end_time: string | null;
          all_day: boolean; event_occurrence_date: string | null; planned_minutes: number;
          actual_minutes: number | null; status: ActivitySessionStatus;
          feedback_score: number | null; notes: string; comment: string;
          url: string | null; attachment_path: string | null; attachment_name: string | null;
          skill_snapshot_complete: boolean; is_exception: boolean;
          sort_order: number; created_at: string; updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["activity_sessions"]["Row"]> & {
          activity_id: string; user_id: string; session_date: string;
        };
        Update: Partial<Database["public"]["Tables"]["activity_sessions"]["Row"]>;
        Relationships: [];
      };
      activity_suppressed_occurrences: {
        Row: { activity_id: string; user_id: string; occurrence_date: string; created_at: string };
        Insert: { activity_id: string; user_id: string; occurrence_date: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["activity_suppressed_occurrences"]["Row"]>;
        Relationships: [];
      };
      activity_skill_links: {
        Row: { activity_id: string; skill_id: string; user_id: string };
        Insert: { activity_id: string; skill_id: string; user_id: string };
        Update: Partial<Database["public"]["Tables"]["activity_skill_links"]["Row"]>;
        Relationships: [];
      };
      activity_program_links: {
        Row: { activity_id: string; program_id: string; user_id: string };
        Insert: { activity_id: string; program_id: string; user_id: string };
        Update: Partial<Database["public"]["Tables"]["activity_program_links"]["Row"]>;
        Relationships: [];
      };
      activity_session_skills: {
        Row: { session_id: string; skill_id: string; user_id: string };
        Insert: { session_id: string; skill_id: string; user_id: string };
        Update: Partial<Database["public"]["Tables"]["activity_session_skills"]["Row"]>;
        Relationships: [];
      };
      habits: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          icon: string;
          color: string;
          recurrence: HabitRecurrence;
          recurrence_config: HabitRecurrenceConfig;
          category_id: string | null;
          xp_value: number;
          archived: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["habits"]["Row"]> & {
          user_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["habits"]["Row"]>;
        Relationships: [];
      };
      habit_logs: {
        Row: {
          id: string;
          habit_id: string;
          user_id: string;
          log_date: string;
          completed: boolean;
          completed_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["habit_logs"]["Row"]> & {
          habit_id: string;
          user_id: string;
          log_date: string;
        };
        Update: Partial<Database["public"]["Tables"]["habit_logs"]["Row"]>;
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          category_id: string | null;
          task_date: string;
          source: TaskSource;
          program_item_id: string | null;
          habit_id: string | null;
          template_id: string | null;
          xp_value: number;
          duration_minutes: number | null;
          is_completed: boolean;
          completed_at: string | null;
          sort_order: number;
          created_at: string;
          description: string;
          notes: string;
          icon: string | null;
          color: string | null;
          priority: TaskPriority;
          is_required: boolean;
          xp_multiplier: number;
          subtasks: SubtaskInstance[];
          is_archived: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["tasks"]["Row"]> & {
          user_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Row"]>;
        Relationships: [];
      };
      task_templates: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string;
          notes: string;
          icon: string;
          color: string;
          category_id: string | null;
          priority: TaskPriority;
          is_required: boolean;
          estimated_duration_minutes: number | null;
          xp_value: number;
          xp_multiplier: number;
          subtasks_template: Subtask[];
          recurrence_type: RecurrenceType;
          recurrence_config: RecurrenceConfig;
          start_date: string;
          end_date: string | null;
          is_active: boolean;
          archived_at: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["task_templates"]["Row"]> & {
          user_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["task_templates"]["Row"]>;
        Relationships: [];
      };
      xp_events: {
        Row: {
          id: string;
          user_id: string;
          source: XpSource;
          ref_id: string | null;
          amount: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["xp_events"]["Row"]> & {
          user_id: string;
          source: XpSource;
          amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["xp_events"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      nf_refresh_activity_occurrences: { Args: { p_activity_id: string; p_user_id?: string | null }; Returns: number };
      nf_set_one_off_event_days: {
        Args: { p_activity_id: string; p_days: {
          date: string; mode: "all_day" | "time_range" | "duration";
          start_time?: string; end_time?: string; duration_minutes?: number;
        }[]; p_user_id?: string | null };
        Returns: number;
      };
      nf_set_activity_recurrence: {
        Args: {
          p_activity_id: string; p_scope: "all" | "following"; p_from_date: string;
          p_frequency: ActivityFrequency; p_week_interval?: number; p_weekdays?: number[];
          p_times_per_week?: number | null; p_interval_days?: number;
          p_start_time?: string | null; p_planned_minutes?: number | null;
          p_anchor_date?: string | null; p_user_id?: string | null;
        };
        Returns: string;
      };
      nf_set_activity_links: { Args: { p_activity_id: string; p_skill_ids: string[]; p_program_ids: string[]; p_user_id?: string | null }; Returns: undefined };
      nf_set_activity_session_skills: { Args: { p_session_id: string; p_skill_ids: string[]; p_user_id?: string | null }; Returns: undefined };
      nf_reorder_activities: { Args: { p_order: string[]; p_user_id?: string | null }; Returns: undefined };
      nf_duplicate_activity: { Args: { p_activity_id: string; p_user_id?: string | null }; Returns: string };
      nf_delete_activity_session: { Args: { p_session_id: string; p_user_id?: string | null }; Returns: undefined };
      nf_move_activity_session: {
        Args: { p_session_id: string; p_target_activity_id: string; p_date: string; p_time?: string | null; p_user_id?: string | null };
        Returns: undefined;
      };
      nf_restore_activity_occurrence: { Args: { p_activity_id: string; p_occurrence_date: string; p_user_id?: string | null }; Returns: undefined };
      nf_clear_activity_recurrence: { Args: { p_activity_id: string; p_user_id?: string | null }; Returns: undefined };
      nf_batch_move_activity_sessions: {
        Args: { p_session_ids: string[]; p_target_activity_id: string; p_date?: string | null; p_user_id?: string | null };
        Returns: undefined;
      };
      nf_batch_delete_activity_sessions: { Args: { p_session_ids: string[]; p_user_id?: string | null }; Returns: undefined };
      nf_batch_duplicate_activity_sessions: {
        Args: { p_session_ids: string[]; p_target_activity_id: string; p_date?: string | null; p_user_id?: string | null };
        Returns: string[];
      };
      nf_reorder_activity_sessions: { Args: { p_date: string; p_order: string[]; p_user_id?: string | null }; Returns: undefined };
      nf_reorder_skills: { Args: { p_order: string[]; p_user_id?: string | null }; Returns: undefined };
      nf_batch_set_activity_session_status: {
        Args: { p_session_ids: string[]; p_status: ActivitySessionStatus; p_user_id?: string | null };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
