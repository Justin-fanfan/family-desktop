import React from 'react';
import { IconHome, IconSetting, IconBell, IconVideo } from '@douyinfe/semi-icons';

const NAV_ITEMS = [
  { view: 'dashboard', label: '设备状态', icon: <IconHome size="large" /> },
  { view: 'settings', label: '远程设置', icon: <IconSetting size="large" /> },
  { view: 'reminders', label: '提醒管理', icon: <IconBell size="large" /> },
  { view: 'ai-view', label: 'AI 视野', icon: <span aria-hidden="true">◎</span> },
  { view: 'video-call', label: '语音 / 视频通话', icon: <IconVideo size="large" /> }
];

function connectionModeText(connection, online) {
  if (!connection) return { mode: '准备连接', address: '--' };
  if (connection.mode === 'mock') return { mode: '演示模式', address: connection.baseUrl };
  return { mode: online === false ? '设备离线' : '局域网设备', address: connection.baseUrl };
}

export default function Sidebar({ state }) {
  const { connection, connectionOnline, activeView, setActiveView } = state;
  const { mode, address } = connectionModeText(connection, connectionOnline);
  const dotClass = connectionOnline === true ? ' online' : connectionOnline === false ? ' error' : '';

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">LP</div>
        <div>
          <strong>LongPet</strong>
          <span>家属端</span>
        </div>
      </div>

      <nav aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            data-view={item.view}
            className={'nav-button' + (activeView === item.view ? ' active' : '')}
            onClick={() => setActiveView(item.view)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <span className={'connection-dot' + dotClass} id="connection-dot" />
        <div>
          <strong id="connection-mode">{mode}</strong>
          <span id="connection-address">{address}</span>
        </div>
      </div>
    </aside>
  );
}
