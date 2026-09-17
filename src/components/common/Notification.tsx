import React, { useEffect, useState } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationProps {
  message: string;
  type?: NotificationType;
  duration?: number;
  onClose?: () => void;
}

const icons: Record<NotificationType, string> = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️'
};

const colors: Record<NotificationType, { bg: string; border: string; text: string }> = {
  success: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
  error: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  warning: { bg: '#fffbeb', border: '#fed7aa', text: '#c2410c' },
  info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' }
};

export const Notification: React.FC<NotificationProps> = ({
  message,
  type = 'info',
  duration = 3000,
  onClose
}) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onClose?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!visible) return null;

  const style = colors[type];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: '8px',
        color: style.text,
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        animation: 'slideIn 0.3s ease-out',
        minWidth: '280px',
        maxWidth: '400px'
      }}
    >
      <span style={{ fontSize: '20px' }}>{icons[type]}</span>
      <span style={{ flex: 1, fontSize: '14px' }}>{message}</span>
      <button
        onClick={() => {
          setVisible(false);
          onClose?.();
        }}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '18px',
          opacity: 0.6,
          padding: '0 4px'
        }}
      >
        ×
      </button>
    </div>
  );
};

export default Notification;
