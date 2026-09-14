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
    Functions: Record<string, never>;
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
