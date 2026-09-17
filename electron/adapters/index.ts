/**
 * 适配器模块导出
 * 统一导出所有适配器相关的接口和类
 */

// 导出接口定义
export {
  PlatformAdapter,
  PlatformPageAnalysisResult,
  PlatformAdapterFactory,
  PlatformDetectionRule,
} from './PlatformAdapter.interface'

// 导出基础适配器
export { BaseAdapter } from './BaseAdapter'

// 导出具体适配器
export { ZhixueAdapter } from './ZhixueAdapter'
export { GenericAdapter } from './GenericAdapter'
export { ConfigurableAdapter } from './ConfigurableAdapter'

// 导出适配器工厂
export { AdapterFactory, getAdapterFactory, createAdapterFactory } from './AdapterFactory'

// 导出初始化函数
export { initializeAdapters, getAdapterFactoryInstance } from './init'
