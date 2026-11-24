import { type EditorView } from "prosemirror-view"

export const uploadingImages = new Set<string>()
export const UPLOAD_META = "image-upload-state-changed"

export function isImageUploading(src: string): boolean {
  return uploadingImages.has(src)
}

export function markUploading(src: string): void {
  uploadingImages.add(src)
}

export function clearUploading(src: string): void {
  uploadingImages.delete(src)
}

export function dispatchUploadMeta(view?: EditorView): void {
  view?.dispatch(view.state.tr.setMeta(UPLOAD_META, true))
}

export function setImageUploading(src: string, view?: EditorView): void {
  markUploading(src)
  dispatchUploadMeta(view)
}

export function clearImageUploading(src: string, view?: EditorView): void {
  clearUploading(src)
  dispatchUploadMeta(view)
}
