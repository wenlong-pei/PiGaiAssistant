import { ReactNode } from 'react'
import TitleBar from '@/components/common/TitleBar'
import Sidebar from '@/components/common/Sidebar'
import './MainLayout.scss'

interface MainLayoutProps {
  children: ReactNode
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="main-layout">
      <TitleBar />
      <div className="main-layout__body">
        <Sidebar />
        <main className="main-layout__content">
          {children}
        </main>
      </div>
    </div>
  )
}
