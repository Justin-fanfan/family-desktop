import React, { useState, useEffect } from 'react';
import { Button, Select, Slider } from '@douyinfe/semi-ui';

export default function SettingsView({ state, active }) {
  const { dashboard, busy, saveSettings, settingsAreWritable } = state;
  const settings = dashboard?.settings;

  const [volume, setVolume] = useState(60);
  const [brightness, setBrightness] = useState(72);
  const [petStyle, setPetStyle] = useState('温和陪伴');

  useEffect(() => {
    if (settings) {
      setVolume(settings.volume);
      setBrightness(settings.brightness);
      setPetStyle(settings.petStyle);
    }
  }, [settings]);

  if (!dashboard) {
    return (
      <section className={'view' + (active ? ' active' : '')} id="view-settings" aria-labelledby="page-title">
        <div className="panel settings-panel">
          <div className="empty-state">连接设备后查看远程设置</div>
        </div>
      </section>
    );
  }

  const writable = settingsAreWritable();
  const volumeCapability = settings.capabilities?.volume;
  const brightnessCapability = settings.capabilities?.brightness;
  const volumeDisabled = !writable || volumeCapability?.available === false;
  const brightnessDisabled = !writable || brightnessCapability?.available === false;

  const note = !writable
    ? '当前板端仅开放远程读取；设置写入将在后续小步接入。'
    : brightnessCapability?.available === false
      ? '当前设备不支持亮度调节；保存时只提交可用设置。'
      : '远程写入会经过设备端 SettingsService 校验。';

  const handleSubmit = (event) => {
    event.preventDefault();
    void saveSettings({ volume, brightness, petStyle });
  };

  return (
    <section className={'view' + (active ? ' active' : '')} id="view-settings" aria-labelledby="page-title">
      <form className="panel settings-panel" onSubmit={handleSubmit}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">设备偏好</span>
            <h2>远程设置</h2>
          </div>
          <span className="revision" id="settings-revision">版本 {settings.revision}</span>
        </div>

        <div className="settings-row">
          <span className="settings-label">
            <strong>扬声器音量</strong>
            <small id="volume-summary">{volumeCapability?.summary ?? '设备未报告音量能力'}</small>
          </span>
          <div className="slider-wrap">
            <Slider
              value={volume}
              onChange={(value) => setVolume(value)}
              min={0}
              max={100}
              step={1}
              disabled={volumeDisabled}
              style={{ flex: 1 }}
            />
            <span className="range-output">{volume}%</span>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">
            <strong>屏幕亮度</strong>
            <small id="brightness-summary">{brightnessCapability?.summary ?? '设备未报告背光能力'}</small>
          </span>
          <div className="slider-wrap">
            <Slider
              value={brightness}
              onChange={(value) => setBrightness(value)}
              min={0}
              max={100}
              step={1}
              disabled={brightnessDisabled}
              style={{ flex: 1 }}
            />
            <span className="range-output">{brightness}%</span>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">
            <strong>陪伴风格</strong>
            <small>改变设备的视觉与交互倾向</small>
          </span>
          <Select
            value={petStyle}
            onChange={(value) => setPetStyle(value)}
            disabled={!writable}
            style={{ width: 220 }}
            size="large"
            optionList={[
              { value: '温和陪伴', label: '温和陪伴' },
              { value: '活泼陪伴', label: '活泼陪伴' }
            ]}
          />
        </div>

        <div className="form-footer">
          <p id="settings-note">{note}</p>
          <Button id="save-settings-button" theme="solid" size="large" htmlType="submit" loading={busy} disabled={!writable}>
            保存到设备
          </Button>
        </div>
      </form>
    </section>
  );
}
