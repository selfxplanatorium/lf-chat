import sharp from 'sharp';
import type { StoredAttachment } from './attachments';

export const MAX_MODEL_IMAGE_BYTES = 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

/** Prepare a model input copy; never alter the stored original or its metadata. */
export async function prepareWebhookFile(file: StoredAttachment): Promise<StoredAttachment> {
  if (!file.contentType.startsWith('image/')) return file;
  try {
    const image = sharp(file.data, { limitInputPixels: MAX_IMAGE_PIXELS, pages: 1 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new Error('Image pixel limit exceeded');
    }
    if (file.data.length <= MAX_MODEL_IMAGE_BYTES && Math.max(metadata.width, metadata.height) <= 2048) return file;

    // Large inline images crash the deployed n8n model adapter. Preserve as
    // much resolution as fits the input budget, at high JPEG quality.
    for (const edge of [2048, 1536, 1024]) {
      const data = await image.clone().rotate()
        .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 90 })
        .timeout({ seconds: 10 }).toBuffer();
      if (data.length <= MAX_MODEL_IMAGE_BYTES) {
        return { ...file, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', contentType: 'image/jpeg', size: data.length, data };
      }
    }
    throw new Error('Image byte limit exceeded');
  } catch {
    throw new Error('Could not prepare image; use a readable image of at most 40 megapixels');
  }
}
