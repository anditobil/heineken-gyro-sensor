/**
 * Brand asset slots. Official brand files are NOT drawn in code: drop them into
 * `public/brand/` (see README.md there) and they replace the placeholders automatically.
 *
 * Markup: <div class="brand-slot" data-brand="heineken-house-logo" data-label="…">fallback</div>
 * The loader tries <name>.svg, then <name>.png. If neither exists, the slot keeps its fallback
 * content (or a dashed placeholder box labelled with data-label).
 */
const EXT = ['svg', 'png', 'webp'];

function tryLoad(name, i = 0) {
  return new Promise((resolve) => {
    if (i >= EXT.length) return resolve(null);
    const src = `./brand/${name}.${EXT[i]}`;
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => tryLoad(name, i + 1).then(resolve);
    img.src = src;
  });
}

const found = new Map();

/** Resolves the URL of a brand file, or null if it is not in public/brand/. */
export function brandUrl(name) {
  if (!found.has(name)) found.set(name, tryLoad(name));
  return found.get(name);
}

export function initBrandSlots(root = document) {
  for (const slot of root.querySelectorAll('[data-brand]')) {
    const name = slot.dataset.brand;
    slot.classList.add('brand-slot');
    brandUrl(name).then((src) => {
      if (!src) {
        slot.classList.add('missing');
        return;
      }
      const img = document.createElement('img');
      img.src = src;
      img.alt = slot.dataset.label || name;
      img.draggable = false;
      slot.appendChild(img);
      slot.classList.add('loaded');
    });
  }
}
