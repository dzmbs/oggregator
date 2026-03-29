import type { OkxWsNotice, OkxWsStatusMsg } from './types.js';

export function deriveOkxNoticeHealth(notice: OkxWsNotice): {
  status: 'reconnecting';
  message: string;
} {
  const code = notice.code != null ? ` (${notice.code})` : '';
  return {
    status: 'reconnecting',
    message: `${notice.msg ?? 'service notice'}${code}`,
  };
}

export function deriveOkxStatusHealth(message: OkxWsStatusMsg): {
  status: 'connected' | 'degraded';
  message: string;
} {
  const active = message.data.find(
    (item) => item.state === 'scheduled' || item.state === 'ongoing' || item.state === 'pre_open',
  );

  if (active != null) {
    const title = active.title != null ? `: ${active.title}` : '';
    return {
      status: 'degraded',
      message: `system status ${active.state}${title}`,
    };
  }

  return {
    status: 'connected',
    message: 'system status healthy',
  };
}
