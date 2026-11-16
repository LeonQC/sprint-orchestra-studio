export interface SprintHelpCriterion {
  label: string;
  description: string;
  example: string;
}

export const SPRINT_PACE_HELP = {
  title: 'How Sprint pace check decides the result',
  description: 'It compares how much of the sprint has passed with how much work is finished. Think of it as a quick schedule check, not a diagnosis.',
  criteria: [
    {
      label: '1. Work out where we should be today',
      description: 'If half of the sprint has passed, we use 50% finished as today’s reference point.',
      example: 'Example: Today is day 5 of a 10-day sprint → expected progress is 50%.',
    },
    {
      label: '2. Work out how much is actually finished',
      description: 'Every Story, Task, and Bug must have story points. If even one is missing an estimate, we show Pace incomplete instead of guessing. The known point subtotal is still shown as “estimated work only.”',
      example: 'Example: Two issues total 10 points but PAY-42 has no estimate. We show the known 10 points and name PAY-42, but we do not claim the sprint is On track or Behind.',
    },
    {
      label: '3. Compare the two numbers',
      description: 'Up to 10 percentage points behind = On track. More than 10 and up to 25 percentage points behind = At risk. More than 25 percentage points behind = Behind.',
      example: 'If 50% is expected: 45% done is On track; 35% is At risk; 20% is Behind.',
    },
    {
      label: '4. Point out work that needs attention',
      description: 'Separately, we list blocked work and unfinished work untouched for more than 3 days. These flags do not change the pace label by themselves.',
      example: 'Example: PAY-42 can still appear as “no activity for 4 days” even when the sprint is On track.',
    },
  ] satisfies SprintHelpCriterion[],
  comparison: 'Best question for this check: “Are we roughly where we should be today?” Sprint dates are required for the pace comparison; issue flags can still be shown without it.',
  note: 'Read-only — it never changes Jira.',
};

export const SPRINT_RECOVERY_HELP = {
  title: 'What makes Diagnose risk investigate a sprint',
  description: 'It first looks for clear warning signs in Jira. If it finds one, AI reads the related history, comments, and issue details to explain what may be causing it.',
  criteria: [
    {
      label: 'Work looks stuck',
      description: 'An issue is In Progress or Blocked and nobody has updated it for at least 2 days.',
      example: 'Example: PAY-42 has been Blocked since Monday and it is now Wednesday with no update.',
    },
    {
      label: 'Too much unfinished work sits with one person',
      description: 'One person owns at least 40% of the remaining points across 2 or more issues. If the team does not use points, 3 or more open issues triggers the check.',
      example: 'Example: Maya owns 10 of the sprint’s 20 unfinished points across 3 issues → 50%, so this is checked.',
    },
    {
      label: 'The sprint is clearly behind today’s pace',
      description: 'After the opening 20% of the sprint, finished work is more than 20 percentage points behind where the calendar says the team should be. With 2 days or less left, being under 90% finished also triggers the check.',
      example: 'Example: On day 6 of 10, about 60% is expected. If only 25% is done, the gap is 35 percentage points, so the sprint gets investigated.',
    },
    {
      label: 'New work was added late',
      description: 'An issue was moved into the sprint after at least half of the sprint had already passed.',
      example: 'Example: A ticket added on day 7 of a 10-day sprint is treated as late scope.',
    },
    {
      label: 'AI must show its evidence',
      description: 'No warning sign means no AI diagnosis. When AI suggests a cause, that statement must point back to evidence retrieved from Jira.',
      example: 'Example: “Waiting for security approval” must link to the comment, history entry, or issue detail that says so.',
    },
  ] satisfies SprintHelpCriterion[],
  comparison: 'Best question for this check: “What is putting delivery at risk, and what could we do about it?” A sprint can look On track overall and still contain one serious blocker.',
  note: 'Nothing is written to Jira until you review and approve a plan.',
};
