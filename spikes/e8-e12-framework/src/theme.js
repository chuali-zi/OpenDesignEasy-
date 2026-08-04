import { createTheme } from '@mui/material/styles'

export const tokens = {
  bg: '#141311',
  surface: '#1e1c19',
  ink: '#edeae3',
  muted: '#a8a29a',
  line: '#33302b',
  accent: '#e8602c',
}

export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: tokens.bg, paper: tokens.surface },
    text: { primary: tokens.ink, secondary: tokens.muted },
    divider: tokens.line,
    primary: {
      main: tokens.accent,
      light: tokens.accent,
      dark: tokens.accent,
      contrastText: tokens.bg,
    },
    secondary: { main: tokens.muted, light: tokens.muted, dark: tokens.muted, contrastText: tokens.bg },
    success: { main: tokens.accent, light: tokens.accent, dark: tokens.accent, contrastText: tokens.bg },
    warning: { main: tokens.accent, light: tokens.accent, dark: tokens.accent, contrastText: tokens.bg },
    error: { main: tokens.accent, light: tokens.accent, dark: tokens.accent, contrastText: tokens.bg },
    info: { main: tokens.accent, light: tokens.accent, dark: tokens.accent, contrastText: tokens.bg },
    grey: {
      50: tokens.ink, 100: tokens.ink, 200: tokens.muted, 300: tokens.muted,
      400: tokens.muted, 500: tokens.line, 600: tokens.line, 700: tokens.surface,
      800: tokens.surface, 900: tokens.bg, A100: tokens.ink, A200: tokens.muted,
      A400: tokens.line, A700: tokens.surface,
    },
    action: {
      active: tokens.ink,
      hover: tokens.surface,
      selected: tokens.accent,
      disabled: tokens.muted,
      disabledBackground: tokens.surface,
      focus: tokens.accent,
    },
  },
  shape: { borderRadius: 2 },
  typography: {
    fontFamily: 'Arial, sans-serif',
    h1: { fontSize: '28px', fontWeight: 600 },
    h2: { fontSize: '20px', fontWeight: 600 },
    body1: { fontSize: '15px', lineHeight: 1.6 },
    body2: { fontSize: '14px', lineHeight: 1.5 },
    button: { fontSize: '14px', textTransform: 'none' },
  },
  spacing: 4,
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 32,
          transition: 'none',
          '&.Mui-focusVisible': { color: tokens.bg, backgroundColor: tokens.accent },
          '&.Mui-disabled': { color: tokens.muted, borderColor: tokens.line, backgroundColor: tokens.surface },
        },
        containedPrimary: {
          '&:hover': { color: tokens.bg, backgroundColor: tokens.accent },
          '&:focus-visible': { outline: `2px solid ${tokens.ink}`, outlineOffset: -3 },
        },
        outlined: {
          borderColor: tokens.accent,
          color: tokens.accent,
          '&:hover': { borderColor: tokens.accent, color: tokens.bg, backgroundColor: tokens.accent },
          '&:focus-visible': { outline: `2px solid ${tokens.accent}`, outlineOffset: 2 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { color: tokens.muted },
        outlined: { borderColor: tokens.line },
      },
    },
    MuiDivider: { styleOverrides: { root: { color: tokens.line, borderColor: tokens.line } } },
    MuiPaper: { defaultProps: { elevation: 0 } },
  },
})
