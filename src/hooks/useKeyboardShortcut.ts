import { useEffect, useRef, useCallback } from 'react'

/**
 * 快捷键配置接口
 */
export interface ShortcutConfig {
  /** 按键（如 'Enter', 'p', 's'） */
  key: string
  /** 是否需要 Ctrl */
  ctrl?: boolean
  /** 是否需要 Shift */
  shift?: boolean
  /** 是否需要 Alt */
  alt?: boolean
  /** 回调函数 */
  callback: () => void
  /** 是否禁用该快捷键 */
  disabled?: boolean
}

/**
 * 键盘快捷键 Hook
 * 
 * 功能：
 * - 监听键盘事件（keydown）
 * - 支持组合键（Ctrl、Shift、Alt）
 * - 提供注册和注销快捷键的 API
 * 
 * @param shortcuts 快捷键配置数组
 * @param isEnabled 是否启用所有快捷键（默认 true）
 * 
 * @example
 * ```tsx
 * useKeyboardShortcut([
 *   {
 *     key: 'Enter',
 *     ctrl: true,
 *     callback: () => handleStart(),
 *     disabled: isRunning
 *   }
 * ])
 * ```
 */
export function useKeyboardShortcut(
  shortcuts: ShortcutConfig[],
  isEnabled: boolean = true
): void {
  // 使用 ref 保存 shortcuts，避免频繁重建事件监听器
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  // 使用 ref 保存启用状态
  const isEnabledRef = useRef(isEnabled)
  isEnabledRef.current = isEnabled

  // 检查按键是否匹配快捷键配置
  const isKeyMatch = useCallback((event: KeyboardEvent, shortcut: ShortcutConfig): boolean => {
    // 检查主键是否匹配（不区分大小写）
    const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase()
    
    // 检查修饰键是否匹配
    const ctrlMatches = !!shortcut.ctrl === event.ctrlKey
    const shiftMatches = !!shortcut.shift === event.shiftKey
    const altMatches = !!shortcut.alt === event.altKey

    return keyMatches && ctrlMatches && shiftMatches && altMatches
  }, [])

  // 检查是否在可输入元素中
  const isInputElement = useCallback((event: KeyboardEvent): boolean => {
    const target = event.target as HTMLElement
    const tagName = target.tagName.toLowerCase()
    
    // 输入框、文本域、选择框、内容可编辑元素
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      target.isContentEditable
    )
  }, [])

  useEffect(() => {
    // 定义键盘事件处理函数
    const handleKeyDown = (event: KeyboardEvent) => {
      // 如果快捷键功能未启用，直接返回
      if (!isEnabledRef.current) return

      // 检查是否在输入元素中，如果是则不触发快捷键（除非是 Escape 键）
      if (isInputElement(event) && event.key !== 'Escape') {
        return
      }

      // 遍历所有快捷键配置
      for (const shortcut of shortcutsRef.current) {
        // 如果该快捷键被禁用，跳过
        if (shortcut.disabled) continue

        // 检查是否匹配
        if (isKeyMatch(event, shortcut)) {
          // 阻止默认行为（如 Ctrl+S 保存页面）
          event.preventDefault()
          event.stopPropagation()

          // 执行回调函数
          shortcut.callback()
          break // 只触发第一个匹配的快捷键
        }
      }
    }

    // 添加事件监听器
    document.addEventListener('keydown', handleKeyDown)

    // 返回清理函数，移除事件监听器
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isKeyMatch, isInputElement]) // 依赖项只包含稳定的回调函数
}

/**
 * 格式化快捷键显示为可读字符串
 * 
 * @param shortcut 快捷键配置
 * @returns 格式化的快捷键字符串（如 "Ctrl+Enter"）
 */
export function formatShortcut(shortcut: ShortcutConfig): string {
  const parts: string[] = []
  
  if (shortcut.ctrl) parts.push('Ctrl')
  if (shortcut.shift) parts.push('Shift')
  if (shortcut.alt) parts.push('Alt')
  
  // 格式化按键名称
  let keyDisplay = shortcut.key
  if (keyDisplay === ' ') keyDisplay = 'Space'
  else if (keyDisplay === 'ArrowUp') keyDisplay = '↑'
  else if (keyDisplay === 'ArrowDown') keyDisplay = '↓'
  else if (keyDisplay === 'ArrowLeft') keyDisplay = '←'
  else if (keyDisplay === 'ArrowRight') keyDisplay = '→'
  else keyDisplay = keyDisplay.toUpperCase()
  
  parts.push(keyDisplay)
  
  return parts.join('+')
}

/**
 * 常用快捷键预设
 */
export const CommonShortcuts = {
  /** 开始/继续 (Ctrl+Enter) */
  START: (callback: () => void, disabled?: boolean): ShortcutConfig => ({
    key: 'Enter',
    ctrl: true,
    callback,
    disabled
  }),
  
  /** 暂停/继续 (Ctrl+P) */
  PAUSE: (callback: () => void, disabled?: boolean): ShortcutConfig => ({
    key: 'p',
    ctrl: true,
    callback,
    disabled
  }),
  
  /** 停止 (Ctrl+S) */
  STOP: (callback: () => void, disabled?: boolean): ShortcutConfig => ({
    key: 's',
    ctrl: true,
    callback,
    disabled
  }),
  
  /** 纠错 (Ctrl+E) */
  CORRECTION: (callback: () => void, disabled?: boolean): ShortcutConfig => ({
    key: 'e',
    ctrl: true,
    callback,
    disabled
  }),
  
  /** 取消 (Escape) */
  CANCEL: (callback: () => void, disabled?: boolean): ShortcutConfig => ({
    key: 'Escape',
    callback,
    disabled
  }),
}
