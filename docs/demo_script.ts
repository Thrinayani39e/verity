/**
 * Single source of truth for the hackathon demo video script.
 *
 * Edit this file when the script changes, not the published runsheet
 * artifact or any chat copy of it - those are generated from this content
 * and will drift if updated separately.
 *
 * Target runtime: under 3:00 (hackathon submission requirement). Word
 * counts are a pacing guide, not a contract - practice once and adjust;
 * real speaking pace varies by person.
 */

export interface DemoScene {
  /** Timestamp this scene starts at, mm:ss. */
  time: string;
  durationSeconds: number;
  title: string;
  /** What to physically do on screen. */
  action: string;
  /** What to say out loud. */
  script: string;
}

export const HOST_INTRO: DemoScene = {
  time: "0:00",
  durationSeconds: 13,
  title: "Introduction",
  action: "Face camera or voiceover only, before switching to the browser.",
  script:
    "Hello, I'm Thrinayani, and this is what I built for the CockroachDB and AWS hackathon. My project is called Verity, and it's basically a claims agent that can prove what it knew, and when.",
};

export const SCENES: DemoScene[] = [
  {
    time: "0:13",
    durationSeconds: 12,
    title: "Cold open: the problem",
    action:
      "Full-screen browser, Overview dashboard already loaded, zoom to about 110 percent. Don't click yet.",
    script:
      "When you file a claim, someone has to remember your policy, your history, and every similar case the company's seen, then decide fairly and fast. That's hard for a person. It's harder for an AI that forgets the moment the conversation ends.",
  },
  {
    time: "0:25",
    durationSeconds: 17,
    title: "What Verity actually is",
    action:
      "Point at the four stat tiles: TOTAL CLAIMS, APPROVAL RATE, TOTAL PAID OUT, NEEDS HUMAN REVIEW. Stay on the dashboard, no click needed yet.",
    script:
      "Verity is an agent that reviews claims automatically. It reads the policy, checks history, and decides to approve, deny, or flag a claim for a person. Its memory lives in CockroachDB, not a chat log, built to prove months later exactly what it knew.",
  },
  {
    time: "0:42",
    durationSeconds: 10,
    title: "Why this needs to be real, not a mockup",
    action: "Click the Flagged filter pill. The queue narrows to a couple of rows.",
    script:
      "This is a real, live deployment on AWS. Real claims, decided by an agent talking to a live CockroachDB cluster. Insurance is regulated: you need to prove a decision, not claim one.",
  },
  {
    time: "0:52",
    durationSeconds: 26,
    title: "A claim thinks out loud",
    action:
      "In the flagged list, click Rosalind Achebe ($2,400, multi-vehicle collision). On her claim page, trace the Case timeline top to bottom: Submitted, Claimed, context_gathered, Decided. Point at the flagged status badge, then stop, don't reveal the review outcome yet.",
    script:
      "Watch Rosalind Achebe's claim. Before deciding anything, the agent looks up her policy, history, and similar cases, and saves that to the database first, before asking the model. It flagged her: the policy belongs to someone else, and she filed two other claims in the same window. A judgment call for a person.",
  },
  {
    time: "1:18",
    durationSeconds: 12,
    title: "Pattern recognition, at database scale",
    action:
      "Click Precedent Search. Type exactly: leak from a pipe upstairs ruined my kitchen ceiling. Pause about one second for results, then point at the top match (Marcus Whitfield's burst pipe claim), the DIST label, and the match percentage bar.",
    script:
      "An adjuster's edge is pattern recognition. Verity does the same with CockroachDB's vector search: every claim becomes a fingerprint, findable in different words. Watch it find the match.",
  },
  {
    time: "1:30",
    durationSeconds: 27,
    title: "A pattern no single claim reveals",
    action:
      "Click Fraud Rings. Point at the 4 claim ring: Harlan, Marcus, and Denise, connected by solid amber lines for a shared bank account. Point at Talia, connected only to Denise by a dashed blue line for a shared address; she shares nothing directly with Harlan or Marcus, but the graph still pulls her into the same ring. Sweep to the legend at the bottom.",
    script:
      "Here's a pattern no single claim can reveal. Three claims, three different names, look unremarkable filed one at a time. But two of them pay into the same bank account, and one of those people shares an address with a third. CockroachDB traces that chain across every claim ever filed and surfaces the whole ring, not just the obvious pair.",
  },
  {
    time: "1:57",
    durationSeconds: 28,
    title: "Proving what it knew, after the fact",
    action:
      "Navigate back to Rosalind Achebe's claim page. Click the Replay decision as of system time button. Let the modal load, then point at the split view: AS OF DECISION TIME shows flagged, CURRENT STATE NOW shows approved. Point at the banner: state has changed since this decision was made.",
    script:
      "Here's the part no other database does for free. A senior adjuster reviewed that flag and approved it. Ask what the system knew at that exact moment, before the human stepped in. Most systems can't answer honestly, because the data has changed. Watch: CockroachDB shows the database exactly as it looked then, next to now. Flagged then. Approved now.",
  },
  {
    time: "2:25",
    durationSeconds: 22,
    title: "One more guarantee, proven not claimed",
    action:
      "Cut to a pre-staged terminal: the 9 node cluster from ops/multiregion/ already running, setup already applied (database, table, four rows inserted), sitting at the BEFORE query output. Run demo shutdown 4, demo shutdown 5, demo shutdown 6, the three nodes hosting the primary region. Run the AFTER read query and the AFTER write. End on the final full table query showing all five rows.",
    script:
      "One more guarantee, proven, not claimed. I spun up a multi-region CockroachDB cluster, loaded a few rows, then killed every node in one whole region, live. Watch: the data in that region is still readable, and a brand new write to it still commits. A surviving replica just takes over. Zero data lost.",
  },
  {
    time: "2:47",
    durationSeconds: 9,
    title: "Close: why AWS, why CockroachDB",
    action: "Cut back to the Overview dashboard for a clean closing frame.",
    script:
      "This runs on AWS Lambda, scaling from one claim to thousands with no server to provision. Dozens of agents run at once, never double paying a claim, because CockroachDB guarantees it under real load. This is Verity.",
  },
];

export const TOTAL_DURATION_SECONDS =
  HOST_INTRO.durationSeconds + SCENES.reduce((sum, scene) => sum + scene.durationSeconds, 0);

export const TARGET_MAX_SECONDS = 180;

if (TOTAL_DURATION_SECONDS > TARGET_MAX_SECONDS) {
  throw new Error(
    `Demo script totals ${TOTAL_DURATION_SECONDS}s, over the ${TARGET_MAX_SECONDS}s hackathon limit.`,
  );
}
