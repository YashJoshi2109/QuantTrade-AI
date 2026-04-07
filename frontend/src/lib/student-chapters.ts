/**
 * QuantTrade Life — Student Stage: "The Apprentice of Ashmarket"
 * 18 chapters (Stage 1: ch1-ch10 Apprentice, Stage 2: ch11-ch18 Young Merchant)
 */

export type ChapterStatus = 'locked' | 'available' | 'active' | 'completed'
export type MechanicType =
  | 'market_sell'
  | 'ledger_review'
  | 'savings_goal'
  | 'vault_deposit'
  | 'emergency_fund'
  | 'loan_compare'
  | 'trust_check'
  | 'asset_buy'
  | 'allocation_wheel'
  | 'graduation'

export interface NpcLine {
  npc: string
  avatar: string
  emotion: 'neutral' | 'happy' | 'warning' | 'wise' | 'suspicious'
  text: string
}

export interface Choice {
  id: string
  label: string
  description: string
  goldDelta: number
  savingsDelta: number
  emergencyDelta: number
  debtDelta: number
  xpReward: number
  isOptimal: boolean
  consequence: string
  lesson: string
}

export interface MarketSellConfig {
  items: Array<{ name: string; emoji: string; qty: number; basePrice: number }>
  stalls: Array<{ name: string; bonus: number; description: string }>
  costs: Array<{ label: string; amount: number }>
}

export interface LedgerReviewConfig {
  entries: Array<{ label: string; amount: number; category: 'need' | 'want' | 'earn' }>
  challengeDays: number
}

export interface SavingsGoalConfig {
  targetLabel: string
  targetAmount: number
  dailySalary: number
  temptations: Array<{ label: string; cost: number; emoji: string }>
  deadlineDays: number
}

export interface LoanCompareConfig {
  amount: number
  options: Array<{ label: string; rate: number; term: number; isGood: boolean; emoji: string; description?: string }>
}

export interface TrustCheckConfig {
  scams: Array<{
    pitch: string
    redFlags: string[]
    verdict: 'scam' | 'legit'
    explanation: string
  }>
}

export interface AssetBuyConfig {
  asset: string
  emoji: string
  unitCost: number
  maxUnits: number
  seasons: Array<{ label: string; returnPct: number; emoji: string }>
}

export interface AllocateConfig {
  totalGold: number
  buckets: Array<{ id: string; label: string; emoji: string; riskLabel: string; color: string }>
}

export interface Chapter {
  id: string
  number: number
  title: string
  subtitle: string
  location: string
  buildingKey: string
  npc: string
  npcAvatar: string
  npcColor: string
  storyLines: NpcLine[]
  lesson: string
  xpReward: number
  goldReward: number
  mechanicType: MechanicType
  mechanicConfig:
    | MarketSellConfig
    | LedgerReviewConfig
    | SavingsGoalConfig
    | LoanCompareConfig
    | TrustCheckConfig
    | AssetBuyConfig
    | AllocateConfig
    | Record<string, unknown>
  choices: Choice[]
  completionSummary: string
}

// ─── All 10 Chapters ─────────────────────────────────────────────────────────

export const CHAPTERS: Chapter[] = [
  {
    id: 'ch1',
    number: 1,
    title: 'First Coin',
    subtitle: 'The Market Day Trial',
    location: 'Ashmarket Docks',
    buildingKey: 'harbor',
    npc: 'Merchant Rafiq',
    npcAvatar: '🧔',
    npcColor: '#C27B2A',
    storyLines: [
      {
        npc: 'Merchant Rafiq',
        avatar: '🧔',
        emotion: 'happy',
        text: "Ahh, young apprentice! My spice boat just arrived from the eastern shores. Help me sort, price and sell these goods at market. You keep a share of the profit!",
      },
      {
        npc: 'Town Crier',
        avatar: '📣',
        emotion: 'neutral',
        text: "Hear ye! The noble quarter craves pepper and cinnamon today. The fishermen's row wants ginger. Choose your stall wisely!",
      },
      {
        npc: 'Merchant Rafiq',
        avatar: '🧔',
        emotion: 'wise',
        text: "Remember — selling at the right place matters as much as the price. And don't forget to set aside coin for food and tools. What you keep is more important than what you earn.",
      },
    ],
    lesson: 'Gross income minus expenses = net income. Earning is not the same as keeping.',
    xpReward: 120,
    goldReward: 18,
    mechanicType: 'market_sell',
    mechanicConfig: {
      items: [
        { name: 'Pepper', emoji: '🫙', qty: 5, basePrice: 4 },
        { name: 'Cinnamon', emoji: '🪵', qty: 3, basePrice: 6 },
        { name: 'Ginger', emoji: '🫚', qty: 4, basePrice: 3 },
      ],
      stalls: [
        { name: 'Noble Quarter', bonus: 1.4, description: 'High demand for pepper & cinnamon today' },
        { name: 'Market Centre', bonus: 1.0, description: 'Steady demand, fair prices' },
        { name: "Fishermen's Row", bonus: 0.8, description: 'Low prices, but ginger sells well here' },
      ],
      costs: [
        { label: 'Food for the day', amount: 3 },
        { label: 'Cart rental', amount: 2 },
        { label: 'Market stall fee', amount: 1 },
      ],
    } as MarketSellConfig,
    choices: [
      {
        id: 'save_all',
        label: 'Save all net earnings',
        description: 'Put every remaining coin into your savings pouch',
        goldDelta: 0,
        savingsDelta: 12,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 40,
        isOptimal: true,
        consequence: 'Wise! You end the day with 12 silver saved. Small habits compound.',
        lesson: 'Saving first, spending second — the foundation of all wealth.',
      },
      {
        id: 'spend_treats',
        label: 'Celebrate with a feast',
        description: 'You earned it! Spend 8 coins on a hot meal and sweet pastries',
        goldDelta: 4,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 10,
        isOptimal: false,
        consequence: 'The pastries were delicious. But you only kept 4 coins. Impulse wins today.',
        lesson: 'Small pleasures feel big in the moment. They delay big goals invisibly.',
      },
      {
        id: 'split',
        label: 'Split: save 8, keep 4',
        description: 'A balanced approach — save most, enjoy a little',
        goldDelta: 4,
        savingsDelta: 8,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 25,
        isOptimal: false,
        consequence: "Reasonable balance. You're learning — both your purse and your spirit are satisfied.",
        lesson: 'Balance is good, but in early stages, maximum savings builds momentum faster.',
      },
    ],
    completionSummary: "You completed your first market day! Merchant Rafiq nods with approval. 'You have the instincts of a trader, young one. Return tomorrow.'",
  },

  {
    id: 'ch2',
    number: 2,
    title: 'The Missing Coins',
    subtitle: 'Where Did the Money Go?',
    location: 'Family Ledger Room',
    buildingKey: 'home',
    npc: 'Mother Elara',
    npcAvatar: '👩',
    npcColor: '#9B6A3A',
    storyLines: [
      {
        npc: 'Mother Elara',
        avatar: '👩',
        emotion: 'warning',
        text: "You said you earned 22 coins this week. But we have only 6 in the jar. Where did the rest go, child?",
      },
      {
        npc: 'Guild Tutor Sera',
        avatar: '📚',
        emotion: 'wise',
        text: "Let us open your ledger together. Every coin you spent is a story. Let's read what story you've been living.",
      },
    ],
    lesson: 'Track every coin. Small leaks — wants pretending to be needs — quietly drain savings.',
    xpReward: 100,
    goldReward: 8,
    mechanicType: 'ledger_review',
    mechanicConfig: {
      entries: [
        { label: 'Market earnings', amount: 22, category: 'earn' },
        { label: 'Bread and water', amount: -3, category: 'need' },
        { label: 'Tool sharpening', amount: -2, category: 'need' },
        { label: 'Sweet pastries (×3)', amount: -6, category: 'want' },
        { label: 'Better boots (impulse)', amount: -4, category: 'want' },
        { label: 'Festival game tokens', amount: -1, category: 'want' },
      ],
      challengeDays: 3,
    } as LedgerReviewConfig,
    choices: [
      {
        id: 'cut_wants',
        label: 'Cut all wants for 3 days',
        description: "No treats, no extras. Every coin goes to savings. It'll be hard.",
        goldDelta: 0,
        savingsDelta: 11,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 50,
        isOptimal: true,
        consequence: 'Three days of discipline. Your ledger glows green. Mother smiles.',
        lesson: 'The ledger does not lie. Awareness is the first step to change.',
      },
      {
        id: 'reduce_some',
        label: 'Cut half the extras',
        description: 'Keep one small pleasure, eliminate the rest',
        goldDelta: 2,
        savingsDelta: 6,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 25,
        isOptimal: false,
        consequence: 'Partial progress. Better than yesterday. Not yet fully in control.',
        lesson: 'Partial discipline is real progress — but tracking is always step one.',
      },
    ],
    completionSummary: 'Your ledger is now organized into three columns: Earn, Need, Want. The pattern becomes visible. You will never look at spending the same way.',
  },

  {
    id: 'ch3',
    number: 3,
    title: 'The Family Roof',
    subtitle: 'Saving With Purpose',
    location: 'Family Home',
    buildingKey: 'home',
    npc: 'Father Aldric',
    npcAvatar: '👨',
    npcColor: '#7B4A2A',
    storyLines: [
      {
        npc: 'Father Aldric',
        avatar: '👨',
        emotion: 'warning',
        text: "The storm last night tore three tiles off the north roof. If it's not fixed before winter, we lose the whole house to rot. We need 60 silver — and winter comes in 10 days.",
      },
      {
        npc: 'Guild Tutor Sera',
        avatar: '📚',
        emotion: 'wise',
        text: "Set your goal. Work backward from the deadline. Every day of spending on wants is a day stolen from your family's safety.",
      },
    ],
    lesson: 'Saving is not abstract — it equals safety, dignity, and a warm home. Goal-based saving is the most powerful kind.',
    xpReward: 150,
    goldReward: 0,
    mechanicType: 'savings_goal',
    mechanicConfig: {
      targetLabel: 'Roof Repair Fund',
      targetAmount: 60,
      dailySalary: 12,
      deadlineDays: 10,
      temptations: [
        { label: 'Festival vendor stall', cost: 8, emoji: '🎪' },
        { label: 'New leather satchel', cost: 6, emoji: '👜' },
        { label: 'Warm spiced wine', cost: 2, emoji: '🍷' },
        { label: 'Inn room (vs camping)', cost: 5, emoji: '🛏️' },
      ],
    } as SavingsGoalConfig,
    choices: [
      {
        id: 'strict_save',
        label: 'Save 10 silver each day',
        description: 'Bare minimum on food, no extras. Goal reached in 6 days with 4 days buffer.',
        goldDelta: 0,
        savingsDelta: 60,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 60,
        isOptimal: true,
        consequence: 'The roof is fixed. Father quietly squeezes your shoulder. No words needed.',
        lesson: 'A named goal makes saving real. The Roof Meter turning green is the most powerful motivator.',
      },
      {
        id: 'slow_save',
        label: 'Save 5 silver each day',
        description: 'Keep some fun. But the roof goal takes 12 days — missing the deadline.',
        goldDelta: 12,
        savingsDelta: 48,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 15,
        isOptimal: false,
        consequence: 'You arrive 2 silver short when winter hits. Emergency repairs cost double.',
        lesson: 'Deadlines are real. Delay has a price.',
      },
    ],
    completionSummary: 'The roof is repaired. Standing outside in the cold night air, you look up at the patched tiles. This is what money is for.',
  },

  {
    id: 'ch4',
    number: 4,
    title: 'The Guild Vault',
    subtitle: 'Why Banks Exist',
    location: 'Guild Vault',
    buildingKey: 'guild_vault',
    npc: 'Master Elowen',
    npcAvatar: '🏦',
    npcColor: '#3A5F8A',
    storyLines: [
      {
        npc: 'Neighbor Bram',
        avatar: '👴',
        emotion: 'warning',
        text: "Thief broke into my cottage last night. Took every coin I had hidden under the floorboards. Everything. Gone.",
      },
      {
        npc: 'Master Elowen',
        avatar: '🏦',
        emotion: 'wise',
        text: "The Guild Vault has protected this town's wealth for 200 years. Your coins earn a small yield here, and they are safe from fire, flood, and thievery. The cost? You cannot spend them instantly — there is a half-day delay to withdraw.",
      },
      {
        npc: 'Master Elowen',
        avatar: '🏦',
        emotion: 'neutral',
        text: "The question every wise person must answer: how much do I keep accessible, and how much do I keep safe and growing?",
      },
    ],
    lesson: 'Banks (Guild Vaults) provide safety, interest, and discipline. Liquidity costs something. That trade-off is worth understanding.',
    xpReward: 110,
    goldReward: 5,
    mechanicType: 'vault_deposit',
    mechanicConfig: {
      totalGold: 40,
      vaultOptions: [
        {
          label: 'Keep all at home',
          vaultPct: 0,
          interestMonthly: 0,
          riskLabel: 'High theft risk',
          emoji: '🏠',
        },
        {
          label: 'Split: half home, half vault',
          vaultPct: 50,
          interestMonthly: 2,
          riskLabel: 'Moderate safety',
          emoji: '⚖️',
        },
        {
          label: 'Vault everything',
          vaultPct: 100,
          interestMonthly: 4,
          riskLabel: 'Fully protected',
          emoji: '🔒',
        },
      ],
    },
    choices: [
      {
        id: 'full_vault',
        label: 'Deposit everything in the Vault',
        description: 'Maximum safety, 4 silver interest per month, half-day withdrawal delay',
        goldDelta: 0,
        savingsDelta: 4,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 50,
        isOptimal: true,
        consequence: "Master Elowen stamps your deposit ledger. 'A prudent choice. Your coins now earn coins of their own.'",
        lesson: 'Stored money can earn money. This is the seed of compound growth.',
      },
      {
        id: 'half_vault',
        label: 'Keep half, vault half',
        description: 'Good safety with some liquid access',
        goldDelta: 20,
        savingsDelta: 2,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 30,
        isOptimal: false,
        consequence: "A reasonable balance. You sleep better knowing half is protected.",
        lesson: 'Liquidity and safety are both real needs. Balance them consciously.',
      },
      {
        id: 'keep_home',
        label: 'Keep everything at home',
        description: "Full access anytime, but no interest and real theft risk",
        goldDelta: 40,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 5,
        isOptimal: false,
        consequence: "Three days later, a fire in the neighboring house spreads. You lose 15 coins in the chaos.",
        lesson: 'Unprotected money is vulnerable. Convenience has a hidden cost.',
      },
    ],
    completionSummary: "Master Elowen hands you a small leather book. 'This is your Steward's Ledger. Every deposit, every yield, every withdrawal — recorded here. This is how wealth is built: one entry at a time.'",
  },

  {
    id: 'ch5',
    number: 5,
    title: 'The Broken Cart',
    subtitle: 'Emergency Fund',
    location: 'Delivery Route',
    buildingKey: 'town_square',
    npc: 'Stable Boy Finn',
    npcAvatar: '🐴',
    npcColor: '#8B5A2B',
    storyLines: [
      {
        npc: 'Stable Boy Finn',
        avatar: '🐴',
        emotion: 'warning',
        text: "Your cart wheel just snapped on the north road. The delivery is stranded. Without a working cart, you earn nothing today — and possibly tomorrow too.",
      },
      {
        npc: 'Guild Tutor Sera',
        avatar: '📚',
        emotion: 'wise',
        text: "This is why the wise keep a Winter Reserve — coins set aside for exactly this kind of shock. Do you have one?",
      },
    ],
    lesson: 'An emergency fund is not idle money — it is income insurance. Without it, one shock becomes a spiral.',
    xpReward: 130,
    goldReward: 10,
    mechanicType: 'emergency_fund',
    mechanicConfig: {
      repairCost: 15,
      daysMissedWithoutFund: 3,
      earningsPerDay: 12,
      borrowCostPerDay: 4,
    },
    choices: [
      {
        id: 'use_emergency',
        label: 'Use your Winter Reserve',
        description: "Pay 15 coins from your emergency fund. Back to work tomorrow.",
        goldDelta: -15,
        savingsDelta: 0,
        emergencyDelta: -15,
        debtDelta: 0,
        xpReward: 60,
        isOptimal: true,
        consequence: "Cart repaired by midday. You lose one afternoon but earn again by dusk. Emergency fund did its job.",
        lesson: "An emergency fund is not money wasted — it is peace of mind purchased in advance.",
      },
      {
        id: 'borrow',
        label: 'Borrow from the inn keeper',
        description: '15 coins at 4 silver/day interest. The longer it takes to repay, the worse it gets.',
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 15,
        xpReward: 10,
        isOptimal: false,
        consequence: "The debt grows. Three days of delivery earnings go entirely to repayment. You fall behind on the roof reserve.",
        lesson: "Borrowing for emergencies is expensive. Being prepared is always cheaper.",
      },
      {
        id: 'wait',
        label: 'Wait for Father to send coins',
        description: 'Three days lost. No income, no cart.',
        goldDelta: -36,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 5,
        isOptimal: false,
        consequence: "You lose 3 days of income = 36 coins missed. The delivery contract is reassigned to another runner.",
        lesson: "The cost of not having an emergency fund is always higher than building one.",
      },
    ],
    completionSummary: "From today, your savings pouch splits into three labeled sections: Spending Pouch, Goal Chest, and Winter Reserve. You will never mix them again.",
  },

  {
    id: 'ch6',
    number: 6,
    title: "The Loan Shark's Offer",
    subtitle: 'Good Debt vs Bad Debt',
    location: 'Shady Alley',
    buildingKey: 'shady_alley',
    npc: 'Street Peddler Varn',
    npcAvatar: '🦹',
    npcColor: '#3A2A5A',
    storyLines: [
      {
        npc: 'Street Peddler Varn',
        avatar: '🦹',
        emotion: 'suspicious',
        text: "Psst. You look like you could use some quick coins, apprentice. I lend 30 silver today — you repay 45 by the week's end. Simple, yes?",
      },
      {
        npc: 'Master Elowen',
        avatar: '🏦',
        emotion: 'warning',
        text: "That rate is 50% in seven days — equivalent to thousands of percent annually. Compare it to the Guild's fair loan: 30 silver, repay 33 over 30 days. The difference is everything.",
      },
      {
        npc: 'Street Peddler Varn',
        avatar: '🦹',
        emotion: 'suspicious',
        text: "The Guild takes forever! My deal is fast. And what's 15 extra silver between friends, hmm?",
      },
    ],
    lesson: 'Compare loan costs before borrowing. The interest rate and term determine how expensive debt truly is.',
    xpReward: 140,
    goldReward: 5,
    mechanicType: 'loan_compare',
    mechanicConfig: {
      amount: 30,
      options: [
        {
          label: 'No loan',
          rate: 0,
          term: 0,
          isGood: true,
          emoji: '🚫',
          description: 'Avoid debt entirely — find another way',
        },
        {
          label: 'Guild Fair Loan',
          rate: 10,
          term: 30,
          isGood: true,
          emoji: '🏛️',
          description: '30 silver, repay 33 over 30 days. Fair and transparent.',
        },
        {
          label: "Varn's Street Loan",
          rate: 50,
          term: 7,
          isGood: false,
          emoji: '🦹',
          description: '30 silver, repay 45 in 7 days. Every delay adds more.',
        },
      ],
    } as LoanCompareConfig,
    choices: [
      {
        id: 'no_loan',
        label: 'Refuse all loans',
        description: 'Find another solution — work extra shifts, ask family',
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 60,
        isOptimal: true,
        consequence: "You work two extra evening shifts instead. Harder, but no debt chains attached.",
        lesson: "The best loan is the one never taken. If you can earn your way out, do it.",
      },
      {
        id: 'guild_loan',
        label: 'Take the Guild fair loan',
        description: 'Reasonable terms, transparent cost',
        goldDelta: 30,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 33,
        xpReward: 35,
        isOptimal: false,
        consequence: "A fair arrangement. You repay 33 silver over 30 days — 3 silver fee for the convenience.",
        lesson: "Good debt has clear terms, fair rates, and a repayment plan you can follow.",
      },
      {
        id: 'street_loan',
        label: "Take Varn's street loan",
        description: 'Fast cash, brutal terms',
        goldDelta: 30,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 45,
        xpReward: 5,
        isOptimal: false,
        consequence: "You repay 45 silver in 7 days. Your next 3 market days go entirely to Varn. Every copper watched.",
        lesson: "High-interest debt is a trap. The lender profits more than you ever can.",
      },
    ],
    completionSummary: "Varn slinks back into the shadow. You've learned to read debt like a weapon — sometimes useful, often dangerous, always costly.",
  },

  {
    id: 'ch7',
    number: 7,
    title: 'The Counterfeit Coin Scam',
    subtitle: 'Fraud and Financial Safety',
    location: 'Market Centre',
    buildingKey: 'market',
    npc: 'Suspicious Trader',
    npcAvatar: '🎭',
    npcColor: '#5A3A2A',
    storyLines: [
      {
        npc: 'Suspicious Trader',
        avatar: '🎭',
        emotion: 'suspicious',
        text: "Friend! Rare opportunity — I've secured a batch of 'enchanted' silver coins that double in value each moon. Just 20 silver entry. Only 3 spots left!",
      },
      {
        npc: 'Guild Tutor Sera',
        avatar: '📚',
        emotion: 'warning',
        text: "Before you hand over a single coin — use the Trust Check. Four questions. If any answer is 'no', walk away.",
      },
    ],
    lesson: 'Any offer that guarantees returns, creates urgency, or obscures risk is a scam. The Trust Check catches them all.',
    xpReward: 120,
    goldReward: 10,
    mechanicType: 'trust_check',
    mechanicConfig: {
      scams: [
        {
          pitch: '"Enchanted coins that double every moon! Only 20 silver entry."',
          redFlags: [
            'Guaranteed doubling (unrealistic)',
            'Urgency: only 3 spots left',
            'No verifiable track record',
            'Promise exceeds all normal yields',
          ],
          verdict: 'scam',
          explanation: "Guaranteed doubling is impossible in any real market. This is a classic 'too good to be true' scheme.",
        },
        {
          pitch: '"Invest in the Guild Vault\'s 6-month Treasury Bond. 8% yield, backed by guild seal."',
          redFlags: [],
          verdict: 'legit',
          explanation: 'Reasonable yield, verifiable issuer, transparent terms. This is a legitimate financial instrument.',
        },
        {
          pitch: '"Send 10 silver to unlock your inheritance from a foreign nobleman. Get 500 back!"',
          redFlags: [
            'Unknown sender with grand promise',
            'Must send money first',
            'No way to verify claim',
            'Story designed to create greed',
          ],
          verdict: 'scam',
          explanation: 'The "advance fee" fraud. You pay upfront; they vanish. The inheritance never existed.',
        },
      ],
    } as TrustCheckConfig,
    choices: [
      {
        id: 'reject_scam',
        label: 'Reject the offer — walk away',
        description: 'The Trust Check failed all four criteria',
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 60,
        isOptimal: true,
        consequence: "Three days later, town guards arrest the trader. Four merchants lost everything.",
        lesson: "The Trust Check saved you. Verification is always worth the discomfort of saying no.",
      },
      {
        id: 'invest_scam',
        label: 'Invest 20 silver',
        description: "The pitch sounds exciting. You hand over the coins.",
        goldDelta: -20,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 5,
        isOptimal: false,
        consequence: "The trader disappears overnight. Your 20 silver is gone. You feel sick.",
        lesson: "Greed blinds judgment. If it sounds too good to be true — it always is.",
      },
    ],
    completionSummary: "Guild Tutor Sera pins the Trust Check to your satchel. Four questions, every time: Source verified? Return realistic? Risk explained? Exit possible? These four questions are a shield.",
  },

  {
    id: 'ch8',
    number: 8,
    title: 'The Mill Share',
    subtitle: 'First Ownership',
    location: 'Grain Mill',
    buildingKey: 'grain_mill',
    npc: 'Miller Oswin',
    npcAvatar: '⚙️',
    npcColor: '#6B4423',
    storyLines: [
      {
        npc: 'Miller Oswin',
        avatar: '⚙️',
        emotion: 'neutral',
        text: "The town mill needs new grinding stones. I'm offering citizens a chance to contribute coin and earn a share of our harvest profits. It's not wages — it's ownership.",
      },
      {
        npc: 'Guild Tutor Sera',
        avatar: '📚',
        emotion: 'wise',
        text: "When you own part of something that produces value, you earn when it earns — even while you sleep. But ownership carries risk. A poor harvest means smaller returns.",
      },
      {
        npc: 'Miller Oswin',
        avatar: '⚙️',
        emotion: 'neutral',
        text: "Each Mill Share costs 5 silver. You can buy up to 4. At harvest, each share earns 1–3 silver depending on the season. There are no guarantees.",
      },
    ],
    lesson: 'Ownership means sharing in profits AND risk. Unlike wages, returns vary. This is the essence of investing.',
    xpReward: 150,
    goldReward: 0,
    mechanicType: 'asset_buy',
    mechanicConfig: {
      asset: 'Mill Share',
      emoji: '⚙️',
      unitCost: 5,
      maxUnits: 4,
      seasons: [
        { label: 'Bountiful harvest', returnPct: 60, emoji: '🌾' },
        { label: 'Normal season', returnPct: 30, emoji: '🌿' },
        { label: 'Poor harvest', returnPct: 0, emoji: '🌧️' },
      ],
    } as AssetBuyConfig,
    choices: [
      {
        id: 'buy_4',
        label: 'Buy 4 Mill Shares (20 silver)',
        description: 'Full investment — maximum potential return',
        goldDelta: -20,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 60,
        isOptimal: true,
        consequence: "Bountiful harvest this year. Each share yields 8 silver. You earn 32 silver on your 20 investment — a 60% return.",
        lesson: "Productive assets earn money while you work on other things. This is the power of ownership.",
      },
      {
        id: 'buy_2',
        label: 'Buy 2 Mill Shares (10 silver)',
        description: 'Cautious first investment',
        goldDelta: -10,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 35,
        isOptimal: false,
        consequence: "You invest 10, earn 16 at harvest. Conservative but smart for a first investment.",
        lesson: "Starting small to learn is wise. The important thing is starting.",
      },
      {
        id: 'no_buy',
        label: 'Skip — too risky',
        description: "Keep all coins in the vault where it's 'safe'",
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 5,
        isOptimal: false,
        consequence: "You watch Miller Oswin's investors celebrate the bountiful harvest. You kept your coins safe — and missed the growth.",
        lesson: "Avoiding all risk is itself a risk. Money that doesn't grow slowly loses value.",
      },
    ],
    completionSummary: "You hold a small rolled parchment — your Mill Share certificate. The first thing you have ever truly owned. It feels different from wages.",
  },

  {
    id: 'ch9',
    number: 9,
    title: 'Diversify or Regret',
    subtitle: 'One Basket, Many Eggs',
    location: 'Guild Hall',
    buildingKey: 'guild_hall',
    npc: 'Guild Tutor Sera',
    npcAvatar: '📚',
    npcColor: '#3A6A4A',
    storyLines: [
      {
        npc: 'Guild Tutor Sera',
        avatar: '📚',
        emotion: 'warning',
        text: "Terrible news from the eastern roads. A pest outbreak destroyed this season's grain route. Three apprentices had all their coins in the Mill — they've lost everything.",
      },
      {
        npc: 'Guild Tutor Sera',
        avatar: '📚',
        emotion: 'wise',
        text: "The wise merchant never travels with all goods on one cart. Spread your coins across different places. When one falls, the others hold you up.",
      },
    ],
    lesson: "Concentration risk is real. Diversification reduces the chance that any one loss destroys everything.",
    xpReward: 130,
    goldReward: 8,
    mechanicType: 'allocation_wheel',
    mechanicConfig: {
      totalGold: 60,
      buckets: [
        { id: 'vault', label: 'Guild Vault', emoji: '🏦', riskLabel: 'Safe, low yield', color: '#3A5F8A' },
        { id: 'mill', label: 'Mill Shares', emoji: '⚙️', riskLabel: 'Medium risk, good yield', color: '#6B4423' },
        { id: 'tools', label: 'Delivery Tools', emoji: '🛠️', riskLabel: 'Productive, earns income', color: '#2A6A4A' },
        { id: 'stall', label: 'Market Stall Upgrade', emoji: '🏪', riskLabel: 'Competitive, needs skill', color: '#C27B2A' },
      ],
    } as AllocateConfig,
    choices: [
      {
        id: 'diversify',
        label: 'Spread across all four buckets',
        description: '15 silver each: Vault, Mill, Tools, Stall',
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 55,
        isOptimal: true,
        consequence: "The pest hits the mill. You lose your 15 mill-share income. But tools and vault hold. You are down but not out.",
        lesson: "Diversification doesn't prevent loss — it prevents total loss.",
      },
      {
        id: 'all_mill',
        label: 'Put everything in Mill Shares',
        description: "Last season was great — it'll be great again!",
        goldDelta: -60,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 5,
        isOptimal: false,
        consequence: "The pest outbreak destroys this season. You lose all 60 silver. Starting over.",
        lesson: "Past performance does not guarantee future results. Concentration risk is brutal.",
      },
    ],
    completionSummary: "You now see your Holdings Ledger differently — not as a single number, but as a collection of independent bets, each protecting the others.",
  },

  {
    id: 'ch10',
    number: 10,
    title: 'Trade Academy Entrance',
    subtitle: 'Graduate the Student Stage',
    location: 'Trade Academy',
    buildingKey: 'academy',
    npc: 'Headmaster Aldus',
    npcAvatar: '🎓',
    npcColor: '#C9A84C',
    storyLines: [
      {
        npc: 'Headmaster Aldus',
        avatar: '🎓',
        emotion: 'wise',
        text: "So — you wish to enter the Trade Academy. Every year a hundred apprentices apply. We accept only those who have already proven themselves in the real world.",
      },
      {
        npc: 'Headmaster Aldus',
        avatar: '🎓',
        emotion: 'neutral',
        text: "Show me your record. The roof repaired, the vault opened, the scam rejected, the mill owned, the portfolio diversified. Have you done all this?",
      },
      {
        npc: 'Guild Tutor Sera',
        avatar: '📚',
        emotion: 'happy',
        text: "I vouch for this apprentice, Headmaster. I have watched them grow from their first coin to a true steward of silver. They are ready.",
      },
    ],
    lesson: 'Financial mastery is a practice, not a moment. The student stage ends — but the learning compounds forever.',
    xpReward: 250,
    goldReward: 25,
    mechanicType: 'graduation',
    mechanicConfig: {
      requirements: [
        { label: 'Roof repaired', chapterId: 'ch3', emoji: '🏠' },
        { label: 'Guild Vault opened', chapterId: 'ch4', emoji: '🏦' },
        { label: 'Scam rejected', chapterId: 'ch7', emoji: '🛡️' },
        { label: 'Mill share owned', chapterId: 'ch8', emoji: '⚙️' },
        { label: 'Portfolio diversified', chapterId: 'ch9', emoji: '📊' },
        { label: 'Emergency fund maintained', chapterId: 'ch5', emoji: '❄️' },
      ],
    },
    choices: [
      {
        id: 'enter_academy',
        label: 'Enter the Trade Academy',
        description: "You've earned it. A new stage begins.",
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 100,
        isOptimal: true,
        consequence: "The great gates of the Trade Academy swing open. Beyond them: markets, caravans, brokerages, and the whole world of finance awaits.",
        lesson: "Every expert was once an apprentice. The student stage is complete. The journey is just beginning.",
      },
    ],
    completionSummary: "You step through the gates of the Trade Academy. Behind you, Ashmarket shimmers in the morning light. Ahead: College Life and a world far larger than you imagined.",
  },

  // ─── Stage 2: Young Merchant — "The Trade Academy Years" ─────────────────

  {
    id: 'ch11',
    number: 11,
    title: "The Tax Collector's Visit",
    subtitle: 'Gross vs Net Income',
    location: 'Counting House',
    buildingKey: 'counting_house',
    npc: 'Tax Clerk Petyr',
    npcAvatar: '📋',
    npcColor: '#4A6A4A',
    storyLines: [
      {
        npc: 'Tax Clerk Petyr',
        avatar: '📋',
        emotion: 'neutral',
        text: "Welcome to the Counting House, young merchant. You earned well this season — 80 silver. But before you celebrate, the realm takes its share. Every working citizen owes a portion of earnings to the treasury.",
      },
      {
        npc: 'Tax Clerk Petyr',
        avatar: '📋',
        emotion: 'wise',
        text: "The realm's rate is 20%. So out of your 80 silver gross income, 16 silver goes to the crown. That leaves you 64 silver net. Your budget must start from 64 — not 80.",
      },
      {
        npc: 'Senior Merchant',
        avatar: '🧓',
        emotion: 'wise',
        text: "I hated taxes too, once. Then I realised they fund the roads I trade on, the guards who protect my caravans, the courts that enforce my contracts. They are the price of a working civilization.",
      },
    ],
    lesson: 'Net income = Gross income − Taxes. Always budget from your net, not your gross. Tax planning — setting aside funds before you spend — prevents the shock when the bill arrives.',
    xpReward: 130,
    goldReward: 0,
    mechanicType: 'ledger_review',
    mechanicConfig: {
      entries: [
        { label: 'Market season earnings', amount: 80, category: 'earn' },
        { label: 'Realm income tax (20%)', amount: -16, category: 'need' },
        { label: 'Food and lodging', amount: -8, category: 'need' },
        { label: 'Tool maintenance', amount: -4, category: 'need' },
        { label: 'Festival celebration', amount: -12, category: 'want' },
        { label: 'New cloak (impulse)', amount: -7, category: 'want' },
      ],
      challengeDays: 3,
    } as LedgerReviewConfig,
    choices: [
      {
        id: 'pay_full_now',
        label: 'Pay the full 16 silver tax today',
        description: 'Honest and immediate. Your record stays clean.',
        goldDelta: -16,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 50,
        isOptimal: true,
        consequence: "Petyr stamps PAID in green ink. 'Clean records earn merchant trust,' he says. Your credit history shows no delinquencies.",
        lesson: 'Paying obligations promptly builds financial credibility. Late taxes carry penalties that compound.',
      },
      {
        id: 'payment_plan',
        label: 'Ask for a monthly payment plan',
        description: '8 silver now, 8 silver next month — plus a small fee',
        goldDelta: -8,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 9,
        xpReward: 20,
        isOptimal: false,
        consequence: "Petyr agrees — at 12% interest on the deferred amount. You bought time, but it cost 1 extra silver. Convenience has a price.",
        lesson: 'Payment plans are useful when cash is tight but always cost more. Calculate the total cost before agreeing.',
      },
      {
        id: 'pay_and_plan',
        label: 'Pay taxes, then set aside 20% each week',
        description: 'Budget from net income going forward — proactively.',
        goldDelta: -16,
        savingsDelta: 10,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 40,
        isOptimal: false,
        consequence: "You pay and immediately deposit 10 silver into savings from your net take-home. Solid instincts — but the optimal choice tracks every category in a ledger.",
        lesson: 'Planning your net income budget immediately after receiving pay is a hallmark of financial discipline.',
      },
    ],
    completionSummary: "Petyr nods. 'Most young merchants leave here in shock. You leave here educated. That is rarer.' You understand gross versus net — the first rule of every real budget.",
  },

  {
    id: 'ch12',
    number: 12,
    title: 'The Credit Merchant',
    subtitle: 'Understanding APR & Credit History',
    location: 'Trading Post',
    buildingKey: 'trading_post',
    npc: 'Trade Broker Veda',
    npcAvatar: '💼',
    npcColor: '#3A5A7A',
    storyLines: [
      {
        npc: 'Trade Broker Veda',
        avatar: '💼',
        emotion: 'happy',
        text: "Good day! I help young merchants access capital to grow. We offer credit lines — but every option looks the same on the surface. The difference is in the rate.",
      },
      {
        npc: 'Trade Broker Veda',
        avatar: '💼',
        emotion: 'wise',
        text: "This lender charges 5% per year. That one charges 45%. You borrow 100 silver from both. But one costs you 5 silver a year and the other costs you 45. Same debt, very different reality.",
      },
      {
        npc: 'Old Merchant',
        avatar: '🧓',
        emotion: 'warning',
        text: "I borrowed at 40% once. Thought I'd repay quickly. Three years later I was still paying. Read the rate — it is the only number that matters in a loan.",
      },
    ],
    lesson: 'APR (Annual Percentage Rate) is the true cost of credit per year. A 5% APR on 100 silver costs 5 silver/year. A 45% APR costs 45. Always compare APR, not the loan amount.',
    xpReward: 140,
    goldReward: 10,
    mechanicType: 'loan_compare',
    mechanicConfig: {
      amount: 100,
      options: [
        { label: 'Guild Credit Line', rate: 5, term: 12, isGood: true, emoji: '🏦', description: 'Requires guild membership. Low rate, formal application.' },
        { label: 'Merchant Bank Loan', rate: 18, term: 6, isGood: false, emoji: '📜', description: 'Fast approval. Moderate rate. No guild required.' },
        { label: 'Street Moneylender', rate: 48, term: 3, isGood: false, emoji: '💸', description: 'Instant gold. No questions. Dangerous rates.' },
      ],
    } as LoanCompareConfig,
    choices: [
      {
        id: 'guild_credit',
        label: 'Apply for the Guild Credit Line (5% APR)',
        description: 'Low rate — but requires joining the guild. Worth the step.',
        goldDelta: 100,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 5,
        xpReward: 50,
        isOptimal: true,
        consequence: "Veda smiles. 'Smart. The 5-silver annual cost is the lowest on the market. Your guild membership also opens trade network access.'",
        lesson: 'The cheapest credit often requires the most effort to qualify for. That barrier protects borrowers from easy-access high-rate debt.',
      },
      {
        id: 'bank_loan',
        label: 'Take the Merchant Bank loan (18% APR)',
        description: 'Faster, easier — but costs 18 silver per year',
        goldDelta: 100,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 18,
        xpReward: 20,
        isOptimal: false,
        consequence: "Fast approval. You have the gold. But 18 silver per year is 3.6× the guild rate for the same 100 silver. Convenience has a real price.",
        lesson: 'Convenience premium: faster credit is almost always more expensive credit.',
      },
      {
        id: 'decline_credit',
        label: 'Decline — save up before borrowing',
        description: "No debt, no interest. Wait until you have the capital.",
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 30,
        isOptimal: false,
        consequence: "Prudent. You miss a trade opportunity this season but carry zero debt. Building capital organically is always valid — just slower.",
        lesson: "Avoiding debt entirely is valid. But good debt (low rate, productive use) can accelerate wealth-building when used deliberately.",
      },
    ],
    completionSummary: "Veda hands you a pamphlet titled 'The Cost of Money'. You now understand why two merchants can borrow the same amount and end up in completely different financial situations.",
  },

  {
    id: 'ch13',
    number: 13,
    title: 'Rent or Own Your Stall?',
    subtitle: 'The Build-vs-Rent Decision',
    location: 'Town Hall Registry',
    buildingKey: 'town_hall',
    npc: 'Town Scribe Aldric',
    npcAvatar: '📜',
    npcColor: '#5A4A2A',
    storyLines: [
      {
        npc: 'Town Scribe Aldric',
        avatar: '📜',
        emotion: 'neutral',
        text: "Two stalls are available in the market quarter. You may rent one for 8 silver per month. Or you may purchase the other for 120 silver — except you do not have 120 silver yet.",
      },
      {
        npc: 'Town Scribe Aldric',
        avatar: '📜',
        emotion: 'wise',
        text: "Here is the calculation: if you save 8 silver per month, you can buy in 15 months. During those 15 months, you would pay 8 silver per month to rent — also 120 silver total. Same cost. But one path ends with a deed you own.",
      },
      {
        npc: 'Elder Merchant',
        avatar: '🧓',
        emotion: 'happy',
        text: "I rented for 20 years before buying. The gold I paid in rent — gone. The deed I finally bought — worth four times what I paid. Every payment builds equity or builds someone else's wealth. Choose wisely.",
      },
    ],
    lesson: 'Renting provides flexibility but builds zero equity. Buying requires capital but creates ownership. Break-even point = when cumulative rent payments equal the purchase price.',
    xpReward: 140,
    goldReward: 5,
    mechanicType: 'savings_goal',
    mechanicConfig: {
      targetLabel: 'Market Stall Deed',
      targetAmount: 120,
      dailySalary: 10,
      temptations: [
        { label: 'Professional tool set', cost: 25, emoji: '🔨' },
        { label: 'Festival market booth fee', cost: 8, emoji: '🎪' },
        { label: 'Imported dyed cloth', cost: 18, emoji: '🧵' },
      ],
      deadlineDays: 15,
    } as SavingsGoalConfig,
    choices: [
      {
        id: 'save_for_deed',
        label: 'Save aggressively — buy the deed in 15 months',
        description: 'Discipline now, ownership later. Zero rent payments ever again.',
        goldDelta: 0,
        savingsDelta: 75,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 50,
        isOptimal: true,
        consequence: "Aldric records your savings goal. 'Fifteen months of discipline for a lifetime of ownership. The compound effect begins now.'",
        lesson: "Delayed gratification in property is one of the highest-returning financial decisions available to a young merchant.",
      },
      {
        id: 'rent_for_now',
        label: 'Rent for now — invest the difference',
        description: 'Pay 8/month but invest remaining capital at 10% return',
        goldDelta: 20,
        savingsDelta: 30,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 30,
        isOptimal: false,
        consequence: "Reasonable. If your investment returns exceed the cost of renting, this may break even or win. The math depends on execution — not just intent.",
        lesson: "Rent-vs-buy analysis requires comparing investment returns against the opportunity cost of down payment capital.",
      },
      {
        id: 'mortgage',
        label: 'Take a mortgage — buy now, pay over time',
        description: '20% down payment (24 silver), borrow 96 silver at 8% interest',
        goldDelta: -24,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 104,
        xpReward: 25,
        isOptimal: false,
        consequence: "You own the deed today. But 8% on 96 silver means 7.7 extra silver per year in interest — adding 77 silver to the total cost over 10 years.",
        lesson: 'Mortgages make ownership accessible but increase total cost. A lower down payment means a larger loan and more interest paid over time.',
      },
    ],
    completionSummary: "Aldric files your intent in the registry. 'The merchants who understand this choice early are the ones who retire with property portfolios. You have taken the first step.'",
  },

  {
    id: 'ch14',
    number: 14,
    title: 'The Spice Route Investment',
    subtitle: 'Risk, Return & Diversification',
    location: 'Trading Post',
    buildingKey: 'trading_post',
    npc: 'Trade Broker Veda',
    npcAvatar: '💼',
    npcColor: '#3A5A7A',
    storyLines: [
      {
        npc: 'Trade Broker Veda',
        avatar: '💼',
        emotion: 'happy',
        text: "I have an opportunity — shares in the Eastern Spice Route caravan. Each share costs 20 silver. A good season returns 18% profit. A bad monsoon loses 25%.",
      },
      {
        npc: 'Trade Broker Veda',
        avatar: '💼',
        emotion: 'wise',
        text: "Last three seasons: plus 18%, plus 12%, minus 25%. The gains are real. The losses are real too. Expected return over three seasons averages about 5% per year — decent, but not guaranteed.",
      },
      {
        npc: 'Veteran Trader',
        avatar: '⚓',
        emotion: 'warning',
        text: "I lost everything betting on one route once. Now I spread across five. When one sinks, four still float. You can't control the weather — you can control your exposure to it.",
      },
    ],
    lesson: 'Expected return = average of (probability × outcome) across scenarios. Diversification does not eliminate risk — it reduces the impact of any single failure on your total portfolio.',
    xpReward: 150,
    goldReward: 0,
    mechanicType: 'asset_buy',
    mechanicConfig: {
      asset: 'Spice Route Shares',
      emoji: '🌶️',
      unitCost: 20,
      maxUnits: 5,
      seasons: [
        { label: 'Clear trade winds', returnPct: 18, emoji: '☀️' },
        { label: 'Mild seasonal rains', returnPct: 8, emoji: '🌦️' },
        { label: 'Monsoon season', returnPct: -25, emoji: '🌊' },
      ],
    } as AssetBuyConfig,
    choices: [
      {
        id: 'three_shares_diversify',
        label: 'Buy 3 shares (60 silver) and split the rest across other assets',
        description: 'Moderate exposure. The remainder stays diversified.',
        goldDelta: -60,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 55,
        isOptimal: true,
        consequence: "Veda marks your ledger: 3 shares in spice route, remaining capital in other positions. 'Measured risk is intelligent risk,' she says.",
        lesson: 'Position sizing — allocating only a portion of capital to any single investment — is the foundation of portfolio management.',
      },
      {
        id: 'max_shares',
        label: 'Buy all 5 shares (100 silver)',
        description: 'Maximum exposure — maximum upside, maximum downside.',
        goldDelta: -100,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 20,
        isOptimal: false,
        consequence: "The monsoon hits. You lose 25 silver on your full 100-silver position. Concentration risk made a natural event into a financial disaster.",
        lesson: "Concentration risk: when one position represents your entire portfolio, its volatility is your volatility.",
      },
      {
        id: 'one_share_test',
        label: 'Buy just 1 share (20 silver) to learn',
        description: 'Cautious entry. Minimal exposure while you understand the market.',
        goldDelta: -20,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 35,
        isOptimal: false,
        consequence: "Conservative but wise for a first investment. You limit learning-by-doing to an affordable stake. Next season you'll size up with experience.",
        lesson: 'Starting small in a new asset class limits expensive mistakes. Scale position size as your knowledge grows.',
      },
    ],
    completionSummary: "Veda hands you your trade certificate. 'You are now an investor, not just a trader. The difference: a trader earns from action, an investor earns from ownership.'",
  },

  {
    id: 'ch15',
    number: 15,
    title: 'The Land Registry',
    subtitle: 'Real Assets & Illiquidity Risk',
    location: 'Town Hall Deed Office',
    buildingKey: 'town_hall',
    npc: 'Town Scribe Aldric',
    npcAvatar: '📜',
    npcColor: '#5A4A2A',
    storyLines: [
      {
        npc: 'Town Scribe Aldric',
        avatar: '📜',
        emotion: 'neutral',
        text: "The old miller left a plot of land along the river — prime location. Two merchants want it as a warehouse site. Asking price: 200 silver. The land generates 15 silver per season in rental income.",
      },
      {
        npc: 'Town Scribe Aldric',
        avatar: '📜',
        emotion: 'wise',
        text: "Land is the original investment. They stopped making it centuries ago. It tends to appreciate in value over decades. But — and this matters greatly — it is illiquid. You cannot sell half a plot in a crisis.",
      },
      {
        npc: 'Elder Landowner',
        avatar: '🧓',
        emotion: 'wise',
        text: "I bought this parcel for 200 silver thirty years ago. Worth 2,000 today. But twice I nearly had to sell during crises — and that would have meant selling at 400 when it was worth 1,000. Illiquidity is the hidden cost of real assets.",
      },
    ],
    lesson: 'Real assets build long-term wealth but cannot be quickly sold without accepting a price discount. Only buy real assets you can hold through downturns without being forced to sell.',
    xpReward: 150,
    goldReward: 10,
    mechanicType: 'savings_goal',
    mechanicConfig: {
      targetLabel: 'River Plot Down Payment (20%)',
      targetAmount: 100,
      dailySalary: 12,
      temptations: [
        { label: 'Expanded warehouse fit-out', cost: 40, emoji: '🏗️' },
        { label: 'Imported silk inventory', cost: 30, emoji: '🧵' },
        { label: 'Tavern meeting room rental', cost: 12, emoji: '🍻' },
      ],
      deadlineDays: 12,
    } as SavingsGoalConfig,
    choices: [
      {
        id: 'save_down_payment',
        label: 'Save the full 100-silver down payment before buying',
        description: 'Disciplined approach. You avoid over-leveraging on the purchase.',
        goldDelta: 0,
        savingsDelta: 80,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 55,
        isOptimal: true,
        consequence: "Aldric records your savings goal. 'Buying with equity built first means your monthly mortgage is lower. You can weather downturns without being forced to sell.'",
        lesson: "A larger down payment reduces your loan principal, your monthly payments, and your vulnerability to forced sales during a downturn.",
      },
      {
        id: 'leveraged_buy',
        label: 'Use a mortgage — 10% down, borrow 90%',
        description: 'Buy now with maximum leverage. Risk is higher but so is speed.',
        goldDelta: -20,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 185,
        xpReward: 30,
        isOptimal: false,
        consequence: "You own the land deed. But your 185-silver debt at 7% means 13 silver/year in interest — almost your entire first year's rental income goes to interest payments.",
        lesson: "High leverage amplifies gains in good times and magnifies losses in bad times. The rental yield must exceed the interest cost for leveraged property to make financial sense.",
      },
      {
        id: 'skip_invest_caravan',
        label: 'Skip land — reinvest in caravan routes for liquidity',
        description: 'Stay liquid. Better returns per silver in trading right now.',
        goldDelta: 10,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 35,
        isOptimal: false,
        consequence: "Reasonable at this stage. You prioritise liquidity and flexibility. The land will still be available when you have more capital — and your caravan returns are strong.",
        lesson: "Asset allocation across liquid and illiquid investments should match your time horizon and liquidity needs.",
      },
    ],
    completionSummary: "Aldric hands you a copy of the property valuation report. 'Every great merchant family built their fortune in three stages: trade profits, then credit management, then land and property. You are learning the sequence.'",
  },

  {
    id: 'ch16',
    number: 16,
    title: 'The Great Market Crash',
    subtitle: 'Your Emergency Fund Is Not an Investment',
    location: 'Counting House (Crisis Session)',
    buildingKey: 'counting_house',
    npc: 'Tax Clerk Petyr',
    npcAvatar: '📋',
    npcColor: '#4A6A4A',
    storyLines: [
      {
        npc: 'Tax Clerk Petyr',
        avatar: '📋',
        emotion: 'warning',
        text: "The northern harbor fleet was lost to a storm. Three major trading houses collapsed overnight. Prices are falling, credit is frozen. Merchants who cannot cover expenses are panic-selling their assets at catastrophic losses.",
      },
      {
        npc: 'Trade Broker Veda',
        avatar: '💼',
        emotion: 'warning',
        text: "I have seen it before — merchants who invested every coin now forced to sell mill shares at half price just to eat. The ones who survive a crash are the ones who never needed to sell.",
      },
      {
        npc: 'Tax Clerk Petyr',
        avatar: '📋',
        emotion: 'wise',
        text: "Those with a 6-month emergency reserve will weather this. For them, a crash is an inconvenience. For those without — it is ruin. The reserve was never about return. It was about not being forced to sell.",
      },
    ],
    lesson: 'An emergency fund (3–6 months of expenses) is financial armor. Its purpose is to prevent forced asset sales during income disruption. It converts potential catastrophe into inconvenience.',
    xpReward: 160,
    goldReward: 0,
    mechanicType: 'emergency_fund',
    mechanicConfig: {
      monthlyExpenses: 30,
      targetMonths: 6,
      currentEmergency: 40,
      scenario: 'Harbor collapse: your main trade route closes for 3 months',
    },
    choices: [
      {
        id: 'use_emergency_fund',
        label: 'Draw from emergency fund — protect your investments',
        description: 'Dip into reserves. Uncomfortable. But your portfolio survives intact.',
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: -30,
        debtDelta: 0,
        xpReward: 60,
        isOptimal: true,
        consequence: "You live off reserves for 3 months. Your mill shares drop 20% during the panic — but you hold. They recover fully in 8 weeks. You lose nothing except sleep.",
        lesson: "The emergency fund did exactly what it was designed to do: it gave you the ability to hold investments through a storm instead of selling at the worst moment.",
      },
      {
        id: 'panic_sell',
        label: 'Sell investments now to cover expenses',
        description: 'Lock in cash by selling at current depressed prices.',
        goldDelta: -25,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 15,
        isOptimal: false,
        consequence: "You sell mill shares at 60% of their value — locking in a 40% loss. Eight weeks later, prices recover fully. You secured survival at the cost of 40 silver in permanent losses.",
        lesson: 'Forced selling at panic prices is the most expensive mistake in investing. Emergency reserves prevent this.',
      },
      {
        id: 'take_crisis_loan',
        label: 'Borrow at crisis rates to cover the shortfall',
        description: 'Emergency lenders charge 30% during crises. But you keep your investments.',
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 45,
        xpReward: 20,
        isOptimal: false,
        consequence: "You keep the investments. But 30% crisis-rate interest on 45 silver means 13.5 silver/year in debt costs — for years. The lack of an emergency fund is now an ongoing expense.",
        lesson: 'Crisis debt is extremely expensive. It often costs more over time than simply selling assets would have. Emergency funds eliminate this dilemma.',
      },
    ],
    completionSummary: "Petyr closes his ledger. 'The merchants who built 6-month reserves before the crash are buying distressed assets right now at half price. Emergency preparedness is not caution — it is the preparation for opportunity.'",
  },

  {
    id: 'ch17',
    number: 17,
    title: "The Merchant's Mutual Aid Pact",
    subtitle: 'Insurance, Risk Pooling & Protection',
    location: 'Apothecary',
    buildingKey: 'apothecary',
    npc: 'Healer Maren',
    npcAvatar: '⚕️',
    npcColor: '#2A6A5A',
    storyLines: [
      {
        npc: 'Healer Maren',
        avatar: '⚕️',
        emotion: 'warning',
        text: "A fire destroyed Tomas the baker's shop last week. Two years of inventory, his tools, all his ledgers — gone. He had no protection pact. He lost everything in one night.",
      },
      {
        npc: 'Healer Maren',
        avatar: '⚕️',
        emotion: 'wise',
        text: "Our guild's mutual protection pact works like this: every member contributes 5 silver per month. When disaster strikes any member, the fund covers them. Three hundred members, 5 silver each — 1,500 silver available every month.",
      },
      {
        npc: 'Guild Member',
        avatar: '🧑',
        emotion: 'happy',
        text: "Tomas's fire damage was 450 silver. Shared across 300 pact members, each paid just 1.5 extra silver. Tomas was back open in a month. Without the pact, he would have been ruined for years.",
      },
    ],
    lesson: 'Insurance converts an uncertain catastrophic loss into a certain small payment (premium). The premium is the price of certainty. Risk pooling allows large losses to be spread across many participants, making them individually bearable.',
    xpReward: 155,
    goldReward: 0,
    mechanicType: 'allocation_wheel',
    mechanicConfig: {
      totalGold: 60,
      buckets: [
        { id: 'pact', label: 'Guild Protection Pact', emoji: '🛡️', riskLabel: 'Certain small cost, prevents catastrophe', color: '#2A6A5A' },
        { id: 'health', label: 'Healer Retainer Bond', emoji: '⚕️', riskLabel: 'Covers illness and injury costs', color: '#3A7A6A' },
        { id: 'cargo', label: 'Caravan Cargo Bond', emoji: '🐪', riskLabel: 'Covers cargo loss on trade routes', color: '#6A5A2A' },
        { id: 'none', label: 'Keep as liquid gold', emoji: '🪙', riskLabel: 'No protection, maximum flexibility', color: '#4A4A4A' },
      ],
    } as AllocateConfig,
    choices: [
      {
        id: 'full_protection',
        label: 'Allocate across pact, health, and cargo bonds',
        description: 'Comprehensive coverage across your key risks. 20 silver each.',
        goldDelta: -60,
        savingsDelta: 0,
        emergencyDelta: 20,
        debtDelta: 0,
        xpReward: 55,
        isOptimal: true,
        consequence: "Maren stamps your protection certificates. 'You have converted three possible catastrophes into three predictable small costs. That is not spending — that is engineering certainty into your financial life.'",
        lesson: 'Comprehensive protection across multiple risk categories (property, health, cargo) is more valuable than protecting against only one.',
      },
      {
        id: 'health_only',
        label: 'Only the healer retainer — health comes first',
        description: 'Cover your body but not your business or cargo.',
        goldDelta: -20,
        savingsDelta: 0,
        emergencyDelta: 10,
        debtDelta: 0,
        xpReward: 30,
        isOptimal: false,
        consequence: "Partial protection is better than none. But a cargo loss or shop fire without coverage could still ruin your business while your health is insured.",
        lesson: 'Single-category insurance leaves other large risks uncovered. Protection should address all your significant financial exposures.',
      },
      {
        id: 'no_insurance',
        label: 'Keep all gold liquid — insurance is waste if nothing happens',
        description: 'Self-insure. Hope no fire, illness, or cargo loss hits.',
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 10,
        isOptimal: false,
        consequence: "You keep the 60 silver. Three months later, your cargo caravan is robbed. The uninsured loss: 200 silver. The pact premium would have been 15 silver. You saved 15 and lost 200.",
        lesson: 'Self-insurance requires holding reserves large enough to cover catastrophic losses. For most merchants, the premium is cheaper than the required reserve.',
      },
    ],
    completionSummary: "Maren hands you your three protection certificates. 'Tomas rebuilt in a month. Without the pact, it would have taken him five years — if ever. You now understand why the wisest merchants protect before they invest.'",
  },

  {
    id: 'ch18',
    number: 18,
    title: "The Young Merchant's Mastery",
    subtitle: 'Net Worth & The Balance Sheet',
    location: 'Apothecary (Ceremony Hall)',
    buildingKey: 'apothecary',
    npc: 'Healer Maren',
    npcAvatar: '⚕️',
    npcColor: '#2A6A5A',
    storyLines: [
      {
        npc: 'Healer Maren',
        avatar: '⚕️',
        emotion: 'happy',
        text: "Look at your ledger now. You have gold in savings, caravan shares, a protection pact, managed debt, tax records. This collection of information has a name: a personal balance sheet.",
      },
      {
        npc: 'Trade Broker Veda',
        avatar: '💼',
        emotion: 'wise',
        text: "Two columns. Left side: Assets — everything you own. Cash, investments, property, tools. Right side: Liabilities — everything you owe. Loans, debt, taxes due. Subtract right from left. That number is your Net Worth.",
      },
      {
        npc: 'Headmaster Aldus',
        avatar: '🎓',
        emotion: 'happy',
        text: "The Apprentice who walked into Ashmarket with 20 silver now understands taxation, credit, property, investment, emergency planning, and insurance. You are no longer a student. You are a Young Merchant. The realm's full markets await you.",
      },
    ],
    lesson: 'Net Worth = Total Assets − Total Liabilities. Track this number monthly. Consistent growth — even slow growth — is the signal that your financial life is moving in the right direction.',
    xpReward: 300,
    goldReward: 50,
    mechanicType: 'graduation',
    mechanicConfig: {
      requirements: [
        { label: 'Tax filing mastered', chapterId: 'ch11', emoji: '📋' },
        { label: 'Credit history built', chapterId: 'ch12', emoji: '💳' },
        { label: 'Property plan created', chapterId: 'ch13', emoji: '🏠' },
        { label: 'Investment portfolio live', chapterId: 'ch14', emoji: '📈' },
        { label: 'Emergency fund hardened', chapterId: 'ch16', emoji: '🛡️' },
        { label: 'Insurance pact joined', chapterId: 'ch17', emoji: '⚕️' },
      ],
    },
    choices: [
      {
        id: 'accept_merchant_title',
        label: 'Accept the Young Merchant certification',
        description: "You have earned it. The guild seal goes on your ledger.",
        goldDelta: 0,
        savingsDelta: 0,
        emergencyDelta: 0,
        debtDelta: 0,
        xpReward: 100,
        isOptimal: true,
        consequence: "The council stamps your ledger: YOUNG MERCHANT — CERTIFIED. The Trade Academy's upper floors are now unlocked. Early Career Stage: Guild Trader awaits.",
        lesson: 'Financial education is not a destination — it is a compounding practice. Stage 2 complete. The wealth-building decades begin now.',
      },
    ],
    completionSummary: "Veda, Aldric, Petyr and Maren each sign your merchant scroll. Headmaster Aldus closes it with the Academy seal. Beyond the Apothecary door: a wider world, a harder market, and far greater rewards. Stage 2 complete.",
  },
]

export const CHAPTER_MAP: Record<string, Chapter> = Object.fromEntries(
  CHAPTERS.map((ch) => [ch.id, ch])
)

export function getChapterStatus(
  chapterId: string,
  completedIds: string[]
): ChapterStatus {
  const ch = CHAPTER_MAP[chapterId]
  if (!ch) return 'locked'
  if (completedIds.includes(chapterId)) return 'completed'
  const idx = CHAPTERS.findIndex((c) => c.id === chapterId)
  if (idx === 0) return 'available'
  const prevChapter = CHAPTERS[idx - 1]
  if (prevChapter && completedIds.includes(prevChapter.id)) return 'available'
  return 'locked'
}
