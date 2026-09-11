import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Switch } from '@douyinfe/semi-ui';

export default function ConnectionDialog({ state }) {
  const { connection, connectionDialogOpen, setConnectionDialogOpen, configureConnection } = state;

  const [mock, setMock] = useState(true);
  const [baseUrl, setBaseUrl] = useState('http://192.168.137.32:8787');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (connectionDialogOpen) {
      setMock(connection?.mode !== 'http');
      if (connection?.mode === 'http') setBaseUrl(connection.baseUrl);
      setToken('');
    }
  }, [connectionDialogOpen, connection]);

  const handleConnect = async () => {
    if (!mock && !baseUrl.trim()) return;
    setSubmitting(true);
    try {
      await configureConnection({
        mode: mock ? 'mock' : 'http',
        baseUrl: baseUrl.trim(),
        token: token.trim()
      });
      setConnectionDialogOpen(false);
    } catch {
      // 错误已由 toast 提示，保持弹窗打开
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <div>
          <div className="eyebrow">连接配置</div>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>选择数据来源</h2>
        </div>
      }
      visible={connectionDialogOpen}
      onCancel={() => setConnectionDialogOpen(false)}
      footer={
        <>
          <Button size="large" onClick={() => setConnectionDialogOpen(false)}>取消</Button>
          <Button size="large" theme="solid" loading={submitting} onClick={handleConnect}>连接并同步</Button>
        </>
      }
      width={520}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 14px' }}>
          <div>
            <strong style={{ fontSize: '1rem' }}>使用演示数据</strong>
            <div className="field-hint">无需板端 API，可完整体验操作流程</div>
          </div>
          <Switch checked={mock} onChange={setMock} size="large" aria-label="使用演示数据" />
        </div>

        <label style={{ display: 'block', fontWeight: 600, fontSize: '0.95rem', margin: '12px 0 6px' }}>设备 API 地址</label>
        <Input
          value={baseUrl}
          onChange={setBaseUrl}
          disabled={mock}
          placeholder="http://192.168.137.32:8787"
          size="large"
        />

        <label style={{ display: 'block', fontWeight: 600, fontSize: '0.95rem', margin: '12px 0 6px' }}>配对令牌</label>
        <Input
          value={token}
          onChange={setToken}
          disabled={mock}
          type="password"
          autoComplete="off"
          placeholder="由 LongPet 配对页面生成"
          size="large"
        />
      </div>
      <p className="dialog-help">令牌仅保存在 Electron 主进程内存中，本版本不会写入磁盘。</p>
    </Modal>
  );
}
