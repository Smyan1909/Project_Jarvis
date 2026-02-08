// =============================================================================
// Color Palette - Dark Mode (Coder-Friendly)
// =============================================================================
// Inspired by Iron Man's Jarvis HUD and modern IDE dark themes.
// High contrast for readability, cyan primary color, green accents.

export const colors = {
  // Primary - Cyan (Jarvis HUD inspired)
  primary: '#00D9FF',
  primaryLight: '#5CE1FF',
  primaryDark: '#00A8CC',

  // Backgrounds - Deep dark (GitHub dark / IDE-like)
  background: '#0D1117',
  backgroundSecondary: '#161B22',
  backgroundTertiary: '#21262D',

  // Text - High contrast for readability
  text: '#E6EDF3',
  textSecondary: '#8B949E',
  textTertiary: '#6E7681',
  textInverse: '#0D1117',

  // Status colors
  success: '#3FB950',
  warning: '#D29922',
  error: '#F85149',
  info: '#58A6FF',

  // Chat bubble colors
  userBubble: '#238636',
  assistantBubble: '#21262D',
  userBubbleText: '#FFFFFF',
  assistantBubbleText: '#E6EDF3',

  // Accent colors
  accent: '#A371F7',
  accentSecondary: '#F778BA',

  // Border colors
  border: '#30363D',
  borderLight: '#21262D',

  // Agent type colors (for task observability)
  agentGeneral: '#58A6FF',
  agentResearch: '#A371F7',
  agentCoding: '#3FB950',
  agentScheduling: '#D29922',
  agentProductivity: '#F778BA',
  agentMessaging: '#00D9FF',

  // Task status colors
  taskPending: '#6E7681',
  taskInProgress: '#00D9FF',
  taskCompleted: '#3FB950',
  taskFailed: '#F85149',

  // Misc
  overlay: 'rgba(0, 0, 0, 0.7)',
  shadow: 'rgba(0, 0, 0, 0.4)',

  // Speech/Recording
  recording: '#F85149',
  recordingLight: '#FF6B6B',
  waveform: '#00D9FF',
} as const;

// Dark mode colors (same as main colors since we're dark by default)
export const darkColors = colors;

export type Colors = typeof colors;
