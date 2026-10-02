'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { FileDown, Pencil, RefreshCw, Send } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Notice, Page, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiSend, openPdf } from '@/lib/session';
import { formatDateTime, titleCase } from '@/lib/format';
import { ConfirmModal, FilterBar, ReportCardBadge, SectionSelect, errorText, fieldErrors, useClasses, useFlash } from './shared';
import type { GenerateSummary, ReportCardResult, SectionReportCard, Term, Wrapped } from './types';

const FINAL = 'final';
const RESULTS: ReportCardResult[] = ['pass', 'fail', 'promoted', 'detained', 'withheld'];

export default function ReportCardsPage() {
  const { sections, loading: secLoading } = useClasses();
  const terms = useApi<Wrapped<Term[]>>('/school/terms');
  const flash = useFlash(12000);
  const [sectionId, setSectionId] = useState('');
  const [termKey, setTermKey] = useState('');
  const [busy, setBusy] = useState<null | 'generate' | 'publish'>(null);
  const [summary, setSummary] = useState<GenerateSummary | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SectionReportCard | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!sectionId && sections.length) setSectionId(sections[0].id);
  }, [sections, sectionId]);
  useEffect(() => {
    // Default to the term we are in (or the last one that started).
    const list = terms.data?.data;
    if (termKey || !list?.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const current = list.filter((t) => t.startDate <= today).at(-1) ?? list[0];
    setTermKey(current.id);
  }, [terms.data, termKey]);

  const termId = termKey && termKey !== FINAL ? termKey : undefined;
  const ready = Boolean(sectionId && termKey);
  const cards = useApi<Wrapped<SectionReportCard[]>>(ready ? `/documents/sections/${sectionId}/report-cards${qs({ termId })}` : null);
  const list = cards.data?.data ?? [];
  const section = sections.find((s) => s.id === sectionId);
  const termLabel = termKey === FINAL ? 'Annual report card' : terms.data?.data.find((t) => t.id === termKey)?.name ?? '';
  const generatedCount = list.filter((c) => c.status === 'generated').length;
  const publishedCount = list.filter((c) => c.status === 'published').length;

  async function generate() {
    setBusy('generate');
    setSummary(null);
    try {
      const res = await apiSend<Wrapped<GenerateSummary>>('POST', '/documents/report-cards/generate', { sectionId, termId });
      setSummary(res.data);
      cards.reload();
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setBusy(null);
    }
  }
  async function publish() {
    setBusy('publish');
    setPublishError(null);
    try {
      const res = await apiSend<Wrapped<{ published: number }>>('POST', '/documents/report-cards/publish', { sectionId, termId });
      setConfirmPublish(false);
      flash.show('success', `Published ${res.data.published} report card${res.data.published === 1 ? '' : 's'}. Parents can now see them in the app.`);
      setSummary(null);
      cards.reload();
    } catch (err) {
      setPublishError(errorText(err));
    } finally {
      setBusy(null);
    }
  }
  async function pdf(c: SectionReportCard) {
    setPdfBusy(c.id);
    try {
      await openPdf(`/documents/report-cards/${c.id}/pdf`, `${c.name}-${termLabel}.pdf`);
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setPdfBusy(null);
    }
  }

  return (
    <Page wide>
      <PageHeader
        title="Report cards"
        description="Generate from entered marks, review, then publish to parents"
        actions={
          ready && (
            <>
              <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" aria-hidden />} loading={busy === 'generate'} disabled={!!busy} onClick={generate}>
                {list.length ? 'Regenerate' : 'Generate'}
              </Button>
              <Button
                icon={<Send className="h-4 w-4" aria-hidden />}
                disabled={!!busy || generatedCount === 0}
                onClick={() => {
                  setPublishError(null);
                  setConfirmPublish(true);
                }}
              >
                Publish{generatedCount ? ` (${generatedCount})` : ''}
              </Button>
            </>
          )
        }
      />
      {flash.node}
      {summary && (
        <div className="mb-4">
          <Notice tone={summary.incomplete ? 'warn' : 'success'}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  Generated {summary.generated} report card{summary.generated === 1 ? '' : 's'} ({summary.term ?? 'annual'}, {summary.academicYear}).
                  {summary.skippedPublished > 0 && ` ${summary.skippedPublished} already published were left unchanged.`}
                </p>
                {summary.incomplete > 0 && (
                  <>
                    <p className="mt-1">{summary.incomplete} student(s) have missing marks. Their percentage only counts what is entered:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {summary.students
                        .filter((s) => !s.complete)
                        .slice(0, 8)
                        .map((s) => (
                          <li key={s.studentId}>
                            {s.name}: {s.missing?.join(', ') ?? 'some subjects'}
                          </li>
                        ))}
                      {summary.incomplete > 8 && <li>and {summary.incomplete - 8} more</li>}
                    </ul>
                  </>
                )}
              </div>
              <button type="button" className="shrink-0 text-xs font-medium hover:underline" onClick={() => setSummary(null)}>
                Dismiss
              </button>
            </div>
          </Notice>
        </div>
      )}
      <Card padded={false}>
        <FilterBar>
          <SectionSelect sections={sections} value={sectionId} onChange={setSectionId} placeholder={secLoading ? 'Loading…' : 'Choose a section'} />
          <Select label="Report" value={termKey} onChange={(e) => setTermKey(e.target.value)}>
            {!termKey && <option value="">Choose…</option>}
            {terms.data?.data.map((t) => (
              <option key={t.id} value={t.id}>
                Progress report · {t.name}
              </option>
            ))}
            <option value={FINAL}>Annual / final report card</option>
          </Select>
          {list.length > 0 && (
            <div className="flex items-center gap-2 pb-2 text-sm text-slate-500 dark:text-slate-400">
              <Badge tone="green">{publishedCount} published</Badge>
              <Badge tone="indigo">{generatedCount} to publish</Badge>
            </div>
          )}
        </FilterBar>
        {!ready ? (
          <EmptyState title="Choose a section and report" />
        ) : cards.loading && !cards.data ? (
          <Spinner label="Loading report cards…" />
        ) : cards.error ? (
          <ErrorState message={cards.error} onRetry={cards.reload} />
        ) : list.length === 0 ? (
          <EmptyState
            title={`No ${termLabel.toLowerCase() || 'report cards'} for ${section?.label ?? 'this section'} yet`}
            description="Generate them from the marks entered so far. You can regenerate any time before publishing."
            action={
              <Button loading={busy === 'generate'} onClick={generate}>
                Generate report cards
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th align="right">Roll</Th>
                <Th>Student</Th>
                <Th align="right">%</Th>
                <Th>Grade</Th>
                <Th align="right">Rank</Th>
                <Th>Result</Th>
                <Th>Status</Th>
                <Th>Remarks</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <Td align="right">{c.rollNumber ?? '-'}</Td>
                  <Td className="whitespace-nowrap font-medium">{c.name}</Td>
                  <Td align="right">{c.percentage === null ? '-' : Number(c.percentage).toFixed(1)}</Td>
                  <Td>{c.grade ? <Badge tone="indigo">{c.grade}</Badge> : '-'}</Td>
                  <Td align="right">{c.rankInSection ?? '-'}</Td>
                  <Td>{c.result ? <Badge tone={c.result === 'pass' || c.result === 'promoted' ? 'green' : c.result === 'pending' ? 'gray' : 'red'}>{titleCase(c.result)}</Badge> : '-'}</Td>
                  <Td>
                    <ReportCardBadge status={c.status} />
                    {c.publishedAt && <span className="mt-0.5 block whitespace-nowrap text-xs text-slate-500">{formatDateTime(c.publishedAt)}</span>}
                  </Td>
                  <Td className="max-w-[16rem]">
                    <span className="line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{c.teacherRemarks ?? <span className="text-slate-400">-</span>}</span>
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={() => setEditing(c)} disabled={c.status === 'published' || c.status === 'revoked'} title={c.status === 'published' ? 'Published cards cannot be edited' : undefined} aria-label={`Edit remarks for ${c.name}`}>
                        Edit
                      </Button>
                      <Button size="sm" variant="secondary" icon={<FileDown className="h-3.5 w-3.5" aria-hidden />} loading={pdfBusy === c.id} onClick={() => pdf(c)}>
                        PDF
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ConfirmModal open={confirmPublish} title="Publish report cards?" tone="primary" confirmLabel={`Publish ${generatedCount}`} busy={busy === 'publish'} error={publishError} onConfirm={publish} onClose={() => setConfirmPublish(false)}>
        <p>
          {generatedCount} {termLabel.toLowerCase()} card{generatedCount === 1 ? '' : 's'} for <strong>{section?.label}</strong> will be published. Parents see them in the app immediately, and each card gets a QR verification code.
        </p>
        <p>Published cards can no longer be edited or regenerated.</p>
      </ConfirmModal>
      <EditCardModal
        card={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          flash.show('success', 'Report card updated.');
          cards.reload();
        }}
      />
    </Page>
  );
}

function EditCardModal({ card, onClose, onSaved }: { card: SectionReportCard | null; onClose: () => void; onSaved: () => void }) {
  const [remarks, setRemarks] = useState('');
  const [principal, setPrincipal] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (card) {
      setRemarks(card.teacherRemarks ?? '');
      setPrincipal('');
      setResult(card.result && card.result !== 'pending' ? card.result : '');
      setError(null);
      setErrors({});
    }
  }, [card]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!card) return;
    const body: Record<string, string | null> = {};
    if (remarks.trim() !== (card.teacherRemarks ?? '')) body.teacherRemarks = remarks.trim() || null;
    if (principal.trim()) body.principalRemarks = principal.trim();
    if (result && result !== card.result) body.result = result;
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend('PATCH', `/documents/report-cards/${card.id}`, body);
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!card}
      onClose={busy ? () => undefined : onClose}
      title={`Remarks · ${card?.name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="rc-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="rc-form" onSubmit={submit} className="space-y-4">
        <Notice tone="info">Remarks and result are printed on the card. Regenerating keeps them.</Notice>
        <Textarea label="Class teacher's remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={600} rows={3} error={errors.teacherRemarks} placeholder="e.g. Sincere and attentive. Should read more." />
        <Textarea label="Principal's remarks" value={principal} onChange={(e) => setPrincipal(e.target.value)} maxLength={600} rows={2} error={errors.principalRemarks} hint="Optional. Leave blank to keep the current remarks." />
        <Select label="Result" value={result} onChange={(e) => setResult(e.target.value)} error={errors.result}>
          <option value="">{card?.result === 'pending' ? 'Pending (worked out on the final card)' : 'Keep as is'}</option>
          {RESULTS.map((r) => (
            <option key={r} value={r}>
              {titleCase(r)}
            </option>
          ))}
        </Select>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}
