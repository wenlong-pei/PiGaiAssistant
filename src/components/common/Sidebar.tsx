import { NavLink } from 'react-router-dom'
import {
  BookOpen,
  History,
  Settings,
  FlaskConical,
  Target,
  Archive,
} from 'lucide-react'
import './Sidebar.scss'

const navItems = [
  { path: '/', icon: Target, label: '试卷批改' },
  { path: '/standards', icon: BookOpen, label: '评分标准' },
  { path: '/records', icon: History, label: '批改记录' },
  { path: '/history', icon: Archive, label: '历史归档' }, // sql.js 历史库：统计、筛选、对比
  { path: '/test', icon: FlaskConical, label: 'API测试' },
  { path: '/settings', icon: Settings, label: '系统设置' },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <nav className="sidebar__nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => 
              `sidebar__item ${isActive ? 'sidebar__item--active' : ''}`
            }
          >
            <item.icon size={20} className="sidebar__icon" />
            <span className="sidebar__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__ai-badge">
          <span>智能批改助手</span>
        </div>
        <div className="sidebar__copyright">
          皮老板出品
        </div>
      </div>
    </aside>
  )
}
