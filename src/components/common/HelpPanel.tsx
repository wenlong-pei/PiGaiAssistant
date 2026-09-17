import { useState, useMemo } from 'react'
import {
  X,
  Search,
  BookOpen,
  HelpCircle,
  ChevronRight,
  FileDown,
} from 'lucide-react'
import { faqData, FAQItem } from '@/data/faqData'
import userManualContent from '@/data/userManual.md?raw'
import './HelpPanel.scss'

// ============================================
// 简易 Markdown 渲染器
// 支持：标题、加粗、列表、代码块、表格、链接
// ============================================

interface MarkdownRendererProps {
  content: string
}

function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const html = useMemo(() => {
    let result = content
    
    // 代码块（```语言\n代码\n```）
    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="md-code-block"><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`
    })
    
    // 行内代码（`代码`）
    result = result.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    
    // 标题（# ## ### ####）
    result = result.replace(/^#### (.+)$/gm, '<h4 class="md-heading md-heading-4">$1</h4>')
    result = result.replace(/^### (.+)$/gm, '<h3 class="md-heading md-heading-3">$1</h3>')
    result = result.replace(/^## (.+)$/gm, '<h2 class="md-heading md-heading-2">$1</h2>')
    result = result.replace(/^# (.+)$/gm, '<h1 class="md-heading md-heading-1">$1</h1>')
    
    // 粗体（**文本**）
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong class="md-bold">$1</strong>')
    
    // 斜体（*文本*）
    result = result.replace(/\*(.+?)\*/g, '<em class="md-italic">$1</em>')
    
    // 链接（[文本](URL)）
    // 修复 RM-SEC-011：链接协议白名单过滤，阻断 javascript:/data: 等注入协议
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) => {
      const safeUrl = sanitizeLinkUrl(url)
      if (!safeUrl) {
        return text
      }
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="md-link">${text} ↗</a>`
    })
    
    // 表格（| 列1 | 列2 |\n| --- | --- |\n| 内容1 | 内容2 |）
    result = result.replace(/\|(.+)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)+)/g, (_: string, header: string, body: string) => {
      const headerCells = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th class="md-table-th">${c.trim()}</th>`).join('')
      const bodyRows = body.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td class="md-table-td">${c.trim()}</td>`).join('')
        return `<tr class="md-table-tr">${cells}</tr>`
      }).join('')
      return `<div class="md-table-wrapper"><table class="md-table"><thead><tr class="md-table-tr">${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`
    })
    
    // 无序列表（- 或 *）
    result = result.replace(/^[-*] (.+)$/gm, '<li class="md-list-item">$1</li>')
    result = result.replace(/(<li class="md-list-item">.+<\/li>\n?)+/g, '<ul class="md-list">$&</ul>')
    
    // 有序列表（数字.）
    result = result.replace(/^\d+\. (.+)$/gm, '<li class="md-list-item md-list-ordered">$1</li>')
    result = result.replace(/(<li class="md-list-item md-list-ordered">.+<\/li>\n?)+/g, '<ol class="md-list md-list-numbered">$&</ol>')
    
    // 段落（连续的非标签文本）
    result = result.replace(/^([^<\n].+)$/gm, '<p class="md-paragraph">$1</p>')
    
    // 换行
    result = result.replace(/\n\n/g, '<br/>')
    
    return result
  }, [content])
  
  return (
    <div 
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** 转义 HTML 特殊字符 */
/**
 * 链接协议白名单过滤（修复 RM-SEC-011）
 * 仅允许 http/https/mailto，其余（javascript:、data:、file: 等）一律丢弃。
 */
export function sanitizeLinkUrl(raw: string): string {
  if (typeof raw !== 'string') return ''
  const url = raw.trim()
  if (!url) return ''
  if (/^(https?:|mailto:)/i.test(url)) return url
  return ''
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ============================================
// 帮助面板主组件
// ============================================

interface HelpPanelProps {
  /** 是否打开 */
  open: boolean
  /** 关闭回调 */
  onClose: () => void
}

type HelpTab = 'manual' | 'faq' | 'shortcuts'

export default function HelpPanel({ open, onClose }: HelpPanelProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>('manual')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFaq, setSelectedFaq] = useState<FAQItem | null>(null)
  
  /** 过滤 FAQ 数据 */
  const filteredFaqs = useMemo(() => {
    if (!searchTerm.trim()) return faqData
    
    const term = searchTerm.toLowerCase()
    return faqData.filter(
      item => 
        item.question.toLowerCase().includes(term) ||
        item.answer.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term)
    )
  }, [searchTerm])
  
  /** 按分类分组 FAQ */
  const groupedFaqs = useMemo(() => {
    const groups: Record<string, FAQItem[]> = {}
    filteredFaqs.forEach(item => {
      const category = item.category
      if (!groups[category]) groups[category] = []
      groups[category].push(item)
    })
    return groups
  }, [filteredFaqs])
  
  /** 分类名称映射 */
  const categoryNames: Record<string, string> = {
    getting_started: '快速开始',
    grading: '批改功能',
    ai_settings: 'AI 配置',
    export: '导出功能',
  }
  
  /** 导出 PDF 用户手册 */
  const handleExportPDF = async () => {
    try {
      const jsPDF = (await import('jspdf')).default
      const doc = new jsPDF()
      
      // 设置字体（支持中文需要引入字体文件，这里使用默认字体）
      doc.setFontSize(20)
      doc.text('Pi Lao Ban Intelligent Grading Tool - User Manual', 20, 20)
      
      doc.setFontSize(12)
      const lines = doc.splitTextToSize(userManualContent.substring(0, 2000), 170)
      doc.text(lines, 20, 40)
      
      doc.save('pilaoban-user-manual.pdf')
    } catch (error) {
      console.error('PDF export failed:', error)
      alert('PDF export failed. Please check if jspdf dependency is installed.')
    }
  }
  
  if (!open) return null
  
  return (
    <div className="help-panel-overlay" onClick={onClose}>
      <div className="help-panel" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="help-panel__header">
          <div className="help-panel__title">
            <BookOpen size={24} />
            <h2>帮助中心</h2>
          </div>
          <div className="help-panel__actions">
            <button 
              className="help-panel__action-btn"
              onClick={handleExportPDF}
              title="导出 PDF 用户手册"
            >
              <FileDown size={18} />
            </button>
            <button 
              className="help-panel__close-btn"
              onClick={onClose}
              title="关闭"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        
        {/* 标签页 */}
        <div className="help-panel__tabs">
          <button 
            className={`help-tab ${activeTab === 'manual' ? 'help-tab--active' : ''}`}
            onClick={() => {
              setActiveTab('manual')
              setSelectedFaq(null)
            }}
          >
            <BookOpen size={16} />
            用户手册
          </button>
          <button 
            className={`help-tab ${activeTab === 'faq' ? 'help-tab--active' : ''}`}
            onClick={() => {
              setActiveTab('faq')
              setSelectedFaq(null)
            }}
          >
            <HelpCircle size={16} />
            常见问题
          </button>
          <button 
            className={`help-tab ${activeTab === 'shortcuts' ? 'help-tab--active' : ''}`}
            onClick={() => {
              setActiveTab('shortcuts')
              setSelectedFaq(null)
            }}
          >
            <ChevronRight size={16} />
            快捷键
          </button>
        </div>
        
        {/* 搜索框（FAQ 标签页显示） */}
        {activeTab === 'faq' && (
          <div className="help-panel__search">
            <Search size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="搜索常见问题..."
            />
            {searchTerm && (
              <button 
                className="help-panel__search-clear"
                onClick={() => setSearchTerm('')}
              >
                ✕
              </button>
            )}
          </div>
        )}
        
        {/* 内容区域 */}
        <div className="help-panel__content">
          {/* 用户手册 */}
          {activeTab === 'manual' && (
            <div className="help-manual">
              <MarkdownRenderer content={userManualContent} />
            </div>
          )}
          
          {/* 常见问题 */}
          {activeTab === 'faq' && (
            <div className="help-faq">
              {selectedFaq ? (
                // FAQ 详情
                <div className="faq-detail">
                  <button 
                    className="faq-back-btn"
                    onClick={() => setSelectedFaq(null)}
                  >
                    ← 返回列表
                  </button>
                  <h3 className="faq-question">{selectedFaq.question}</h3>
                  <div className="faq-answer">
                    <MarkdownRenderer content={selectedFaq.answer} />
                  </div>
                </div>
              ) : (
                // FAQ 列表
                <div className="faq-list">
                  {Object.entries(groupedFaqs).map(([category, items]) => (
                    <div key={category} className="faq-group">
                      <h3 className="faq-group-title">{categoryNames[category] || category}</h3>
                      {items.map(item => (
                        <button
                          key={item.id}
                          className="faq-item"
                          onClick={() => setSelectedFaq(item)}
                        >
                          <span className="faq-item__question">{item.question}</span>
                          <ChevronRight size={16} className="faq-item__arrow" />
                        </button>
                      ))}
                    </div>
                  ))}
                  
                  {filteredFaqs.length === 0 && (
                    <div className="faq-empty">
                      <HelpCircle size={48} />
                      <p>没有找到相关的问题</p>
                      <p className="faq-empty-hint">请尝试其他关键词</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* 快捷键 */}
          {activeTab === 'shortcuts' && (
            <div className="help-shortcuts">
              <h3 className="shortcuts-title">键盘快捷键</h3>
              <p className="shortcuts-desc">使用快捷键可以快速操作，提高效率</p>
              
              <div className="shortcuts-table">
                <div className="shortcuts-table__header">
                  <span>Shortcut</span>
                  <span>Function</span>
                </div>
                <div className="shortcuts-table__body">
                  <div className="shortcut-row">
                    <kbd className="shortcut-key">F1</kbd>
                    <span className="shortcut-desc">Open Help Center</span>
                  </div>
                  <div className="shortcut-row">
                    <kbd className="shortcut-key">Ctrl + Enter</kbd>
                    <span className="shortcut-desc">Start/Continue Grading</span>
                  </div>
                  <div className="shortcut-row">
                    <kbd className="shortcut-key">Ctrl + P</kbd>
                    <span className="shortcut-desc">Pause/Resume Grading</span>
                  </div>
                  <div className="shortcut-row">
                    <kbd className="shortcut-key">Ctrl + S</kbd>
                    <span className="shortcut-desc">Stop Grading</span>
                  </div>
                  <div className="shortcut-row">
                    <kbd className="shortcut-key">Ctrl + E</kbd>
                    <span className="shortcut-desc">Open Correction Panel</span>
                  </div>
                  <div className="shortcut-row">
                    <kbd className="shortcut-key">Ctrl + K</kbd>
                    <span className="shortcut-desc">Quick Search</span>
                  </div>
                  <div className="shortcut-row">
                    <kbd className="shortcut-key">Esc</kbd>
                    <span className="shortcut-desc">Close Current Panel/Cancel Operation</span>
                  </div>
                </div>
              </div>
              
              <div className="shortcuts-tip">
                <p>💡 提示：您可以在"设置 - 基础设置"中关闭或开启快捷键功能。</p>
              </div>
            </div>
          )}
        </div>
        
        {/* 底部 */}
        <div className="help-panel__footer">
          <p>需要更多帮助？</p>
          <a 
            href="https://github.com/wenlong-pei/IMA/issues" 
            target="_blank" 
            rel="noopener noreferrer"
            className="help-panel__footer-link"
          >
            前往 GitHub 提交问题
            <span style={{ marginLeft: '4px' }}>↗</span>
          </a>
        </div>
      </div>
    </div>
  )
}

export { HelpPanel }
