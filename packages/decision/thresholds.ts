/** Engineering signal cutoffs only, not professional business admission rules. */
export const MODEL_SIGNAL_POLICY='model-signal-thresholds-v1'
export const MODEL_SIGNAL_THRESHOLDS={
  dashboard_display:{min_confidence:0.65},
  research_route:{min_confidence:0.8,min_choice_probability:0.65,min_sufficiency:0.75},
  general_map_fit:{low_max:2,high_min:3.5},
} as const
