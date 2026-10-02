/**
 * Homework attachment checks (pure, no I/O). Unit-tested in test/homework-files.test.js.
 *
 * A file is accepted only when its extension, the declared MIME type and the content
 * (magic bytes, where cheap) all agree. The stored MIME type is the canonical one for the
 * extension, never the client's.
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_HOMEWORK = 5;

const PDF = 'application/pdf';
const OOXML_DOC = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OOXML_XLS = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const OOXML_PPT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * ext -> { mime: canonical, accept: declared MIME types accepted, kind: content check }
 * Office formats also accept application/octet-stream (some Windows/Android browsers send
 * that for .docx etc.); the magic bytes still have to match.
 */
export const FILE_TYPES = Object.freeze({
  pdf: { mime: PDF, accept: [PDF, 'application/x-pdf'], kind: 'pdf' },
  jpg: { mime: 'image/jpeg', accept: ['image/jpeg', 'image/jpg', 'image/pjpeg'], kind: 'jpeg' },
  jpeg: { mime: 'image/jpeg', accept: ['image/jpeg', 'image/jpg', 'image/pjpeg'], kind: 'jpeg' },
  png: { mime: 'image/png', accept: ['image/png', 'image/x-png'], kind: 'png' },
  webp: { mime: 'image/webp', accept: ['image/webp'], kind: 'webp' },
  doc: { mime: 'application/msword', accept: ['application/msword', 'application/octet-stream'], kind: 'ole' },
  xls: { mime: 'application/vnd.ms-excel', accept: ['application/vnd.ms-excel', 'application/msexcel', 'application/octet-stream'], kind: 'ole' },
  ppt: { mime: 'application/vnd.ms-powerpoint', accept: ['application/vnd.ms-powerpoint', 'application/mspowerpoint', 'application/octet-stream'], kind: 'ole' },
  docx: { mime: OOXML_DOC, accept: [OOXML_DOC, 'application/zip', 'application/octet-stream'], kind: 'ooxml', part: 'word/' },
  xlsx: { mime: OOXML_XLS, accept: [OOXML_XLS, 'application/zip', 'application/octet-stream'], kind: 'ooxml', part: 'xl/' },
  pptx: { mime: OOXML_PPT, accept: [OOXML_PPT, 'application/zip', 'application/octet-stream'], kind: 'ooxml', part: 'ppt/' },
  txt: { mime: 'text/plain; charset=utf-8', accept: ['text/plain'], kind: 'text' },
});

export const ALLOWED_EXTENSIONS = Object.freeze(Object.keys(FILE_TYPES));

const startsWith = (buf, bytes, offset = 0) => buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

const MAGIC = {
  pdf: (b) => startsWith(b, ascii('%PDF-')),
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  webp: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  ole: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  zip: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
};

/** Plain text: valid UTF-8 (BOM allowed), no NUL bytes, not one of the binary formats above. */
function looksLikeText(buf) {
  if (buf.length === 0) return false;
  if (Object.values(MAGIC).some((test) => test(buf))) return false;
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** The content matches the extension's format. */
export function contentMatches(ext, buf) {
  const type = FILE_TYPES[ext];
  if (!type || !Buffer.isBuffer(buf) || buf.length === 0) return false;
  switch (type.kind) {
    case 'ooxml':
      // A zip whose entries include the format's folder (word/, xl/ or ppt/).
      return MAGIC.zip(buf) && buf.includes(type.part, 0, 'latin1');
    case 'text':
      return looksLikeText(buf);
    default:
      return MAGIC[type.kind](buf);
  }
}

/** Lower-case extension of a file name ('' if none). */
export function extensionOf(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name ?? '').trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * Safe display / download name: no path, no control or reserved characters, no leading
 * dots, at most 150 characters with the extension kept. Unicode letters are kept (NFC).
 */
export function sanitizeFileName(name, fallbackExt = '') {
  let base = String(name ?? '').normalize('NFC');
  base = base.split(/[/\\]/).pop();                                  // drop any path
  base = base.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');          // control characters
  base = base.replace(/[<>:"|?*\u202a-\u202e\u2066-\u2069]/g, '_');  // reserved + bidi overrides
  base = base.replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');

  if (!base) base = `file${fallbackExt ? `.${fallbackExt}` : ''}`;
  const ext = extensionOf(base);
  const MAX = 150;
  if (base.length > MAX) {
    const suffix = ext ? `.${ext}` : '';
    base = base.slice(0, MAX - suffix.length).replace(/[.\s]+$/, '') + suffix;
  }
  return base;
}

/**
 * Checks one upload. Returns { ok: true, ext, mime, fileName } or
 * { ok: false, code: 'FILE_TYPE_NOT_ALLOWED' | 'FILE_TOO_LARGE' | 'FILE_EMPTY', message }.
 *
 * @param {{ originalname: string, mimetype: string, buffer: Buffer, size?: number }} file
 */
export function checkUpload(file) {
  const size = file?.size ?? file?.buffer?.length ?? 0;
  if (!file?.buffer || size === 0) return { ok: false, code: 'FILE_EMPTY', message: 'The file is empty' };
  if (size > MAX_FILE_BYTES) return { ok: false, code: 'FILE_TOO_LARGE', message: 'Files can be at most 5 MB' };

  const fileName = sanitizeFileName(file.originalname);
  const ext = extensionOf(fileName);
  const type = FILE_TYPES[ext];
  const notAllowed = (why) => ({
    ok: false,
    code: 'FILE_TYPE_NOT_ALLOWED',
    message: `${why}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
  });
  if (!type) return notAllowed(ext ? `.${ext} files are not allowed` : 'The file has no extension');

  const declared = String(file.mimetype ?? '').split(';')[0].trim().toLowerCase();
  if (!type.accept.includes(declared)) return notAllowed(`The file type (${declared || 'unknown'}) does not match .${ext}`);
  if (!contentMatches(ext, file.buffer)) return notAllowed(`The file content is not a valid .${ext} file`);

  return { ok: true, ext, mime: type.mime, fileName };
}

/** Content-Disposition for a download: ASCII fallback + RFC 5987 UTF-8 name. */
export function contentDisposition(fileName) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
