export async function resizeScreenshotForModel(
  base64Data: string,
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number = 1,
): Promise<{ data: string; width: number; height: number }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load screenshot image'));
    img.src = `data:image/png;base64,${base64Data}`;
  });

  const width = viewportWidth;
  const height = viewportHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/png');
  const data = dataUrl.split(',')[1];

  return { data, width, height };
}
