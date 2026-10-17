# Site Notes, Krug roast (2026-10-17, a client demo on the demo host in Chrome 1237 px, client and content not named here, plus README)

SEED: the reviewer gets a developer's toolbar with nine controls, CSS selectors and note IDs in the face, when the whole job is "click it, say it, later say keep or revert".

Krug's questions on every screen: Is it obvious what this is? What can I click? Where am I? Did I just do the right thing?
Severity: S1 stops a first-time reviewer, S2 makes them think, S3 noise.

| # | S | Where | What a first-time reviewer sees | Krug rule broken | Fix shipped |
|---|---|---|---|---|---|
| 1 | S1 | pill | Nine controls in one row: Paused, 4 notes, 5 changes..., Lead, Follow, Hide fixed, List, Export site, x. Three audiences (reviewer, agent operator, phone pairing) share one toolbar | mindless choices: every control is a "what's this?" | pill = one primary button + "to check" count + x; the rest behind "..." |
| 2 | S1 | pill | "Paused" / "Notes on" is a state label posing as a button. Nothing says what clicking does | buttons say the action | "Add note" / "Done" |
| 3 | S1 | hover label | `a:nth-of-type(3) 560x69` floats over the element | omit what the reader cannot use | human label: "link: Home" (kind + text); selector stays in the export |
| 4 | S1 | card | Breadcrumb `body > main > a` and the selector field sit ABOVE the question "What should change?" | visual hierarchy: the question is the page | question first, size walker as two small words, selector under "details" |
| 5 | S1 | badges | Clicking a link badge in note mode picked `body`, the whole page | the tool's own chrome must never be a target | overlay excluded from picking |
| 6 | S2 | markers | Green "v35", "v37", "v28" show raw note IDs; dashed boxes overlap each other and the page's header | numbers the reader did not ask for | marker = "v" only, ID on hover; dashed outline only for the one that is open |
| 7 | S2 | Changes view | The "dim the page" is barely visible and the first change card opens by itself on top of the lit element | did I do the right thing? | real dim (0.55), nothing opens until tapped |
| 8 | S2 | pill | The green filled "5 changes on this page, 14 on other pages" is the loudest thing; the actual primary action is grey | the loudest element is read as the main action | primary = Add note (filled); count = quiet pill "5 to check" |
| 9 | S2 | page | "4 notes on this page" but one blue dot is visible; #38, #58, #60 are on hidden elements. Where are they? | where am I / what is here | count is a button: click steps to each, hidden ones listed with "not visible on this layout" |
| 10 | S2 | pill | "Lead" and "Follow" on every device. Nobody knows which one they are | words the reader uses | phone: "Point from phone"; desktop: "Type for the phone"; only in "..." |
| 11 | S2 | x | Tap = tuck, hold 0.7 s = off. The second behaviour is invisible | conventions: x means close | x = hide; "Turn off" is a line in "..." |
| 12 | S2 | change card | WHAT CHANGED leaks agent text: "ssot/20-ekrany.yaml replanBtn icon/nogps_label" | omit needless words | human part before " \| " shown; rest under "for the agent" |
| 13 | S3 | change card | "Why revert? (optional)" input always visible | happy talk, form before decision | field appears after Revert is pressed |
| 14 | S1 | first run | No hint. A pill appears with nine words | the trunk test: what can I do here? | one-time line: "Click anything on the page and say what should change" |
| 15 | S3 | pill | "Export site" for the reviewer. The reviewer never exports; the agent runs `annot export` | remove what the audience cannot use | reviewer mode (secret link, demo hosts): no Export; extension keeps it under "..." |
| 16 | S3 | tucked tab | A `>_<` face at the right edge | icons need a convention | pencil + count of open notes |
| 17 | S2 | pill | The pill sits on the page's own bottom-left button; worse at phone width | the tool must not hide the thing being reviewed | pill shrinks to the essentials, which also moves it off the content |
| 18 | S2 | words | notes, changes, fixed, changed, done, accepted, Keep, Revert, Not fixed, REVERT: ten words for two states | one word per thing | a note is OPEN or TO CHECK; after Keep it is gone |

What stays as is (it passed): the blur + blue border on the picked element; Cancel at left, Save filled at right; Esc cancels; markers survive page loads; the List groups by page; the hub needs no account.

Levels: everything above is my own observation on the live demo today; no outside claim. The Krug rules are from "Don't Make Me Think" (3rd ed., 2014) as I remember them `[2 LOW | model memory, book not opened]`.
