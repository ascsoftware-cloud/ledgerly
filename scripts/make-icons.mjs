// Generates the app icons (public/pwa/*, src/app/apple-icon.png) from one drawing. Run: node scripts/make-icons.mjs
import sharp from "sharp";

const GREEN = "#059669";

// A white "L" (for Ledgerly) on green. `scale` shrinks the glyph for the maskable icon's safe zone.
function svg({ rounded, scale }) {
  const g = (v) => 256 + (v - 256) * scale;
  const bar = (x, y, w, h) => `<rect x="${g(x)}" y="${g(y)}" width="${w * scale}" height="${h * scale}" rx="${14 * scale}" fill="#fff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${GREEN}"/>
${bar(156, 118, 64, 276)}${bar(156, 330, 208, 64)}
</svg>`;
}

async function png(file, size, opts) {
  await sharp(Buffer.from(svg(opts))).resize(size, size).png().toFile(file);
  console.log("wrote", file);
}

await png("public/pwa/icon-192.png", 192, { rounded: true, scale: 1 });
await png("public/pwa/icon-512.png", 512, { rounded: true, scale: 1 });
await png("public/pwa/icon-maskable-512.png", 512, { rounded: false, scale: 0.72 });
await png("src/app/apple-icon.png", 180, { rounded: false, scale: 0.86 });
