import React, { useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { useAppState } from './hooks/useAppState';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import DashboardView from './views/DashboardView';
import SettingsView from './views/SettingsView';
import RemindersView from './views/RemindersView';
import VisionMonitorView from './views/VisionMonitorView';
import VideoCallView from './views/VideoCallView';
import ConnectionDialog from './components/ConnectionDialog';
import ReminderDialog from './components/ReminderDialog';

export default function App() {
  const showToast = useCallback((message, error = false) => {
    if (error) Toast.error({ content: message, duration: 3.5 });
    else Toast.success({ content: message, duration: 3.5 });
  }, []);

  const state = useAppState({ onToast: showToast });

  return (
    <div className="app-shell">
      <Sidebar state={state} />
      <main>
        <Topbar state={state} />
        <DashboardView state={state} active={state.activeView === 'dashboard'} />
        <SettingsView state={state} active={state.activeView === 'settings'} />
        <RemindersView state={state} active={state.activeView === 'reminders'} />
        <VisionMonitorView active={state.activeView === 'ai-view'} />
        <VideoCallView state={state} active={state.activeView === 'video-call'} />
      </main>
      <ConnectionDialog state={state} />
      <ReminderDialog state={state} />
    </div>
  );
}
