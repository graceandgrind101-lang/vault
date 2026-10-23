/**
 * Krypton Vault - Zero-Dependency ISO/IEC 18004 QR Code Matrix Generator
 * Generates standard scannable QR codes (Versions 1 to 10, Error Correction L)
 * 100% client-side and offline with zero external dependencies.
 */

// Capacities for Byte mode at Error Correction Level L (Versions 1..10)
const VERSION_BYTE_CAPACITIES = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];

// Total data codewords and EC codewords per block for Level L (Versions 1..10)
interface VersionSpec {
  totalDataCodewords: number;
  ecCodewordsPerBlock: number;
  numBlocksGroup1: number;
  dataCodewordsGroup1: number;
  numBlocksGroup2: number;
  dataCodewordsGroup2: number;
  alignmentCoords: number[];
}

const VERSION_SPECS: Record<number, VersionSpec> = {
  1: { totalDataCodewords: 19, ecCodewordsPerBlock: 7, numBlocksGroup1: 1, dataCodewordsGroup1: 19, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCoords: [] },
  2: { totalDataCodewords: 34, ecCodewordsPerBlock: 10, numBlocksGroup1: 1, dataCodewordsGroup1: 34, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCoords: [6, 18] },
  3: { totalDataCodewords: 55, ecCodewordsPerBlock: 15, numBlocksGroup1: 1, dataCodewordsGroup1: 55, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCoords: [6, 22] },
  4: { totalDataCodewords: 80, ecCodewordsPerBlock: 20, numBlocksGroup1: 1, dataCodewordsGroup1: 80, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCoords: [6, 26] },
  5: { totalDataCodewords: 108, ecCodewordsPerBlock: 26, numBlocksGroup1: 1, dataCodewordsGroup1: 108, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCoords: [6, 30] },
  6: { totalDataCodewords: 136, ecCodewordsPerBlock: 18, numBlocksGroup1: 2, dataCodewordsGroup1: 68, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCoords: [6, 34] },
  7: { totalDataCodewords: 156, ecCodewordsPerBlock: 20, numBlocksGroup1: 2, dataCodewordsGroup1: 78, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCoords: [6, 22, 38] },
  8: { totalDataCodewords: 194, ecCodewordsPerBlock: 24, numBlocksGroup1: 2, dataCodewordsGroup1: 97, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCoords: [6, 24, 42] },
  9: { totalDataCodewords: 232, ecCodewordsPerBlock: 30, numBlocksGroup1: 2, dataCodewordsGroup1: 116, numBlocksGroup2: 0, dataCodewordsGroup2: 0, alignmentCoords: [6, 26, 46] },
  10: { totalDataCodewords: 274, ecCodewordsPerBlock: 18, numBlocksGroup1: 2, dataCodewordsGroup1: 68, numBlocksGroup2: 2, dataCodewordsGroup2: 69, alignmentCoords: [6, 28, 50] },
};

// GF(256) log/exp tables for Reed-Solomon
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaliosField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function getGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function computeReedSolomon(data: Uint8Array, ecDegree: number): Uint8Array {
  const gen = getGeneratorPoly(ecDegree);
  const msg = new Uint8Array(data.length + ecDegree);
  msg.set(data);

  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

export function generateQRMatrix(text: string): boolean[][] {
  const utf8Bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 10 && VERSION_BYTE_CAPACITIES[version] < utf8Bytes.length) {
    version++;
  }
  if (version > 10) {
    // Truncate safely if exceeding version 10 capacity
    return generateQRMatrix(text.slice(0, 240));
  }

  const spec = VERSION_SPECS[version];
  const bits: number[] = [];

  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Mode indicator: Byte mode (0100)
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for V1-9, 16 bits for V10)
  pushBits(utf8Bytes.length, version <= 9 ? 8 : 16);

  for (let i = 0; i < utf8Bytes.length; i++) {
    pushBits(utf8Bytes[i], 8);
  }

  // Terminator up to 4 zero bits
  const maxDataBits = spec.totalDataCodewords * 8;
  const termLen = Math.min(4, maxDataBits - bits.length);
  pushBits(0, termLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Pad codewords 0xEC, 0x11
  let padToggle = true;
  while (bits.length < maxDataBits) {
    pushBits(padToggle ? 0xec : 0x11, 8);
    padToggle = !padToggle;
  }

  // Convert bits to data codewords
  const dataCodewords = new Uint8Array(spec.totalDataCodewords);
  for (let i = 0; i < spec.totalDataCodewords; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    dataCodewords[i] = b;
  }

  // Split into blocks and compute EC
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < spec.numBlocksGroup1; i++) {
    const block = dataCodewords.slice(offset, offset + spec.dataCodewordsGroup1);
    offset += spec.dataCodewordsGroup1;
    dataBlocks.push(block);
    ecBlocks.push(computeReedSolomon(block, spec.ecCodewordsPerBlock));
  }
  for (let i = 0; i < spec.numBlocksGroup2; i++) {
    const block = dataCodewords.slice(offset, offset + spec.dataCodewordsGroup2);
    offset += spec.dataCodewordsGroup2;
    dataBlocks.push(block);
    ecBlocks.push(computeReedSolomon(block, spec.ecCodewordsPerBlock));
  }

  // Interleave data and EC codewords
  const finalCodewords: number[] = [];
  const maxBlockLen = Math.max(spec.dataCodewordsGroup1, spec.dataCodewordsGroup2);
  for (let i = 0; i < maxBlockLen; i++) {
    for (const b of dataBlocks) {
      if (i < b.length) finalCodewords.push(b[i]);
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (const ec of ecBlocks) {
      finalCodewords.push(ec[i]);
    }
  }

  const size = version * 4 + 17;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = dark;
      isFunction[r][c] = true;
    }
  };

  // Draw 7x7 finder pattern + 1-module white separator
  const drawFinder = (topR: number, leftC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const inBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (inBorder || inInner));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const coords = spec.alignmentCoords;
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === coords.length - 1) ||
        (i === coords.length - 1 && j === 0)
      ) {
        continue;
      }
      const cr = coords[i];
      const cc = coords[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(cr + dr, cc + dc, dark);
        }
      }
    }
  }

  // Dark module & reserve format info areas
  setFunctionModule(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!isFunction[8][i]) setFunctionModule(8, i, false);
    if (!isFunction[i][8]) setFunctionModule(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunction[8][size - 1 - i]) setFunctionModule(8, size - 1 - i, false);
    if (!isFunction[size - 1 - i][8]) setFunctionModule(size - 1 - i, 8, false);
  }

  // Place data bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // Skip vertical timing pattern column
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunction[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            dark = ((finalCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          // Apply Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) {
            dark = !dark;
          }
          matrix[r][c] = dark;
        }
      }
    }
    upward = !upward;
  }

  // Write Format Information for Level L (01) and Mask 0 (000) -> precomputed BCH bits: 0x77c4
  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((formatBits >>> i) & 1) === 1);
  setFunctionModule(8, 7, ((formatBits >>> 6) & 1) === 1);
  setFunctionModule(8, 8, ((formatBits >>> 7) & 1) === 1);
  setFunctionModule(7, 8, ((formatBits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((formatBits >>> i) & 1) === 1);

  for (let i = 0; i < 8; i++) setFunctionModule(8, size - 1 - i, ((formatBits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) setFunctionModule(size - 15 + i, 8, ((formatBits >>> i) & 1) === 1);

  return matrix;
}
