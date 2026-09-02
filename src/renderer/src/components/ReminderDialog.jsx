import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Switch } from '@douyinfe/semi-ui';

export default function ReminderDialog({ state }) {
  const { reminderDialogState, setReminderDialogState, submitReminder, localDateInputValue } = state;
  const { open, reminder } = reminderDialogState;
  const isEdit = Boolean(reminder);

  const [title, setTitle] = useState('');
  const [type, setType] = useState('medicine');
  const [repeatRule, setRepeatRule] = useState('daily');
  const [timeOfDay, setTimeOfDay] = useState('08:00');
  const [scheduledDate, setScheduledDate] = useState(localDateInputValue());
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(reminder?.title ?? '');
      setType(reminder?.type ?? 'medicine');
      setRepeatRule(reminder?.repeatRule ?? 'daily');
      setTimeOfDay(reminder?.timeOfDay ?? '08:00');
      setScheduledDate(reminder?.scheduledDate ?? localDateInputValue());
      setEnabled(reminder?.enabled ?? true);
    }
  }, [open, reminder]);

  const close = () => setReminderDialogState({ open: false, reminder: null });

  const handleSave = async () => {
    if (!title.trim()) return;
    const draft = {
      id: reminder?.id ?? 0,
      expectedRevision: reminder?.revision ?? 0,
      title: title.trim(),
      type,
      repeatRule,
      timeOfDay,
      scheduledDate,
      enabled
    };
    setSubmitting(true);
    const ok = await submitReminder(draft, 'save');
    setSubmitting(false);
    if (ok) close();
  };

  const handleDelete = () => {
    if (!reminder) return;
    Modal.confirm({
      title: '删除提醒',
      content: `确定删除“${reminder.title}”吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        setSubmitting(true);
        const ok = await submitReminder(
          { id: reminder.id, expectedRevision: reminder.revision, title: reminder.title },
          'delete'
        );
        setSubmitting(false);
        if (ok) close();
      }
    });
  };

  return (
    <Modal
      title={
        <div>
          <div className="eyebrow">日程编辑</div>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{isEdit ? '编辑提醒' : '新增提醒'}</h2>
        </div>
      }
      visible={open}
      onCancel={close}
      width={560}
      footer={
        <>
          {isEdit && (
            <Button type="danger" theme="solid" size="large" loading={submitting} onClick={handleDelete} style={{ marginRight: 'auto' }}>
              删除
            </Button>
          )}
          <Button size="large" onClick={close}>取消</Button>
          <Button size="large" theme="solid" loading={submitting} onClick={handleSave}>保存提醒</Button>
        </>
      }
    >
      <div>
        <label style={{ display: 'block', fontWeight: 600, fontSize: '0.95rem', margin: '4px 0 6px' }}>标题 <span style={{ color: 'var(--lp-danger)' }}>*</span></label>
        <Input value={title} onChange={setTitle} maxLength={40} placeholder="如：午饭后服药" size="large" />
        <div className="reminder-form-grid" style={{ marginTop: 6 }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.95rem', margin: '8px 0 6px' }}>类型</label>
            <Select value={type} onChange={setType} size="large" style={{ width: '100%' }}
              optionList={[
                { value: 'medicine', label: '用药' },
                { value: 'water', label: '喝水' },
                { value: 'other', label: '其他' }
              ]} />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.95rem', margin: '8px 0 6px' }}>重复</label>
            <Select value={repeatRule} onChange={setRepeatRule} size="large" style={{ width: '100%' }}
              optionList={[
                { value: 'daily', label: '每天' },
                { value: 'weekdays', label: '工作日' },
                { value: 'once', label: '仅一次' }
              ]} />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.95rem', margin: '8px 0 6px' }}>时间 <span style={{ color: 'var(--lp-danger)' }}>*</span></label>
            <Input type="time" value={timeOfDay} onChange={setTimeOfDay} size="large" style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.95rem', margin: '8px 0 6px' }}>日期 <span style={{ color: 'var(--lp-danger)' }}>*</span></label>
            <Input type="date" value={scheduledDate} onChange={setScheduledDate} size="large" style={{ width: '100%' }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
          <div>
            <strong style={{ fontSize: '1rem' }}>启用提醒</strong>
            <div className="field-hint">关闭后仍保留在设备中</div>
          </div>
          <Switch checked={enabled} onChange={setEnabled} size="large" aria-label="启用提醒" />
        </div>
      </div>
    </Modal>
  );
}
