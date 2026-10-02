import { redirect } from 'next/navigation';

/** /teacher has no screen of its own: start on attendance, the teacher's daily task. */
export default function TeacherIndex() {
  redirect('/teacher/attendance');
}
