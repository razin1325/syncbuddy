/**
 * Pure TypeScript ISO/IEC 18004 QR Code Matrix Generator
 * Zero external dependencies. Generates valid standard QR code 2D boolean matrix.
 * Compatible with any standard QR Scanner, Google Lens, and phone camera.
 */

// Error correction levels: L (7%), M (15%), Q (25%), H (30%)
export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

const PAD0 = 0xec;
const PAD1 = 0x11;

const EXP_TABLE = new Array(256);
const LOG_TABLE = new Array(256);

for (let i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i;
for (let i = 8; i < 256; i++) {
  EXP_TABLE[i] =
    EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i++) LOG_TABLE[EXP_TABLE[i]] = i;

function glog(n: number) {
  if (n < 1) throw new Error(`glog(${n})`);
  return LOG_TABLE[n];
}

function gexp(n: number) {
  while (n < 0) n += 255;
  while (n >= 256) n -= 255;
  return EXP_TABLE[n];
}

class Polynomial {
  num: number[];
  constructor(num: number[], shift = 0) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) {
      this.num[i] = num[i + offset];
    }
    for (let i = num.length - offset; i < this.num.length; i++) {
      this.num[i] = 0;
    }
  }

  get(index: number) {
    return this.num[index];
  }

  getLength() {
    return this.num.length;
  }

  multiply(e: Polynomial): Polynomial {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
      }
    }
    return new Polynomial(num);
  }

  mod(e: Polynomial): Polynomial {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= gexp(glog(e.get(i)) + ratio);
    }
    return new Polynomial(num).mod(e);
  }
}

class QRRSBlock {
  totalCount: number;
  dataCount: number;

  constructor(totalCount: number, dataCount: number) {
    this.totalCount = totalCount;
    this.dataCount = dataCount;
  }

  // Version 1 to 6 RS blocks (covers up to 134 bytes, plenty for IP + Room code)
  static getRSBlocks(typeNumber: number): QRRSBlock[] {
    switch (typeNumber) {
      case 1:
        return [new QRRSBlock(26, 19)];
      case 2:
        return [new QRRSBlock(44, 34)];
      case 3:
        return [new QRRSBlock(70, 55)];
      case 4:
        return [new QRRSBlock(100, 80)];
      case 5:
        return [new QRRSBlock(134, 108)];
      default:
        return [new QRRSBlock(172, 136)];
    }
  }
}

class QRBitBuffer {
  buffer: number[] = [];
  length = 0;

  get(index: number) {
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
  }

  put(num: number, length: number) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) this.buffer.push(0);
    if (bit) this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    this.length++;
  }
}

function getBCHTypeInfo(data: number): number {
  let d = data << 10;
  while (getBCHDigit(d) - getBCHDigit(0x537) >= 0) {
    d ^= 0x537 << (getBCHDigit(d) - getBCHDigit(0x537));
  }
  return ((data << 10) | d) ^ 0x5412;
}

function getBCHDigit(data: number): number {
  let digit = 0;
  while (data !== 0) {
    digit++;
    data >>>= 1;
  }
  return digit;
}

export class QRCodeModel {
  typeNumber: number;
  modules: (boolean | null)[][] = [];
  moduleCount = 0;
  dataList: string[] = [];

  constructor(typeNumber: number) {
    this.typeNumber = typeNumber;
    this.moduleCount = typeNumber * 4 + 17;
  }

  addData(data: string) {
    this.dataList.push(data);
  }

  isDark(row: number, col: number): boolean {
    if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
      return false;
    }
    return !!this.modules[row][col];
  }

  make() {
    this.modules = Array.from({ length: this.moduleCount }, () =>
      new Array(this.moduleCount).fill(null)
    );

    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupTimingPattern();
    this.setupPositionAdjustPattern();
    this.setupTypeInfo(true, 0);

    const data = this.createData();
    this.mapData(data, 0);
    this.setupTypeInfo(false, 0);
  }

  private setupTypeInfo(test: boolean, maskPattern: number) {
    // EC Level L is 1
    const data = (1 << 3) | maskPattern;
    const bits = getBCHTypeInfo(data);

    // vertical
    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 6) {
        this.modules[i][8] = mod;
      } else if (i < 8) {
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }
    }

    // horizontal
    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 8) {
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9) {
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }

    // fixed dark module
    this.modules[this.moduleCount - 8][8] = !test;
  }

  private setupPositionProbePattern(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.moduleCount <= col + c) continue;
        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          this.modules[row + r][col + c] = true;
        } else {
          this.modules[row + r][col + c] = false;
        }
      }
    }
  }

  private setupTimingPattern() {
    for (let r = 8; r < this.moduleCount - 8; r++) {
      if (this.modules[r][6] !== null) continue;
      this.modules[r][6] = r % 2 === 0;
    }
    for (let c = 8; c < this.moduleCount - 8; c++) {
      if (this.modules[6][c] !== null) continue;
      this.modules[6][c] = c % 2 === 0;
    }
  }

  private setupPositionAdjustPattern() {
    if (this.typeNumber < 2) return;
    const pos = this.typeNumber * 4 + 10;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        if (
          Math.abs(r) === 2 ||
          Math.abs(c) === 2 ||
          (r === 0 && c === 0)
        ) {
          this.modules[pos + r][pos + c] = true;
        } else {
          this.modules[pos + r][pos + c] = false;
        }
      }
    }
  }

  private createData(): number[] {
    const rsBlock = QRRSBlock.getRSBlocks(this.typeNumber)[0];
    const buffer = new QRBitBuffer();

    for (let i = 0; i < this.dataList.length; i++) {
      const data = this.dataList[i];
      // 8-bit byte mode (0100)
      buffer.put(4, 4);
      buffer.put(data.length, 8);
      for (let j = 0; j < data.length; j++) {
        buffer.put(data.charCodeAt(j), 8);
      }
    }

    // Terminator
    if (buffer.length + 4 <= rsBlock.dataCount * 8) {
      buffer.put(0, 4);
    }
    while (buffer.length % 8 !== 0) {
      buffer.putBit(false);
    }
    while (buffer.length < rsBlock.dataCount * 8) {
      buffer.put(PAD0, 8);
      if (buffer.length >= rsBlock.dataCount * 8) break;
      buffer.put(PAD1, 8);
    }

    // Reed Solomon Error Correction
    const dataBytes: number[] = [];
    for (let i = 0; i < rsBlock.dataCount; i++) {
      let b = 0;
      for (let j = 0; j < 8; j++) {
        if (buffer.get(i * 8 + j)) b |= 0x80 >>> j;
      }
      dataBytes.push(b);
    }

    const ecCount = rsBlock.totalCount - rsBlock.dataCount;
    let rsPoly = new Polynomial([1]);
    for (let i = 0; i < ecCount; i++) {
      rsPoly = rsPoly.multiply(new Polynomial([1, gexp(i)]));
    }
    const rawPoly = new Polynomial(dataBytes, rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);

    const ecBytes: number[] = new Array(rsPoly.getLength() - 1).fill(0);
    for (let i = 0; i < ecBytes.length; i++) {
      const modIndex = i + modPoly.getLength() - ecBytes.length;
      ecBytes[i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
    }

    return [...dataBytes, ...ecBytes];
  }

  private mapData(data: number[], maskPattern: number) {
    let inc = -1;
    let row = this.moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;

    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (let c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            }
            // mask pattern 0: (row + col) % 2 === 0
            const mask = (row + (col - c)) % 2 === 0;
            this.modules[row][col - c] = mask ? !dark : dark;
            bitIndex--;
            if (bitIndex === -1) {
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || this.moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }
}

/**
 * Generate a 2D boolean array representing real scannable QR modules
 */
export function generateQRMatrix(text: string): boolean[][] {
  // Determine version: 1 (up to 17 chars), 2 (up to 32 chars), 3 (up to 53 chars), 4 (up to 78 chars), 5 (up to 106 chars)
  let version = 2;
  if (text.length <= 14) version = 1;
  else if (text.length <= 26) version = 2;
  else if (text.length <= 42) version = 3;
  else if (text.length <= 62) version = 4;
  else version = 5;

  const qr = new QRCodeModel(version);
  qr.addData(text);
  qr.make();

  // ISO/IEC 18004 Standard: 4-module clean quiet zone all around
  const quiet = 4;
  const total = qr.moduleCount + quiet * 2;
  const matrix: boolean[][] = Array.from({ length: total }, () =>
    new Array(total).fill(false)
  );

  for (let r = 0; r < qr.moduleCount; r++) {
    for (let c = 0; c < qr.moduleCount; c++) {
      matrix[r + quiet][c + quiet] = qr.isDark(r, c);
    }
  }
  return matrix;
}

