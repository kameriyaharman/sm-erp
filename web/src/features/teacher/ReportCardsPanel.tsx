'use client';

import { useEffect, useState } from 'react';
import { Award, FileText, PencilLine, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Notice, Select, Spinner, Table, Td, Textarea, Th, type BadgeTone } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { ApiError, apiSend, openPdf } from '@/lib/session';
import type { ReportCardStatus, SectionChoice, SectionReportCard, Term } from './types';

const STATUS: Record<ReportCardStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  generated: { label: 'Generated', tone: 'indigo' },
  published: { label: 'Published', tone: 'green' },
  revoked: { label: 'Revoked', tone: 'red' },
};

const FINAL = 'final';

/** Report cards of the teacher's own class: view PDFs and write class-teacher remarks before publishing. */
export default function ReportCardsPanel({ sections }: { sections: SectionChoice[] }) {
  const terms = useApi<{ data: Term[] }>('/school/terms');
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [termId, setTermId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SectionReportCard | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genNote, setGenNote] = useState<{ tone: 'success' | 'warn' | 'error'; text: string } | null>(null);

  // Default to the most recent term that has ended (its report cards are the ones being prepared), else the first.
  useEffect(() => {
    if (termId !== null || !terms.data) return;
    const today = new Date().toISOString().slice(0, 10);
    const ended = terms.data.data.filter((t) => t.endDate < today);
    const pick = ended[ended.length - 1] ?? terms.data.data[0];
    setTermId(pick?.id ?? FINAL);
  }, [terms.data, termId]);

  const path = sectionId && termId !== null ? `/documents/sections/${sectionId}/report-cards${qs({ termId: termId === FINAL ? undefined : termId })}` : null;
  const cards = useApi<{ data: SectionReportCard[] }>(path);

  if (sections.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Award className="h-7 w-7" aria-hidden />} title="You are not a class teacher this year" description="Report cards are managed by each class's class teacher and the school office." />
      </Card>
    );
  }

  const termName = termId === FINAL ? 'the final (annual) report' : terms.data?.data.find((t) => t.id === termId)?.name ?? 'this term';
  const list = cards.data?.data ?? [];
  const published = list.filter((c) => c.status === 'published').length;

  async function generate() {
    setGenerating(true);
    setGenNote(null);
    try {
      const res = await apiSend<{ data: { generated: number; skippedPublished: number; incomplete: number } }>('POST', '/documents/report-cards/generate', {
        sectionId,
        ...(termId && termId !== FINAL && { termId }),
      });
      const { generated, skippedPublished, incomplete } = res.data;
      const parts = [`${generated} report card${generated === 1 ? '' : 's'} generated`];
      if (skippedPublished) parts.push(`${skippedPublished} already published left as they are`);
      setGenNote({
        tone: incomplete ? 'warn' : 'success',
        text: `${parts.join(', ')}.${incomplete ? ` ${incomplete} still have marks missing for some exams; they will update when you generate again after marks are entered.` : ''}`,
      });
      cards.reload();
    } catch (e) {
      setGenNote({ tone: 'error', text: (e as ApiError).message });
    } finally {
      setGenerating(false);
    }
  }

  async function view(card: SectionReportCard) {
    setPdfError(null);
    setOpening(card.id);
    try {
      await openPdf(`/documents/report-cards/${card.id}/pdf`, `report-card-${card.name.replace(/\s+/g, '-')}.pdf`);
    } catch (e) {
      setPdfError((e as Error).message);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {sections.length > 1 ? (
          <Select aria-label="Class" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="!w-40">
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone="indigo">{sections[0].label}</Badge>
        )}
        <Select aria-label="Term" value={termId ?? ''} onChange={(e) => setTermId(e.target.value)} className="!w-48" disabled={!terms.data}>
          {terms.data?.data.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value={FINAL}>Final (annual)</option>
        </Select>
        {list.length > 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {list.length} cards, {published} published
          </p>
        )}
        {cards.data && (list.length === 0 || published < list.length) && (
          <Button variant="secondary" size="sm" className="ml-auto" icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} onClick={generate} loading={generating}>
            {list.length ? 'Regenerate from latest marks' : 'Generate report cards'}
          </Button>
        )}
      </div>
      {genNote && <Notice tone={genNote.tone}>{genNote.text}</Notice>}

      {pdfError && <Notice tone="error">{pdfError}</Notice>}
      {list.length > 0 && published === list.length && (
        <Notice tone="info">These report cards are published to parents, so remarks can no longer be changed. Contact the school office if a correction is needed.</Notice>
      )}

      <Card padded={false}>
        {terms.error || cards.error ? (
          <ErrorState message={(terms.error ?? cards.error)!} onRetry={terms.error ? terms.reload : cards.reload} />
        ) : !cards.data ? (
          <Spinner label="Loading report cards…" />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Award className="h-7 w-7" aria-hidden />}
            title={`No report cards for ${termName} yet`}
            description="Generate them once marks for the term's exams are entered; the school office publishes them to parents."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-14">Roll</Th>
                <Th>Student</Th>
                <Th align="right">Score</Th>
                <Th align="center">Grade</Th>
                <Th align="center" className="hidden sm:table-cell">
                  Rank
                </Th>
                <Th className="hidden md:table-cell">Status</Th>
                <Th className="hidden lg:table-cell">Teacher&apos;s remarks</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const st = STATUS[c.status] ?? { label: c.status, tone: 'gray' as BadgeTone };
                const canEdit = c.status !== 'published' && c.status !== 'revoked';
                return (
                  <tr key={c.id}>
                    <Td className="tabular-nums text-slate-500">{c.rollNumber ?? '–'}</Td>
                    <Td className="font-medium">{c.name}</Td>
                    <Td align="right">{c.percentage !== null ? `${c.percentage.toFixed(1)}%` : '–'}</Td>
                    <Td align="center" className="font-semibold">
                      {c.grade ?? '–'}
                    </Td>
                    <Td align="center" className="hidden tabular-nums sm:table-cell">
                      {c.rankInSection ?? '–'}
                    </Td>
                    <Td className="hidden md:table-cell">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </Td>
                    <Td className="hidden max-w-xs lg:table-cell">
                      <span className="line-clamp-2 text-slate-600 dark:text-slate-300">{c.teacherRemarks || <span className="text-slate-400">–</span>}</span>
                    </Td>
                    <Td align="right">
                      <span className="inline-flex gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<FileText className="h-3.5 w-3.5" aria-hidden />}
                          onClick={() => view(c)}
                          loading={opening === c.id}
                          aria-label={`View report card PDF for ${c.name}`}
                        >
                          PDF
                        </Button>
                        {canEdit && (
                          <Button variant="ghost" size="sm" icon={<PencilLine className="h-3.5 w-3.5" aria-hidden />} onClick={() => setEditing(c)} aria-label={`Edit remarks for ${c.name}`}>
                            Remarks
                          </Button>
                        )}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && (
        <RemarksModal
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            cards.reload();
          }}
        />
      )}
    </div>
  );
}

function RemarksModal({ card, onClose, onSaved }: { card: SectionReportCard; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(card.teacherRemarks ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiSend('PATCH', `/documents/report-cards/${card.id}`, { teacherRemarks: text.trim() ? text.trim() : null });
      onSaved();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={`Remarks for ${card.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save remarks
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Notice tone="error">{error}</Notice>}
        <Textarea
          label="Class teacher's remarks"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={600}
          rows={5}
          hint={`${text.length}/600. Printed on the report card.`}
          placeholder="e.g. Aarav is attentive in class and should practise mental maths daily."
        />
      </div>
    </Modal>
  );
}
