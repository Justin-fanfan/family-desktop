import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import {
  IconWifi, IconBolt, IconVolume2, IconBell,
  IconActivity, IconLikeThumb, IconArrowRight
} from '@douyinfe/semi-icons';
import { TYPE_LABELS, REPEAT_LABELS, formatDateTime } from '../hooks/useAppState';

function MetricCard({ icon, iconBg, label, value, detail }) {
  return (
    <article className="metric-card">
      <span className="metric-label">
        <span className="metric-icon" style={{ background: iconBg }}>{icon}</span>
        {label}
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function CareCell({ value, label }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function DashboardView({ state, active }) {
  const { dashboard, setActiveView } = state;
  const { status, settings, reminders } = dashboard || {};

  let deviceName = '尚未连接 LongPet';
  let deviceVersion = '连接设备后可查看实时状态';
  let deviceTime = '--:--';
  let deviceDate = '----';
  let online = false;
  let onlineBadgeText = '状态未知';

  let networkValue = '--';
  let networkDetail = '等待同步';
  let powerValue = '--';
  let batteryDetail = '电池状态未知';
  let audioValue = '--';
  let reminderCount = '--';
  let careWater = '--';
  let careMedicine = '--';
  let careActivity = '--';
  let careInteraction = '--';
  let nextReminder = null;

  if (status) {
    const { device, system, care } = status;
    const dateTime = formatDateTime(system?.currentDateTime);
    deviceName = device.name;
    deviceVersion = `设备 ${device.id} · LongPet ${device.softwareVersion}`;
    deviceTime = dateTime.time;
    deviceDate = dateTime.date;
    online = device.online;
    onlineBadgeText = device.online ? '设备在线' : '设备离线';

    networkValue = system?.networkAvailable ? '网络正常' : '网络不可用';
    networkDetail = device.networkSummary;
    powerValue = device.powerSummary || '状态未知';
    batteryDetail = system?.batteryPercent >= 0 ? `电量 ${system.batteryPercent}%` : '无电池读数';
    audioValue = device.audioSummary || '状态未知';
    reminderCount = String(reminders?.filter((item) => item.enabled).length ?? '--');

    careWater = `${care?.waterCompleted ?? '--'}/${care?.waterGoal ?? '--'}`;
    careMedicine = `${care?.medicineCompleted ?? '--'}/${care?.medicineTotal ?? '--'}`;
    careActivity = String(care?.activityMinutes ?? '--');
    careInteraction = String(care?.interactionCount ?? '--');

    const enabled = (reminders || []).filter((item) => item.enabled);
    enabled.sort((left, right) => left.timeOfDay.localeCompare(right.timeOfDay));
    nextReminder = enabled[0] || null;
  }

  return (
    <section className={'view' + (active ? ' active' : '')} id="view-dashboard" aria-labelledby="page-title">
      <div className="hero-card">
        <div>
          <span className={'status-badge' + (online ? ' online' : ' offline')} id="online-badge">{onlineBadgeText}</span>
          <h2 id="device-name">{deviceName}</h2>
          <p id="device-version">{deviceVersion}</p>
        </div>
        <div className="hero-time">
          <span>设备时间</span>
          <strong id="device-time">{deviceTime}</strong>
          <small id="device-date">{deviceDate}</small>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard icon={<IconWifi size="large" />} iconBg="var(--lp-success-soft)" label="网络"
          value={networkValue} detail={networkDetail} />
        <MetricCard icon={<IconBolt size="large" />} iconBg="var(--lp-primary-soft)" label="供电"
          value={powerValue} detail={batteryDetail} />
        <MetricCard icon={<IconVolume2 size="large" />} iconBg="var(--lp-warning-soft)" label="音频"
          value={audioValue} detail="来自设备适配器" />
        <MetricCard icon={<IconBell size="large" />} iconBg="var(--lp-danger-soft)" label="提醒"
          value={reminderCount} detail="当前启用" />
      </div>

      <div className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">今日关怀</span>
              <h2>生活记录</h2>
            </div>
          </div>
          <div className="care-grid">
            <CareCell value={careWater} label="饮水" />
            <CareCell value={careMedicine} label="用药" />
            <CareCell value={careActivity} label="活动分钟" />
            <CareCell value={careInteraction} label="互动次数" />
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">近期安排</span>
              <h2>下一条提醒</h2>
            </div>
            <Button data-jump="reminders" theme="borderless" size="large"
              icon={<IconArrowRight />} iconPosition="right" onClick={() => setActiveView('reminders')}>
              查看全部
            </Button>
          </div>
          {nextReminder ? (
            <div className="next-reminder" id="next-reminder">
              <strong>{nextReminder.timeOfDay} · {nextReminder.title}</strong>
              <span>{TYPE_LABELS[nextReminder.type]} · {REPEAT_LABELS[nextReminder.repeatRule]}</span>
            </div>
          ) : (
            <div className="next-reminder empty" id="next-reminder">暂无启用的提醒</div>
          )}
        </article>
      </div>
    </section>
  );
}
