import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Language = "en" | "sw";

const LANGUAGE_KEY = "forge_language_v1";

const en = {
  tagline:
    "Your founder operating system: test an idea, get a clear decision, and start executing this week.",
  loading: "Loading...",
  signOut: "Sign out",
  profile: "Profile",
  cancel: "Cancel",
  retry: "Retry",
  copy: "Copy",
  copied: "Copied",
  back: "Back",

  // Auth
  authSignInLead: "Sign in to pick up your ideas where you left them.",
  authSignUpLead: "Create an account to keep your ideas, reports and plans.",
  email: "Email",
  password: "Password",
  passwordHint: "At least 8 characters",
  confirmEmail: "Check your inbox and confirm your email, then sign in here.",
  signInFailed: "Could not sign you in. Try again.",
  working: "Working...",
  signIn: "Sign in",
  createAccount: "Create account",
  newHere: "New here?",
  haveAccount: "Already have an account?",
  createAnAccount: "Create an account",

  // Input
  revising: (title: string, evidence: number) =>
    `Revising ${title}. The new report is saved as the next version of this idea${
      evidence > 0
        ? ` and will weigh ${evidence} finished ${evidence === 1 ? "experiment" : "experiments"}.`
        : "."
    }`,
  updatedIdea: "Updated idea",
  yourIdea: "Your startup idea",
  ideaPlaceholder: "Drop your idea, messy is fine",
  oneQuestion: "One quick question before analysis",
  editIdea: "Edit idea",
  answerPlaceholder: "Answer in one or two direct sentences",
  noFlattery: "No flattery. Anything that could not be verified is flagged.",
  submitContinue: "CONTINUE",
  submitRerun: "RE-RUN",
  submitIgnite: "IGNITE",
  yourIdeas: "Your ideas",
  browserOnly: "Saved in this browser only",
  loadingIdeas: "Loading your ideas...",
  noIdeas:
    "Nothing here yet. Each idea you test gets its own workspace: a report, a decision, and a 7-day plan to act on it.",
  reportsCount: (n: number) => (n === 1 ? "1 report" : `${n} reports`),
  sprintProgress: (done: number, total: number) => `sprint ${done}/${total}`,
  profileNudge:
    "Add your founder profile so FORGE can judge fit and tailor plans to your money, time and location.",
  profileNudgeAction: "Add profile",

  // App errors
  enterIdeaFirst: "Enter your startup idea first so there is something to test.",
  answerClarifying: "Answer the clarifying question so FORGE can judge the idea.",
  loadIdeasFailed: (msg: string) => `Could not load your saved ideas (${msg}).`,
  reportNotSaved: (msg: string) =>
    `This report could not be saved (${msg}). Copy it as Markdown before leaving this page.`,
  deleteConfirm: (title: string, n: number) =>
    `Delete "${title}" and all ${n} of its reports? This cannot be undone.`,
  deleteFailed: (msg: string) => `Could not delete this idea (${msg}).`,
  planSaveFailed: (msg: string) =>
    `That change was not saved (${msg}). Reload to see what is stored.`,
  analysisFailed: "Analysis failed unexpectedly. Please try again.",
  aiLimitReached:
    "FORGE has used up today's free AI allowance. Please try again tomorrow. Your ideas and plans are saved.",
  unknownError: "unknown error",

  // Verdicts
  verdict: (score: number): string =>
    score >= 80
      ? "Strong case to build"
      : score >= 65
      ? "Viable with real hurdles"
      : score >= 45
      ? "Needs sharper focus before building"
      : score >= 25
      ? "Weak foundation as framed"
      : "Do not build as currently framed",

  // Working screen
  stressTesting: "Stress-testing your idea",
  phaseNames: [
    "Problem",
    "Customer",
    "Market",
    "Competition",
    "Business Model",
    "Execution Risk",
  ],
  phaseNotes: [
    "Checking problem specificity and pain intensity",
    "Evaluating target buyer and willingness to pay",
    "Scanning live web sources for market signals",
    "Verifying existing alternatives and pricing",
    "Testing unit economics and revenue assumptions",
    "Compiling failure modes and the decision",
  ],
  phaseDone: "Done",
  phaseRunning: "Running",
  phaseQueued: "Queued",
  nexusNote:
    "You can close this page. FORGE keeps working and saves the report to your ideas.",
  keepInBackground: "Keep working in the background",
  nexusQuotaWait:
    "The free AI allowance is used up for now. FORGE will continue automatically when it frees up.",

  // Nexus jobs on the home screen
  nexusHeading: "FORGE is working",
  nexusAnalyzing: (idea: string) => `Testing: ${idea}`,
  nexusSprinting: (idea: string) => `Building the 7-day sprint for: ${idea}`,
  nexusStep: (step: string) =>
    ({
      start: "Step 1 of 4: checking the idea is clear",
      scout: "Step 2 of 4: Scout is searching the web",
      analyst: "Step 3 of 4: Analyst is writing the report",
      skeptic: "Step 4 of 4: Skeptic is checking every claim",
    })[step] ?? "Queued",
  nexusWaiting: "Waiting for free AI allowance, will continue automatically",
  nexusQuestion: "FORGE has a question before it continues",
  answer: "Answer",

  // Skeptic
  skepticHeading: "The Skeptic's check",
  skepticChecked: (supported: number, checked: number) =>
    `${supported} of ${checked} competitors and claims are backed by the sources FORGE found.`,
  skepticRemoved: "Removed: their source did not back them",
  skepticUnsupported: "Not supported by any source",
  skepticObjection: "Strongest argument against this idea",

  // Report
  allIdeas: "All ideas",
  copyMarkdown: "Copy as Markdown",
  newIdea: "New idea",
  reviseRerun: "Revise and re-run",
  reportOf: (v: number, n: number) => `Report v${v} of ${n}`,
  deleteIdea: "Delete idea",
  reportVersions: "Report versions",
  verdictLabel: "Verdict",
  confidence: (c: string) => `Confidence: ${c}`,
  confidenceWords: { low: "low", medium: "medium", high: "high" } as Record<string, string>,
  noChangeFrom: (v: number) => `no change from v${v}`,
  versus: (v: number) => `vs v${v}`,
  ideaTested: "Idea tested",
  whatYouWrote: "What you wrote for this version",
  scoreBreakdown: "Score breakdown",
  breakdown: {
    problem_clarity: "Problem clarity",
    market_signal: "Market signal",
    founder_fit: "Founder fit",
    feasibility: "Feasibility",
    differentiation: "Differentiation",
  },
  couldntVerify: "What I couldn't verify",
  couldntVerifyEmpty:
    "Competitor references matched retrieved web sources, though market size and pricing figures remain estimates until tested with buyers.",
  swot: "SWOT Analysis",
  strengths: "Strengths",
  weaknesses: "Weaknesses",
  opportunities: "Opportunities",
  threats: "Threats",
  noneStrengths: "No clear strengths identified from the input.",
  noneWeaknesses: "No weaknesses listed.",
  noneOpportunities: "No verified opportunities identified.",
  noneThreats: "No major threats listed.",
  competitors: "Competitors",
  source: "Source",
  unverifiedSource: "Unverified source",
  noCompetitors:
    "Could not verify competitors from live search sources. No unverified competitors were fabricated.",
  retrievedSources: "Retrieved search sources",
  blueprint: "Blueprint",
  problem: "Problem",
  targetUser: "Target user",
  solution: "Solution",
  businessModel: "Business model",
  keyRisks: "Key risks",
  validateNext: "Validate next",
  inPlan: "In plan",
  addToPlan: "Add to plan",
  businessPlan: "Business Plan",
  tam: "TAM",
  pricingHypothesis: "Pricing hypothesis",
  goToMarket: "Go-to-market",
  assumptions: "Assumptions",
  estimate: "ESTIMATE",

  // Decision
  decisionHeading: "FORGE's call",
  decisionCalls: {
    go: "Go: start executing",
    pivot: "Pivot: change the angle",
    kill: "Kill: move on",
  } as Record<string, string>,
  decisionNext: {
    go: "Your next move: build the 7-day sprint below and start Day 1 today.",
    pivot: "Your next move: test one of the sharper ideas below instead of polishing this one.",
    kill: "Your next move: don't spend more time here. Test one of these ideas instead.",
  } as Record<string, string>,
  pivotsHeading: "Sharper ideas to test",
  testThisIdea: "Test this idea",
  decisionMissing:
    "This report was made before FORGE gave clear decisions. Revise and re-run it to get one.",

  // Sprint
  sprintHeading: "7-day launch sprint",
  sprintIntro:
    "Stop planning, start doing. FORGE turns this report into small daily tasks, with step-by-step guidance and messages and scripts you can copy and use straight away.",
  buildSprint: "Build my 7-day sprint",
  buildingSprint: "Building your sprint. This takes about a minute...",
  rebuildSprint: "Rebuild sprint",
  rebuildConfirm:
    "Build a new sprint? Your current plan and its ticked tasks will be replaced.",
  sprintGoal: "Goal this week",
  sprintMetric: "Success looks like",
  day: (n: number) => `Day ${n}`,
  why: "Why it matters",
  howTo: "How to do it",
  doThisNext: "Do this next",
  markDone: "Mark as done",
  markNotDone: "Mark as not done",
  sprintTasksDone: (done: number, total: number) => `${done} of ${total} tasks done`,
  sprintComplete:
    "Sprint complete. Record what you learned in the validation plan, then re-run the idea so the score reflects real evidence.",
  sprintUnavailable: "This idea was not saved, so a sprint cannot be kept for it.",
  sprintFailed: (msg: string) => `Could not build the sprint (${msg}).`,
  sprintSaveFailed: (msg: string) => `Your sprint progress was not saved (${msg}).`,
  sprintAskProfile:
    "Tip: fill in your profile first so the plan fits your budget, time and location.",

  // Validation plan
  validationPlan: "Validation plan",
  doneOf: (done: number, total: number) => `${done} of ${total} done`,
  validationIntro:
    "The score only moves on evidence. Run these in the real world, record what happened, then re-run the idea so the report weighs your results.",
  planNotSaved: "This idea was not saved, so a plan cannot be kept for it.",
  addExperiment: "Add an experiment",
  addExperimentPlaceholder: "Add your own experiment, e.g. Interview 10 target users",
  add: "Add",
  readyToWeigh: (n: number) =>
    `${n === 1 ? "1 finished experiment is" : `${n} finished experiments are`} ready to be weighed in a new report.`,
  rerunWithResults: "Re-run with results",
  statusLabels: { todo: "To do", running: "In progress", done: "Done" } as Record<string, string>,
  outcomeLabels: {
    supported: "Supported the idea",
    refuted: "Went against the idea",
    inconclusive: "Inconclusive",
  } as Record<string, string>,
  statusOf: (title: string) => `Status of: ${title}`,
  removeItem: (title: string) => `Remove: ${title}`,
  result: "Result",
  chooseResult: "Choose a result...",
  whatHappened: "What happened",
  notesPlaceholder: "Specifics count: who, how many, what they said, did or paid.",
  chooseResultHint: "Choose a result so this counts in your next re-run.",

  // Profile
  profileTitleNew: "Tell FORGE about you",
  profileTitleEdit: "Your founder profile",
  profileLead:
    "FORGE remembers this and uses it in every report and plan: to judge founder fit, and to fit plans to your money, time and location. Only you can see it.",
  fieldName: "Your name",
  fieldCountry: "Country",
  fieldCity: "City or town",
  fieldBackground: "Background and experience",
  fieldBackgroundHint: "e.g. Final-year IT student, ran a small phone-repair stall for 2 years",
  fieldSkills: "Skills you bring",
  fieldSkillsHint: "e.g. Sales, coding, design, cooking, social media",
  fieldHours: "Time you can give each week",
  fieldHoursHint: "e.g. 10 hours, evenings and weekends",
  fieldBudget: "Money you can put in to start",
  fieldBudgetHint: "e.g. Nothing yet, or TSh 200,000",
  fieldGoal: "What you want from this",
  fieldGoalHint: "e.g. Side income, a full-time business, a startup that raises money",
  language: "Language",
  saveProfile: "Save profile",
  saving: "Saving...",
  skipForNow: "Skip for now",
  profileSaveFailed: (msg: string) => `Could not save your profile (${msg}).`,

  // Two scores, licences, evidence
  splitOpportunity: "Opportunity",
  splitOpportunityHint: "The market on its own",
  splitReadiness: "Your readiness",
  splitReadinessHint: "You, right now",
  splitGapNote: "A good opportunity with low readiness means start smaller, not stop.",
  splitGaps: "How to close the gap",
  regulationHeading: "Licences & rules to check",
  regulationLead: "FORGE cannot confirm the law for you. Check these with the right office before you start serving or charging customers.",
  regulationCheckWith: "Check with",
  evidenceHeading: "Evidence behind the big claims",
  evidenceSupported: "Backed",
  evidenceEstimate: "Estimate",
  evidenceUnsupported: "Not backed",
  evidenceContradicted: "Sources disagree",
  evidenceSource: "source",

  // Feedback
  close: "Close",
  feedbackButton: "Feedback",
  feedbackTitle: "Tell us anything",
  feedbackLead: "Something broken, confusing, missing, or loved? A real person on the FORGE team reads every message.",
  feedbackHowIsIt: "How is FORGE for you so far?",
  feedbackFaces: ["Bad", "Okay", "Good", "Love it"],
  feedbackAbout: "What is it about?",
  feedbackKindBug: "🐞 Something broke",
  feedbackKindConfusing: "🤔 Confusing",
  feedbackKindIdea: "💡 Idea",
  feedbackKindPraise: "❤️ I like this",
  feedbackMessageLabel: "Tell us more",
  feedbackPlaceholder: "What happened? What did you expect? What would make FORGE better for you?",
  feedbackContactOk: "You can email me about this",
  feedbackNeedMessage: "Write a few words so we know what to fix.",
  feedbackSend: "Send to the FORGE team",
  feedbackSending: "Sending...",
  feedbackThanksTitle: "Asante!",
  feedbackThanks: "Thank you. Your message went straight to the FORGE team, and we use it to decide what to fix next.",
  feedbackWhatWrong: "What was wrong or missing?",
  feedbackRated: "Thanks for rating",
  feedbackUseful: "Useful",
  feedbackNotUseful: "Not useful",
  feedbackRateAnswer: "Helpful?",
  feedbackRateReport: "Was this report useful?",
  admin: "Admin",

  // Today (home brief)
  todayMorning: "Good morning",
  todayAfternoon: "Good afternoon",
  todayEvening: "Good evening",
  todayIdea: "You're working on",
  todaySprintDay: (n: number) => `Today: sprint day ${n}`,
  todayReady: "Ready for you",
  todaySprintFinished: "You finished every task in this sprint. Record what you learned in your tests, then re-run the analysis.",
  todayNoSprint: (call: string) => `FORGE's call: ${call}. Next step: build your 7-day sprint so you know exactly what to do each day.`,
  todayOpenTests: "Tests still open",
  todayOpenPlan: "Open today's plan",
  todayBuildSprint: "Build my 7-day sprint",
  todayAsk: "Ask FORGE what to do",

  // Ask FORGE
  askForge: "Ask FORGE",
  askForgeLead:
    "Ask anything about your ideas, reports or next steps. FORGE uses your profile, its agents' reports, your tests and your sprint, and searches the web when it needs to.",
  askForgeAbout: (title: string) => `Talking about: ${title}`,
  askForgeAllIdeas: "All my ideas",
  askForgeFocus: "Focus",
  askForgePlaceholder: "Ask a question, raise a worry, or ask FORGE to explain something...",
  askForgeSend: "Send",
  askForgeThinking: "FORGE is thinking...",
  askForgeThinkingLong: "FORGE is checking the web...",
  askForgeClear: "Clear chat",
  askForgeClearConfirm: "Delete this whole conversation? This cannot be undone.",
  askForgeFailed: (msg: string) => `FORGE could not answer (${msg}).`,
  askForgeRetry: "Send again",
  askForgeSources: "Sources",
  askForgeViaTelegram: "via Telegram",
  askForgeUnavailable: "Ask FORGE works on the hosted version of FORGE only.",
  askForgeSuggestions: [
    "What should I do today?",
    "Explain my score in simple words",
    "What is the biggest risk in my idea, and how do I test it cheaply?",
    "How do I register a business in Tanzania?",
  ],
  actionRunAnalysis: "Test this idea",
  actionOpenIdea: (title: string) => `Open “${title}”`,
  actionBuildSprint: (title: string) => `Build sprint for “${title}”`,
  actionEditProfile: "Update my profile",
  askAboutIdea: "Ask FORGE",

  // Telegram
  telegramHeading: "FORGE on Telegram",
  telegramLead:
    "Get a short brief every morning at 7:00 (Tanzania time) with today's sprint tasks, and ask FORGE questions straight from Telegram.",
  telegramConnect: "Connect Telegram",
  telegramOpening: "Preparing your link...",
  telegramWaiting: "Telegram opened in a new tab. Press Start in the chat with the FORGE bot to finish connecting.",
  telegramOpenAgain: "Open Telegram again",
  telegramConnected: "Connected",
  telegramBrief: "Morning brief",
  telegramBriefOn: "On",
  telegramBriefOff: "Off",
  telegramDisconnect: "Disconnect",
  telegramFailed: (msg: string) => `Could not connect Telegram (${msg}).`,
};

export type Dictionary = typeof en;

const sw: Dictionary = {
  tagline:
    "Mfumo wako wa mjasiriamali: pima wazo, pata uamuzi wa wazi, na anza kutekeleza wiki hii.",
  loading: "Inapakia...",
  signOut: "Toka",
  profile: "Wasifu",
  cancel: "Ghairi",
  retry: "Jaribu tena",
  copy: "Nakili",
  copied: "Imenakiliwa",
  back: "Rudi",

  authSignInLead: "Ingia uendelee na mawazo yako ulipoishia.",
  authSignUpLead: "Fungua akaunti uhifadhi mawazo, ripoti na mipango yako.",
  email: "Barua pepe",
  password: "Nenosiri",
  passwordHint: "Angalau herufi 8",
  confirmEmail: "Angalia barua pepe yako na uthibitishe, kisha ingia hapa.",
  signInFailed: "Imeshindikana kuingia. Jaribu tena.",
  working: "Inashughulikia...",
  signIn: "Ingia",
  createAccount: "Fungua akaunti",
  newHere: "Mgeni hapa?",
  haveAccount: "Tayari una akaunti?",
  createAnAccount: "Fungua akaunti",

  revising: (title, evidence) =>
    `Unaboresha ${title}. Ripoti mpya itahifadhiwa kama toleo jipya la wazo hili${
      evidence > 0 ? ` na itazingatia majaribio ${evidence} yaliyokamilika.` : "."
    }`,
  updatedIdea: "Wazo lililoboreshwa",
  yourIdea: "Wazo lako la biashara",
  ideaPlaceholder: "Andika wazo lako, hata kama bado halijapangika",
  oneQuestion: "Swali moja kabla ya uchambuzi",
  editIdea: "Hariri wazo",
  answerPlaceholder: "Jibu kwa sentensi moja au mbili",
  noFlattery: "Hakuna kubembeleza. Chochote ambacho hakikuthibitishwa kinaonyeshwa wazi.",
  submitContinue: "ENDELEA",
  submitRerun: "PIMA TENA",
  submitIgnite: "WASHA",
  yourIdeas: "Mawazo yako",
  browserOnly: "Imehifadhiwa kwenye kivinjari hiki tu",
  loadingIdeas: "Inapakia mawazo yako...",
  noIdeas:
    "Bado hakuna kitu hapa. Kila wazo unalopima linapata sehemu yake: ripoti, uamuzi, na mpango wa siku 7 wa kulitekeleza.",
  reportsCount: (n) => (n === 1 ? "ripoti 1" : `ripoti ${n}`),
  sprintProgress: (done, total) => `mpango ${done}/${total}`,
  profileNudge:
    "Jaza wasifu wako ili FORGE ipime ufaafu wako na kuandaa mipango inayolingana na pesa, muda na mahali ulipo.",
  profileNudgeAction: "Jaza wasifu",

  enterIdeaFirst: "Andika wazo lako kwanza ili kuwe na kitu cha kupima.",
  answerClarifying: "Jibu swali ili FORGE iweze kupima wazo.",
  loadIdeasFailed: (msg) => `Imeshindikana kupakia mawazo yako (${msg}).`,
  reportNotSaved: (msg) =>
    `Ripoti hii haikuweza kuhifadhiwa (${msg}). Inakili kama Markdown kabla ya kuondoka kwenye ukurasa huu.`,
  deleteConfirm: (title, n) =>
    `Futa "${title}" pamoja na ripoti zake zote ${n}? Huwezi kurudisha.`,
  deleteFailed: (msg) => `Imeshindikana kufuta wazo hili (${msg}).`,
  planSaveFailed: (msg) =>
    `Mabadiliko hayo hayakuhifadhiwa (${msg}). Pakia upya ukurasa kuona kilichohifadhiwa.`,
  analysisFailed: "Uchambuzi umeshindikana. Tafadhali jaribu tena.",
  aiLimitReached:
    "FORGE imemaliza kiwango cha bure cha AI kwa leo. Tafadhali jaribu tena kesho. Mawazo na mipango yako imehifadhiwa.",
  unknownError: "hitilafu isiyojulikana",

  verdict: (score) =>
    score >= 80
      ? "Lina nguvu, anza kujenga"
      : score >= 65
      ? "Linawezekana, lakini lina vikwazo halisi"
      : score >= 45
      ? "Linahitaji kulengwa zaidi kabla ya kujenga"
      : score >= 25
      ? "Msingi dhaifu kama lilivyo sasa"
      : "Usijenge kama lilivyo sasa",

  stressTesting: "Tunalipima wazo lako",
  phaseNames: [
    "Tatizo",
    "Mteja",
    "Soko",
    "Washindani",
    "Mfumo wa biashara",
    "Hatari za utekelezaji",
  ],
  phaseNotes: [
    "Tunaangalia kama tatizo ni mahususi na linauma kiasi gani",
    "Tunapima mnunuzi lengwa na utayari wake wa kulipa",
    "Tunatafuta dalili za soko kwenye vyanzo vya mtandaoni",
    "Tunathibitisha njia mbadala zilizopo na bei zao",
    "Tunapima mapato na gharama za kila mteja",
    "Tunakusanya hatari na kufanya uamuzi",
  ],
  phaseDone: "Imekamilika",
  phaseRunning: "Inaendelea",
  phaseQueued: "Inasubiri",
  nexusNote:
    "Unaweza kufunga ukurasa huu. FORGE inaendelea kufanya kazi na kuhifadhi ripoti kwenye mawazo yako.",
  keepInBackground: "Endelea kufanya kazi nyuma",
  nexusQuotaWait:
    "Kiwango cha bure cha AI kimeisha kwa sasa. FORGE itaendelea yenyewe kikipatikana tena.",

  nexusHeading: "FORGE inafanya kazi",
  nexusAnalyzing: (idea) => `Inapima: ${idea}`,
  nexusSprinting: (idea) => `Inatengeneza mpango wa siku 7 wa: ${idea}`,
  nexusStep: (step) =>
    ({
      start: "Hatua 1 kati ya 4: kuhakikisha wazo liko wazi",
      scout: "Hatua 2 kati ya 4: Scout anatafuta mtandaoni",
      analyst: "Hatua 3 kati ya 4: Analyst anaandika ripoti",
      skeptic: "Hatua 4 kati ya 4: Skeptic anakagua kila dai",
    })[step] ?? "Inasubiri",
  nexusWaiting: "Inasubiri kiwango cha bure cha AI, itaendelea yenyewe",
  nexusQuestion: "FORGE ina swali kabla ya kuendelea",
  answer: "Jibu",

  skepticHeading: "Ukaguzi wa Skeptic",
  skepticChecked: (supported, checked) =>
    `Washindani na madai ${supported} kati ya ${checked} yanaungwa mkono na vyanzo FORGE ilivyopata.`,
  skepticRemoved: "Wameondolewa: chanzo chao hakikuwaunga mkono",
  skepticUnsupported: "Hayaungwi mkono na chanzo chochote",
  skepticObjection: "Hoja yenye nguvu zaidi dhidi ya wazo hili",

  allIdeas: "Mawazo yote",
  copyMarkdown: "Nakili kama Markdown",
  newIdea: "Wazo jipya",
  reviseRerun: "Boresha na upime tena",
  reportOf: (v, n) => `Ripoti v${v} kati ya ${n}`,
  deleteIdea: "Futa wazo",
  reportVersions: "Matoleo ya ripoti",
  verdictLabel: "Hukumu",
  confidence: (c) => `Uhakika: ${c}`,
  confidenceWords: { low: "mdogo", medium: "wa kati", high: "mkubwa" },
  noChangeFrom: (v) => `hakuna mabadiliko tangu v${v}`,
  versus: (v) => `ukilinganisha na v${v}`,
  ideaTested: "Wazo lililopimwa",
  whatYouWrote: "Ulichoandika kwa toleo hili",
  scoreBreakdown: "Mgawanyo wa alama",
  breakdown: {
    problem_clarity: "Uwazi wa tatizo",
    market_signal: "Dalili za soko",
    founder_fit: "Ufaafu wa mjasiriamali",
    feasibility: "Uwezekano wa kutekeleza",
    differentiation: "Utofauti",
  },
  couldntVerify: "Nisichoweza kuthibitisha",
  couldntVerifyEmpty:
    "Washindani waliotajwa walilingana na vyanzo vya mtandaoni, lakini ukubwa wa soko na bei bado ni makadirio hadi yapimwe kwa wanunuzi.",
  swot: "Uchambuzi wa SWOT",
  strengths: "Nguvu",
  weaknesses: "Udhaifu",
  opportunities: "Fursa",
  threats: "Vitisho",
  noneStrengths: "Hakuna nguvu za wazi zilizobainika.",
  noneWeaknesses: "Hakuna udhaifu ulioorodheshwa.",
  noneOpportunities: "Hakuna fursa zilizothibitishwa.",
  noneThreats: "Hakuna vitisho vikubwa vilivyoorodheshwa.",
  competitors: "Washindani",
  source: "Chanzo",
  unverifiedSource: "Chanzo hakijathibitishwa",
  noCompetitors:
    "Haikuwezekana kuthibitisha washindani kutoka vyanzo vya mtandaoni. Hakuna mshindani aliyebuniwa.",
  retrievedSources: "Vyanzo vilivyopatikana",
  blueprint: "Mchoro wa biashara",
  problem: "Tatizo",
  targetUser: "Mtumiaji lengwa",
  solution: "Suluhisho",
  businessModel: "Mfumo wa mapato",
  keyRisks: "Hatari kuu",
  validateNext: "Pima kinachofuata",
  inPlan: "Kipo kwenye mpango",
  addToPlan: "Ongeza kwenye mpango",
  businessPlan: "Mpango wa biashara",
  tam: "Ukubwa wa soko",
  pricingHypothesis: "Dhana ya bei",
  goToMarket: "Njia ya kufikia soko",
  assumptions: "Dhana",
  estimate: "MAKADIRIO",

  decisionHeading: "Uamuzi wa FORGE",
  decisionCalls: {
    go: "Endelea: anza kutekeleza",
    pivot: "Badilisha mwelekeo",
    kill: "Acha: songa mbele",
  },
  decisionNext: {
    go: "Hatua yako inayofuata: tengeneza mpango wa siku 7 hapa chini na anza Siku ya 1 leo.",
    pivot: "Hatua yako inayofuata: pima mojawapo ya mawazo bora hapa chini badala ya kung'arisha hili.",
    kill: "Hatua yako inayofuata: usitumie muda zaidi hapa. Pima mojawapo ya mawazo haya badala yake.",
  },
  pivotsHeading: "Mawazo bora zaidi ya kupima",
  testThisIdea: "Pima wazo hili",
  decisionMissing:
    "Ripoti hii ilitengenezwa kabla FORGE haijaanza kutoa maamuzi. Boresha na upime tena kupata uamuzi.",

  sprintHeading: "Mpango wa siku 7 wa kuanza",
  sprintIntro:
    "Acha kupanga, anza kutenda. FORGE inageuza ripoti hii kuwa kazi ndogo za kila siku, zenye maelekezo hatua kwa hatua na jumbe au maandishi unayoweza kunakili na kutumia mara moja.",
  buildSprint: "Tengeneza mpango wangu wa siku 7",
  buildingSprint: "Tunatengeneza mpango wako. Inachukua kama dakika moja...",
  rebuildSprint: "Tengeneza mpango upya",
  rebuildConfirm:
    "Tengeneza mpango mpya? Mpango wako wa sasa na kazi ulizoweka alama zitabadilishwa.",
  sprintGoal: "Lengo la wiki hii",
  sprintMetric: "Mafanikio ni",
  day: (n) => `Siku ${n}`,
  why: "Kwa nini ni muhimu",
  howTo: "Jinsi ya kufanya",
  doThisNext: "Fanya hiki sasa",
  markDone: "Weka alama kuwa imekamilika",
  markNotDone: "Ondoa alama ya kukamilika",
  sprintTasksDone: (done, total) => `Kazi ${done} kati ya ${total} zimekamilika`,
  sprintComplete:
    "Mpango umekamilika. Andika ulichojifunza kwenye mpango wa majaribio, kisha pima wazo tena ili alama ionyeshe ushahidi halisi.",
  sprintUnavailable: "Wazo hili halikuhifadhiwa, kwa hiyo mpango hauwezi kuhifadhiwa.",
  sprintFailed: (msg) => `Imeshindikana kutengeneza mpango (${msg}).`,
  sprintSaveFailed: (msg) => `Maendeleo ya mpango wako hayakuhifadhiwa (${msg}).`,
  sprintAskProfile:
    "Kidokezo: jaza wasifu wako kwanza ili mpango ulingane na pesa, muda na mahali ulipo.",

  validationPlan: "Mpango wa majaribio",
  doneOf: (done, total) => `${done} kati ya ${total} yamekamilika`,
  validationIntro:
    "Alama hubadilika tu kwa ushahidi. Fanya majaribio haya kwa vitendo, andika kilichotokea, kisha pima wazo tena ili ripoti izingatie matokeo yako.",
  planNotSaved: "Wazo hili halikuhifadhiwa, kwa hiyo mpango hauwezi kuhifadhiwa.",
  addExperiment: "Ongeza jaribio",
  addExperimentPlaceholder: "Ongeza jaribio lako, mf. Ongea na wateja 10 lengwa",
  add: "Ongeza",
  readyToWeigh: (n) =>
    `${n === 1 ? "Jaribio 1 lililokamilika liko" : `Majaribio ${n} yaliyokamilika yako`} tayari kuzingatiwa kwenye ripoti mpya.`,
  rerunWithResults: "Pima tena na matokeo",
  statusLabels: { todo: "Bado", running: "Inaendelea", done: "Imekamilika" },
  outcomeLabels: {
    supported: "Liliunga mkono wazo",
    refuted: "Lilipinga wazo",
    inconclusive: "Halijulikani",
  },
  statusOf: (title) => `Hali ya: ${title}`,
  removeItem: (title) => `Ondoa: ${title}`,
  result: "Matokeo",
  chooseResult: "Chagua matokeo...",
  whatHappened: "Kilichotokea",
  notesPlaceholder: "Taja undani: nani, wangapi, walisema nini, walifanya nini au walilipa kiasi gani.",
  chooseResultHint: "Chagua matokeo ili jaribio hili lihesabiwe utakapopima tena.",

  profileTitleNew: "Iambie FORGE kuhusu wewe",
  profileTitleEdit: "Wasifu wako wa mjasiriamali",
  profileLead:
    "FORGE inakumbuka haya na kuyatumia kwenye kila ripoti na mpango: kupima ufaafu wako, na kuandaa mipango inayolingana na pesa, muda na mahali ulipo. Ni wewe tu unayeweza kuyaona.",
  fieldName: "Jina lako",
  fieldCountry: "Nchi",
  fieldCity: "Mji",
  fieldBackground: "Historia na uzoefu",
  fieldBackgroundHint: "mf. Mwanafunzi wa mwaka wa mwisho wa IT, niliendesha kibanda cha kutengeneza simu kwa miaka 2",
  fieldSkills: "Ujuzi ulionao",
  fieldSkillsHint: "mf. Mauzo, kuandika programu, ubunifu, upishi, mitandao ya kijamii",
  fieldHours: "Muda unaoweza kutoa kila wiki",
  fieldHoursHint: "mf. Saa 10, jioni na wikendi",
  fieldBudget: "Pesa unazoweza kuweka kuanza",
  fieldBudgetHint: "mf. Bado sina, au TSh 200,000",
  fieldGoal: "Unachotaka kupata kutoka kwa hili",
  fieldGoalHint: "mf. Kipato cha ziada, biashara ya muda wote, kampuni changa itakayopata wawekezaji",
  language: "Lugha",
  saveProfile: "Hifadhi wasifu",
  saving: "Inahifadhi...",
  skipForNow: "Ruka kwa sasa",
  profileSaveFailed: (msg) => `Imeshindikana kuhifadhi wasifu wako (${msg}).`,

  // Two scores, licences, evidence
  splitOpportunity: "Fursa",
  splitOpportunityHint: "Soko lenyewe",
  splitReadiness: "Utayari wako",
  splitReadinessHint: "Wewe, sasa hivi",
  splitGapNote: "Fursa nzuri yenye utayari mdogo maana yake anza kidogo, si kuacha.",
  splitGaps: "Jinsi ya kuziba pengo",
  regulationHeading: "Leseni na sheria za kuhakiki",
  regulationLead: "FORGE haiwezi kuthibitisha sheria kwa niaba yako. Hakiki haya na ofisi husika kabla ya kuanza kuhudumia au kutoza wateja.",
  regulationCheckWith: "Hakiki na",
  evidenceHeading: "Ushahidi wa madai makubwa",
  evidenceSupported: "Lina chanzo",
  evidenceEstimate: "Makadirio",
  evidenceUnsupported: "Halina chanzo",
  evidenceContradicted: "Vyanzo vinapinga",
  evidenceSource: "chanzo",

  // Feedback
  close: "Funga",
  feedbackButton: "Maoni",
  feedbackTitle: "Tuambie chochote",
  feedbackLead: "Kuna kitu kimeharibika, kinachanganya, kinakosekana, au umekipenda? Mtu halisi wa timu ya FORGE husoma kila ujumbe.",
  feedbackHowIsIt: "FORGE inakufaa vipi hadi sasa?",
  feedbackFaces: ["Mbaya", "Kawaida", "Nzuri", "Naipenda"],
  feedbackAbout: "Ni kuhusu nini?",
  feedbackKindBug: "🐞 Kitu kimeharibika",
  feedbackKindConfusing: "🤔 Kinachanganya",
  feedbackKindIdea: "💡 Wazo",
  feedbackKindPraise: "❤️ Nimependa",
  feedbackMessageLabel: "Tuambie zaidi",
  feedbackPlaceholder: "Nini kimetokea? Ulitarajia nini? Nini kingefanya FORGE ikufae zaidi?",
  feedbackContactOk: "Mnaweza kunitumia barua pepe kuhusu hili",
  feedbackNeedMessage: "Andika maneno machache ili tujue cha kurekebisha.",
  feedbackSend: "Tuma kwa timu ya FORGE",
  feedbackSending: "Inatuma...",
  feedbackThanksTitle: "Asante!",
  feedbackThanks: "Asante. Ujumbe wako umefika moja kwa moja kwa timu ya FORGE, na tunautumia kuamua cha kurekebisha kwanza.",
  feedbackWhatWrong: "Nini kilikuwa kibaya au kinakosekana?",
  feedbackRated: "Asante kwa tathmini",
  feedbackUseful: "Inasaidia",
  feedbackNotUseful: "Haisaidii",
  feedbackRateAnswer: "Imesaidia?",
  feedbackRateReport: "Ripoti hii imekusaidia?",
  admin: "Admin",

  // Today (home brief)
  todayMorning: "Habari ya asubuhi",
  todayAfternoon: "Habari ya mchana",
  todayEvening: "Habari ya jioni",
  todayIdea: "Unafanyia kazi",
  todaySprintDay: (n: number) => `Leo: siku ya ${n} ya sprint`,
  todayReady: "Tayari kwako",
  todaySprintFinished: "Umemaliza kazi zote za sprint hii. Andika ulichojifunza kwenye majaribio yako, kisha endesha uchambuzi upya.",
  todayNoSprint: (call: string) => `Uamuzi wa FORGE: ${call}. Hatua inayofuata: tengeneza sprint yako ya siku 7 ili ujue cha kufanya kila siku.`,
  todayOpenTests: "Majaribio yaliyo wazi",
  todayOpenPlan: "Fungua mpango wa leo",
  todayBuildSprint: "Tengeneza sprint yangu ya siku 7",
  todayAsk: "Uliza FORGE nifanye nini",

  // Ask FORGE
  askForge: "Uliza FORGE",
  askForgeLead:
    "Uliza chochote kuhusu mawazo yako, ripoti au hatua zinazofuata. FORGE inatumia wasifu wako, ripoti za mawakala wake, majaribio yako na sprint yako, na hutafuta mtandaoni inapohitajika.",
  askForgeAbout: (title: string) => `Tunazungumzia: ${title}`,
  askForgeAllIdeas: "Mawazo yangu yote",
  askForgeFocus: "Lengo",
  askForgePlaceholder: "Uliza swali, eleza wasiwasi, au omba FORGE ikueleze jambo...",
  askForgeSend: "Tuma",
  askForgeThinking: "FORGE inafikiri...",
  askForgeThinkingLong: "FORGE inakagua mtandaoni...",
  askForgeClear: "Futa mazungumzo",
  askForgeClearConfirm: "Ufute mazungumzo yote haya? Hili haliwezi kurudishwa.",
  askForgeFailed: (msg: string) => `FORGE haikuweza kujibu (${msg}).`,
  askForgeRetry: "Tuma tena",
  askForgeSources: "Vyanzo",
  askForgeViaTelegram: "kupitia Telegram",
  askForgeUnavailable: "Uliza FORGE inafanya kazi kwenye toleo la mtandaoni la FORGE pekee.",
  askForgeSuggestions: [
    "Nifanye nini leo?",
    "Nieleze alama yangu kwa maneno rahisi",
    "Hatari kubwa zaidi ya wazo langu ni ipi, na naijaribu vipi kwa gharama ndogo?",
    "Nasajili vipi biashara Tanzania?",
  ],
  actionRunAnalysis: "Jaribu wazo hili",
  actionOpenIdea: (title: string) => `Fungua “${title}”`,
  actionBuildSprint: (title: string) => `Tengeneza sprint ya “${title}”`,
  actionEditProfile: "Sasisha wasifu wangu",
  askAboutIdea: "Uliza FORGE",

  // Telegram
  telegramHeading: "FORGE kwenye Telegram",
  telegramLead:
    "Pata muhtasari mfupi kila asubuhi saa 1:00 wenye kazi za leo za sprint, na uliza FORGE maswali moja kwa moja kutoka Telegram.",
  telegramConnect: "Unganisha Telegram",
  telegramOpening: "Inaandaa kiungo chako...",
  telegramWaiting: "Telegram imefunguka kwenye kichupo kipya. Bonyeza Start kwenye mazungumzo na bot ya FORGE ili kumaliza kuunganisha.",
  telegramOpenAgain: "Fungua Telegram tena",
  telegramConnected: "Imeunganishwa",
  telegramBrief: "Muhtasari wa asubuhi",
  telegramBriefOn: "Umewashwa",
  telegramBriefOff: "Umezimwa",
  telegramDisconnect: "Tenganisha",
  telegramFailed: (msg: string) => `Imeshindwa kuunganisha Telegram (${msg}).`,
};

const DICTIONARIES: Record<Language, Dictionary> = { en, sw };

function initialLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    if (stored === "en" || stored === "sw") return stored;
  } catch {
    // Storage blocked; fall back to the browser language.
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("sw")
    ? "sw"
    : "en";
}

interface I18nValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Dictionary;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLanguage);
  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // The choice still applies for this visit.
    }
    document.documentElement.lang = next;
  }, []);
  const value = useMemo(
    () => ({ lang, setLang, t: DICTIONARIES[lang] }),
    [lang, setLang]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside LanguageProvider");
  return value;
}

/** Two-button English / Kiswahili switch. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useI18n();
  const options: Array<[Language, string, string]> = [
    ["en", "EN", "English"],
    ["sw", "SW", "Kiswahili"],
  ];
  return (
    <div
      role="group"
      aria-label="Language / Lugha"
      className={`inline-flex shrink-0 rounded-lg border border-[#DFDED8] bg-white p-0.5 ${className}`}
    >
      {options.map(([code, short, full]) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          title={full}
          onClick={() => setLang(code)}
          className={`min-h-[32px] min-w-[40px] cursor-pointer rounded-md px-2 font-mono text-xs font-semibold transition-colors ${
            lang === code
              ? "bg-[#18181B] text-white"
              : "text-[#575752] hover:text-[#18181B]"
          }`}
        >
          {short}
        </button>
      ))}
    </div>
  );
}
