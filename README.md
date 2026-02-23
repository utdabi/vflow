# VolunteerFlow

A simple tool for small nonprofits to coordinate volunteers, find last-minute replacements,
and keep your volunteer list up to date without wrestling with spreadsheets all day.

---

## Managing your volunteer list with CSV

The fastest way to get a big list of volunteers into the system is a CSV file. Once they're in,
you can export the list, make changes in Excel or Google Sheets, and re-upload to update records.
No need to edit volunteers one by one.

### First time: add volunteers in bulk

**Step 1 — download the template**

Go to the Volunteers page and click "Download template". This gives you a CSV with the right
column names and a couple of example rows so you can see the format.

Open it in Excel or Google Sheets. Delete the example rows before uploading.

**Step 2 — fill it in**

| Column | Required? | Notes |
|---|---|---|
| first_name | Yes | |
| last_name | Yes | |
| mobile | Yes | International format preferred: +12125550101. A plain 10-digit number like 2125550101 gets converted automatically. |
| email | No | |
| gender | No | Male, Female, Non-binary, Prefer not to say, or Other |
| date_of_birth | No | DD/MM/YYYY (or MM/DD/YYYY if your org uses US dates) |
| skills | No | Multiple skills separated by semicolons: `first aid; cooking; driving` |
| preferred_days | No | Day names separated by semicolons or commas: `Mon; Wed; Fri` or `Monday, Friday`. Sun through Sat all work, short or full name. |
| notes | No | Free text |

Leave a cell blank if you don't have that information. Don't add extra columns.

**Step 3 — upload and check the preview**

Back on the Volunteers page, click "Import CSV" and select your file. Before anything saves,
you'll see a preview split into two sections:

- Rows that look good (green count at the top)
- Rows with errors (shown individually with what went wrong)

Fix the errors in your spreadsheet, re-upload, and check again. When you're happy, click Confirm.
The volunteers appear in the list immediately.

---

### Updating existing volunteers (export → edit → re-import)

Once volunteers are in the system, the cleanest way to make bulk changes is to export the list,
edit it, and re-import.

**Step 1 — export**

On the Volunteers page, click "Export list". The file downloads as a CSV named something like
`volunteers_active_2026-02-23.csv`.

Open it. The first column is labelled **ID (DO NOT MODIFY)**. That column holds a long
random-looking code for each volunteer. The system uses it to match your edited rows back to the
right records. Leave that column exactly as it is.

**Step 2 — edit**

Change whatever you need: name, mobile, email, skills, preferred days, notes. You can also change
the **Status** column:

- `Active` — the volunteer shows up in the active list and can be assigned to shifts
- `Inactive` — they're hidden from the active list but their history stays in the system

Status is case-insensitive. `active`, `ACTIVE`, and `Active` all work the same. You can also
write `Yes`/`No` or `True`/`False` if that's easier.

**Step 3 — re-import**

Save your edited file and import it the same way as before. The preview will show an **Update**
badge next to rows that match an existing ID, and a **New** badge for any row where the ID
column is blank (that creates a new volunteer instead of updating).

Confirm when the preview looks right. Changes take effect straight away.

A few things to know:
- If you blank out an ID, it creates a new volunteer instead of updating the old one, which
  can leave duplicates. Only do it intentionally.
- If a row has an ID the system doesn't recognise (for example, you accidentally typed in it),
  the preview marks it as an error and won't save it.
- The same file can mix updates and new volunteers. Rows with IDs update; rows without IDs create.
