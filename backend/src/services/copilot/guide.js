/**
 * Short, factual descriptions of how STS works, served to the AI on demand (get_app_guide) so it can
 * explain features accurately instead of guessing. These describe the real implementation in this
 * repository; keep them in step with the code when behaviour changes.
 */
const GUIDES = {
  sos: {
    both: 'An SOS can start three ways: the wristband SOS button, the SOS button in the tourist app, or automatically (entering a danger zone, an unanswered safety check-in, or a critical risk score). It creates one SOS record and one critical incident at the tourist\'s location, flags the device as in emergency, and alerts admins live. A tourist can only have one active SOS at a time; pressing again does not create duplicates. Emergency contacts get an SMS only if SMS is configured on the server and the tourist is real (simulated tourists never send SMS). The SOS stays active until an admin resolves its incident; nothing closes it automatically.',
    tourist: 'For an emergency press SOS in the app or on the wristband and, if you can, also call the local emergency number (112 in India). STS is an assistance layer and does not replace calling emergency services.',
  },
  geofencing: {
    both: 'Admins draw zones on the map: safe, restricted or danger. Every location ping is checked against active zones. Entering a restricted zone records a violation and notifies admins (no SOS). Entering a danger zone also raises an automatic SOS. Leaving a zone is recorded as an exit. A stale location is never treated as proof that someone is inside a zone.',
    tourist: 'You get an alert on screen when you enter a restricted or danger zone. "Safe zones" in STS are only areas the administrators defined; hospitals and police stations are separate facilities.',
  },
  safety_checks: {
    both: 'The server periodically asks active tourists "are you safe?". Answering safe closes the check. Answering unsafe raises an incident. If nobody answers within the response window, the check escalates: for a live device it becomes an automatic SOS, otherwise a lower-severity "no response" incident. Stale or offline devices are not prompted so an old location cannot create a false SOS.',
  },
  risk_scoring: {
    both: 'Each tourist gets a rule-based score from 0 to 100 (levels low, medium, high, critical) from weighted factors: safety check-in history, zone risk and proximity, recent violations, open incidents, movement, and device connectivity/battery. Some rules force critical (for example standing in a danger zone). It is explainable, not a trained machine-learning model. High or critical risk opens a risk incident unless the tourist is already in an active incident, in which case the risk event is added to that incident\'s timeline.',
  },
  incidents: {
    admin: 'Incident lifecycle: New, Acknowledged, Assigned, En route, Resolved, Closed (a resolve is also allowed from any open state). Every step is validated on the server and recorded in the incident timeline; assignment and resolution are also written to the tamper-evident audit chain. High/urgent incidents that nobody acknowledges within 5 minutes (or that stay unresolved for 60 minutes) are escalated once; escalation never closes anything. Related events for the same tourist (missed check-in, risk escalation, zone entry) are attached to the existing active incident instead of creating duplicates, and a genuine new SOS is never absorbed. Responders see and act only on incidents assigned to them; handover summaries list assignment history in order.',
    tourist: 'When you trigger SOS an admin acknowledges it, assigns someone to help and marks them en route; you get a notification at each step. You can only see your own incidents.',
  },
  help_centers: {
    both: 'Help centers are hospitals, police stations and similar places that administrators registered inside STS. The Copilot can also find real facilities from OpenStreetMap that nobody registered; those results are labelled separately and may be incomplete or out of date.',
  },
  language_and_voice: {
    both: 'The app supports English, Hindi and Marathi through the language selector. The Copilot answers in the selected language by default and understands mixed-language questions. The microphone button uses the browser\'s built-in speech recognition (in Chrome and Edge the audio is processed by the browser vendor\'s service); the text appears in the box for you to edit before sending.',
  },
  privacy: {
    both: 'The Copilot only reads data your account is allowed to see through fixed, read-only lookups. It cannot change incidents, zones or assignments. Tourists can only ask about their own status. Your questions and the minimum needed data are sent to the AI provider to produce an answer.',
  },
};

const TOPICS = Object.keys(GUIDES);

function guideFor(topic, role) {
  const g = GUIDES[topic];
  if (!g) return 'No guide for that topic.';
  return [g.both, g[role]].filter(Boolean).join(' ');
}

module.exports = { guideFor, TOPICS };
