import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FILE_BYTES, checkUpload, contentDisposition, contentMatches, extensionOf, sanitizeFileName,
} from '../src/modules/homework/file-type.js';

const bytes = (...b) => Buffer.from(b);
const PDF = Buffer.from('%PDF-1.7\n%\xe2\xe3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'latin1');
const PNG = Buffer.concat([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), Buffer.alloc(20)]);
const JPEG = Buffer.concat([bytes(0xff, 0xd8, 0xff, 0xe0), Buffer.alloc(20)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), bytes(1, 0, 0, 0), Buffer.from('WEBPVP8 '), Buffer.alloc(10)]);
const OLE = Buffer.concat([bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), Buffer.alloc(40)]);
const zipWith = (entry) => Buffer.concat([bytes(0x50, 0x4b, 0x03, 0x04), Buffer.alloc(26), Buffer.from(`[Content_Types].xml${entry}document.xml`)]);
const EXE = Buffer.concat([Buffer.from('MZ'), bytes(0x90, 0, 3, 0, 0, 0, 4, 0), Buffer.alloc(50)]);

const file = (originalname, mimetype, buffer) => ({ originalname, mimetype, buffer, size: buffer.length });

test('magic bytes per type', () => {
  assert.equal(contentMatches('pdf', PDF), true);
  assert.equal(contentMatches('png', PNG), true);
  assert.equal(contentMatches('jpg', JPEG), true);
  assert.equal(contentMatches('jpeg', JPEG), true);
  assert.equal(contentMatches('webp', WEBP), true);
  assert.equal(contentMatches('doc', OLE), true);
  assert.equal(contentMatches('xls', OLE), true);
  assert.equal(contentMatches('docx', zipWith('word/')), true);
  assert.equal(contentMatches('xlsx', zipWith('xl/')), true);
  assert.equal(contentMatches('pptx', zipWith('ppt/')), true);
  assert.equal(contentMatches('txt', Buffer.from('Read chapter 6 — पाठ 5\n')), true);

  assert.equal(contentMatches('pdf', EXE), false);
  assert.equal(contentMatches('png', JPEG), false);
  assert.equal(contentMatches('docx', zipWith('xl/')), false, 'a spreadsheet renamed .docx');
  assert.equal(contentMatches('docx', OLE), false);
  assert.equal(contentMatches('txt', EXE), false, 'binary is not text');
  assert.equal(contentMatches('txt', PDF), false);
  assert.equal(contentMatches('txt', bytes(0xc3, 0x28)), false, 'invalid UTF-8');
  assert.equal(contentMatches('pdf', Buffer.alloc(0)), false);
  assert.equal(contentMatches('exe', EXE), false);
});

test('checkUpload: extension, declared type and content must agree', () => {
  assert.deepEqual(checkUpload(file('Worksheet.pdf', 'application/pdf', PDF)), { ok: true, ext: 'pdf', mime: 'application/pdf', fileName: 'Worksheet.pdf' });
  assert.equal(checkUpload(file('photo.JPG', 'image/jpeg', JPEG)).mime, 'image/jpeg');
  assert.equal(checkUpload(file('notes.docx', 'application/octet-stream', zipWith('word/'))).ok, true, 'octet-stream accepted for Office when the bytes match');
  assert.equal(checkUpload(file('notes.txt', 'text/plain; charset=utf-8', Buffer.from('hello'))).mime, 'text/plain; charset=utf-8');

  const rejected = (f) => checkUpload(f).code;
  assert.equal(rejected(file('virus.exe', 'application/x-msdownload', EXE)), 'FILE_TYPE_NOT_ALLOWED');
  assert.equal(rejected(file('virus.pdf', 'application/pdf', EXE)), 'FILE_TYPE_NOT_ALLOWED', 'exe renamed .pdf');
  assert.equal(rejected(file('photo.png', 'application/pdf', PNG)), 'FILE_TYPE_NOT_ALLOWED', 'declared type does not match');
  assert.equal(rejected(file('page.html', 'text/html', Buffer.from('<script>'))), 'FILE_TYPE_NOT_ALLOWED');
  assert.equal(rejected(file('image.svg', 'image/svg+xml', Buffer.from('<svg/>'))), 'FILE_TYPE_NOT_ALLOWED');
  assert.equal(rejected(file('noext', 'application/pdf', PDF)), 'FILE_TYPE_NOT_ALLOWED');
  assert.equal(rejected(file('a.pdf', 'application/pdf', Buffer.alloc(0))), 'FILE_EMPTY');
  const big = Buffer.concat([PDF, Buffer.alloc(MAX_FILE_BYTES)]);
  assert.equal(rejected(file('big.pdf', 'application/pdf', big)), 'FILE_TOO_LARGE');
});

test('sanitizeFileName', () => {
  assert.equal(sanitizeFileName('../../etc/passwd.pdf'), 'passwd.pdf');
  assert.equal(sanitizeFileName('C:\\Users\\me\\Desktop\\HW 1.pdf'), 'HW 1.pdf');
  assert.equal(sanitizeFileName('a\u0000b\u001fc.pdf'), 'abc.pdf');
  assert.equal(sanitizeFileName('what?<is>"this"|*.pdf'), 'what__is__this___.pdf');
  assert.equal(sanitizeFileName('  ...hidden.pdf  '), 'hidden.pdf');
  assert.equal(sanitizeFileName('evil\u202Efdp.exe'), 'evil_fdp.exe');
  assert.equal(sanitizeFileName('गृहकार्य   पाठ 5.pdf'), 'गृहकार्य पाठ 5.pdf');
  assert.equal(sanitizeFileName(''), 'file');
  assert.equal(sanitizeFileName('', 'pdf'), 'file.pdf');
  const long = sanitizeFileName(`${'x'.repeat(300)}.docx`);
  assert.equal(long.length, 150);
  assert.ok(long.endsWith('.docx'));
});

test('extensionOf', () => {
  assert.equal(extensionOf('Report.Final.PDF'), 'pdf');
  assert.equal(extensionOf('noext'), '');
  assert.equal(extensionOf('trailing.'), '');
});

test('contentDisposition: ASCII fallback + UTF-8 name', () => {
  assert.equal(contentDisposition('HW 1.pdf'), `attachment; filename="HW 1.pdf"; filename*=UTF-8''HW%201.pdf`);
  const hindi = contentDisposition('पाठ.pdf');
  assert.match(hindi, /^attachment; filename="___\.pdf"; filename\*=UTF-8''%E0%A4%AA%E0%A4%BE%E0%A4%A0\.pdf$/);
  assert.match(contentDisposition("it's (1).pdf"), /filename\*=UTF-8''it%27s%20%281%29\.pdf$/);
  assert.doesNotMatch(contentDisposition('a"b\\c.pdf'), /filename="[^"]*"[^;]*"/);
});
