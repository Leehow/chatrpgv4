declare module 'yauzl' {
  import {EventEmitter} from 'node:events';
  import type {Readable} from 'node:stream';
  export interface Entry {
    fileNameRaw: Buffer; generalPurposeBitFlag: number; externalFileAttributes: number;
    uncompressedSize: number; compressedSize: number; compressionMethod: number; crc32: number;
    relativeOffsetOfLocalHeader: number; versionNeededToExtract: number;
  }
  export interface LocalFileHeader {fileName: Buffer; generalPurposeBitFlag: number; fileDataStart: number}
  export interface ZipFile extends EventEmitter {
    isOpen: boolean; readEntryCursor: number; readEntry(): void; close(): void;
    openReadStreamPromise(entry: Entry, options: {decodeFileData: boolean}): Promise<Readable>;
    readLocalFileHeaderPromise(entry: Entry, options: {minimal: false}): Promise<LocalFileHeader>;
  }
  export function fromFdPromise(fd: number, options: {lazyEntries: boolean; decodeStrings: boolean; autoClose: boolean; validateEntrySizes: boolean; strictFileNames: boolean}): Promise<ZipFile>;
  export function getFileNameLowLevel(flags: number, name: Buffer, extraFields: unknown[], strict: boolean): string;
}
declare module 'seek-bzip' {
  const decoder: {decode(input: {readByte(): number; eof(): boolean}, output: {writeByte(value: number): void}, multistream?: boolean): unknown};
  export default decoder;
}
declare module 'lzma-purejs' {
  const decoder: {decompress(properties: Uint8Array, input: {readByte(): number}, output: {writeByte(value: number): void}, outSize: number): boolean};
  export default decoder;
}
