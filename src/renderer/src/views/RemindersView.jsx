import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { IconPlus } from '@douyinfe/semi-icons';
import { TYPE_LABELS, REPEAT_LABELS, STATUS_LABELS } from '../hooks/useAppState';

export default function RemindersView({ state, active }) {
  const { dashboard, remindersAreWritable, setReminderDialogState } = state;
  const reminders = dashboard?.reminders || [];
  const writable = remindersAreWritable();

  const sorted = [...reminders].sort((left, right) => left.timeOfDay.localeCompare(right.timeOfDay));

  const openDialog = (reminder = null) => setReminderDialogState({ open: true, reminder });

  return (
    <section className={'view' + (active ? ' active' : '')} id="view-reminders" aria-labelledby="page-title">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">设备日程</span>
            <h2>远程提醒</h2>
          </div>
          <Button id="add-reminder-button" theme="solid" icon={<IconPlus />} size="large"
            disabled={!writable} onClick={() => openDialog()}>
            新增提醒
          </Button>
        </div>

        <div className="reminder-list" id="reminder-list">
          {sorted.length === 0 ? (
            <div className="empty-state">
              <span className="empty-symbol">◷</span>
              暂无提醒，可以从家属端新增
            </div>
          ) : (
            sorted.map((reminder) => (
              <article key={reminder.id} className="reminder-item">
                <div className="reminder-time">{reminder.timeOfDay}</div>
                <div className="reminder-copy">
                  <strong>{reminder.title}</strong>
                  <span>
                    {TYPE_LABELS[reminder.type]} · {REPEAT_LABELS[reminder.repeatRule]} · {reminder.scheduledDate}
                  </span>
                </div>
                <span className={'reminder-state' + (reminder.enabled ? '' : ' disabled')}>
                  {STATUS_LABELS[reminder.status] ?? reminder.status}
                </span>
                <Button
                  data-reminder-id={reminder.id}
                  size="large"
                  disabled={!writable}
                  onClick={() => openDialog(reminder)}
                >
                  {writable ? '编辑' : '只读'}
                </Button>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
