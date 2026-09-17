import { describe, it, expect, beforeEach } from 'vitest'
import LoggerImpl from '@/utils/Logger'

describe('Logger', () => {
  let logger: LoggerImpl

  beforeEach(() => {
    logger = new LoggerImpl({ module: 'Test' })
  })

  describe('basic logging', () => {
    it('should add debug log', () => {
      logger.debug('Debug message', { key: 'value' })
      const logs = logger.getHistory()
      
      expect(logs).toHaveLength(1)
      expect(logs[0].level).toBe('debug')
      expect(logs[0].message).toBe('Debug message')
      expect(logs[0].data).toEqual({ key: 'value' })
    })

    it('should add info log', () => {
      logger.info('Info message')
      const logs = logger.getHistory()
      
      expect(logs).toHaveLength(1)
      expect(logs[0].level).toBe('info')
      expect(logs[0].message).toBe('Info message')
    })

    it('should add warn log', () => {
      logger.warn('Warning message')
      const logs = logger.getHistory()
      
      expect(logs).toHaveLength(1)
      expect(logs[0].level).toBe('warn')
    })

    it('should add error log', () => {
      const error = new Error('Test error')
      logger.error('Error message', error)
      const logs = logger.getHistory()
      
      expect(logs).toHaveLength(1)
      expect(logs[0].level).toBe('error')
      expect(logs[0].error).toBe(error)
    })
  })

  describe('log retrieval', () => {
    it('should get logs by level', () => {
      logger.debug('Debug')
      logger.info('Info')
      logger.error('Error')
      
      const errorLogs = logger.getHistory().filter(log => log.level === 'error')
      expect(errorLogs).toHaveLength(1)
      expect(errorLogs[0].message).toBe('Error')
    })

    it('should limit history to 1000 entries', () => {
      for (let i = 0; i < 1005; i++) {
        logger.info(`Log ${i}`)
      }
      
      const history = logger.getHistory()
      expect(history.length).toBe(1000)
    })
  })

  describe('clear history', () => {
    it('should clear all logs', () => {
      logger.info('Test')
      logger.clearHistory()
      const history = logger.getHistory()
      
      expect(history).toHaveLength(0)
    })
  })
})
