import React from 'react'
import { Box, Typography, Button, IconButton, Chip, Divider, InputBase, Stack } from '@mui/material'
import { tokens } from './theme.js'

/* ------------------------------------------------------------------ */
/* Inline SVG marks — no icon fonts, no network                        */
/* ------------------------------------------------------------------ */

const Mark = ({ size = 16, children }) => (
  <Box
    component="svg"
    viewBox="0 0 16 16"
    width={size}
    height={size}
    aria-hidden="true"
    sx={{ display: 'block', flexShrink: 0 }}
  >
    {children}
  </Box>
)

const AsteriskMark = ({ size }) => (
  <Mark size={size}>
    <path d="M8 2v12M2.5 5l11 6M13.5 5l-11 6" stroke={tokens.amber} strokeWidth="1.8" strokeLinecap="square" />
  </Mark>
)

const UserDot = () => (
  <Box sx={{ width: 8, height: 8, bgcolor: tokens.muted, borderRadius: '50%', flexShrink: 0 }} />
)

const SendMark = () => (
  <Mark size={14}>
    <path d="M2 8h10M8 3.5 12.5 8 8 12.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
  </Mark>
)

const DownloadMark = () => (
  <Mark size={14}>
    <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M2.5 13.5h11" stroke="currentColor" strokeWidth="1.6" fill="none" />
  </Mark>
)

const ImageMark = () => (
  <Mark size={14}>
    <rect x="2" y="2.5" width="12" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2 11l3.5-3.5 3 3L11 8l3 3" stroke="currentColor" strokeWidth="1.4" fill="none" />
    <circle cx="5.5" cy="5.5" r="1.2" fill="currentColor" />
  </Mark>
)

const DocMark = () => (
  <Mark size={14}>
    <path d="M4 2h5.5L13 5.5V14H4z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9.5 2v3.5H13" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </Mark>
)

const CloseMark = () => (
  <Mark size={12}>
    <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.6" />
  </Mark>
)

const PlusMark = () => (
  <Mark size={12}>
    <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.8" />
  </Mark>
)

const CheckMark = () => (
  <Mark size={12}>
    <path d="M2.5 8.5 6.5 12 13.5 4.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
  </Mark>
)

/* ------------------------------------------------------------------ */
/* Artifact palette — the deliverable owns its own visual language     */
/* ------------------------------------------------------------------ */

const A = {
  cream: '#F4EEDF',
  cream2: '#EAE1CB',
  espresso: '#241C13',
  clay: '#6E5F4C',
  rust: '#B34A22',
  aline: '#D5C8AB',
}

/* ------------------------------------------------------------------ */
/* Shared pin — reused component receives its anchor via props         */
/* ------------------------------------------------------------------ */

function Pin({ n, anchor, size = 22 }) {
  return (
    <Box
      data-oey-object={anchor}
      aria-label={`Feedback pin ${n}`}
      sx={{
        width: size,
        height: size,
        bgcolor: tokens.amber,
        color: tokens.ink,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: '"SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
        borderRadius: '2px',
        flexShrink: 0,
      }}
    >
      {n}
    </Box>
  )
}

/* Inline reference chip used inside conversation text — matches pins  */
function Ref({ n, children }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        px: '6px',
        py: '2px',
        mx: '2px',
        border: `1px solid ${tokens.amber}`,
        color: tokens.text,
        fontSize: 14,
        verticalAlign: 'middle',
        borderRadius: 2,
        whiteSpace: 'nowrap',
      }}
    >
      <Box component="span" sx={{ color: tokens.amber, fontWeight: 700, fontSize: 12, fontFamily: '"SFMono-Regular", ui-monospace, Menlo, Consolas, monospace' }}>
        {n}
      </Box>
      {children}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

function TopBar() {
  return (
    <Box
      component="header"
      sx={{
        height: 56,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        px: 2.5,
        borderBottom: `1px solid ${tokens.line}`,
        bgcolor: tokens.panel,
        gap: 2,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
        <AsteriskMark size={18} />
        <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.01em' }}>OEYdesign</Typography>
        <Box sx={{ width: 1, height: 18, bgcolor: tokens.line }} />
        <Typography sx={{ fontSize: 14, color: tokens.muted }}>kiln-and-co / seasonal-landing</Typography>
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Chip
        label="Framework candidate 0.9"
        size="small"
        variant="outlined"
        sx={{ fontSize: 14, color: tokens.muted }}
      />
      <Button
        variant="outlined"
        size="small"
        startIcon={<ImageMark />}
        aria-label="Attachments"
        sx={{ color: tokens.muted }}
      >
        Assets
      </Button>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1, borderLeft: `1px solid ${tokens.line}` }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            bgcolor: tokens.ink,
            border: `1px solid ${tokens.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            color: tokens.text,
          }}
        >
          ME
        </Box>
      </Box>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Conversation rail                                                   */
/* ------------------------------------------------------------------ */

const files = [
  { name: 'brand-board.pdf', size: '1.2 MB', icon: 'doc' },
  { name: 'moodboard-v2.png', size: '842 KB', icon: 'img' },
]

const pins = [
  { n: '01', target: 'Hero headline', quote: '“Hand-thrown, small-batch, here for the season.”', note: 'Add a subhead that names the drop — “Autumn Kiln List, 34 pieces.”', state: 'resolved' },
  { n: '02', target: 'Trio — Ash vessel', quote: 'Card 2, glaze photography', note: 'Swap to the speckled close-up; flat front-on reads catalog, not editorial.', state: 'open' },
  { n: '03', target: 'Maker panel', quote: 'Sana Ito portrait + bio', note: 'Crop tighter on the hands at the wheel; keep caption under 20 words.', state: 'open' },
  { n: '04', target: 'Reserve footer', quote: 'Rust CTA block', note: 'Repeat edition count next to the button so urgency survives the scroll.', state: 'open' },
]

function AttachmentCard({ file }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        border: `1px solid ${tokens.line}`,
        bgcolor: tokens.ink,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        minHeight: 40,
      }}
    >
      <Box sx={{ color: tokens.amber }}>{file.icon === 'doc' ? <DocMark /> : <ImageMark />}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, color: tokens.text, fontWeight: 600 }}>{file.name}</Typography>
        <Typography sx={{ fontSize: 14, color: tokens.muted }}>{file.size}</Typography>
      </Box>
    </Box>
  )
}

function VersionCard({ v, note, active }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        border: `1px solid ${active ? tokens.amber : tokens.line}`,
        bgcolor: tokens.ink,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        minHeight: 40,
      }}
    >
      <Typography sx={{ fontSize: 14, fontWeight: 700, color: active ? tokens.amber : tokens.text, fontFamily: '"SFMono-Regular", ui-monospace, Menlo, Consolas, monospace' }}>
        {v}
      </Typography>
      <Typography sx={{ fontSize: 14, color: tokens.muted, flex: 1 }}>{note}</Typography>
      {active && <CheckMark />}
    </Box>
  )
}

function Turn({ role, time, children }) {
  const isAgent = role === 'agent'
  return (
    <Box
      component="article"
      sx={{
        px: 2.5,
        py: 2,
        borderBottom: `1px solid ${tokens.line}`,
        bgcolor: isAgent ? 'transparent' : tokens.panel,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 1 }}>
        {isAgent ? <AsteriskMark size={15} /> : <UserDot />}
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: isAgent ? tokens.amber : tokens.text }}>
          {isAgent ? 'OEY' : 'Mara'}
        </Typography>
        <Typography sx={{ fontSize: 14, color: tokens.muted }}>{time}</Typography>
      </Stack>
      <Stack spacing={1.25} sx={{ pl: '27px' }}>
        {children}
      </Stack>
    </Box>
  )
}

const P = ({ children }) => (
  <Typography sx={{ fontSize: 14, lineHeight: 1.65, color: tokens.text }}>{children}</Typography>
)

function Conversation() {
  return (
    <Box
      component="section"
      data-oey-section="conversation"
      aria-label="Conversation"
      sx={{
        width: 384,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: `1px solid ${tokens.line}`,
        bgcolor: tokens.ink,
        minHeight: 0,
      }}
    >
      {/* Rail header */}
      <Box sx={{ px: 2.5, py: 1.5, borderBottom: `1px solid ${tokens.line}`, bgcolor: tokens.panel, flexShrink: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Session</Typography>
        <Typography sx={{ fontSize: 14, color: tokens.muted }}>Seasonal landing · 4 objects pinned · v0.3 live</Typography>
      </Box>

      {/* Turns */}
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <Turn role="user" time="09:41">
          <P>
            New brief: Kiln &amp; Co, a small ceramics studio. They need a seasonal landing for the autumn
            drop — 34 pieces, reservations open Friday. Warm, editorial, nothing that looks like a template.
            Two references attached.
          </P>
          <Stack spacing={1}>
            {files.map((f) => (
              <AttachmentCard key={f.name} file={f} />
            ))}
          </Stack>
        </Turn>

        <Turn role="agent" time="09:41">
          <P>
            Reading the board: cream ground, espresso ink, a single rust accent, generous margins. I drafted
            v0.1 — a hero statement, a trio of vessels, a maker panel, and a reservation footer. Open on the
            right; tell me what to push.
          </P>
          <VersionCard v="v0.1" note="First pass · structure only" active={false} />
        </Turn>

        <Turn role="user" time="09:52">
          <P>
            Structure is right. Two things: the hero needs a subhead naming the drop, and the second vessel
            photo is the wrong glaze — use the speckled close-up from the moodboard. Pinning both.
          </P>
        </Turn>

        <Turn role="agent" time="09:52">
          <P>
            <Ref n="01">Hero headline</Ref> — added “Autumn Kiln List, 34 pieces” as a deck under the
            statement. <Ref n="02">Ash vessel</Ref> — swapped in the speckled close-up, cropped square.
            Both resolved in v0.2.
          </P>
          <VersionCard v="v0.2" note="Hero deck + glaze swap" active={false} />
        </Turn>

        <Turn role="user" time="10:07">
          <P>
            Better. The maker portrait is too distant — I want hands at the wheel, not a headshot. And the
            reservation footer loses urgency by the time you reach it; the edition count should sit next to
            the button.
          </P>
        </Turn>

        <Turn role="agent" time="10:08">
          <P>
            <Ref n="03">Maker panel</Ref> — recropped to Sana’s hands centering a bowl, caption trimmed to
            18 words. <Ref n="04">Reserve footer</Ref> — “34 pieces · one firing” now sits inside the rust
            block beside the button. Shipping as v0.3.
          </P>
          <VersionCard v="v0.3" note="Maker crop + footer urgency" active={true} />
          <P sx={{ color: tokens.muted }}>
            If the footer feels heavy I can fall back to v0.2 and keep only the caption change — one click
            from the version chips above the canvas.
          </P>
        </Turn>

        <Turn role="user" time="10:15">
          <P>
            v0.3 is the one. Export it — static HTML and a PNG for the client deck — and keep the session
            open in case they ask for a winter variant.
          </P>
        </Turn>

        <Turn role="agent" time="10:15">
          <P>
            Exported. <strong>kiln-seasonal.html</strong> (48 KB, self-contained) and{' '}
            <strong>kiln-hero.png</strong> (2400 px) are ready from the canvas toolbar. Session parked on
            v0.3; say “winter variant” and I’ll branch from here.
          </P>
        </Turn>
      </Box>

      {/* Feedback draft */}
      <Box sx={{ borderTop: `1px solid ${tokens.line}`, bgcolor: tokens.panel, px: 2.5, py: 1.5, flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Feedback draft</Typography>
          <Typography sx={{ fontSize: 14, color: tokens.muted }}>4 of 4 objects</Typography>
        </Stack>
        <Stack spacing={0.75}>
          {pins.map((pin) => (
            <Stack
              key={pin.n}
              direction="row"
              alignItems="center"
              spacing={1.25}
              sx={{ minHeight: 32 }}
            >
              <Pin n={pin.n} anchor={`pin-row-${pin.n}`} size={22} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 14, color: tokens.text, fontWeight: 600, lineHeight: 1.3 }}>
                  {pin.target}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    color: tokens.muted,
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {pin.note}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={pin.state === 'resolved' ? 'Resolved' : 'Open'}
                sx={{
                  fontSize: 14,
                  height: 24,
                  border: `1px solid ${pin.state === 'resolved' ? tokens.amber : tokens.line}`,
                  color: pin.state === 'resolved' ? tokens.amber : tokens.muted,
                  bgcolor: 'transparent',
                }}
              />
              <IconButton size="small" aria-label={`Remove note on ${pin.target}`} sx={{ width: 32, height: 32 }}>
                <CloseMark />
              </IconButton>
            </Stack>
          ))}
        </Stack>
      </Box>

      {/* Composer */}
      <Box sx={{ borderTop: `1px solid ${tokens.line}`, bgcolor: tokens.panel, p: 2, flexShrink: 0 }}>
        <Box
          sx={{
            border: `1px solid ${tokens.line}`,
            bgcolor: tokens.ink,
            borderRadius: 2,
            px: 1.5,
            py: 1,
          }}
        >
          <InputBase
            multiline
            minRows={2}
            maxRows={5}
            fullWidth
            placeholder="Describe a change, or pin an object on the canvas…"
            inputProps={{ 'aria-label': 'Message OEY' }}
            sx={{ fontSize: 14, color: tokens.text, '& ::placeholder': { color: tokens.muted, opacity: 1 } }}
          />
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
            <IconButton size="small" aria-label="Attach file" sx={{ width: 32, height: 32 }}>
              <ImageMark />
            </IconButton>
            <IconButton size="small" aria-label="Attach document" sx={{ width: 32, height: 32 }}>
              <DocMark />
            </IconButton>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              size="small"
              endIcon={<SendMark />}
              sx={{ bgcolor: tokens.amber, color: tokens.ink, '&:hover': { bgcolor: tokens.amber } }}
            >
              Send
            </Button>
          </Stack>
        </Box>
      </Box>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* The artifact — Kiln & Co seasonal landing (own visual language)     */
/* ------------------------------------------------------------------ */

function PinAnchor({ n, anchor }) {
  return (
    <Box sx={{ position: 'absolute', left: -12, top: 20, zIndex: 2 }}>
      <Pin n={n} anchor={anchor} size={24} />
    </Box>
  )
}

/* Vessel “photography” — flat SVG illustrations, no gradients */
function VesselAsh() {
  return (
    <Box component="svg" viewBox="0 0 200 160" sx={{ display: 'block', width: '100%', height: '100%', bgcolor: A.cream2 }}>
      <circle cx="100" cy="80" r="56" fill={A.espresso} />
      <circle cx="100" cy="80" r="46" fill={A.cream2} />
      {/* speckled glaze close-up */}
      {[
        [88, 60, 5], [112, 70, 7], [96, 92, 6], [120, 95, 4], [80, 84, 4],
        [104, 50, 3], [126, 80, 5], [90, 108, 3], [110, 110, 4], [76, 70, 3],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={A.espresso} />
      ))}
      <circle cx="100" cy="80" r="56" fill="none" stroke={A.espresso} strokeWidth="3" />
    </Box>
  )
}

function VesselMoon() {
  return (
    <Box component="svg" viewBox="0 0 200 160" sx={{ display: 'block', width: '100%', height: '100%', bgcolor: A.espresso }}>
      <path d="M60 130 Q60 60 100 52 Q140 60 140 130 Z" fill={A.cream} />
      <path d="M86 52 h28 v-10 h-28 z" fill={A.cream} />
      <path d="M70 96 Q100 84 130 96" stroke={A.rust} strokeWidth="4" fill="none" />
    </Box>
  )
}

function VesselRust() {
  return (
    <Box component="svg" viewBox="0 0 200 160" sx={{ display: 'block', width: '100%', height: '100%', bgcolor: A.cream2 }}>
      <path d="M55 40 h90 v14 q0 66 -45 66 q-45 0 -45 -66 z" fill={A.rust} />
      <rect x="70" y="30" width="60" height="10" fill={A.rust} />
      <path d="M55 54 h90" stroke={A.espresso} strokeWidth="3" />
    </Box>
  )
}

function HandsAtWheel() {
  return (
    <Box component="svg" viewBox="0 0 360 240" sx={{ display: 'block', width: '100%', height: '100%', bgcolor: A.espresso }}>
      {/* wheel */}
      <ellipse cx="180" cy="196" rx="120" ry="22" fill={A.clay} />
      <ellipse cx="180" cy="190" rx="120" ry="22" fill={A.cream2} />
      {/* centered bowl on wheel */}
      <path d="M140 190 Q140 148 180 146 Q220 148 220 190 Z" fill={A.rust} />
      {/* hands shaping the bowl */}
      <path d="M96 60 Q120 96 138 132 Q146 148 138 152 Q126 156 116 140 Q98 104 82 72 Z" fill={A.cream} />
      <path d="M264 60 Q240 96 222 132 Q214 148 222 152 Q234 156 244 140 Q262 104 278 72 Z" fill={A.cream} />
      {/* sleeve lines */}
      <path d="M82 72 Q96 66 108 74" stroke={A.cream2} strokeWidth="6" fill="none" />
      <path d="M278 72 Q264 66 252 74" stroke={A.cream2} strokeWidth="6" fill="none" />
    </Box>
  )
}

const serif = 'Georgia, "Times New Roman", ui-serif, serif'

function Artifact() {
  return (
    <Box
      data-oey-preview-root="artifact"
      component="main"
      aria-label="Kiln and Co seasonal landing artifact"
      sx={{
        bgcolor: A.cream,
        color: A.espresso,
        border: `1px solid ${tokens.line}`,
        maxWidth: 1080,
        mx: 'auto',
        width: '100%',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      }}
    >
      {/* Artifact masthead */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 5,
          py: 2,
          borderBottom: `1px solid ${A.aline}`,
        }}
      >
        <Typography sx={{ fontFamily: serif, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em', color: A.espresso }}>
          Kiln <Box component="span" sx={{ color: A.rust }}>&amp;</Box> Co.
        </Typography>
        <Stack direction="row" spacing={3} component="nav" aria-label="Artifact navigation">
          {['The List', 'Vessels', 'Maker', 'Reserve'].map((item) => (
            <Typography key={item} sx={{ fontSize: 14, fontWeight: 600, color: A.clay, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {item}
            </Typography>
          ))}
        </Stack>
      </Box>

      {/* Hero — pin 01 */}
      <Box data-oey-object="artifact-hero" sx={{ position: 'relative', px: 5, pt: 7, pb: 6, borderBottom: `1px solid ${A.aline}` }}>
        <PinAnchor n="01" anchor="artifact-hero-pin" />
        <Typography
          sx={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: A.rust, mb: 2 }}
        >
          Autumn Kiln List · No. 07
        </Typography>
        <Typography
          component="h1"
          sx={{ fontFamily: serif, fontSize: 56, lineHeight: 1.05, fontWeight: 700, color: A.espresso, maxWidth: 720, letterSpacing: '-0.01em' }}
        >
          Hand-thrown, small-batch, here for the season.
        </Typography>
        <Typography sx={{ fontFamily: serif, fontSize: 22, fontStyle: 'italic', color: A.clay, mt: 2.5, maxWidth: 560, lineHeight: 1.4 }}>
          The Autumn Kiln List — thirty-four pieces from a single firing, reserved in order of asking.
        </Typography>
        <Stack direction="row" spacing={4} sx={{ mt: 4 }}>
          {[
            ['34', 'pieces in the firing'],
            ['01', 'kiln, one weekend'],
            ['Fri', 'reservations open, 9:00'],
          ].map(([big, small]) => (
            <Box key={small} sx={{ borderLeft: `2px solid ${A.rust}`, pl: 1.5 }}>
              <Typography sx={{ fontFamily: serif, fontSize: 28, fontWeight: 700, color: A.espresso, lineHeight: 1.1 }}>{big}</Typography>
              <Typography sx={{ fontSize: 14, color: A.clay }}>{small}</Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      {/* Trio — pin 02 on the ash vessel */}
      <Box sx={{ px: 5, py: 6, borderBottom: `1px solid ${A.aline}` }}>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 3 }}>
          <Typography component="h2" sx={{ fontFamily: serif, fontSize: 28, fontWeight: 700, color: A.espresso }}>
            Three from the shelf
          </Typography>
          <Typography sx={{ fontSize: 14, color: A.clay }}>Stoneware · wood-ash and rust glazes</Typography>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
          {[
            { name: 'Moon jar', glaze: 'Matte white, rust band', price: '240', art: <VesselMoon /> },
            { name: 'Ash vessel', glaze: 'Speckled wood-ash close-up', price: '180', art: <VesselAsh />, pin: true },
            { name: 'Rust pourer', glaze: 'Iron-rust, dipped rim', price: '160', art: <VesselRust /> },
          ].map((v) => (
            <Box
              key={v.name}
              {...(v.pin ? { 'data-oey-object': 'artifact-trio-ash' } : {})}
              sx={{ position: 'relative', border: `1px solid ${A.aline}`, bgcolor: '#FBF7EC' }}
            >
              {v.pin && <PinAnchor n="02" anchor="artifact-trio-ash-pin" />}
              <Box sx={{ height: 180, borderBottom: `1px solid ${A.aline}` }}>{v.art}</Box>
              <Box sx={{ p: 2 }}>
                <Stack direction="row" alignItems="baseline" justifyContent="space-between">
                  <Typography sx={{ fontFamily: serif, fontSize: 18, fontWeight: 700, color: A.espresso }}>{v.name}</Typography>
                  <Typography sx={{ fontFamily: serif, fontSize: 18, color: A.rust, fontWeight: 700 }}>€{v.price}</Typography>
                </Stack>
                <Typography sx={{ fontSize: 14, color: A.clay, mt: 0.5 }}>{v.glaze}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Maker — pin 03 */}
      <Box
        data-oey-object="artifact-maker"
        sx={{ position: 'relative', display: 'grid', gridTemplateColumns: '5fr 7fr', borderBottom: `1px solid ${A.aline}` }}
      >
        <PinAnchor n="03" anchor="artifact-maker-pin" />
        <Box sx={{ borderRight: `1px solid ${A.aline}`, minHeight: 280 }}>
          <HandsAtWheel />
        </Box>
        <Box sx={{ p: 5, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: A.rust, mb: 1.5 }}>
            The maker
          </Typography>
          <Typography component="h2" sx={{ fontFamily: serif, fontSize: 32, fontWeight: 700, color: A.espresso, lineHeight: 1.15 }}>
            Sana Ito throws every piece herself.
          </Typography>
          <Typography sx={{ fontSize: 16, color: A.clay, lineHeight: 1.6, mt: 2, maxWidth: 460 }}>
            One wheel, one kiln, one pair of hands. Sana centers, pulls, and trims each vessel in her
            Lisbon studio — no molds, no second firing, no two alike.
          </Typography>
          <Typography sx={{ fontFamily: serif, fontStyle: 'italic', fontSize: 16, color: A.espresso, mt: 2.5 }}>
            “The kiln decides the glaze. I only ask nicely.”
          </Typography>
        </Box>
      </Box>

      {/* Reserve — pin 04 */}
      <Box data-oey-object="artifact-reserve" sx={{ position: 'relative', bgcolor: A.rust, color: A.cream, px: 5, py: 5 }}>
        <PinAnchor n="04" anchor="artifact-reserve-pin" />
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems="center" spacing={4}>
          <Box sx={{ flex: 1 }}>
            <Typography component="h2" sx={{ fontFamily: serif, fontSize: 32, fontWeight: 700, lineHeight: 1.15 }}>
              Reserve your piece Friday, 9:00.
            </Typography>
            <Typography sx={{ fontSize: 16, mt: 1, color: A.cream, opacity: 0.92 }}>
              Reservations close when the list does.
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" spacing={3}>
            <Box sx={{ textAlign: 'right', borderRight: '1px solid rgba(244,238,223,0.5)', pr: 3 }}>
              <Typography sx={{ fontFamily: serif, fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>34 pieces</Typography>
              <Typography sx={{ fontSize: 14 }}>one firing, no restock</Typography>
            </Box>
            <Button
              disableElevation
              sx={{
                bgcolor: A.espresso,
                color: A.cream,
                fontSize: 16,
                fontWeight: 700,
                px: 4,
                minHeight: 48,
                borderRadius: 0,
                '&:hover': { bgcolor: A.espresso },
              }}
            >
              Join the list
            </Button>
          </Stack>
        </Stack>
      </Box>

      {/* Artifact footer */}
      <Box sx={{ px: 5, py: 2, display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${A.aline}` }}>
        <Typography sx={{ fontSize: 14, color: A.clay }}>Kiln &amp; Co. · Rua do Forno 12, Lisboa</Typography>
        <Typography sx={{ fontSize: 14, color: A.clay }}>Autumn list closes Sunday</Typography>
      </Box>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Canvas — preview surface + toolbar                                  */
/* ------------------------------------------------------------------ */

function Canvas() {
  const versions = ['v0.1', 'v0.2', 'v0.3']
  return (
    <Box component="section" aria-label="Artifact preview" sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      {/* Canvas toolbar */}
      <Box
        sx={{
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          px: 2.5,
          gap: 1.5,
          borderBottom: `1px solid ${tokens.line}`,
          bgcolor: tokens.panel,
        }}
      >
        <DocMark />
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>kiln-seasonal.html</Typography>
        <Box sx={{ width: 1, height: 18, bgcolor: tokens.line }} />
        <Stack direction="row" spacing={0.75} component="nav" aria-label="Versions">
          {versions.map((v) => {
            const active = v === 'v0.3'
            return (
              <Button
                key={v}
                size="small"
                aria-current={active ? 'true' : undefined}
                sx={{
                  minHeight: 32,
                  px: 1.25,
                  fontSize: 14,
                  fontFamily: '"SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
                  color: active ? tokens.ink : tokens.muted,
                  bgcolor: active ? tokens.amber : 'transparent',
                  border: `1px solid ${active ? tokens.amber : tokens.line}`,
                  '&:hover': { bgcolor: active ? tokens.amber : 'rgba(217,164,65,0.08)' },
                }}
              >
                {v}
              </Button>
            )
          })}
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 14, color: tokens.muted }}>1280 × 800 · live preview</Typography>
        <Button variant="outlined" size="small" startIcon={<DownloadMark />}>
          Export
        </Button>
      </Box>

      {/* Preview surface */}
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, bgcolor: tokens.ink, p: 3 }}>
        <Artifact />
        <Box sx={{ maxWidth: 1080, mx: 'auto', mt: 1.5, display: 'flex', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: 14, color: tokens.muted }}>
            Rendered from v0.3 · 4 pins placed on this artifact
          </Typography>
          <Typography sx={{ fontSize: 14, color: tokens.muted }}>Self-contained · no external assets</Typography>
        </Box>
      </Box>
    </Box>
  )
}

/* ------------------------------------------------------------------ */

export default function App() {
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: tokens.ink }}>
      <TopBar />
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Conversation />
        <Canvas />
      </Box>
    </Box>
  )
}
