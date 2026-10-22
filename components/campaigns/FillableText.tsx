import { fillableParts } from '@/lib/campaigns';

/** A message with its fillable fields ({first_name}, {company}, …) shown as small highlighted chips. A field the
 *  campaign does not know is shown in red: nobody would get a value for it. */
export default function FillableText({ text }: { text: string }) {
  return (
    <>
      {fillableParts(text).map((p, i) => p.field ? (
        <span key={i} className="rounded px-1 font-medium whitespace-nowrap"
          style={{ background: p.known ? 'var(--accent-soft)' : 'color-mix(in srgb, var(--red) 14%, transparent)', color: p.known ? 'var(--accent)' : 'var(--red)' }}
          title={p.known ? 'Filled in for each person' : 'Unknown field: nobody gets a value for it'}>{p.text}</span>
      ) : <span key={i}>{p.text}</span>)}
    </>
  );
}
