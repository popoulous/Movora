// Movora design tokens — the same palette as the web/webOS apps (#05060B base with a
// violet -> pink accent). `gradient` is a colour pair for react-native-linear-gradient.

export const theme = {
  bg: '#05060B',
  surface: 'rgba(255,255,255,0.05)',
  surfaceStrong: 'rgba(255,255,255,0.09)',
  border: 'rgba(255,255,255,0.10)',
  text: '#f2f2f7',
  muted: '#9aa0b4',
  accent: '#7A4DFF',
  accent2: '#EC4899',
  gradient: ['#7A4DFF', '#EC4899'] as [string, string],
  radius: 12,
} as const;
