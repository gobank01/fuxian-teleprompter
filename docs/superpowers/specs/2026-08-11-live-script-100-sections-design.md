# Fuxian Live Script — 100 Sections Design

## Goal

Expand the built-in Fuxian teleprompter script from 37 to exactly 100 independently readable sections. The script must sound natural in a live-shopping broadcast, remain varied under continuous shuffle, and avoid unsupported health or product claims.

## Live-first content model

Each section is a short live-speaking unit, normally 2–4 lines. It must make sense when shown in any order and must not rely on the previous or next section.

The library will deliberately alternate among five live beats:

1. **Welcome and re-entry** — greet new viewers, reorient people who just joined, invite a quick response.
2. **Product orientation** — identify Fuxian Multi-Oil Holistic, its format, pack size, and neutral product facts.
3. **Question and interaction** — ask simple chat questions, acknowledge common hesitation, invite viewers to type or tap.
4. **Offer and comparison** — state only verified current prices, explain quantities and simple per-jar arithmetic, then direct viewers to the basket.
5. **Soft close and reset** — create a natural decision point, help viewers choose a pack, and smoothly reset the pitch for the next shuffled section.

The tone is conversational Thai used by a friendly live host. The host refers to herself as “น้อง” and addresses customers as “แม่”, “แม่ๆ”, or “แม่ขา”. Sentences stay short enough to read aloud without sounding scripted. Calls to action vary instead of repeating the same closing line.

## Distribution

The final 100 sections will use this balance:

- 20 welcome, hook, and viewer re-entry sections
- 20 neutral product and package-information sections
- 15 questions, hesitation handling, and chat-engagement sections
- 20 price, bundle, value-comparison, and basket sections
- 15 returning-viewer, recap, and tempo-change sections
- 10 decision and closing sections

Within those groups, the writing will vary in rhythm: direct hooks, questions, mini-recaps, comparison prompts, countdown-style transitions, and calm reassurance. No two adjacent source sections should be near-duplicates even though runtime order is shuffled.

## Verified content boundary

The script may state:

- registered product name: Fuxian Multi-Oil Holistic dietary supplement
- Thai FDA registration number `73-1-02663-5-0172`, with active product status at the time of research
- current official-store facts that are consistently supported: softgel format, 30 softgels per jar, single jar at 490 baht, and 2+1 bundle at 1,290 baht
- neutral purchasing guidance such as checking the label, registration number, seller, quantity, and current basket price

The new script will not add specific dosage instructions because the public Thai FDA entry does not display dosage and currently available sources conflict. It will use neutral phrasing such as “อ่านฉลากก่อนรับประทาน” when this topic appears.

The script will not promote the existing 4+2 bundle at 2,350 baht until a current official promotion is supplied or verified. Existing unsupported dosage and promotion lines will be replaced as part of the cleanup, rather than copied into additional sections.

The wording “10 cold-pressed oils” may be used sparingly as the dominant current official-store representation, but individual ingredient benefits will not be connected to product outcomes. The script will avoid medical, disease, weight-loss, body-transformation, and guaranteed-result claims.

## Formatting rules

- Every section starts with a `#` heading so the existing shuffler can treat it as one unit.
- Every spoken line starts with a relevant emoji.
- Important spoken fragments use `*...*` highlighting.
- All numbers use Arabic numerals.
- Sections do not use forward references such as “as mentioned earlier”.
- Price arithmetic must be correct and must not imply an unverified limited-time offer.
- The exact mandatory dietary-supplement disclaimer stays available in the library without being rewritten into a medical claim.

## Application behavior

The existing shuffle behavior remains: sections are split at `#` headings, randomized, and concatenated into a looping prompt. Only the built-in seed script is migrated. User-created scripts remain untouched.

The built-in script label changes from “Multi-Oil คลังวน 37 ท่อน” to “Multi-Oil LIVE 100 ท่อน”, and the seed migration version is incremented consistently so existing installations receive the new library once.

## Verification

Before completion:

1. Count exactly 100 section headings.
2. Confirm every spoken line begins with an emoji.
3. Confirm no duplicate section bodies or repeated headings.
4. Scan the final seed against `keywords.js` and manually review context-sensitive health language.
5. Confirm prices and calculated averages used in the script are correct.
6. Confirm the seed version and built-in script name match in every migration location.
7. Run JavaScript syntax validation and the existing browser regression checks, including seed migration and shuffle behavior.
8. Confirm unrelated existing working-tree changes are preserved.
