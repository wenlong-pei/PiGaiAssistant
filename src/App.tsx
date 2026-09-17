import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import MainLayout from '@/components/layouts/MainLayout'
import CoordinateGradingPage from '@/pages/CoordinateGradingPage'
import StandardsPage from '@/pages/StandardsPage'
import RecordsPage from '@/pages/RecordsPage'
import GradingHistoryPage from '@/pages/GradingHistoryPage' // 导入批改历史页面
import SettingsPage from '@/pages/SettingsPage'
import ApiTestPage from '@/pages/ApiTestPage'
import OnboardingGuide from '@/components/common/OnboardingGuide'
import HelpPanel from '@/components/common/HelpPanel'
import { SoundProvider } from '@/hooks/useSound'
import { SettingsProvider } from '@/store/settingsStore'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { useSettingsStore } from '@/store/settingsStore'
import ErrorBoundary from '@/components/ErrorBoundary'
import { initErrorHandler } from '@/utils/errorHandler'
import { useEffect, useState } from 'react'

// 动态主题 Toaster
function ThemedToaster() {
  const { settings } = useSettingsStore()
  const isDark = settings.theme === 'dark' ||
    (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3000,
        style: {
          background: isDark ? '#1e293b' : '#ffffff',
          color: isDark ? '#f1f5f9' : '#0f172a',
          borderRadius: '12px',
          padding: '12px 16px',
          border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
        },
      }}
    />
  )
}

/**
 * 应用初始化组件
 * 负责初始化全局错误处理等
 */
function AppInitializer({ children }: { children: React.ReactNode }) {
  const loadApiKeys = useSettingsStore(s => s.loadApiKeys)

  useEffect(() => {
    // 初始化全局错误处理器
    initErrorHandler()
    console.log('[App] 全局错误处理器已初始化')

    // 启动时从安全存储回读各服务商的 API Key 状态
    // 修复：此前从未调用，导致设置页 Key 输入框始终显示为空，用户误以为没配上
    loadApiKeys()

    // 清理函数
    return () => {
      // 如果需要，可以在这里清理错误处理器
      console.log('[App] 应用卸载')
    }
  }, [loadApiKeys])

  return <>{children}</>
}

function App() {
  // 帮助面板状态
  const [helpOpen, setHelpOpen] = useState(false)
  
  // F1 快捷键打开帮助
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault()
        setHelpOpen(true)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  
  return (
    <AppInitializer>
      <SettingsProvider>
        <ThemeProvider>
          <SoundProvider>
            {/* 使用 ErrorBoundary 包裹整个应用 */}
            <ErrorBoundary>
              <HashRouter>
                <MainLayout>
                  <Routes>
                    <Route path="/" element={<CoordinateGradingPage />} />
                    <Route path="/coordinate" element={<Navigate to="/" replace />} />
                    <Route path="/standards" element={<StandardsPage />} />
                    <Route path="/records" element={<RecordsPage />} />
                    <Route path="/history" element={<GradingHistoryPage />} /> {/* 添加历史记录路由 */}
                    <Route path="/test" element={<ApiTestPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </MainLayout>
                <ThemedToaster />
                <OnboardingGuide />
                
                {/* 帮助面板 */}
                <HelpPanel 
                  open={helpOpen} 
                  onClose={() => setHelpOpen(false)} 
                />
                
                {/* 浮动帮助按钮 */}
                <button 
                  className="floating-help-btn"
                  onClick={() => setHelpOpen(true)}
                  title="打开帮助中心 (F1)"
                >
                  <svg 
                    width="24" 
                    height="24" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </button>
              </HashRouter>
            </ErrorBoundary>
          </SoundProvider>
        </ThemeProvider>
      </SettingsProvider>
    </AppInitializer>
  )
}

export default App
