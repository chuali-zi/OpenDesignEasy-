import {
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material'

const objects = Array.from({ length: 20 }, (_, index) => ({
  id: `card-${String(index + 1).padStart(2, '0')}`,
  title: `校样对象 ${String(index + 1).padStart(2, '0')}`,
  note: index % 2 ? '版式已校准' : '等待对象级反馈',
}))

function ObjectCard({ object }) {
  return (
    <Paper
      data-oey-object={object.id}
      variant="outlined"
      sx={{ borderColor: 'divider', bgcolor: 'background.paper', p: 3 }}
    >
      <Typography variant="h2">{object.title}</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        {object.note}
      </Typography>
    </Paper>
  )
}

export default function App() {
  return (
    <Box data-oey-section="workspace" sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '340px 1fr' }}>
      <Box component="aside" data-oey-section="conversation" sx={{ borderRight: 1, borderColor: 'divider', bgcolor: 'background.paper', p: 5 }}>
        <Typography variant="h1">OEYdesign</Typography>
        <Typography color="text.secondary">Framework baseline</Typography>
        <Divider sx={{ my: 4 }} />
        <List disablePadding>
          {['收紧标题层级', '统一对象间距', '确认导出边界'].map((text, index) => (
            <ListItem key={text} disableGutters data-oey-object={`message-${index + 1}`} sx={{ py: 2 }}>
              <Stack>
                <Typography>{text}</Typography>
                <Typography variant="body2" color="text.secondary">已应用到当前版本</Typography>
              </Stack>
            </ListItem>
          ))}
        </List>
        <Button fullWidth variant="contained" sx={{ mt: 5, minHeight: 36 }}>发送修改</Button>
      </Box>

      <Box component="main" data-oey-section="preview-area" sx={{ p: 6 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="h1">当前校样</Typography>
            <Chip label="v3.2" variant="outlined" />
          </Stack>
          <Button variant="outlined">导出</Button>
        </Stack>
        <Box
          data-oey-preview-root="artifact"
          sx={{ bgcolor: '#ffffff', color: '#1c1b18', p: 5, minHeight: 620 }}
        >
          <Typography variant="h1" sx={{ color: '#1c1b18', mb: 4 }}>对象注册表预览</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 3 }}>
            {objects.map((object) => <ObjectCard key={object.id} object={object} />)}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
