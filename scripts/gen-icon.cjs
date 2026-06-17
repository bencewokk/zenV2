// Generates a 1024x1024 solid Zen-blue source PNG for `tauri icon`.
// Replace app-icon.png with your own artwork anytime and re-run `npm run tauri icon`.
const zlib = require("zlib");
const fs = require("fs");

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const W = 1024, H = 1024;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: truecolor RGB

const row = Buffer.alloc(1 + W * 3);
row[0] = 0; // filter: none
for (let x = 0; x < W; x++) {
  row[1 + x * 3] = 0x6e;
  row[2 + x * 3] = 0xa8;
  row[3 + x * 3] = 0xfe;
}
const raw = Buffer.concat(Array.from({ length: H }, () => row));
const idat = zlib.deflateSync(raw);

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync("app-icon.png", png);
console.log("wrote app-icon.png (1024x1024)");
