import { redirect } from 'next/navigation';

// Merged into Deals on 2026-10-24: the board is the Pipeline view of /opportunities.
export default function PipelinePage() {
  redirect('/opportunities?view=pipeline');
}
