// Reading a tar stream one chunk at a time.
//
// GitHub's archive endpoints answer with a gzip stream around a tar of a whole
// worktree, and the browser walks it looking for a handful of changed files.
// The walk has to be incremental — a chunk arrives, it is consumed, and nothing
// waits for the whole body — and it has to skip without buffering, because
// almost every entry in the archive is a file nobody asked for and holding it
// would cost the memory of the repository rather than of the diff.
//
// So the reader keeps at most one 512-byte header, one pax record set, and the
// bytes of the one file its sink said yes to. Everything else is a counter
// that eats incoming bytes. The sink is asked before an entry's data arrives,
// with the entry's size, which is what lets it refuse a file for being too
// large without paying for a single byte of it.
//
// The format is the POSIX ustar layout that `git archive` writes: fixed-width
// headers in 512-byte blocks, data padded to the block, pax extended headers
// (`x`) for paths longer than the fixed fields, one pax global header (`g`)
// carrying the commit id, and two zero blocks at the end. GNU extensions this
// app will never meet — base-256 sizes, `L` long-name entries — are treated as
// corruption rather than half-supported.

const BLOCK_SIZE = 512;

/**
 * A pax record set is a few short `key=value` lines. One claiming to be larger
 * than this is not metadata, it is a stream this reader has lost its place in.
 */
const MAX_PAX_BYTES = 1024 * 1024;

export interface TarEntryHeader {
  /** The path exactly as the archive wrote it, root directory included. */
  path: string;
  /** The entry's content size in bytes. */
  size: number;
}

export interface TarSink {
  /**
   * Asked once per regular file, before any of its bytes arrive. False skips
   * the file without buffering it.
   */
  wants(header: TarEntryHeader): boolean;
  /** One wanted file, complete. */
  onFile(path: string, bytes: Uint8Array): void;
}

const decoder = new TextDecoder();

export class TarReader {
  private readonly sink: TarSink;

  /** Bytes still to discard before the next thing worth reading. */
  private skip = 0;

  /** The wanted file being filled, or nothing. */
  private collectPath: string | undefined;
  private collectBytes: Uint8Array | undefined;
  private collectFilled = 0;
  private collectPadding = 0;

  /** The header or pax block being buffered, and how much of it has arrived. */
  private pending: Uint8Array = new Uint8Array(BLOCK_SIZE);
  private pendingFilled = 0;
  private parse: 'header' | 'pax' = 'header';
  private paxContentSize = 0;
  private paxGlobal = false;

  /** Overrides a following header's fixed-width fields, from a pax `x` entry. */
  private paxPath: string | undefined;
  private paxSize: number | undefined;

  private zeroBlocks = 0;
  private finished = false;

  constructor(sink: TarSink) {
    this.sink = sink;
  }

  push(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length) {
      // Everything after the end marker is padding some writers add to round
      // the stream up; it means nothing and is not an error.
      if (this.finished) return;

      if (this.skip > 0) {
        const taken = Math.min(this.skip, chunk.length - offset);
        this.skip -= taken;
        offset += taken;
        continue;
      }

      if (this.collectBytes != null) {
        const taken = Math.min(
          this.collectBytes.length - this.collectFilled,
          chunk.length - offset
        );
        this.collectBytes.set(
          chunk.subarray(offset, offset + taken),
          this.collectFilled
        );
        this.collectFilled += taken;
        offset += taken;
        if (this.collectFilled === this.collectBytes.length) {
          const path = this.collectPath;
          const bytes = this.collectBytes;
          this.collectPath = undefined;
          this.collectBytes = undefined;
          this.skip = this.collectPadding;
          if (path != null) this.sink.onFile(path, bytes);
        }
        continue;
      }

      const taken = Math.min(
        this.pending.length - this.pendingFilled,
        chunk.length - offset
      );
      this.pending.set(
        chunk.subarray(offset, offset + taken),
        this.pendingFilled
      );
      this.pendingFilled += taken;
      offset += taken;
      if (this.pendingFilled < this.pending.length) return;

      const block = this.pending;
      this.pending = new Uint8Array(BLOCK_SIZE);
      this.pendingFilled = 0;
      if (this.parse === 'header') {
        this.readHeader(block);
      } else {
        this.parse = 'header';
        this.readPax(block);
      }
    }
  }

  /**
   * Call once the stream ends. Throws when the archive stopped mid-entry,
   * which is what a capped or dropped download looks like from here. A stream
   * that ends cleanly between entries but without the two zero blocks is
   * accepted: some writers leave them off.
   */
  end(): void {
    if (this.finished) return;
    if (
      this.collectBytes != null ||
      this.skip > 0 ||
      this.pendingFilled > 0 ||
      this.parse === 'pax'
    ) {
      throw new Error('The archive ended in the middle of an entry.');
    }
  }

  private readHeader(block: Uint8Array): void {
    if (isZeroBlock(block)) {
      this.zeroBlocks += 1;
      if (this.zeroBlocks === 2) this.finished = true;
      return;
    }
    if (this.zeroBlocks > 0) {
      throw new Error('The archive continued after its end marker.');
    }
    // 'ustar' at offset 257 is the one fixed point of the format; a block
    // without it means the reader and the stream have come apart.
    if (readString(block, 257, 5) !== 'ustar') {
      throw new Error('That is not a tar header.');
    }

    const size = this.paxSize ?? readOctal(block, 124, 12);
    const padding = (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;
    const typeflag = block[156];

    // 'x' describes the next entry, 'g' describes every following one. Both
    // carry their records as data; only 'x' is worth parsing, since the global
    // one holds nothing but the commit id.
    if (typeflag === 0x78 || typeflag === 0x67) {
      if (size > MAX_PAX_BYTES) {
        throw new Error('That pax header is too large to be one.');
      }
      this.parse = 'pax';
      this.paxContentSize = size;
      this.paxGlobal = typeflag === 0x67;
      this.paxSize = undefined;
      this.pending = new Uint8Array(size + padding);
      this.pendingFilled = 0;
      return;
    }

    const path = this.paxPath ?? readName(block);
    this.paxPath = undefined;
    this.paxSize = undefined;

    // '0' and NUL are the two spellings of a regular file. Directories,
    // symlinks and the rest have nothing this app wants; their data — usually
    // none — is skipped like any other.
    const isFile = typeflag === 0x30 || typeflag === 0;
    if (isFile && this.sink.wants({ path, size })) {
      if (size === 0) {
        this.sink.onFile(path, new Uint8Array(0));
      } else {
        this.collectPath = path;
        this.collectBytes = new Uint8Array(size);
        this.collectFilled = 0;
        this.collectPadding = padding;
      }
      return;
    }
    this.skip = size + padding;
  }

  private readPax(block: Uint8Array): void {
    if (this.paxGlobal) return;
    // Records are `<length> <key>=<value>\n`, where the length counts the
    // whole record, its own digits included. The value is UTF-8 and may hold
    // an `=`, so only the first one splits.
    let offset = 0;
    while (offset < this.paxContentSize) {
      let digitsEnd = offset;
      while (digitsEnd < this.paxContentSize && block[digitsEnd] !== 0x20) {
        digitsEnd += 1;
      }
      const length = Number(readString(block, offset, digitsEnd - offset));
      if (!Number.isInteger(length) || length <= digitsEnd - offset + 2) {
        throw new Error('That pax record does not parse.');
      }
      const record = decoder.decode(
        block.subarray(digitsEnd + 1, offset + length - 1)
      );
      const equals = record.indexOf('=');
      if (equals > 0) {
        const key = record.slice(0, equals);
        const value = record.slice(equals + 1);
        if (key === 'path') this.paxPath = value;
        if (key === 'size') this.paxSize = Number(value);
      }
      offset += length;
    }
  }
}

function isZeroBlock(block: Uint8Array): boolean {
  for (const byte of block) {
    if (byte !== 0) return false;
  }
  return true;
}

/** The UTF-8 text of a fixed-width field, up to its first NUL. */
function readString(block: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && block[end] !== 0) end += 1;
  return decoder.decode(block.subarray(offset, end));
}

/**
 * A numeric field is octal digits, possibly led by spaces and ended by a space
 * or NUL. A first byte with the high bit set is GNU's base-256 form for sizes
 * past 8 GiB, which no archive this app reads should contain.
 */
function readOctal(block: Uint8Array, offset: number, length: number): number {
  const first = block[offset];
  if (first != null && (first & 0x80) !== 0) {
    throw new Error('That tar header uses a size format this reader does not.');
  }
  const text = readString(block, offset, length).trim();
  const value = Number.parseInt(text === '' ? '0' : text, 8);
  if (Number.isNaN(value)) {
    throw new Error('That tar header does not parse.');
  }
  return value;
}

/** The entry path from the fixed fields: prefix, a slash, then the name. */
function readName(block: Uint8Array): string {
  const name = readString(block, 0, 100);
  const prefix = readString(block, 345, 155);
  return prefix === '' ? name : `${prefix}/${name}`;
}
