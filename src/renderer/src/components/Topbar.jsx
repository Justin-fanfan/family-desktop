import React, { useEffect, useState } from 'react';
import { Button, Radio, Tooltip } from '@douyinfe/semi-ui';
import { IconRefresh, IconMoon, IconSun } from '@douyinfe/semi-icons';
import { PAGE_TITLES } from '../hooks/useAppState';
import { useTheme, FONT_LEVELS } from '../theme/ThemeContext';

function formatNow() {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date());
}

export default function Topbar({ state }) {
  const { activeView, dashboard, busy, connection, refreshDashboard, setConnectionDialogOpen } = state;
  const { fontSize, setFontSize, dark, setDark } = useTheme();
  const [syncText, setSyncText] = useState('尚未同步');

  useEffect(() => {
    if (!dashboard) { setSyncText('尚未同步'); return; }
    setSyncText(`同步于 ${formatNow()}`);
  }, [dashboard]);

  const handleRefresh = () => {
    refreshDashboard(false).catch(() => {});
  };

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">家庭陪伴控制台</p>
        <h1 id="page-title">{PAGE_TITLES[activeView]}</h1>
      </div>
      <div className="topbar-actions">
        <div className="display-controls" aria-label="显示设置">
          <span className="font-label">字号</span>
          <Radio.Group
            type="button"
            value={fontSize}
            onChange={(event) => setFontSize(event.target.value)}
            options={FONT_LEVELS.map((level) => ({ label: level.label, value: level.key }))}
            buttonSize="small"
            aria-label="字体大小"
          />
          <Tooltip content={dark ? '切换浅色模式' : '切换深色模式'}>
            <button
              type="button"
              className="theme-icon-btn"
              aria-label={dark ? '切换浅色模式' : '切换深色模式'}
              onClick={() => setDark(!dark)}
            >
              {dark ? <IconSun size="large" /> : <IconMoon size="large" />}
            </button>
          </Tooltip>
        </div>
        <span className="sync-time" id="sync-time">{syncText}</span>
        <Button
          id="refresh-button"
          icon={<IconRefresh />}
          loading={busy}
          onClick={handleRefresh}
          size="large"
        >
          刷新
        </Button>
        <Button
          id="connection-button"
          theme="solid"
          size="large"
          onClick={() => setConnectionDialogOpen(true)}
        >
          {connection ? '切换连接' : '连接设备'}
        </Button>
      </div>
    </header>
  );
}
