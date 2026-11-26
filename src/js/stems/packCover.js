// Portada de un pack a partir de una imagen del multitrack (ZIP o carpeta): recorte cuadrado
// al centro, entre 600 y 1200 px, en JPEG — como las portadas que se eligen a mano en el subidor.

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** bytes (ArrayBuffer) + nombre → File JPEG cuadrado, o null si la imagen no se puede leer. */
export async function squareCover(bytes, name = 'cover.jpg') {
  try {
    const ext = String(name).split('.').pop().toLowerCase();
    const img = await createImageBitmap(new Blob([bytes], { type: TYPES[ext] || 'image/jpeg' }));
    const side = Math.min(img.width, img.height);
    if (side < 200) return null;
    const out = Math.min(1200, Math.max(600, side));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = out;
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, Math.round((img.width - side) / 2), Math.round((img.height - side) / 2), side, side, 0, 0, out, out);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    return blob ? new File([blob], 'cover.jpg', { type: 'image/jpeg' }) : null;
  } catch (_) { return null; }
}
