/**
 * 主题生成器
 * 根据主题配置生成 MUI Theme 对象
 * 支持自定义主题色、高对比度模式、字体大小调整
 */

import { createTheme, Theme, PaletteMode } from '@mui/material/styles'

/**
 * 主题配置接口
 */
export interface ThemeConfig {
  mode: 'light' | 'dark' | 'system' | 'highContrast'  // 主题模式（添加 system 支持）
  primaryColor: string                       // 主题色
  fontSize: 1 | 2 | 3 | 4 | 5             // 字体大小档位（1-5）
  highContrast: boolean                     // 高对比度模式
}

/**
 * 预设主题配置
 */
export const PRESET_THEMES: Record<string, { name: string; primaryColor: string }> = {
  blue: {
    name: '蓝色（默认）',
    primaryColor: '#1976d2',
  },
  green: {
    name: '绿色',
    primaryColor: '#2e7d32',
  },
  purple: {
    name: '紫色',
    primaryColor: '#7b1fa2',
  },
  orange: {
    name: '橙色',
    primaryColor: '#ed6c02',
  },
  red: {
    name: '红色',
    primaryColor: '#d32f2f',
  },
}

/**
 * 字体大小映射表
 * 档位: 基础字体大小 (px)
 */
const FONT_SIZE_MAP: Record<number, number> = {
  1: 12,  // 小
  2: 14,  // 较小
  3: 16,  // 中（默认）
  4: 18,  // 较大
  5: 20,  // 大
}

/**
 * 生成主题对象
 * @param config 主题配置
 * @returns MUI Theme 对象
 */
export function generateTheme(config: ThemeConfig): Theme {
  // 确定调色板模式
  let paletteMode: PaletteMode = 'light'
  
  if (config.mode === 'highContrast') {
    paletteMode = 'light'  // 高对比度基于浅色主题
  } else if (config.mode === 'system') {
    // 检测系统主题
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      paletteMode = 'dark'
    } else {
      paletteMode = 'light'
    }
  } else {
    paletteMode = config.mode as PaletteMode
  }

  // 创建基础主题
  let theme = createTheme({
    palette: {
      mode: paletteMode,
      primary: {
        main: config.primaryColor,
      },
    },
    typography: {
      fontSize: FONT_SIZE_MAP[config.fontSize] || 16,
      // 调整所有字体大小变体
      h1: { fontSize: `${FONT_SIZE_MAP[config.fontSize] * 2.5}px` },
      h2: { fontSize: `${FONT_SIZE_MAP[config.fontSize] * 2}px` },
      h3: { fontSize: `${FONT_SIZE_MAP[config.fontSize] * 1.75}px` },
      h4: { fontSize: `${FONT_SIZE_MAP[config.fontSize] * 1.5}px` },
      h5: { fontSize: `${FONT_SIZE_MAP[config.fontSize] * 1.25}px` },
      h6: { fontSize: `${FONT_SIZE_MAP[config.fontSize] * 1.1}px` },
      body1: { fontSize: `${FONT_SIZE_MAP[config.fontSize]}px` },
      body2: { fontSize: `${FONT_SIZE_MAP[config.fontSize] * 0.875}px` },
      button: { fontSize: `${FONT_SIZE_MAP[config.fontSize] * 0.875}px` },
      caption: { fontSize: `${FONT_SIZE_MAP[config.fontSize] * 0.75}px` },
    },
  })

  // 高对比度模式（WCAG 2.1 AA 标准）
  if (config.highContrast || config.mode === 'highContrast') {
    theme = createTheme(theme, {
      palette: {
        text: {
          primary: '#000000',      // 纯黑文字
          secondary: '#262626',    // 深灰次要文字
        },
        background: {
          paper: '#FFFFFF',        // 纯白背景
          default: '#F5F5F5',      // 浅灰页面背景
        },
        action: {
          active: '#000000',
          hover: 'rgba(0, 0, 0, 0.08)',
          selected: 'rgba(0, 0, 0, 0.12)',
        },
      },
      components: {
        MuiButton: {
          styleOverrides: {
            root: {
              borderWidth: 2,
              '&:hover': {
                borderWidth: 2,
              },
            },
          },
        },
        MuiInputBase: {
          styleOverrides: {
            root: {
              borderWidth: 2,
            },
          },
        },
      },
    })
  }

  // 深色模式的高对比度调整
  if (config.mode === 'dark' && config.highContrast) {
    theme = createTheme(theme, {
      palette: {
        text: {
          primary: '#FFFFFF',      // 纯白文字
          secondary: '#E0E0E0',    // 浅灰次要文字
        },
        background: {
          paper: '#1A1A1A',        // 深灰背景
          default: '#000000',      // 纯黑页面背景
        },
      },
    })
  }

  return theme
}

/**
 * 应用字体大小到 CSS 变量
 * @param fontSize 字体大小档位
 */
export function applyFontSizeToCSS(fontSize: 1 | 2 | 3 | 4 | 5): void {
  const root = document.documentElement
  const baseSize = FONT_SIZE_MAP[fontSize] || 16
  
  // 设置 CSS 变量
  root.style.setProperty('--font-size-base', `${baseSize}px`)
  root.style.setProperty('--font-size-small', `${baseSize * 0.75}px`)
  root.style.setProperty('--font-size-medium', `${baseSize}px`)
  root.style.setProperty('--font-size-large', `${baseSize * 1.25}px`)
  root.style.setProperty('--font-size-xlarge', `${baseSize * 1.5}px`)
  
  // 同时设置 body 字体大小作为兜底
  document.body.style.fontSize = `${baseSize}px`
}

/**
 * 获取默认主题配置
 */
export function getDefaultThemeConfig(): ThemeConfig {
  return {
    mode: 'light',
    primaryColor: '#1976d2',
    fontSize: 3,  // 中等
    highContrast: false,
  }
}
