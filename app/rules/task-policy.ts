// Monthly tasks are created only by the formal-member monthly rule; legacy/manual generation stays retired.
export const taskKinds=['audit','onboarding','monthly','cooperation','custom'] as const;
export const taskPriorities=['P0','P1','P2'] as const;
export const taskLabelNames:Record<typeof taskKinds[number],string>={audit:'人事审核',onboarding:'入社对接',monthly:'月度沟通',cooperation:'组织合作',custom:'临时工作'};
export const taskPriorityDefaults:Record<typeof taskKinds[number],typeof taskPriorities[number]>={audit:'P1',onboarding:'P1',monthly:'P2',cooperation:'P2',custom:'P2'};
