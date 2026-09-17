/**
 * 适配器初始化模块
 * 在应用启动时注册所有默认适配器
 */

import { LogService } from '../services/LogService'
import { ConfigService } from '../services/ConfigService'
import { AdapterFactory, getAdapterFactory } from '../adapters/AdapterFactory'
import { ZhixueAdapter } from '../adapters/ZhixueAdapter'
import { GenericAdapter } from '../adapters/GenericAdapter'
import { ConfigurableAdapter } from '../adapters/ConfigurableAdapter'

/**
 * 初始化适配器系统
 * 在应用启动时调用此函数
 * @param logger - 日志服务实例
 * @param configService - 配置服务实例
 */
export async function initializeAdapters(
  logger: LogService,
  configService: ConfigService
): Promise<AdapterFactory> {
  logger.info('开始初始化适配器系统')

  try {
    // 获取适配器工厂实例
    const adapterFactory = getAdapterFactory(logger, configService)

    // 注册智学网适配器
    adapterFactory.registerAdapter('zhixue', () => {
      return new ZhixueAdapter(logger, configService)
    })
    logger.info('注册适配器: zhixue')

    // 注册通用适配器
    adapterFactory.registerAdapter('generic', () => {
      return new GenericAdapter(logger, configService)
    })
    logger.info('注册适配器: generic')

    // 注册可配置适配器
    adapterFactory.registerAdapter('configurable', () => {
      return new ConfigurableAdapter(logger, configService)
    })
    logger.info('注册适配器: configurable')

    // 可扩展：注册更多适配器
    // adapterFactory.registerAdapter('other-platform', () => {
    //   return new OtherPlatformAdapter(logger, configService)
    // })

    logger.info('适配器系统初始化完成', {
      availablePlatforms: adapterFactory.getAvailablePlatforms(),
    })

    return adapterFactory
  } catch (error) {
    logger.error('适配器系统初始化失败', error as Error)
    throw error
  }
}

/**
 * 获取适配器工厂实例（快捷方式）
 */
export function getAdapterFactoryInstance(): AdapterFactory {
  return getAdapterFactory()
}

export default initializeAdapters
