// MUI Grid 组件类型扩展
// 修复 Grid 组件不支持 item、xs、md 等属性的类型错误

import type { GridBaseProps } from '@mui/material/Grid';

declare module '@mui/material/Grid' {
  interface GridBaseProps {
    item?: boolean;
    container?: boolean;
    xs?: number | boolean;
    sm?: number | boolean;
    md?: number | boolean;
    lg?: number | boolean;
    xl?: number | boolean;
    spacing?: number;
    alignItems?: string;
    justifyContent?: string;
    direction?: string;
  }
}
