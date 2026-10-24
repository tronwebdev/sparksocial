# Switching Mautic from SendGrid to an IPwarmup SMTP server

For the IPwarmup **Pro pre-warmed SMTP** plan ($200/month), with DNS at SiteGround and
Mautic on the Namecheap VPS.

**The order matters.** Get IPwarmup sending and passing authentication *before* removing
anything from SendGrid. Deleting SendGrid first leaves a gap where Mautic can't send.

```
0. Confirm before paying → 1. Buy, collect details → 2. DNS for IPwarmup
→ 3. Switch Mautic → 4. Test → 5. Bounces → 6. Remove SendGrid → 7. Warm up
```

Replace `YOURDOMAIN.com` with your domain, and `news.YOURDOMAIN.com` with whatever
domain your From address uses.

---

## 0. What IPwarmup's own docs already answer (checked 22 Oct 2026)

| Question | Answer | Source |
|---|---|---|
| Port | **2525** for outgoing. Ports 587/465 aren't mentioned | KB: "Which part of SMTP credentials…" |
| Username | Looks like `xxxxxxxxxxxx@IPwarmup`. Use the **Outgoing** credentials, never the Incoming ones, or SPF/DKIM/DMARC fail | same |
| Own domain | Implied yes: they act as a relay and send whatever From your app sets | KB: "How DKIM works when sending from your own domain" |
| **DKIM** | **They don't sign your mail.** They pass through whatever signature your app adds. If your app can't sign, you open a ticket and they set it up at SMTP level with one DNS record | same |
| Bounces | Each server comes with `bounce@`, `abuse@` and `info@` mailboxes on **their assigned domain**, readable at `mail.<assigned domain>` on port 143 (IMAP) or 110 (POP3) | KB: "Which part of SMTP credentials…" |
| Bounce webhook | Optional HTTPS feed of delivery, bounce and deferral events (no complaints or opens), set up by ticket | KB: "HTTP Webhook Integration Guide" |
| Refunds | **None.** "Strictly non-refundable … under any circumstances." The only exception is an order not delivered within 45 days | Terms and Conditions |
| Cancellation | Email them **at least 72 hours before** the renewal date. Service runs to the end of the cycle | Terms and Conditions |
| Termination | Immediately, without refund, for spam or abuse | Terms and Conditions |
| Allowed use | Opt-in marketing only, with proof of consent kept. Cold email, scraped addresses, and bought or rented lists are banned. Physical address, unsubscribe link and privacy policy link required. Unsubscribes honoured within 7 days | Email Policy |

### Why DKIM is the one that matters

**Mautic doesn't sign DKIM either.** It has no setting for a private key, and signing
is normally left to the SMTP server. So if neither side signs, your mail goes out with
**no DKIM**, DMARC fails, and Gmail and Yahoo bulk-sender rules treat it as unauthenticated.

**You're in their "Scenario 3": the app doesn't sign.** Their KB article says support will
configure DKIM at SMTP level for your domain when you open a ticket, and you then add one DNS
record. So it's a documented service, not a gamble. Open that ticket **right after buying**,
and don't switch Mautic over until a test email shows `DKIM: PASS` for your domain.

### Ask in your first ticket (before or right after buying)

1. My app (Mautic) can't sign DKIM. Will you set up **SMTP-level DKIM for my own domain**
   `news.YOURDOMAIN.com`, and what DNS record do I add?
2. What **SPF** mechanism do I add for your server (`ip4:…` or `include:…`)?
3. Is **TLS (STARTTLS)** supported on port 2525?
4. Does the `bounce@` mailbox accept **plus-addressed** mail (`bounce+abc123@…`)? Mautic tags
   each email's return-path this way so it can match a bounce to a contact.
5. Is the IP **dedicated** to me, and what is its current SenderScore?

Question 1 is covered by their KB, so it's fine to buy first. If you'd rather have all five
answered before paying, remember payment is non-refundable.

## 1. Buy, and collect these details

From IPwarmup's welcome email or dashboard, write down:

| Item | Example | Used in |
|---|---|---|
| **Outgoing** SMTP host | an IP or hostname | Step 3 |
| Port | `2525` | Step 3 |
| **Outgoing** username / password | `xxxxxxxxxxxx@IPwarmup` | Step 3 |
| Assigned domain | the aged domain that comes with the server | Step 5 |
| `bounce@` mailbox password | on the assigned domain | Step 5 |
| Sending IP | `203.0.113.10` | Step 2 (SPF) |
| DKIM selector and public key | `ipw._domainkey` → `v=DKIM1; k=rsa; p=MIIB...` | Step 2 |
| Return-path / bounce domain record | a CNAME or MX they specify | Step 2 |
| Reverse DNS (PTR) hostname | `mail.YOURDOMAIN.com` or theirs | Step 2 (check only) |

Keep the SMTP password in your password manager, not in a note or chat.

## 2. DNS at SiteGround (Site Tools → Domain → DNS Zone Editor)

Add IPwarmup's records **alongside** SendGrid's for now. Use the host part only.

**SPF.** A name can have **exactly one** SPF record (`v=spf1 ...`). Two records means both fail.
- If you send from a **subdomain** (`news.YOURDOMAIN.com`): add a TXT at `news` with what
  IPwarmup gives you, typically `v=spf1 ip4:SENDING_IP -all` or `v=spf1 include:THEIRS -all`.
- If the return-path uses your **root domain**: **edit** the existing root SPF TXT and add
  IPwarmup's mechanism before the `~all`/`-all`. For example,
  `v=spf1 include:_spf.siteground... ~all` becomes
  `v=spf1 include:_spf.siteground... ip4:SENDING_IP ~all`. Don't create a second one.

**DKIM.** Add the TXT record IPwarmup's support gives you after enabling SMTP-level DKIM
(step 0, question 1), for example `ipw._domainkey.news`. It doesn't clash with SendGrid's
`s1`/`s2` selectors. **Without this record, don't switch Mautic over.**

**Return-path.** Add whatever CNAME/MX they specify. If it uses the **same host name** as
SendGrid's `em####` CNAME, you can't have both: do that one record in step 6 instead.

**DMARC.** Keep your existing `_dmarc` record unchanged.

**PTR (reverse DNS).** You don't set this at SiteGround; IPwarmup controls it. Check it
resolves to a hostname, and that the hostname resolves back to the IP:
```bash
nslookup SENDING_IP
```

Wait for the records to appear (TTL 300 means about 5 minutes; allow up to an hour), then check:
```bash
nslookup -type=txt news.YOURDOMAIN.com
nslookup -type=txt SELECTOR._domainkey.news.YOURDOMAIN.com
```

## 3. Switch Mautic

**Settings (gear) → Configuration → Email Settings**:

| Field | Value |
|---|---|
| DSN Scheme | `smtp` |
| DSN Host | IPwarmup's **Outgoing** host |
| DSN Port | `2525` |
| DSN User | the **Outgoing** username, including `@IPwarmup` |
| DSN Password | clear the box, paste the Outgoing password |

First check the VPS can reach their server on 2525:
```bash
nc -vz SMTP_HOST 2525
```
"succeeded" or "open" means you're fine. A timeout means a firewall is blocking it, so ask
Namecheap support.
| From address | unchanged (`hello@news.YOURDOMAIN.com`) unless IPwarmup said otherwise |

**Save first, then test.** Testing before saving tests the *old* saved DSN, which is what
caused the 535 error with SendGrid.

## 4. Test

1. **Send test email** from the same page.
2. In Gmail open it, then **⋮ → Show original**. You need all of:
   - `SPF: PASS` with IP `SENDING_IP` (not a SendGrid IP)
   - `DKIM: PASS` with `d=news.YOURDOMAIN.com` (or your root domain), **not** IPwarmup's domain
   - `DMARC: PASS`
3. `mail-tester.com`: aim for 9/10 or better.
4. Also check the IP isn't on blocklists: mxtoolbox.com → Blacklist Check → `SENDING_IP`.

If DKIM passes but with IPwarmup's domain, DMARC won't align: ask them to sign with your
domain's key.

## 5. Bounces, which work better here than on SendGrid

IPwarmup gives you a `bounce@` mailbox on the server's assigned domain. Point Mautic's
monitored inbox at it, and Mautic marks bounced contacts itself.

1. You don't need to create a mailbox. Use `bounce@<assigned domain>` from your credentials.
2. Check the Mautic image has IMAP support:
   ```bash
   cd ~/docker-mautic/examples/basic
   docker compose exec mautic_web php -m | grep -i imap
   ```
   If this prints nothing, stop here and ask. The monitored inbox needs that extension.
3. **Email Settings → Monitored Inbox Settings**:

   | Field | Value |
   |---|---|
   | IMAP host | `mail.<assigned domain>` |
   | Port / Encryption | `143` / TLS (STARTTLS). Try "none" only if TLS fails, and tell IPwarmup |
   | Username / Password | `bounce@<assigned domain>` and its password |
   | Bounces folder | `INBOX` |
   | Unsubscribe requests | custom → same mailbox, `INBOX` |

   **Test connection**, then **Save**. Mautic now sets each email's return-path to this
   mailbox, with a per-message tag, and marks bounced contacts automatically.
   - If the bounce mailbox **doesn't accept plus-addressing** (step 0, question 4), Mautic can't
     match bounces to contacts. Fall back to step 4.
   - **Unsubscribe requests:** consider a mailbox on your own domain instead. Recipients see
     its address in the List-Unsubscribe header, and an unfamiliar domain looks odd.
4. **Fallback: weekly manual cleanup.** Use their **Email Logs Console** (or the bounce
   webhook) to list hard bounces, then in Mautic: import the list with a tag → filter by tag
   → **Batch actions → Do Not Contact**. Mautic can't receive their webhook natively, so
   that would need a small receiver, which isn't worth building at the start.
5. Check the cron is fetching:
   ```bash
   docker compose logs --tail=50 mautic_cron | grep -i fetch
   ```

## 6. Remove SendGrid entirely

Only once step 4 passes and a real test campaign has gone out through IPwarmup.

**In Mautic:** nothing is left to do. Step 3 replaced the only SendGrid setting. Re-open
Email Settings and confirm the host no longer says `smtp.sendgrid.net`.

**In SendGrid:**
1. **Settings → API Keys** → delete the `mautic` key. Do this first, so nothing can send as you
   while you clean up.
2. **Settings → Sender Authentication** → your domain → **⋯ → Delete**. Do the same for any
   **Link Branding** entry and any **Single Sender** you verified.
3. **Settings → Account Details**: if you upgraded from the trial, downgrade/cancel the plan
   under **Plan & Billing** first. Then, if you want the account gone, **Delete Account** at the
   bottom of Account Details.

**At SiteGround**, delete the records SendGrid created. Look for these, using the exact
names shown on SendGrid's authentication page before you delete it there (screenshot it first):

| Type | Name looks like | What it was |
|---|---|---|
| CNAME | `em1234` (or `em1234.news`) | SendGrid return-path |
| CNAME | `s1._domainkey` | SendGrid DKIM |
| CNAME | `s2._domainkey` | SendGrid DKIM |
| CNAME | `url1234`, `12345678` | Link branding, only if you set it up |

**Don't delete:** `_dmarc`, the `mautic` A record, MX records, or any IPwarmup record.

If IPwarmup's return-path needed the same host as `em1234` (step 2), add theirs now, right
after deleting SendGrid's.

Then re-run step 4's test once more. It should still pass all three.

## 7. Warm up anyway

The **IP** is pre-warmed, but your **domain** isn't. Gmail and Outlook score both.

| Days | Emails/day |
|---|---|
| 1–3 | 200 |
| 4–6 | 500 |
| 7–9 | 1,000 |
| 10–12 | 2,500 |
| 13+ | roughly double every 2–3 days while bounces < 2% and complaints < 0.1% |

- Most engaged opted-in contacts first. Mautic has no daily cap, so use segments
  (a `warmup-batch` tag on N contacts a day) and campaign sends.
- Register the domain in **Google Postmaster Tools** and watch domain reputation daily
  for the first month.
- Namecheap requires double opt-in for bulk mail from its servers, and IPwarmup's own
  disclaimer says bought or rented lists get blocked. Only opted-in contacts.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| `Connection refused` / timeout | Wrong port, or the port is blocked. Test from the VPS: `nc -vz SMTP_HOST 2525` |
| `535 Authentication failed` | Wrong username/password, or tested before saving |
| SPF fail | Two SPF records on one name, or IPwarmup's IP/include missing |
| DKIM pass, DMARC fail | Signed with IPwarmup's domain, not yours |
| No DKIM header at all | SMTP-level DKIM not enabled yet. Neither Mautic nor IPwarmup signs by default (step 0) |
| Emails go to spam, all checks pass | Domain too new: slow the warmup, check Postmaster Tools |
| Bounced contacts still "active" | Monitored inbox not configured, or IPwarmup keeps the return-path (step 5.4) |
