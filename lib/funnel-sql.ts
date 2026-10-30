/** The cumulative list funnel over person_funnel.stage (086), shared by /api/icp/overview and /api/icp/[id]/panel. Server only. */
// Cumulative funnel steps over person_funnel.stage (086): everyone who got AT LEAST that far.
export const READY = `('prospect_ready','prospect_connected','lead_contacted','lead_engaged','lead_meeting','lead_qualified','opportunity','client')`;
export const CONNECTED = `('prospect_connected','lead_contacted','lead_engaged','lead_meeting','lead_qualified','opportunity','client')`;
export const CONTACTED = `('lead_contacted','lead_engaged','lead_meeting','lead_qualified','opportunity','client')`;
export const ANSWERED = `('lead_engaged','lead_meeting','lead_qualified','opportunity','client')`;
export const MEETING = `('lead_meeting','lead_qualified','opportunity','client')`;
export const OPPORTUNITY = `('opportunity','client')`;
export const FUNNEL_COUNTS = `count(*)::int AS found,
       count(*) FILTER (WHERE stage IN ${READY})::int AS ready,
       count(*) FILTER (WHERE stage IN ${CONNECTED})::int AS connected,
       count(*) FILTER (WHERE stage IN ${CONTACTED})::int AS contacted,
       count(*) FILTER (WHERE stage IN ${ANSWERED})::int AS answered,
       count(*) FILTER (WHERE stage IN ${MEETING})::int AS meeting,
       count(*) FILTER (WHERE stage IN ${OPPORTUNITY})::int AS opportunity,
       count(*) FILTER (WHERE exit = 'unfit')::int AS unfit,
       COALESCE(mode() WITHIN GROUP (ORDER BY lane) FILTER (WHERE stage IN ${CONTACTED}),
                mode() WITHIN GROUP (ORDER BY lane)) AS lane`;
