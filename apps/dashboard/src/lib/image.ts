/** Result of shrinking an image in the browser before upload. */
export interface PreparedImage {
  blob: Blob
  ext: 'webp' | 'jpg'
  width: number
  height: number
}

/**
 * Shrinks an image so its longest side is at most `maxSide` (never enlarges)
 * and re-encodes it as WebP (JPEG where WebP encoding is not supported).
 * Any photo from a phone can be picked; the uploaded file stays small.
 */
export async function prepareImage(file: File, maxSide = 1600, quality = 0.85): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('not_image')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  let blob = await encode('image/webp')
  let ext: PreparedImage['ext'] = 'webp'
  if (!blob || blob.type !== 'image/webp') {
    blob = await encode('image/jpeg')
    ext = 'jpg'
  }
  if (!blob) throw new Error('encode')
  return { blob, ext, width, height }
}

/** Reads only the pixel size of an image file (no re-encoding). */
export async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}
