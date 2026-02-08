import { TextStyle } from 'react-native';

export const typography = {
  // Headings
  h1: {
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 41,
    letterSpacing: 0.37,
  } as TextStyle,

  h2: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: 0.36,
  } as TextStyle,

  h3: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 28,
    letterSpacing: 0.35,
  } as TextStyle,

  // Body
  body: {
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 22,
    letterSpacing: -0.41,
  } as TextStyle,

  bodySmall: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
    letterSpacing: -0.24,
  } as TextStyle,

  // Captions
  caption: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    letterSpacing: -0.08,
  } as TextStyle,

  captionSmall: {
    fontSize: 11,
    fontWeight: '400',
    lineHeight: 13,
    letterSpacing: 0.07,
  } as TextStyle,

  // Buttons
  button: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
    letterSpacing: -0.41,
  } as TextStyle,

  buttonSmall: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    letterSpacing: -0.24,
  } as TextStyle,
} as const;

export type Typography = typeof typography;
