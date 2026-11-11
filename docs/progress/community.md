# Community: progress

The community workstream: sharing designs, the public library, profiles, remixes, likes and comments, moderation and the monthly contest (roadmap C1–C9, "Community" in `docs/roadmap.md`). The owner asked on 2026-11-11 to start working towards it. Its design questions are in `docs/community.md`. Times are Perth (AWST, UTC+8).

Rules for this workstream:
- Accounts already exist (Google sign-in, My designs, settings that follow you: `packages/account`, `supabase/`), so every community table follows `supabase/CLAUDE.md`: row level security, the browser only through functions, every limit at 0.9×/1.1× in `supabase/test/`, and a `my_data_part_<name>()` for each new kind of data.
- Nothing here goes live to everyone until its legal check is done. Each feature stays behind a switch until then (`?share` for sharing links, and so on), and the wording it shows is marked as a placeholder. The legal list is kept privately by the owner.
- A database change reaches the live service only when the owner applies the migration, as with My designs.
- A shared design is the project's own file text, opened by the same reader as Open (`projectFromJson`), so a shared file can never do more than a file opened from disk.

## C1. Decisions (proposed 2026-11-11, money items wait on the owner)

Proposed answers to `docs/community.md`'s questions, chosen for the fewest compromises. The ones that cost money are marked "owner".
- Hosting: Supabase (already used for accounts, in Sydney). Sharing links keep their copy in the database like My designs, because they are small and few. The public library moves design files to Supabase Storage behind its cache (C3), since the database's free space is too small for a library. Owner: the paid plan (about US$25 a month) once the free tier's storage or bandwidth runs out.
- Limits that cap the bill: a shared design is at most 5 MiB (as My designs) with a picture of at most 32 KiB. A person has at most 50 sharing links on and 20 MiB of shared copies, and makes at most 20 new links a day.
- Accounts: making a link needs a signed-in account. Opening a link needs none, because a link is like sending someone a file. The public library follows AC2: browsing needs no account, while posting, downloading and remixing need one.
- File kinds: SpindleLabs projects only at first, since the kernel checks them as they open. STL and 3MF come with the library (C3). Pictures are drawn in the browser, never made on the server.
- Licences (library only): CC BY 4.0 (the default), CC BY-SA 4.0, CC BY-NC 4.0 and CC0. A remix may pick only what its original allows.
- Moderation: a Report button on every shared design from the first sharing link. Reports go to a review list for the people who run SpindleLabs. The library hides a design once enough different signed-in people report it, until it is reviewed (C5).
- Search: tags, a category and PostgreSQL's own full-text search. Ranked by newest or most remixed, never by payment.
- Remixes: a remix records its original's library id and version (X12's `origin`/`lineage`). When the original is deleted, the credit stays as plain text, "Remix of <name> by <author> (removed)".
- Versions: a shared design can be updated, and a link always shows its latest version. People who already opened it keep their copy, and nobody is told about updates at first. "Update available from the author" is X12, later.
- Privacy and age: no real names, only a display name picked by the person. No private messages, ever. No location, and no other contact between users except comments, if those are built (C8).
- If the money or the maintainer runs out: a weekly export of every public design and its licence, so the library can move.

## Steps

- [ ] C2. Sharing links: share a frozen copy of a design with a link, open it as your own copy, turn the link off, report it. Behind `?share` until its legal check.
  - [x] C2a. Database: `supabase/migrations/20261111120000_shares.sql` and `supabase/test/test_shares.py` (26 tests; listed in `supabase/CLAUDE.md`). Done as planned, with these choices: the link id is a random UUID (122 random bits, nothing to guess or list); turning a link off empties its copy at once but keeps the row, so the 20 new links a day count turned-off ones (turning links off and on can't get round it); a link taken down (`remove_share`, server only until C5) shows in `my_shares` with `removed_at`; signed-out reports have their own 20 a link, apart from the signed-in 200, and the sharer can't report their own link (both from the security review of 2026-11-11, with the report id sequence closed to the browser; each with a failing test first). Verified: the whole `supabase/test` suite passes (105), and two deliberate breaks (a turned-off link still opening, no 50-link cap) each fail their test. Reaches the live service only when the owner applies the migration. C2b starts in `packages/account/src/designs.ts` (copy its call style into a new `shares.ts`) and `test/fake-designs.ts` (a fake `shares` service beside it).
  - [ ] C2b. `packages/account`: the client calls for C2a against the fake service (`test/fake-designs.ts` style), with unit tests.
  - [ ] C2c. App: Share in My designs and the File menu (a design must be kept in the account first, or is shared from the open project), the link to copy, the placeholder sharing terms beside it, and My links with Turn off.
  - [ ] C2d. Opening a link: `spindlelabs.app/?s=<id>` opens the shared copy as a new project in this browser (through `projectFromJson`, refused with a message when damaged or newer), with a Report button. e2e against the fake service, phone and desktop screenshots, the privacy page's sharing section (marked placeholder).
Built in this order: C2, C6, C5, C3, C4, C7, C8, C9 (the numbers C1–C5 are the roadmap's from before 2026-11-11).

- [ ] C6. Profiles: a display name (checked against a word list, changeable once a week) and nothing else; no pictures of people, no messages.
- [ ] C5. Moderation: the review list for reports, hide and restore, close an account, the takedown process, upload rate limits, every report and decision kept as a record.
- [ ] C3. Public library: publish with a licence, browse and search without an account, tags, pictures, files in Storage behind its cache, download into a new project (signed in).
- [ ] C4. Remix: needs X12 (the file's `origin` and `lineage`, a data version) and C3.
- [ ] C7. Likes (signed in, one per person per design; counts shown, never who).
- [ ] C8. Comments: only if the legal check of the under-16 social media rules allows them; otherwise "remix as a reply" and photos of prints.
- [ ] C9. The monthly design contest (after launch; needs C3, C6, Pro and Team on sale and the contest rules checked).
