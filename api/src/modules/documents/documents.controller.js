import { env } from '../../config/env.js';
import { renderReportCard } from './pdf/report-card.pdf.js';
import { renderCertificate } from './pdf/certificate.pdf.js';
import * as service from './documents.service.js';
import { branchLogoBuffer } from '../setup/setup.repository.js';

/** The school logo uploaded in Settings, unless the document's frozen snapshot carries its own. */
async function withLogo(school, branchId) {
  if (!school || school.logo) return school;
  const logo = await branchLogoBuffer(branchId);
  return logo ? { ...school, logo } : school;
}

const verifyBaseUrl = () => env.DOCUMENT_VERIFY_BASE_URL ?? `http://localhost:${env.PORT}/api/v1/verify`;

function sendPdf(res, fileName, download) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${fileName.replace(/[^A-Za-z0-9._-]+/g, '-')}"`,
    'Cache-Control': 'private, no-store',
  });
}

// ---------------------------------------------------------------- report cards
export async function generateReportCards(req, res) {
  res.json({ data: await service.generateReportCards(req.auth, req.valid.body) });
}

export async function publishReportCards(req, res) {
  res.json({ data: await service.publishReportCards(req.auth, req.valid.body) });
}

export async function updateReportCard(req, res) {
  res.json({ data: await service.updateReportCard(req.auth, req.valid.params.id, req.valid.body) });
}

export async function reportCardPdf(req, res) {
  const rc = await service.getReportCardDocument(req.auth, req.valid.params.id);
  rc.school = await withLogo(rc.school, rc.branchId);
  sendPdf(res, `report-card-${rc.student.admissionNumber}-${rc.session}.pdf`, req.valid.query.download === '1');
  await renderReportCard(rc, res, { verifyBaseUrl: verifyBaseUrl() });
}

export async function listSectionReportCards(req, res) {
  res.json({ data: await service.listSectionReportCards(req.auth, req.valid.params.sectionId, req.valid.query) });
}

export async function listStudentReportCards(req, res) {
  res.json({ data: await service.listStudentReportCards(req.auth, req.valid.params.studentId) });
}

// ---------------------------------------------------------------- certificates
export async function issueTransferCertificate(req, res) {
  const cert = await service.issueTransferCertificate(req.auth, req.valid.params.studentId, req.valid.body);
  res.status(201).location(`${req.baseUrl}/certificates/${cert.id}/pdf`).json({ data: cert });
}

export async function issueBonafide(req, res) {
  const cert = await service.issueBonafide(req.auth, req.valid.params.studentId, req.valid.body);
  res.status(201).location(`${req.baseUrl}/certificates/${cert.id}/pdf`).json({ data: cert });
}

export async function listCertificates(req, res) {
  res.json({ data: await service.listCertificates(req.auth, req.valid.query) });
}

export async function certificatePdf(req, res) {
  const { cert, copyLabel } = await service.getCertificateDocument(req.auth, req.valid.params.id, { copy: req.valid.query.copy });
  cert.content = { ...cert.content, school: await withLogo(cert.content?.school, cert.branchId) };
  sendPdf(res, `${cert.number}.pdf`, req.valid.query.download === '1');
  res.set('X-Copy', copyLabel);
  await renderCertificate(cert, res, { verifyBaseUrl: verifyBaseUrl(), copyLabel });
}

export async function cancelCertificate(req, res) {
  res.json({ data: await service.cancelCertificate(req.auth, req.valid.params.id, req.valid.body) });
}

// ---------------------------------------------------------------- public
export async function verify(req, res) {
  res.set('Cache-Control', 'no-store').json({ data: await service.verifyDocument(req.valid.params.code) });
}
