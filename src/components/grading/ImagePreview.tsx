import { Image } from 'lucide-react'

/**
 * 图片预览组件 Props 接口
 */
interface ImagePreviewProps {
  imagePath: string | null
  recognizedText?: string
}

/**
 * 图片预览组件
 * 负责显示答题图片和识别内容
 */
export default function ImagePreview({ imagePath, recognizedText }: ImagePreviewProps) {
  return (
    <>
      {/* 答题图片预览 */}
      <div className="card preview-card">
        <div className="card-header">
          <Image size={16} />
          <h3>答题图片预览</h3>
        </div>
        <div className="card-body">
          {imagePath ? (
            <img src={imagePath} alt="答题预览" className="preview-img" />
          ) : (
            <div className="preview-placeholder">
              <Image size={48} />
              <p>答题图片将显示在这里</p>
            </div>
          )}
        </div>
      </div>

      {/* 识别内容展示 */}
      {recognizedText && (
        <div className="card">
          <div className="card-header">
            <Image size={16} />
            <h3>识别内容</h3>
          </div>
          <div className="card-body">
            <pre className="recognized-text">{recognizedText}</pre>
          </div>
        </div>
      )}
    </>
  )
}
