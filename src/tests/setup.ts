import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: {
    minimizeWindow: () => {},
    maximizeWindow: () => {},
    closeWindow: () => {},
    openFile: () => Promise.resolve({ canceled: false, filePaths: [] }),
    saveFile: () => Promise.resolve({ canceled: false, filePath: '' }),
    readFile: () => Promise.resolve({ success: true, data: '' }),
    writeFile: () => Promise.resolve({ success: true }),
    readImage: () => Promise.resolve({ success: true, data: '' }),
    openExternal: () => Promise.resolve(),
    getPath: () => Promise.resolve(''),
    invoke: () => Promise.resolve(),
    send: () => {},
    on: () => {},
    off: () => {},
    secureStorage: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(true),
      delete: () => Promise.resolve(true),
      has: () => Promise.resolve(false),
      isAvailable: () => Promise.resolve(false),
    },
    updateBotSettings: () => {},
    configurePaddleOCR: () => {},
  },
  writable: true,
})

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock localStorage
const localStorageMock = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })
