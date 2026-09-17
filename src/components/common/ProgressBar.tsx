import React from 'react';

export interface ProgressBarProps {
  progress: number;
  label?: string;
  showPercentage?: boolean;
  height?: number;
  color?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  label,
  showPercentage = true,
  height = 8,
  color = '#3b82f6'
}) => {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div style={{ width: '100%' }}>
      {(label || showPercentage) && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '4px',
          fontSize: '12px',
          color: '#6b7280'
        }}>
          {label && <span>{label}</span>}
          {showPercentage && <span>{clampedProgress.toFixed(0)}%</span>}
        </div>
      )}
      <div
        style={{
          width: '100%',
          height: `${height}px`,
          backgroundColor: '#e5e7eb',
          borderRadius: '9999px',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: `${clampedProgress}%`,
            height: '100%',
            backgroundColor: color,
            borderRadius: '9999px',
            transition: 'width 0.3s ease-in-out',
            position: 'relative'
          }}
        >
          {clampedProgress < 100 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundImage: `linear-gradient(
                  45deg,
                  rgba(255, 255, 255, 0.15) 25%,
                  transparent 25%,
                  transparent 50%,
                  rgba(255, 255, 255, 0.15) 50%,
                  rgba(255, 255, 255, 0.15) 75%,
                  transparent 75%,
                  transparent
                )`,
                backgroundSize: '1rem 1rem',
                animation: 'progress-bar-stripes 1s linear infinite'
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ProgressBar;
