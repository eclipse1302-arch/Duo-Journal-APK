// Client-side media handling: compress images and convert to base64 data URLs.
// No external storage bucket required.

const MAX_IMAGE_WIDTH = 1200;
const MAX_IMAGE_HEIGHT = 1200;
const IMAGE_QUALITY = 0.8;
const MAX_VIDEO_SIZE = 5 * 1024 * 1024; // 5MB for video

export async function processImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Resize if necessary
        let { width, height } = img;
        if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
          const ratio = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not supported'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to JPEG for smaller size (unless it's a PNG with transparency or GIF)
        const isPng = file.type === 'image/png';
        const isGif = file.type === 'image/gif';
        
        if (isGif) {
          // For GIFs, keep original (canvas loses animation)
          resolve(e.target?.result as string);
        } else {
          const outputType = isPng ? 'image/png' : 'image/jpeg';
          const quality = isPng ? undefined : IMAGE_QUALITY;
          const dataUrl = canvas.toDataURL(outputType, quality);
          resolve(dataUrl);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function processVideo(file: File): Promise<string> {
  if (file.size > MAX_VIDEO_SIZE) {
    throw new Error(`Video too large. Maximum size is ${MAX_VIDEO_SIZE / 1024 / 1024}MB.`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve(e.target?.result as string);
    };
    reader.onerror = () => reject(new Error('Failed to read video file'));
    reader.readAsDataURL(file);
  });
}
