export const colors = {
  // Primary
  primary: '#007AFF',
  primaryLight: '#4DA3FF',
  primaryDark: '#0055CC',

  // Backgrounds
  background: '#FFFFFF',
  backgroundSecondary: '#F2F2F7',
  backgroundTertiary: '#E5E5EA',

  // Text
  text: '#000000',
  textSecondary: '#3C3C43',
  textTertiary: '#8E8E93',
  textInverse: '#FFFFFF',

  // Status
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  info: '#5AC8FA',

  // Chat
  userBubble: '#007AFF',
  assistantBubble: '#E5E5EA',
  userBubbleText: '#FFFFFF',
  assistantBubbleText: '#000000',

  // Borders
  border: '#C6C6C8',
  borderLight: '#E5E5EA',

  // Misc
  overlay: 'rgba(0, 0, 0, 0.4)',
  shadow: 'rgba(0, 0, 0, 0.1)',

  // Speech/Recording
  recording: '#FF3B30',
  recordingLight: '#FF6961',
  waveform: '#007AFF',
} as const;

// Dark mode colors (for future)
export const darkColors = {
  ...colors,
  background: '#000000',
  backgroundSecondary: '#1C1C1E',
  backgroundTertiary: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#EBEBF5',
  textTertiary: '#8E8E93',
  assistantBubble: '#2C2C2E',
  assistantBubbleText: '#FFFFFF',
  border: '#38383A',
  borderLight: '#2C2C2E',
} as const;

export type Colors = typeof colors;
