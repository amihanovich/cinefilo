export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      moment_feedback: {
        Row: {
          accepted: boolean
          correction: string | null
          created_at: string
          detected_label: string
          detected_signals: Json
          id: string
          user_id: string
        }
        Insert: {
          accepted?: boolean
          correction?: string | null
          created_at?: string
          detected_label: string
          detected_signals?: Json
          id?: string
          user_id: string
        }
        Update: {
          accepted?: boolean
          correction?: string | null
          created_at?: string
          detected_label?: string
          detected_signals?: Json
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      moments: {
        Row: {
          attention_filter: string | null
          auto_detected: boolean
          company_filter: string | null
          created_at: string
          id: string
          mood_filter: string | null
          name: string
          novelty_filter: string | null
          platforms: string[]
          season_hint: string | null
          time_filter: string | null
          type_filter: string | null
          updated_at: string
          use_location: boolean
          user_id: string
          weather_hint: string | null
        }
        Insert: {
          attention_filter?: string | null
          auto_detected?: boolean
          company_filter?: string | null
          created_at?: string
          id?: string
          mood_filter?: string | null
          name: string
          novelty_filter?: string | null
          platforms?: string[]
          season_hint?: string | null
          time_filter?: string | null
          type_filter?: string | null
          updated_at?: string
          use_location?: boolean
          user_id: string
          weather_hint?: string | null
        }
        Update: {
          attention_filter?: string | null
          auto_detected?: boolean
          company_filter?: string | null
          created_at?: string
          id?: string
          mood_filter?: string | null
          name?: string
          novelty_filter?: string | null
          platforms?: string[]
          season_hint?: string | null
          time_filter?: string | null
          type_filter?: string | null
          updated_at?: string
          use_location?: boolean
          user_id?: string
          weather_hint?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age_bracket: string | null
          avatar_color: string
          created_at: string
          default_platforms: string[]
          display_name: string | null
          id: string
          seed_loved: string[]
          updated_at: string
        }
        Insert: {
          age_bracket?: string | null
          avatar_color?: string
          created_at?: string
          default_platforms?: string[]
          display_name?: string | null
          id: string
          seed_loved?: string[]
          updated_at?: string
        }
        Update: {
          age_bracket?: string | null
          avatar_color?: string
          created_at?: string
          default_platforms?: string[]
          display_name?: string | null
          id?: string
          seed_loved?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      social_matches: {
        Row: {
          id: string
          matched_at: string
          platform: string
          title: string
          user_a: string
          user_b: string
        }
        Insert: {
          id?: string
          matched_at?: string
          platform: string
          title: string
          user_a: string
          user_b: string
        }
        Update: {
          id?: string
          matched_at?: string
          platform?: string
          title?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      user_presence: {
        Row: {
          attention_filter: string | null
          avatar_color: string
          company_filter: string | null
          display_name: string
          is_visible: boolean
          last_seen: string
          lat: number
          lng: number
          mood_filter: string | null
          type_filter: string | null
          user_id: string
        }
        Insert: {
          attention_filter?: string | null
          avatar_color?: string
          company_filter?: string | null
          display_name: string
          is_visible?: boolean
          last_seen?: string
          lat: number
          lng: number
          mood_filter?: string | null
          type_filter?: string | null
          user_id: string
        }
        Update: {
          attention_filter?: string | null
          avatar_color?: string
          company_filter?: string | null
          display_name?: string
          is_visible?: boolean
          last_seen?: string
          lat?: number
          lng?: number
          mood_filter?: string | null
          type_filter?: string | null
          user_id?: string
        }
        Relationships: []
      }
      search_history: {
        Row: {
          attention_filter: string | null
          company_filter: string | null
          created_at: string
          id: string
          mood_filter: string | null
          novelty_filter: string | null
          platforms: string[]
          prompt_text: string | null
          season_hint: string | null
          source: string
          time_filter: string | null
          type_filter: string | null
          user_id: string
          weather_hint: string | null
        }
        Insert: {
          attention_filter?: string | null
          company_filter?: string | null
          created_at?: string
          id?: string
          mood_filter?: string | null
          novelty_filter?: string | null
          platforms?: string[]
          prompt_text?: string | null
          season_hint?: string | null
          source: string
          time_filter?: string | null
          type_filter?: string | null
          user_id: string
          weather_hint?: string | null
        }
        Update: {
          attention_filter?: string | null
          company_filter?: string | null
          created_at?: string
          id?: string
          mood_filter?: string | null
          novelty_filter?: string | null
          platforms?: string[]
          prompt_text?: string | null
          season_hint?: string | null
          source?: string
          time_filter?: string | null
          type_filter?: string | null
          user_id?: string
          weather_hint?: string | null
        }
        Relationships: []
      }
      title_feedback: {
        Row: {
          created_at: string
          id: string
          platform: string | null
          sentiment: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform?: string | null
          sentiment: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string | null
          sentiment?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_user: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
