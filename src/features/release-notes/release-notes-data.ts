export type ReleaseNoteItem = {
  title: string;
  description: string;
};

export type MonthlyReleaseNote = {
  id: string;
  month: string;
  shortMonth: string;
  monthNumber: string;
  year: string;
  headline: string;
  summary: string;
  newFeatures: ReleaseNoteItem[];
  enhancements: ReleaseNoteItem[];
};

export const monthlyReleaseNotes: MonthlyReleaseNote[] = [
  {
    id: "november-2026",
    month: "November",
    shortMonth: "Nov",
    monthNumber: "11",
    year: "2026",
    headline: "Ask about how you work, wherever you are",
    summary:
      "AskFabric, in beta, answers questions about your organisation with every claim linked to its source, and Claude or Microsoft Copilot can now answer from Fabric too.",
    newFeatures: [
      {
        title: "AskFabric (beta)",
        description:
          "Ask about how your organisation works in plain words, from the AskFabric page in the sidebar. Answers say how much of the organisation they cover.",
      },
      {
        title: "Sources you can check",
        description:
          "Hover over or tap a numbered source to read the quoted evidence, or follow it to the finding, flow step or transcript line it came from.",
      },
      {
        title: "AskFabric for admins",
        description:
          "Admin, then AskFabric, shows questions, active users and answer ratings for the workspace, never the questions or answers themselves.",
      },
      {
        title: "Fabric in Claude and Copilot",
        description:
          "Ask Claude or Microsoft Copilot about how your organisation works, using only what you can see in Fabric. Admins switch on this add-on under Admin, then MCP, with step-by-step setup and a 30-day usage view.",
      },
      {
        title: "Cards, charts and flow steps in answers",
        description:
          "Answers can end with cards for the processes they cover, a flow step with the steps around it, or a chart you can switch to a table. When a name matches several things, pick the one you meant.",
      },
      {
        title: "Ask about this",
        description:
          "Start an AskFabric thread from any process, department or function page, with suggested questions, or choose Ask Fabric in Ctrl+K search.",
      },
      {
        title: "Listen, copy and follow up",
        description:
          "Play an answer aloud, copy it with its sources, or ask one of up to three suggested follow-up questions in one click.",
      },
      {
        title: "Move a contribution",
        description:
          "Admins can move a contribution recorded under the wrong process, see what will change first, and keep a record of the move on its transcript.",
      },
    ],
    enhancements: [
      {
        title: "Private threads",
        description:
          "Your AskFabric threads are visible only to you. Rename, pin, archive or delete them from the thread list.",
      },
      {
        title: "Daily limits during the beta",
        description:
          "Each person can ask 10 questions a day and each workspace 100, resetting at midnight Gulf time.",
      },
      {
        title: "A refreshed AskFabric",
        description:
          "Answers say what they drew on, sources are grouped by type, threads are grouped by day, and your daily allowance sits in the header. Long answers now say what is happening while you wait.",
      },
      {
        title: "More AskFabric can answer",
        description:
          "Ask about a single flow step in full or about Fabric's recommendations. Admins can also ask who has contributed and which processes have no contributions yet.",
      },
      {
        title: "Reasons for deletions",
        description:
          "Deleting a contribution now needs a reason, and admins can review a log of deleted contributions.",
      },
      {
        title: "Evidence labels that count people",
        description:
          "\"Corroborated\", agreements, step confidence and recommendation value now count the people behind them, not the number of contributions. One person interviewed twice is one account, and that is worth confirming with someone else.",
      },
      {
        title: "Small but noticeable fixes",
        description:
          "Overviews and flows no longer assume a contributor's gender, and replies you type during an AI interview now appear in the live transcript.",
      },
    ],
  },
  {
    id: "october-2026",
    month: "October",
    shortMonth: "Oct",
    monthNumber: "10",
    year: "2026",
    headline: "Everyone in the right place",
    summary:
      "Recommendations replace Automations, members get a Home and their department in each workspace, and newcomers are guided through their first visit.",
    newFeatures: [
      {
        title: "Recommendations",
        description:
          "The Recommendations tab replaces Automations, suggesting changes to each process, technical or not, with change plans, build briefs and a place to record decisions.",
      },
      {
        title: "Workspace Home",
        description:
          "Start from a Home page with your own interviews and recently opened processes. On a phone, Home and Browse make it easier to find your way.",
      },
      {
        title: "Guided first steps",
        description:
          "New members are welcomed with the tour and a short walkthrough, and new admins get a Getting started checklist. Anyone can choose Show me around from the help menu.",
      },
      {
        title: "Your department in each workspace",
        description:
          "Members choose their function and department separately in each workspace they belong to.",
      },
      {
        title: "Departments in the members list",
        description:
          "Admins can see each member's department and function in the members table.",
      },
      {
        title: "Two-minute product tour",
        description:
          "Watch a captioned walkthrough of Fabric from the workspace header.",
      },
    ],
    enhancements: [
      {
        title: "Placements that keep up",
        description:
          "Renaming or moving a function or department updates everyone placed in it, without changing anyone's profile.",
      },
      {
        title: "Process volume in flows",
        description:
          "When people mention how many requests or cases a process handles, voice notes and audio uploads now capture it for process flows.",
      },
      {
        title: "Clearer findings",
        description:
          "Insights open with key findings, overviews lead with key facts and an On this page list, and confidence is capped when it rests on a single contributor.",
      },
      {
        title: "Faster admin work",
        description:
          "Search every contribution in the workspace, change roles or remove several members at once, invite several people in one go, and restore your previous theme.",
      },
      {
        title: "Smoother capture",
        description:
          "Uploads show their progress, meeting videos are accepted, microphone problems come with clearer guidance, and a searchable picker links speakers to members.",
      },
    ],
  },
  {
    id: "september-2026",
    month: "September",
    shortMonth: "Sep",
    monthNumber: "09",
    year: "2026",
    headline: "Faster from capture to context",
    summary:
      "Capture choices are visible at a glance, process maps now open at the first step, and audio, uploads, and AI processing gained tighter protections.",
    newFeatures: [
      {
        title: "Direct capture actions",
        description:
          "Start an AI interview, record a voice note, or upload files directly from the process header.",
      },
    ],
    enhancements: [
      {
        title: "Process maps start at the beginning",
        description:
          "Horizontal and vertical flows now open around their entry step instead of centering the full graph.",
      },
      {
        title: "Shorter-lived audio links",
        description:
          "Playback links now expire within minutes and stop working as soon as someone leaves the workspace, without interrupting playback.",
      },
      {
        title: "Safer audio uploads",
        description:
          "Uploaded files are checked to confirm they are real audio, with limits of 100 MB and four hours per file.",
      },
      {
        title: "Stronger AI safeguards",
        description:
          "Fabric's AI now treats conversation content as evidence only, which lowers the chance of instructions inside it affecting summaries.",
      },
      {
        title: "Verified interview imports",
        description:
          "AI interview recordings are checked against the interview they belong to before being imported.",
      },
    ],
  },
  {
    id: "august-2026",
    month: "August",
    shortMonth: "Aug",
    monthNumber: "08",
    year: "2026",
    headline: "Evidence you can follow",
    summary:
      "Overviews now connect every important finding to its source, while process flows are easier to explore and trust.",
    newFeatures: [
      {
        title: "Evidence-backed overviews",
        description:
          "See clear findings, key facts, and source links for every process, department, and function.",
      },
      {
        title: "Connected source trails",
        description:
          "Jump from an overview or PDF report to the source conversation or process-flow step.",
      },
      {
        title: "More flexible process flows",
        description:
          "Use owner lanes, layout controls, spotlights, keyboard navigation, and a resizable details panel.",
      },
      {
        title: "Automation build briefs",
        description:
          "Review analysed automation opportunities and copy an evidence-grounded brief into Microsoft Copilot Studio.",
      },
      {
        title: "Light, dark, and system themes",
        description:
          "Choose an appearance that stays with the device while keeping workspace colours legible.",
      },
      {
        title: "Workspace usage metering",
        description:
          "The platform team can now understand AI and voice usage and cost by workspace.",
      },
      {
        title: "A new public website",
        description:
          "Explore Fabric's product journey, capabilities, common uses, and frequently asked questions.",
      },
    ],
    enhancements: [
      {
        title: "Staged flow generation",
        description:
          "Progress appears sooner, and interrupted flow generation can recover safely.",
      },
      {
        title: "Automatic knowledge updates",
        description:
          "Summary and flow updates begin when a conversation finishes without blocking each other.",
      },
      {
        title: "Smarter rebuild controls",
        description:
          "Build and rebuild controls appear only when usable sources or new information exist, with guidance when evidence is missing.",
      },
      {
        title: "Daily and cumulative cost trends",
        description:
          "Platform usage pages now compare daily AI cost with the running total for the selected period.",
      },
      {
        title: "Duplicate-safe invitations",
        description:
          "Admins receive clear feedback when someone is already a member or has a pending invitation.",
      },
      {
        title: "Foundry-only AI processing",
        description:
          "Fabric-owned AI requests now stay within Microsoft Foundry, with the former external rollback path retired.",
      },
      {
        title: "Clearer executive briefs",
        description:
          "Important facts stand out, while status and rebuild details take up less space.",
      },
      {
        title: "More reliable roll-ups",
        description:
          "Large summaries, usage reports, insight counts, and workspace branding are clearer and steadier.",
      },
    ],
  },
  {
    id: "july-2026",
    month: "July",
    shortMonth: "Jul",
    monthNumber: "07",
    year: "2026",
    headline: "A stronger foundation for growth",
    summary:
      "Workspace creation, joining, and administration became easier to manage as Fabric prepared for more organisations and contributors.",
    newFeatures: [
      {
        title: "Tenant management console",
        description:
          "Create and manage workspaces, invitations, email domains, logos, and staff access in one place.",
      },
      {
        title: "Approved workspace joining",
        description:
          "Join through an invitation or an allowed company email domain.",
      },
      {
        title: "Record on someone's behalf",
        description:
          "Admins can capture the subject, submitter, and consent as separate, clear details.",
      },
      {
        title: "Meaningful conversation titles",
        description:
          "Conversation lists now describe what was discussed instead of only showing the recording type.",
      },
    ],
    enhancements: [
      {
        title: "Contributor access by default",
        description:
          "New workspace members can begin capturing knowledge right away.",
      },
      {
        title: "Accurate workspace totals",
        description:
          "Member, admin, and pending-invitation counts remain correct for new and existing workspaces.",
      },
      {
        title: "More dependable workspace loading",
        description:
          "Joining, conversation lists, media playback, and error recovery are more resilient.",
      },
      {
        title: "Unified AI processing",
        description:
          "Provider monitoring, rollback options, and timeout handling are now managed consistently.",
      },
      {
        title: "Platform maintenance",
        description:
          "Core libraries and install safeguards were refreshed for security and compatibility.",
      },
    ],
  },
  {
    id: "june-2026",
    month: "June",
    shortMonth: "Jun",
    monthNumber: "06",
    year: "2026",
    headline: "A new way to move through Fabric",
    summary:
      "The redesigned workbench made process knowledge faster to find, easier to share, and ready to take offline.",
    newFeatures: [
      {
        title: "Redesigned app shell and workbench",
        description:
          "Move more easily between the process tree, overviews, conversations, flows, and insights.",
      },
      {
        title: "Search and shareable views",
        description:
          "Press Ctrl+K to search the hierarchy and share a link to the same selection and tab.",
      },
      {
        title: "Installable Fabric app",
        description:
          "Install Fabric on your device and keep basic access when you are offline.",
      },
      {
        title: "Complete process PDFs",
        description:
          "Download overviews, insights, conversations, and readable process-flow cards in one report.",
      },
      {
        title: "Admin recovery tools",
        description:
          "Choose invitation roles and retry failed audio transcription or analysis.",
      },
    ],
    enhancements: [
      {
        title: "Consistent workspace colours",
        description:
          "Organisation colours now carry across navigation, controls, conversations, flows, and insights.",
      },
      {
        title: "Predictable hierarchy navigation",
        description:
          "Ordering, direct links, deleted selections, long names, and responsive layouts behave more reliably.",
      },
      {
        title: "Cleaner overview actions",
        description:
          "Edit and delete controls moved into headers, while long summaries can expand and collapse.",
      },
      {
        title: "Safer delete guidance",
        description:
          "Dialogs explain what can be removed and guide admins through required cleanup.",
      },
      {
        title: "Resilient process-flow generation",
        description:
          "More response formats are supported, cut-off results are detected, and failures are clearer.",
      },
      {
        title: "Interaction polish",
        description:
          "Audio, waveforms, profile editing, keyboard access, and responsive layouts received a broad refinement pass.",
      },
    ],
  },
  {
    id: "may-2026",
    month: "May",
    shortMonth: "May",
    monthNumber: "05",
    year: "2026",
    headline: "More ways to bring conversations in",
    summary:
      "Teams gained flexible audio capture, speaker review, and workspace theming without giving up privacy or control.",
    newFeatures: [
      {
        title: "Workspace accent themes",
        description:
          "Create a theme from the organisation logo or choose and approve a colour manually.",
      },
      {
        title: "Speaker-label review",
        description:
          "Identify speakers in voice recordings before their conversation is analysed.",
      },
      {
        title: "Audio file uploads",
        description:
          "Process existing audio through the same transcription and analysis flow as a live recording.",
      },
    ],
    enhancements: [
      {
        title: "Private audio playback",
        description:
          "Signed playback links keep workspace audio protected when it is streamed or revisited.",
      },
      {
        title: "Safer descriptions",
        description:
          "Checks reduce the chance of unsafe or instruction-like text affecting AI results.",
      },
      {
        title: "Clean recording abandonment",
        description:
          "Closing an unfinished recording removes its temporary conversation and audio safely.",
      },
      {
        title: "Clear conversation types",
        description:
          "Badges distinguish AI interviews, voice recordings, and audio uploads at a glance.",
      },
    ],
  },
  {
    id: "april-2026",
    month: "April",
    shortMonth: "Apr",
    monthNumber: "04",
    year: "2026",
    headline: "From conversations to a living process map",
    summary:
      "Fabric expanded from captured conversations into structured knowledge, interactive flows, and complete workspace administration.",
    newFeatures: [
      {
        title: "Manage the full hierarchy",
        description:
          "Create, rename, move, and manage functions, departments, and processes in the workspace.",
      },
      {
        title: "Structured AI overviews",
        description:
          "Summaries now cover processes, departments, and functions with clear refresh controls.",
      },
      {
        title: "Interactive process-flow maps",
        description:
          "Visualise steps, decisions, handoffs, tools, and issues found in conversations.",
      },
      {
        title: "Workspace roles",
        description:
          "Viewer, contributor, and admin roles control who can view, capture, edit, and manage content.",
      },
      {
        title: "Protected organisation workspaces",
        description:
          "Each organisation has its own subdomain with guided joining and workspace switching.",
      },
      {
        title: "Conversation administration",
        description:
          "Admins can invite members and review, export, retry, or remove conversations.",
      },
      {
        title: "Standalone voice recordings",
        description:
          "Capture a voice recording as an alternative to an AI-guided interview.",
      },
    ],
    enhancements: [
      {
        title: "Automatic summary freshness",
        description:
          "Overviews ask for attention only after their source material changes.",
      },
      {
        title: "Hierarchy safeguards",
        description:
          "Delete checks protect child records, while repair tools preserve content if a link is lost.",
      },
      {
        title: "Richer audio controls",
        description:
          "Seek, skip, change speed, use a mini-player, and click through a synced transcript.",
      },
      {
        title: "Clear recording progress",
        description:
          "Background voice processing now shows processing, success, and failure states.",
      },
      {
        title: "More resilient workspace access",
        description:
          "Routing, sign-in, tenant isolation, audio access, and organisation activation are steadier.",
      },
      {
        title: "Consistent organisation branding",
        description:
          "Logos or initials now appear across sign-in, headers, and the workspace shell.",
      },
    ],
  },
  {
    id: "march-2026",
    month: "March",
    shortMonth: "Mar",
    monthNumber: "03",
    year: "2026",
    headline: "Fabric takes shape",
    summary:
      "The first release established a secure workspace for capturing how an organisation really works through conversation.",
    newFeatures: [
      {
        title: "A clear process hierarchy",
        description:
          "Organise company knowledge into functions, departments, and processes.",
      },
      {
        title: "Secure account setup",
        description:
          "Sign in, complete guided onboarding, and create a Fabric profile.",
      },
      {
        title: "AI-guided process interviews",
        description:
          "Turn recorded interviews into conversation records and early process summaries.",
      },
    ],
    enhancements: [
      {
        title: "Guided recording setup",
        description:
          "Microphone access and consent are confirmed before a session begins.",
      },
      {
        title: "Conversation playback foundations",
        description:
          "Playback includes transcripts, waveforms, and essential audio controls.",
      },
      {
        title: "Authenticated workspace data",
        description:
          "Workspace information and backend actions are protected from the first release.",
      },
    ],
  },
];
