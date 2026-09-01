import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type TarEntryHeader, TarReader, type TarSink } from './tar.ts';

// The archives under test are built here, byte by byte, to the same POSIX
// ustar layout `git archive` writes: fixed-width headers, data padded to the
// 512-byte block, pax records for what the fixed fields cannot carry, and two
// zero blocks at the end.

const BLOCK = 512;
const encoder = new TextEncoder();

function writeString(block: Uint8Array, offset: number, text: string): void {
  block.set(encoder.encode(text), offset);
}

function writeOctal(
  block: Uint8Array,
  offset: number,
  length: number,
  value: number
): void {
  writeString(block, offset, value.toString(8).padStart(length - 1, '0'));
}

function header(
  name: string,
  size: number,
  options: { typeflag?: string; prefix?: string } = {}
): Uint8Array {
  const block = new Uint8Array(BLOCK);
  writeString(block, 0, name);
  writeOctal(block, 100, 8, 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, 0);
  writeString(block, 148, '        ');
  writeString(block, 156, options.typeflag ?? '0');
  writeString(block, 257, 'ustar');
  writeString(block, 263, '00');
  if (options.prefix != null) writeString(block, 345, options.prefix);
  // The checksum is the byte sum with its own field read as spaces.
  let sum = 0;
  for (const byte of block) sum += byte;
  writeOctal(block, 148, 7, sum);
  block[155] = 0x20;
  return block;
}

function data(contents: string): Uint8Array {
  const bytes = encoder.encode(contents);
  const padded = new Uint8Array(Math.ceil(bytes.length / BLOCK) * BLOCK);
  padded.set(bytes);
  return padded;
}

function file(
  name: string,
  contents: string,
  options: { prefix?: string } = {}
): Uint8Array[] {
  const bytes = encoder.encode(contents);
  return [header(name, bytes.length, options), data(contents)];
}

function paxHeader(records: Record<string, string>): Uint8Array[] {
  let text = '';
  for (const [key, value] of Object.entries(records)) {
    const body = ` ${key}=${value}\n`;
    // The length prefix counts itself, so it is found by fixpoint: almost
    // every record settles in one step and a carry settles in two.
    let length = body.length + 1;
    while (`${length}${body}`.length !== length) {
      length = `${length}${body}`.length;
    }
    text += `${length}${body}`;
  }
  return [
    header('pax', encoder.encode(text).length, { typeflag: 'x' }),
    data(text),
  ];
}

function archive(...parts: Uint8Array[][]): Uint8Array {
  const blocks = [
    ...parts.flat(),
    new Uint8Array(BLOCK),
    new Uint8Array(BLOCK),
  ];
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    bytes.set(block, offset);
    offset += block.length;
  }
  return bytes;
}

class RecordingSink implements TarSink {
  offered: TarEntryHeader[] = [];
  kept = new Map<string, string>();
  accept: (header: TarEntryHeader) => boolean;

  constructor(accept: (header: TarEntryHeader) => boolean = () => true) {
    this.accept = accept;
  }

  wants(entry: TarEntryHeader): boolean {
    this.offered.push(entry);
    return this.accept(entry);
  }

  onFile(path: string, bytes: Uint8Array): void {
    this.kept.set(path, new TextDecoder().decode(bytes));
  }
}

/** Runs the reader over the archive in slices of the given size. */
function read(
  bytes: Uint8Array,
  sink: TarSink,
  chunkSize = bytes.length
): void {
  const reader = new TarReader(sink);
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    reader.push(
      bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    );
  }
  reader.end();
}

test('reads a file whole', () => {
  const sink = new RecordingSink();
  read(archive(file('repo/src/a.ts', 'const a = 1;\n')), sink);
  assert.deepEqual([...sink.kept], [['repo/src/a.ts', 'const a = 1;\n']]);
});

test('every chunk boundary lands somewhere safe', () => {
  const bytes = archive(
    file('repo/a.txt', 'first\n'),
    file('repo/b.txt', 'x'.repeat(600)),
    file('repo/c.txt', '')
  );
  for (const chunkSize of [1, 7, BLOCK - 1, BLOCK, BLOCK + 1]) {
    const sink = new RecordingSink();
    read(bytes, sink, chunkSize);
    assert.equal(sink.kept.get('repo/a.txt'), 'first\n');
    assert.equal(sink.kept.get('repo/b.txt'), 'x'.repeat(600));
    assert.equal(sink.kept.get('repo/c.txt'), '');
  }
});

test('a refused file costs no delivery and no offer of its bytes', () => {
  const sink = new RecordingSink((entry) => entry.path !== 'repo/big.bin');
  read(
    archive(
      file('repo/big.bin', 'y'.repeat(2000)),
      file('repo/keep.txt', 'kept')
    ),
    sink
  );
  assert.deepEqual([...sink.kept.keys()], ['repo/keep.txt']);
  assert.deepEqual(
    sink.offered.map((entry) => entry.path),
    ['repo/big.bin', 'repo/keep.txt']
  );
});

test('a directory is never offered', () => {
  const sink = new RecordingSink();
  read(
    archive(
      [header('repo/src/', 0, { typeflag: '5' })],
      file('repo/src/a.ts', 'a')
    ),
    sink
  );
  assert.deepEqual(
    sink.offered.map((entry) => entry.path),
    ['repo/src/a.ts']
  );
});

test('a pax path record overrides the fixed field', () => {
  const longPath = `repo/${'directory/'.repeat(15)}file.ts`;
  const sink = new RecordingSink();
  read(
    archive(paxHeader({ path: longPath }), file('repo/truncated', 'deep')),
    sink
  );
  assert.deepEqual([...sink.kept], [[longPath, 'deep']]);
});

test('a pax global header is consumed and changes nothing', () => {
  const sink = new RecordingSink();
  const global = [
    header('pax_global_header', 18, { typeflag: 'g' }),
    data('18 comment=abc123\n'),
  ];
  read(archive(global, file('repo/a.txt', 'after')), sink);
  assert.deepEqual([...sink.kept], [['repo/a.txt', 'after']]);
});

test('the ustar prefix field joins the path', () => {
  const sink = new RecordingSink();
  read(archive(file('file.ts', 'split', { prefix: 'repo/deep/dir' })), sink);
  assert.deepEqual([...sink.kept], [['repo/deep/dir/file.ts', 'split']]);
});

test('a truncated archive throws from end', () => {
  const bytes = archive(file('repo/a.txt', 'z'.repeat(600)));
  const sink = new RecordingSink();
  const reader = new TarReader(sink);
  reader.push(bytes.subarray(0, BLOCK + 100));
  assert.throws(() => reader.end(), /middle of an entry/);
});

test('an end without the two zero blocks is accepted', () => {
  const parts = file('repo/a.txt', 'ok');
  const bytes = new Uint8Array(parts[0].length + parts[1].length);
  bytes.set(parts[0], 0);
  bytes.set(parts[1], parts[0].length);
  const sink = new RecordingSink();
  read(bytes, sink);
  assert.equal(sink.kept.get('repo/a.txt'), 'ok');
});

test('bytes that are not a tar throw', () => {
  const sink = new RecordingSink();
  const reader = new TarReader(sink);
  assert.throws(
    () => reader.push(encoder.encode('a'.repeat(BLOCK))),
    /not a tar/
  );
});
