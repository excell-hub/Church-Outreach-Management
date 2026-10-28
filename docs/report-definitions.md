# How the figures are counted

These are the definitions the dashboard, the reports, the charts and the CSV exports all use. They are **drafts** until Kharis leadership confirms them. A person can have many encounters and many follow-up contacts, so each figure says whether it counts records or different people.

_Generated from the prototype's own metric table by `prototype/scripts/export_definitions.js`._

**Periods:** Last 7 days, Last 30 days, Last 90 days, This year, All time, Custom range. Figures marked "right now" describe today and ignore the period.

## Outreach activity

| Figure | Basis | How it is counted |
|---|---|---|
| Sessions | Period | Sessions whose outreach date falls in the period. The date is when the outreach happened, not when it was entered. Archived sessions are left out. |
| Encounters | Period | One for every person listed in a session. Someone met in three sessions is three encounters. This measures how much outreach happened, not how many different people were met. |
| People reached | Period | Distinct people with at least one encounter in the period. Someone met three times counts once, whichever team or session they were met in. |
| New to us | Period | People reached in the period whose first recorded encounter, anywhere in the data this report covers, falls in the period. Everyone else had been met before. |
| Flagged for follow-up | Period | Distinct people with at least one encounter in the period marked “follow-up suggested”. A suggestion is not a case, and nobody is contacted until a leader opens one. |
| Decisions recorded | Period | Distinct people with a decision noted on an encounter (by its outreach date) or on a follow-up contact (by its contact date) in the period. A decision is an outcome that people record. It is never a pipeline stage and never a score. |

## Follow-up

| Figure | Basis | How it is counted |
|---|---|---|
| Cases opened | Period | Follow-up cases whose opening date falls in the period, for the teams selected. |
| Contact attempts | Period | Every follow-up contact in the period where someone reached out: unanswered calls, messages left and real conversations. Seeing someone at church without speaking to them is not an attempt. |
| Follow-ups completed | Period | Follow-up contacts in the period where the person was actually spoken with. That includes “not interested right now” and “asked us not to contact them again”. Unanswered calls, messages left and numbers that didn’t work are not included. |
| People spoken with | Period | Distinct people with at least one completed follow-up in the period. Two conversations with the same person count once here and twice in Follow-ups completed. |

## Attendance and integration

| Figure | Basis | How it is counted |
|---|---|---|
| Attended church | Period | Distinct people with attendance recorded on a follow-up contact in the period, either because they told us they came or because we saw them there. Someone with both counts once, as seen. This is people we follow up, not general church attendance. |
| Moving towards integration | Period | Distinct people whose follow-up case moved to Integration in progress or to Integrated during the period. It reads the stage history, so a later move back does not undo it. |
| Integrated | Period | Distinct people whose follow-up case moved to the Integrated stage during the period. |

## Right now

| Figure | Basis | How it is counted |
|---|---|---|
| Follow-ups due | Right now | Open cases (not Integrated or Closed) whose next contact date is today or earlier. It describes today, so it ignores the date range. |
| Open cases | Right now | Every case that is not Integrated or Closed, for the teams selected. It describes today, so it ignores the date range. |
| Cases by stage | Right now | Every case for the teams selected, placed at its current stage. Each case is counted once. It describes today, so it ignores the date range. |
| Not assigned | Right now | Open cases that have no one assigned. It describes today, so it ignores the date range. |
| No next step planned | Right now | Open cases that have no date for the next contact, so nothing will prompt anyone to follow up. It describes today, so it ignores the date range. |
| Flagged, no case yet | Right now | People an evangelist flagged who have no open case and no case opened since the flag was raised. They are waiting for a leader to decide. It describes today, so it ignores the date range. |
