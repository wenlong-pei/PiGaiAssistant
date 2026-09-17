import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { GradingStandard, PresetSet } from '@/types'
import { createResilientPersistStorage } from './resilientStorage'

interface StandardsState {
  standards: GradingStandard[]
  presetSets: PresetSet[]
  currentPresetId: string | null
  currentStandardId: string | null
  
  // 标准操作
  addStandard: (standard: Omit<GradingStandard, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateStandard: (id: string, updates: Partial<GradingStandard>) => void
  deleteStandard: (id: string) => void
  duplicateStandard: (id: string) => string | null
  
  // 预设套操作
  addPresetSet: (preset: Omit<PresetSet, 'id'>) => string
  updatePresetSet: (id: string, updates: Partial<PresetSet>) => void
  deletePresetSet: (id: string) => void
  switchPresetSet: (id: string) => void
  
  // 当前选择
  setCurrentStandard: (id: string | null) => void
  getCurrentStandard: () => GradingStandard | null
}

/**
 * 「瘦身重试」：配额写失败时剥离示例答案里的 base64 图片再写一次。
 *
 * 只在**真正写失败时**触发 —— 正常路径仍然完整保留 `examples[].image`，
 * 因此不会改变持久化字段集合；代价是配额彻底满时宁可丢示例图，也不丢整套评分标准。
 */
function shrinkStandardsPayload(rawJson: string): string | null {
  try {
    const payload = JSON.parse(rawJson) as { state?: Partial<StandardsState> }
    const standards = payload?.state?.standards
    if (!Array.isArray(standards)) return null

    let touched = false
    payload.state!.standards = standards.map((standard) => {
      if (!standard || !Array.isArray(standard.examples)) return standard
      let exampleTouched = false
      const examples = standard.examples.map((example) => {
        if (example && typeof example === 'object' && example.image) {
          exampleTouched = true
          return { ...example, image: '' }
        }
        return example
      })
      if (!exampleTouched) return standard
      touched = true
      return { ...standard, examples }
    })

    return touched ? JSON.stringify(payload) : null
  } catch {
    return null
  }
}

/**
 * 容错存储（8.4）：评分标准里含示例答案图片（base64），
 * 配额满时 `setItem` 会同步抛错并把保存动作整个打断。接上容错存储后只降级、不抛错。
 */
const { storage: standardsStorage } = createResilientPersistStorage<StandardsState>({
  label: 'standardsStore',
  shrink: shrinkStandardsPayload,
})

export const useStandardsStore = create<StandardsState>()(
  persist(
    (set, get) => ({
      standards: [],
      presetSets: [],
      currentPresetId: null,
      currentStandardId: null,

      addStandard: (standard) => {
        if (!standard.name || standard.name.trim() === '') {
          throw new Error('标准名称不能为空')
        }
        if (!standard.totalScore || standard.totalScore <= 0) {
          throw new Error('总分必须大于0')
        }
        const id = uuidv4()
        const now = new Date().toISOString()
        set((state) => ({
          standards: [
            ...state.standards,
            { ...standard, id, createdAt: now, updatedAt: now },
          ],
        }))
        return id
      },

      updateStandard: (id, updates) => {
        set((state) => ({
          standards: state.standards.map((s) =>
            s.id === id
              ? { ...s, ...updates, updatedAt: new Date().toISOString() }
              : s
          ),
        }))
      },

      deleteStandard: (id) => {
        set((state) => ({
          standards: state.standards.filter((s) => s.id !== id),
          // 如果删除的是当前选中的标准，清除悬挂引用
          currentStandardId: state.currentStandardId === id ? null : state.currentStandardId,
        }))
      },

      duplicateStandard: (id) => {
        const standard = get().standards.find((s) => s.id === id)
        if (!standard) return null
        const newId = uuidv4()
        const now = new Date().toISOString()
        set((state) => ({
          standards: [
            ...state.standards,
            {
              ...standard,
              id: newId,
              name: `${standard.name} (副本)`,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }))
        return newId
      },

      addPresetSet: (preset) => {
        const id = uuidv4()
        set((state) => ({
          presetSets: [...state.presetSets, { ...preset, id }],
        }))
        return id
      },

      updatePresetSet: (id, updates) => {
        set((state) => ({
          presetSets: state.presetSets.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }))
      },

      deletePresetSet: (id) => {
        set((state) => ({
          presetSets: state.presetSets.filter((p) => p.id !== id),
        }))
      },

      switchPresetSet: (id) => {
        const preset = get().presetSets.find((p) => p.id === id)
        if (preset) {
          set({
            currentPresetId: id,
            standards: preset.standards,
            // 切换预设后旧的标准ID不再有效，清除悬挂引用
            currentStandardId: null,
          })
        }
      },

      setCurrentStandard: (id) => {
        set({ currentStandardId: id })
      },

      getCurrentStandard: () => {
        const { standards, currentStandardId } = get()
        return standards.find((s) => s.id === currentStandardId) || null
      },
    }),
    {
      name: 'grading-standards',
      // 容错存储：写入失败（配额满）只降级 + 记错误，绝不把异常抛给调用方
      storage: standardsStorage,
      // 持久化字段与旧版本完全一致（身份映射）；图片仅在写失败时由 shrink 兜底剥离
      partialize: (state): StandardsState => ({ ...state }),
    }
  )
)
