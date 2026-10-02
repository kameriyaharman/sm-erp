import { Badge, type BadgeTone } from '@/components/ui';
import { titleCase } from '@/lib/format';
import type { ExamStatus } from '../types';

const TONE: Record<ExamStatus, BadgeTone> = { draft: 'gray', scheduled: 'indigo', ongoing: 'amber', completed: 'green', results_published: 'green' };

export function ExamStatusBadge({ status }: { status: ExamStatus }) {
  return <Badge tone={TONE[status]}>{status === 'results_published' ? 'Results out' : titleCase(status)}</Badge>;
}
