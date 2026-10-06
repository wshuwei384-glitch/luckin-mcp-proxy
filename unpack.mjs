import fs from "node:fs";
import zlib from "node:zlib";

const PNG = "luckin-mcp-proxy-carrier.png";

const buf = fs.readFileSync(PNG);

// PNG signature
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!buf.subarray(0, 8).equals(sig)) {
  throw new Error("Invalid PNG");
}

let pos = 8;
let width, height, bitDepth, colorType;
const idat = [];

while (pos < buf.length) {
  const length = buf.readUInt32BE(pos);
  const type = buf.toString("ascii", pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + length);

  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
  } else if (type === "IDAT") {
    idat.push(data);
  } else if (type === "IEND") {
    break;
  }

  pos += 12 + length;
}

if (bitDepth !== 8 || colorType !== 2) {
  throw new Error("Expected 8-bit RGB PNG");
}

const raw = zlib.inflateSync(Buffer.concat(idat));
const bpp = 3;
const stride = width * bpp;
const pixels = Buffer.alloc(height * stride);

let src = 0;

for (let y = 0; y < height; y++) {
  const filter = raw[src++];
  const row = raw.subarray(src, src + stride);
  src += stride;

  const out = pixels.subarray(y * stride, (y + 1) * stride);
  const prev =
    y === 0
      ? Buffer.alloc(stride)
      : pixels.subarray((y - 1) * stride, y * stride);

  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? out[x - bpp] : 0;
    const b = prev[x];
    const c = x >= bpp ? prev[x - bpp] : 0;

    let value;

    if (filter === 0) {
      value = row[x];
    } else if (filter === 1) {
      value = (row[x] + a) & 255;
    } else if (filter === 2) {
      value = (row[x] + b) & 255;
    } else if (filter === 3) {
      value = (row[x] + Math.floor((a + b) / 2)) & 255;
    } else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      value = (row[x] + pr) & 255;
    } else {
      throw new Error(`Unsupported PNG filter ${filter}`);
    }

    out[x] = value;
  }
}

// Carrier data begins after the 190px visual header.
const carrier = pixels.subarray(190 * stride);

if (carrier.subarray(0, 7).toString() !== "LCKZIP1") {
  throw new Error("Carrier signature not found");
}

const size = Number(carrier.readBigUInt64BE(7));
const zip = carrier.subarray(15, 15 + size);

fs.writeFileSync("payload.zip", zip);

console.log(`Recovered ${size} bytes to payload.zip`);
