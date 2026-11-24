export interface OnboardingConfig {
  startup_behavior?: 'blank' | 'workspace';
  workspace_folder?: string | null;
  color_theme?: string;
  appearance?: 'light' | 'dark' | 'system';
  editor_font_family?: string;
  language?: string;
  custom_lang_hash?: string;
}
