// electron 模块 stub：仅用于测试环境（node 无 electron 二进制）
import * as path from 'path'
const TEST_USERDATA = path.join(process.env.TEMP || '.', 'qa-exec-userdata')
export const app = {
  getPath: (name: string) => (name === 'userData' ? TEST_USERDATA : name),
  whenReady: async () => {},
  on: () => {},
  quit: () => {},
  getVersion: () => '0.0.0-test',
}
export const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
export const ipcMain = { handle: () => {}, on: () => {}, removeHandler: () => {} }
export const BrowserWindow = class {}
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: '' }) }
export const shell = { openExternal: async () => {} }
export const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
export const session = { defaultSession: { webRequest: { onHeadersReceived: () => {}, onBeforeRequest: () => {} } } }
export const net = { request: () => ({ on: () => {}, end: () => {} }) }
export const powerMonitor = { on: () => {} }
export const clipboard = { readText: () => '', writeText: () => {} }
export default { app, screen, ipcMain, BrowserWindow, dialog, shell, safeStorage, session, net, powerMonitor, clipboard }
