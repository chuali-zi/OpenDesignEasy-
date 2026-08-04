import { createTheme } from '@mui/material/styles'

// The six shell tokens. Nothing else may appear in the workspace chrome.
export const tokens = {
  ink: '#131519',
  panel: '#1C1F24',
  line: '#32363E',
  text: '#ECE9E2',
  muted: '#9AA1AB',
  amber: '#D9A441',
}

export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: tokens.ink, paper: tokens.panel },
    text: { primary: tokens.text, secondary: tokens.muted, disabled: tokens.muted },
    divider: tokens.line,
    // Every MUI semantic channel re-points at the six tokens so no
    // seventh palette color can leak in via defaults.
    primary: { main: tokens.amber, contrastText: tokens.ink },
    secondary: { main: tokens.muted, contrastText: tokens.ink },
    error: { main: tokens.amber, contrastText: tokens.ink },
    warning: { main: tokens.amber, contrastText: tokens.ink },
    info: { main: tokens.amber, contrastText: tokens.ink },
    success: { main: tokens.amber, contrastText: tokens.ink },
    action: {
      active: tokens.text,
      hover: 'rgba(217,164,65,0.10)',
      selected: 'rgba(217,164,65,0.16)',
      disabled: tokens.muted,
      disabledBackground: tokens.panel,
      focus: 'rgba(217,164,65,0.22)',
    },
  },
  shape: { borderRadius: 2 },
  typography: {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 14,
    button: { textTransform: 'none', fontWeight: 600, fontSize: 14 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: tokens.ink,
          color: tokens.text,
          overscrollBehavior: 'none',
          '::-webkit-scrollbar': { width: 10, height: 10 },
          '::-webkit-scrollbar-thumb': {
            background: tokens.line,
            border: `3px solid ${tokens.ink}`,
            borderRadius: 6,
          },
          '::-webkit-scrollbar-track': { background: 'transparent' },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 32,
          borderRadius: 2,
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        },
        outlined: {
          borderColor: tokens.line,
          color: tokens.text,
          '&:hover': { borderColor: tokens.amber, backgroundColor: 'rgba(217,164,65,0.08)' },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          minWidth: 32,
          minHeight: 32,
          color: tokens.muted,
          '&:hover': { color: tokens.amber, backgroundColor: 'rgba(217,164,65,0.10)' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          height: 24,
          fontSize: 14,
          borderColor: tokens.line,
          color: tokens.muted,
        },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: tokens.line } } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: tokens.panel, color: tokens.text, border: `1px solid ${tokens.line}`, fontSize: 14 },
      },
    },
  },
})
