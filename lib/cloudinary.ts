import { v2 as cloudinary } from 'cloudinary';

const cloudName = process.env.CLOUDINARY_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

export function assertCloudinaryConfig() {
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Missing Cloudinary configuration: CLOUDINARY_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be set.'
    );
  }
}

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
}

/**
 * Deletes a file from Cloudinary.
 * @param publicId - The public ID of the resource to delete.
 * @param options - Optional Cloudinary destroy settings (e.g., resource_type).
 * @returns Promise resolving to the deletion result.
 */
export async function deleteFromCloudinary(
  publicId: string,
  options?: { resource_type?: 'image' | 'video' | 'raw'; invalidate?: boolean }
): Promise<{ result: string }> {
  try {
    assertCloudinaryConfig();
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image', // Defaults to image, but can be overridden
      ...options,
    });
    return result;
  } catch (error) {
    console.error('Cloudinary deletion error:', error);
    throw error;
  }
}

/**
 * Extracts the public ID from a Cloudinary URL.
 * @param url - The Cloudinary secure or standard URL.
 */
export function getPublicIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('cloudinary.com')) return null;

    const parts = parsed.pathname.split('/').filter(Boolean);
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1 || uploadIndex + 1 >= parts.length) return null;

    let startIndex = uploadIndex + 1;
    // Skip version tag (e.g. v12345678)
    if (parts[startIndex].startsWith('v') && /^\d+$/.test(parts[startIndex].slice(1))) {
      startIndex += 1;
    }

    const remainingPath = parts.slice(startIndex).join('/');
    // Remove the file extension (e.g. .jpg)
    return remainingPath.replace(/\.[^/.]+$/, '');
  } catch {
    return null;
  }
}

export { cloudinary };
