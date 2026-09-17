import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: {},
  app: { getPath: () => '/tmp' },
  BrowserWindow: class {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: any) => b.toString(),
  },
}))

import { validateNavigateUrl, validateExternalUrl } from '../../electron/ipc'
import { sanitizeLinkUrl } from '../components/common/HelpPanel'

describe('安全校验回归（RM-SEC-003 / RM-SEC-011）', () => {
  it('内部导航只允许 http/https，阻断本地与注入协议', () => {
    expect(validateNavigateUrl('https://www.zhixue.com/login').ok).toBe(true)
    expect(validateNavigateUrl('http://127.0.0.1:5173/').ok).toBe(true)

    for (const bad of [
      'file:///C:/Windows/win.ini',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '',
      'not a url',
    ]) {
      expect(validateNavigateUrl(bad).ok).toBe(false)
    }
  })

  it('外部链接只允许 http/https/mailto', () => {
    expect(validateExternalUrl('https://docs.example.com').ok).toBe(true)
    expect(validateExternalUrl('mailto:a@b.com').ok).toBe(true)
    expect(validateExternalUrl('file:///etc/passwd').ok).toBe(false)
    expect(validateExternalUrl('javascript:alert(1)').ok).toBe(false)
  })

  it('Markdown 链接净化：非白名单协议不生成 <a>', () => {
    expect(sanitizeLinkUrl('https://a.com')).toBe('https://a.com')
    expect(sanitizeLinkUrl('mailto:x@y.com')).toBe('mailto:x@y.com')
    expect(sanitizeLinkUrl('javascript:alert(1)')).toBe('')
    expect(sanitizeLinkUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('')
    expect(sanitizeLinkUrl('file:///C:/secret.txt')).toBe('')
  })
})
