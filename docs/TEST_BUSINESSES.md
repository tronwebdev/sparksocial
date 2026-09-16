# Three businesses to test with

Fictional, and deliberately so — no real company's name, address or numbers.
Every field below maps to something onboarding actually asks for, in the order it
asks, so each can be typed straight through without inventing anything mid-flow.

They are chosen to be **different where the engine branches**, not merely
different industries. Playbook selection keys off `proof_asset`,
`capture_capability`, `objective` and `talent_availability` — so these three
answer those four differently on purpose, and should produce visibly different
calendars. If all three plan the same month, something is wrong.

| | Brightwell | Fernhill | Northgate |
|---|---|---|---|
| Niche | Trades and services | Food and drink | Software |
| Proof asset | work being done by hand | a physical product | a screen or app |
| Can film | the place I work | the product itself | **nothing** |
| Objective | more bookings | more sales | sign-ups / trials |
| On camera | yes, real footage only | yes, licensed likeness | nobody |

The third is the important one: **Northgate can film nothing and will put nobody
on camera.** It exists to prove the product still plans a month for a brand with
no capture capability at all, which is the case most likely to fall back to
nothing.

---

## 1. Brightwell Plumbing & Heating

A two-van domestic plumbing firm. Emergency callouts and boiler servicing.

**Brand name**
```
Brightwell Plumbing & Heating
```

**What it does** *(the one-sentence description)*
```
We fix leaks, breakdowns and cold radiators for homeowners across the north of
the city, usually the same day, and service boilers before winter so they do not
fail in January.
```

**Niche** — Trades and services

**Website** (for `genome.bootstrap_from_url`, if testing that path)
```
https://example.com/brightwell
```

### The five questions

| Question | Answer |
|---|---|
| What can you actually show someone? | **Work being done by hand** + **Finished results** |
| What could you film, realistically? | **The place I work** + **Things I am working on** |
| What is this actually for? | **More bookings** |
| Is anyone willing to be on camera? | **Yes, but only real footage** |

### Brand kit

- **Voice**: plain, reassuring, no jargon. Explains what went wrong in words a
  worried homeowner understands.
- **Colours**: deep blue `#12395C`, warm amber `#E8A33D`, off-white `#F7F5F1`
- **Typography**: a sturdy sans — Inter or similar
- **Primary CTA**: "Book a callout"
- **Timezone**: Europe/London

### Details for the later steps

- **Audience**: homeowners 35–65 within about eight miles; landlords with two to
  ten properties
- **Offer**: £0 callout on boiler servicing booked before October
- **Proof to lean on**: 400+ jobs a year, Gas Safe registered, same-day response
  on emergencies
- **Target**: 40 bookings in 30 days
- **Do not say**: never quote a fixed price before seeing the job

---

## 2. Fernhill Roastery

A small-batch coffee roaster with one café and a growing subscription.

**Brand name**
```
Fernhill Roastery
```

**What it does**
```
We roast single-origin coffee in small batches every Tuesday and Friday, sell it
from our café on Fernhill Road, and post it to subscribers the morning after it
is roasted.
```

**Niche** — Food and drink

**Website**
```
https://example.com/fernhill
```

### The five questions

| Question | Answer |
|---|---|
| What can you actually show someone? | **A physical product** + **Work being done by hand** |
| What could you film, realistically? | **The product itself** + **The place I work** |
| What is this actually for? | **More sales** |
| Is anyone willing to be on camera? | **Yes, and they agree to a digital likeness** |

### Brand kit

- **Voice**: warm and specific. Talks about origin, roast date and the person who
  grew it, never "artisanal".
- **Colours**: dark espresso `#2B1B12`, terracotta `#C2603C`, cream `#F2E8DC`
- **Typography**: a serif for headlines, sans for body
- **Primary CTA**: "Start a subscription"
- **Timezone**: Europe/London

### Details for the later steps

- **Audience**: home brewers who own a grinder; local office managers buying for
  a team
- **Offer**: first bag free on a three-month subscription
- **Proof to lean on**: roasted-to-shipped in under 24 hours, direct trade with
  four farms, 1,200 subscribers
- **Target**: 120 new subscriptions in 30 days
- **Do not say**: no health claims about coffee, no origin story we cannot source

> This is the one to test **avatar and voice cloning** with — it is the only
> profile that consents to a digital likeness, so `talent_availability:
> yes_licensed` should unlock the synthesize playbooks the other two cannot use.

---

## 3. Northgate Actuarial

A four-person consultancy doing pension scheme valuations for small employers.

**Brand name**
```
Northgate Actuarial
```

**What it does**
```
We run scheme valuations and funding reviews for employers with defined benefit
pension schemes under £50m, and translate the result into the three decisions a
trustee board actually has to make.
```

**Niche** — Professional services

**Website**
```
https://example.com/northgate
```

### The five questions

| Question | Answer |
|---|---|
| What can you actually show someone? | **Numbers and results** |
| What could you film, realistically? | **Nothing — I would rather not film** |
| What is this actually for? | **More enquiries** |
| Is anyone willing to be on camera? | **No** |

### Brand kit

- **Voice**: precise and unhurried. Short sentences, no exclamation marks, never
  urgent.
- **Colours**: slate `#1F2933`, muted teal `#3E7C7B`, paper `#FAFAF8`
- **Typography**: a quiet serif; generous line height
- **Primary CTA**: "Request a funding review"
- **Timezone**: Europe/London

### Details for the later steps

- **Audience**: trustees and finance directors at employers with 50–500 staff
- **Offer**: a free one-page funding summary of your latest valuation
- **Proof to lean on**: 60+ schemes advised, average deficit reduction of 18%
  over three years
- **Target**: 25 enquiries in 30 days
- **Do not say**: no performance predictions, no advice that could read as
  regulated financial advice to an individual

> **The hard case, on purpose.** No camera, no person, no product to photograph —
> only data. Watch whether the calendar still fills, whether it leans on
> `data_outcomes` formats, and whether the mix engine avoids anything requiring
> capture. A thin or empty month here is a real finding, not a bad test profile.

---

## What to check once all three exist

1. **The calendars differ.** Same month, three brands, three different playbook
   mixes. Identical calendars would mean the genome is not reaching the resolver.
2. **Northgate is not empty.** It has the least to work with; if it plans
   nothing, that is the gap worth reporting.
3. **Only Fernhill gets avatar formats.** It is the one that consented to a
   likeness, and `talent_availability` is what gates them.
4. **Brightwell leans local and seasonal.** Bookings, same-day, pre-winter
   servicing.
5. **One brand's assets never appear in another's drafts.** Genome isolation is
   the invariant the whole repository layer exists to enforce, and three brands in
   one account is the cheapest way to see it holding.
