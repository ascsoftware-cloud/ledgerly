// Generates the app icons from the ASC mark (public/pwa/*, src/app/apple-icon.png, src/app/favicon.ico).
// Run: node scripts/make-icons.mjs. The mark is the same drawing as src/components/brand/logo.tsx.
import { writeFileSync } from "node:fs";
import sharp from "sharp";

// `rounded` draws the green square with rounded corners (otherwise full bleed, for maskable and Apple icons, which
// the system crops itself); `scale` shrinks the triangles toward the centre to keep them inside a maskable safe zone.
function svg({ rounded, scale }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">
<rect width="100" height="100" rx="${rounded ? 22 : 0}" fill="#176e56"/>
<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">
<polygon points="62,13 34,80 95,80" fill="#f2f0e8" stroke="#f2f0e8" stroke-width="3" stroke-linejoin="round"/>
<polygon points="29,44 6,80 55,80" fill="#e8d6b0" stroke="#176e56" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>
</g>
</svg>`;
}

async function png(size, opts) {
  return sharp(Buffer.from(svg(opts))).resize(size, size).png().toBuffer();
}
async function write(file, size, opts) {
  writeFileSync(file, await png(size, opts));
  console.log("wrote", file);
}

await write("public/pwa/icon-192.png", 192, { rounded: true, scale: 1 });
await write("public/pwa/icon-512.png", 512, { rounded: true, scale: 1 });
await write("public/pwa/icon-maskable-512.png", 512, { rounded: false, scale: 0.72 });
await write("src/app/apple-icon.png", 180, { rounded: false, scale: 0.9 });

// favicon.ico: an ICO file may hold PNG images directly (16, 32 and 48 px).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(s, { rounded: true, scale: 1 })));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((img, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 0);
  e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(img.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.length;
  return e;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([header, ...entries, ...images]));
console.log("wrote src/app/favicon.ico");
