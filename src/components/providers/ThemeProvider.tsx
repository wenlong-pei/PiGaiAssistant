import { useEffect, useMemo } from 'react'
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { useSettingsStore } from '@/store/settingsStore'
import { generateTheme, applyFontSizeToCSS, type ThemeConfig } from '@/utils/themeGenerator'

/**
 * 自定义主题提供者组件
 * 集成 MUI ThemeProvider，根据设置动态生成主题
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettingsStore()
  const { themeCustom } = settings

  // 将自定义主题配置转换为 ThemeConfig
  const themeConfig: ThemeConfig = useMemo(() => ({
    mode: themeCustom.mode,
    primaryColor: themeCustom.primaryColor,
    fontSize: themeCustom.fontSize,
    highContrast: themeCustom.highContrast,
  }), [themeCustom])

  // 生成 MUI 主题
  const muiTheme = useMemo(() => generateTheme(themeConfig), [themeConfig])

  // 应用主题到 DOM（处理非 MUI 组件的主题切换）
  useEffect(() => {
    const root = document.documentElement
    
    // 检测系统主题
    const getSystemTheme = (): 'light' | 'dark' => {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark'
      }
      return 'light'
    }
    
    // 确定当前应用的主题模式
    let effectiveMode: 'light' | 'dark' = 'light'
    
    if (themeConfig.mode === 'highContrast') {
      effectiveMode = 'light'  // 高对比度模式基于浅色主题
    } else if (themeConfig.mode === 'system') {
      effectiveMode = getSystemTheme()
    } else {
      effectiveMode = themeConfig.mode as 'light' | 'dark'
    }
    
    // 添加/移除 dark 类名（用于 SCSS 中的 .dark-theme 选择器）
    if (effectiveMode === 'dark') {
      root.classList.add('dark-theme')
      root.classList.remove('light-theme')
    } else {
      root.classList.add('light-theme')
      root.classList.remove('dark-theme')
    }

    // 应用高对比度模式
    if (themeConfig.highContrast || themeConfig.mode === 'highContrast') {
      root.classList.add('high-contrast')
    } else {
      root.classList.remove('high-contrast')
    }
    
    // 应用字体大小到 CSS 变量
    applyFontSizeToCSS(themeConfig.fontSize)
    
    // 设置主题色 CSS 变量
    root.style.setProperty('--primary-color', themeConfig.primaryColor)
    
    // 监听系统主题变化
    if (themeConfig.mode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        if (e.matches) {
          root.classList.add('dark-theme')
          root.classList.remove('light-theme')
        } else {
          root.classList.add('light-theme')
          root.classList.remove('dark-theme')
        }
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [themeConfig])

  return (
    <MuiThemeProvider theme={muiTheme}>
      <CssBaseline /> {/* MUI 的 CSS 重置 */}
      {children}
    </MuiThemeProvider>
  )
}
