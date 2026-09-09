/// <reference path="./zip-types.d.ts" />
/** ZIP metadata from yauzl, bounded native/pure-JS codecs, and Python-compatible names. */
import {openSync, closeSync, readSync} from 'node:fs';
import {extname} from 'node:path';
import {crc32, createInflateRaw, createZstdDecompress} from 'node:zlib';
import * as yauzl from 'yauzl';
import bzip from 'seek-bzip';
import lzma from 'lzma-purejs';
import {RpcError, pythonStringRepr} from '../errors.js';

const MAX_BYTES = 16 * 1024 * 1024, MAX_FILES = 128;
const invalid = (message: string): never => { throw new RpcError('invalid_params', message); };
function unsupported(message: string): never { const error = new Error(message); error.name = 'NotImplementedError'; throw error; }
function fileName(flags: number, bytes: Buffer): string {
  return flags & 0x800 ? new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes)
    : yauzl.getFileNameLowLevel(flags, bytes, [], true);
}
class CompressedInput {
  private position = 0;
  private chunk = Buffer.alloc(0);
  private cursor = 0;
  constructor(readonly fd: number, readonly start: number, readonly size: number) {}
  eof(): boolean { return this.position >= this.size; }
  read(buffer: Uint8Array, offset: number, length: number): number {
    let count = 0;
    while (count < length && !this.eof()) { buffer[offset + count] = this.readByte(); count++; }
    return count;
  }
  seek(position: number): void { this.position = position; this.chunk = Buffer.alloc(0); this.cursor = 0; }
  readByte(): number {
    if (this.eof()) return -1;
    if (this.cursor === this.chunk.length) {
      const buffer = Buffer.allocUnsafe(Math.min(65536, this.size - this.position));
      const count = readSync(this.fd, buffer, 0, buffer.length, this.start + this.position);
      if (!count) throw new Error('Unexpected end of compressed file data');
      this.chunk = buffer.subarray(0, count); this.cursor = 0;
    }
    this.position++; return this.chunk[this.cursor++];
  }
}
function decodedSink(size: number) {
  const bytes = Buffer.allocUnsafe(size); let position = 0;
  return {writeByte(value: number) { if (position >= size) throw new Error('Decoded ZIP entry exceeds its size'); bytes[position++] = value; },
    finish() { if (position !== size) throw new Error('Decoded ZIP entry has the wrong size'); return bytes; }};
}
async function entryData(zip: yauzl.ZipFile, fd: number, entry: yauzl.Entry, originalName: string, endOffset: number): Promise<Buffer> {
  const local = await zip.readLocalFileHeaderPromise(entry, {minimal: false});
  if (fileName(local.generalPurposeBitFlag, local.fileName) !== originalName) throw new Error('Local and central file names differ');
  if (local.fileDataStart + entry.compressedSize > endOffset) throw new Error('Overlapped ZIP entries');
  if (entry.generalPurposeBitFlag & 0x20) unsupported('compressed patched data (flag bit 5)');
  if (entry.generalPurposeBitFlag & 0x40) unsupported('strong encryption (flag bit 6)');
  if (entry.generalPurposeBitFlag & 1) { const error = new Error(`File ${pythonStringRepr(originalName)} is encrypted, password required for extraction`); error.name = 'RuntimeError'; throw error; }
  const size = entry.uncompressedSize, method = entry.compressionMethod;
  let result: Buffer;
  if (method === 12 || method === 14) {
    const input = new CompressedInput(fd, local.fileDataStart, entry.compressedSize), output = decodedSink(size);
    if (method === 12) bzip.decode(input, output, false);
    else {
      input.readByte(); input.readByte();
      const propertiesSize = input.readByte() | input.readByte() << 8;
      if (propertiesSize !== 5) throw new Error('Invalid ZIP LZMA properties');
      const properties = Buffer.from(Array.from({length: propertiesSize}, () => input.readByte()));
      // No valid back-reference can reach beyond the bounded output history.
      properties.writeUInt32LE(Math.min(properties.readUInt32LE(1), Math.max(size, 1)), 1);
      lzma.decompress(properties, input, output, size);
    }
    result = output.finish();
  } else if ([0, 8, 93].includes(method)) {
    const raw = await zip.openReadStreamPromise(entry, {decodeFileData: false});
    const transform = method === 8 ? createInflateRaw() : method === 93 ? createZstdDecompress() : null;
    const decoded = transform ?? raw;
    if (transform) { raw.on('error', error => transform.destroy(error)); raw.pipe(transform); }
    const chunks: Buffer[] = []; let length = 0;
    try {
      for await (const chunk of decoded) {
        length += chunk.length;
        if (length > size) throw new Error('Decoded ZIP entry exceeds its size');
        chunks.push(chunk);
      }
    } finally { raw.destroy(); if (decoded !== raw) decoded.destroy(); }
    if (length !== size) throw new Error('Decoded ZIP entry has the wrong size');
    result = Buffer.concat(chunks, length);
  } else {
    const names: Record<number, string> = {1: 'shrink', 2: 'reduce', 3: 'reduce', 4: 'reduce', 5: 'reduce', 6: 'implode', 7: 'tokenize', 9: 'deflate64', 10: 'implode', 18: 'terse', 19: 'lz77', 97: 'wavpack', 98: 'ppmd'};
    unsupported(`compression type ${method}${names[method] ? ` (${names[method]})` : ''}`);
  }
  if (crc32(result) !== entry.crc32) throw new Error('Bad CRC-32 for ZIP entry');
  return result;
}

export async function readZipPackage(path: string): Promise<Map<string, Buffer>> {
  let fd: number | undefined, zip: yauzl.ZipFile | undefined;
  const files = new Map<string, Buffer>();
  try {
    fd = openSync(path, 'r');
    zip = await yauzl.fromFdPromise(fd, {lazyEntries: true, decodeStrings: false, autoClose: false, validateEntrySizes: true, strictFileNames: true});
    const owner = zip;
    // Pinned yauzl initializes this cursor at the central directory before any readEntry.
    const directoryStart = owner.readEntryCursor, offsets: number[] = [];
    const entries = await new Promise<Array<{entry: yauzl.Entry; original: string; name: string}>>((resolve, reject) => {
      const result: Array<{entry: yauzl.Entry; original: string; name: string}> = [];
      owner.on('error', reject);
      owner.on('entry', (entry: yauzl.Entry) => {
        try {
          const extract = entry.versionNeededToExtract & 0xff;
          if (extract > 63) unsupported(`zip file version ${(extract / 10).toFixed(1)}`);
          const original = fileName(entry.generalPurposeBitFlag, entry.fileNameRaw), name = original.split('\0')[0];
          offsets.push(entry.relativeOffsetOfLocalHeader);
          if (!name.endsWith('/')) result.push({entry, original, name});
          if (result.length > MAX_FILES) invalid('Mod archive has too many files');
          owner.readEntry();
        } catch (error) { reject(error); }
      });
      owner.once('end', () => resolve(result)); owner.readEntry();
    });
    const orderedOffsets = [...new Set(offsets)].sort((a, b) => a - b);
    let size = 0;
    for (const {entry, original, name} of entries) {
      size += entry.uncompressedSize;
      if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\') || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
        || size > MAX_BYTES || !['.md', '.json'].includes(extname(name))) invalid('Unsafe or unsupported Mod archive entry');
      if (files.has(name)) invalid('Duplicate Mod archive entry');
      const end = orderedOffsets.find(offset => offset > entry.relativeOffsetOfLocalHeader) ?? directoryStart;
      files.set(name, await entryData(owner, fd, entry, original, end));
    }
  } catch (error) {
    if (error instanceof RpcError || error instanceof Error && ['NotImplementedError', 'RuntimeError'].includes(error.name)) throw error;
    invalid('Not a readable Mod directory or ZIP');
  } finally {
    if (zip?.isOpen) await new Promise<void>(resolve => { zip!.once('close', resolve); zip!.close(); });
    else if (fd !== undefined) { try { closeSync(fd); } catch { /* Failed open may already have closed its descriptor. */ } }
  }
  if (!files.has('mod.json')) {
    const manifests = [...files.keys()].filter(name => name.endsWith('/mod.json'));
    if (manifests.length !== 1) invalid('Archive must contain exactly one Mod root');
    const prefix = manifests[0].slice(0, -'mod.json'.length);
    if ([...files.keys()].some(name => !name.startsWith(prefix))) invalid('Archive contains files outside its Mod root');
    return new Map([...files].map(([name, bytes]) => [name.slice(prefix.length), bytes]));
  }
  return files;
}
