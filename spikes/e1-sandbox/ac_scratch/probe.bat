@echo off
type "D:\projects2\OEYdesign\spikes\e1-sandbox\ac_scratch\inside.txt" > "D:\projects2\OEYdesign\spikes\e1-sandbox\ac_scratch\r_read_inside.txt" 2>&1
type "D:\projects2\OEYdesign\spikes\e1-sandbox\outside_secret.txt" > "D:\projects2\OEYdesign\spikes\e1-sandbox\ac_scratch\r_read_outside.txt" 2>&1
type "C:\Windows\win.ini" > "D:\projects2\OEYdesign\spikes\e1-sandbox\ac_scratch\r_read_winini.txt" 2>&1
echo WROTE-INSIDE > "D:\projects2\OEYdesign\spikes\e1-sandbox\ac_scratch\r_write_inside.txt" 2>&1
echo WROTE-OUTSIDE > "D:\projects2\OEYdesign\spikes\e1-sandbox\r_write_outside.txt" 2>&1
certutil -urlcache -split -f http://example.com "D:\projects2\OEYdesign\spikes\e1-sandbox\ac_scratch\net.bin" > "D:\projects2\OEYdesign\spikes\e1-sandbox\ac_scratch\r_network.txt" 2>&1
exit /b 0
