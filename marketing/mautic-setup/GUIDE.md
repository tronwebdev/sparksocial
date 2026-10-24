# Mautic on a Namecheap VPS · DNS on SiteGround · SendGrid for sending

Checked against the docker-mautic repo and Docker Hub in October 2026. The files next to
this one are referenced by name: `docker-compose.override.yml`, `Caddyfile`, `backup.sh`.

Replace `YOURDOMAIN.com` everywhere with your domain.

## Why this is simpler than the Google Cloud version

- **No free-tier traps.** No region rules, disk types, IP charges or 1 GB egress cap.
  Pulsar includes about 1 TB/month of bandwidth.
- **Enough RAM.** 2 GB is Mautic's practical minimum, versus 1 GB on e2-micro.
- **What you take on instead:** there is no cloud firewall or console SSH button. You
  harden the box yourself (Part 3), and backups go to an S3-compatible bucket (Part 10).

## Part 0 — Buy the right plan

| Choice | Pick | Why |
|---|---|---|
| Plan | **Quasar** (bought) — Pulsar (2 GB) is the minimum | Quasar leaves room for MySQL and the worker defaults |
| OS | Latest **Ubuntu LTS** offered (24.04; 22.04 also works) | |
| Control panel | **None** — do not add cPanel | cPanel costs extra and fights Docker and Caddy for ports 80/443 |
| Location | Closest to your contacts (US or EU) | |

Prices seen in reviews: Pulsar about $6.88/mo for the first year, about $9.88/mo on renewal.
Budget for the **renewal** price, and check the live page before buying.

After purchase Namecheap emails the server IP and a **root password**.

## Part 1 — First login and a non-root user

From your own computer (PowerShell or Terminal):

```bash
ssh root@YOUR_VPS_IP
```

On the server:

```bash
adduser mautic                 # choose a strong password
usermod -aG sudo mautic
```

From your computer, install your SSH key for that user (`ssh-keygen -t ed25519` first if
you don't have one):

```bash
ssh-copy-id mautic@YOUR_VPS_IP
```

On Windows without `ssh-copy-id`:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh mautic@YOUR_VPS_IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

Confirm `ssh mautic@YOUR_VPS_IP` logs in **without** a password before going on.

## Part 2 — Lock down SSH

```bash
sudo tee /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sudo systemctl restart ssh
sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication'   # expect: no, no
```

The file is named `00-` on purpose. sshd keeps the **first** value it reads, and many
images ship a `50-cloud-init.conf` that turns password login back on, which would win
over a later-sorting file.

Keep your current session open and test a **new** `ssh mautic@YOUR_VPS_IP` in a second
window. If it fails, fix it from the open session. Namecheap's VPS panel also has a
console for emergencies.

## Part 3 — Firewall, updates, swap, Docker

```bash
sudo apt update && sudo apt -y upgrade
sudo apt install -y git curl fail2ban unattended-upgrades ufw rclone

# Firewall: SSH, HTTP, HTTPS only
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# 2 GB swap as a safety net
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf && sudo sysctl --system

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

Reconnect, then `docker run --rm hello-world` and `free -h`.

> **Docker ignores ufw.** Any port Docker publishes on `0.0.0.0` is reachable from the
> internet whatever ufw says. That is why Part 5 binds Mautic to `127.0.0.1`. Don't skip it.

## Part 4 — DNS at SiteGround

Site Tools → Domain → **DNS Zone Editor** → A record: name `mautic`, value = the VPS IP,
TTL 300. Don't touch MX records. Check from your computer:

```bash
nslookup mautic.YOURDOMAIN.com
```

## Part 5 — Mautic

```bash
cd ~
git clone https://github.com/mautic/docker-mautic.git
cd docker-mautic/examples/basic
```

1. **Passwords.** Edit `.env` and change `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`
   (defaults are `mautic_db_pwd` / `changeme`). `.mautic_env` reads them from `.env`.
   ```bash
   nano .env
   ```
2. **Port local-only.** Compose appends port lists in override files rather than replacing
   them, so edit the base file:
   ```bash
   sed -i 's/- 8080:80/- 127.0.0.1:8080:80/' docker-compose.yml
   grep 8080 docker-compose.yml     # expect: - 127.0.0.1:8080:80
   ```
3. **Override.** Put `docker-compose.override.yml` (from this folder) here. It pins the
   image, sizes MySQL and PHP for Quasar, and adds restart policies so the stack comes back
   after a reboot.
   ```bash
   nano docker-compose.override.yml   # paste the contents
   docker compose config --services   # db, mautic_web, mautic_cron, mautic_worker
   ```
4. **Start:**
   ```bash
   docker compose up -d
   docker compose ps
   ```
   A restarting container: `docker compose logs --tail=50 mautic_web` (or `db`, etc.).

## Part 6 — HTTPS with Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile      # replace contents with ./Caddyfile
sudo systemctl reload caddy
```

Open `https://mautic.YOURDOMAIN.com`. The certificate is issued once DNS resolves to the VPS.

## Part 7 — Finish Mautic

1. Run the installer. DB host `db`; name/user/password from `.env`. Strong admin password.
2. **Settings → Configuration → System Settings → Site URL**: `https://mautic.YOURDOMAIN.com`.
3. If links come out `http://` or logins loop, add to `./mautic/config/local.php`:
   `'trusted_proxies' => ['127.0.0.1', '172.16.0.0/12'],` then `docker compose restart mautic_web`.
4. Background jobs:
   ```bash
   docker compose logs --tail=50 mautic_cron
   docker compose logs --tail=50 mautic_worker
   ```
   The cron container runs the segment, campaign and email-send jobs. If its log is silent
   for more than ~15 minutes, nothing will send.

## Part 8 — SendGrid

> **Switching to IPwarmup?** Follow `SWITCH-TO-IPWARMUP.md` instead of this part.
> It replaces SendGrid, keeps sending working during the move, then removes SendGrid.

1. **Settings → Sender Authentication → Authenticate Your Domain**. DNS host "Other",
   domain `YOURDOMAIN.com`, automated security on.
2. Add the CNAMEs at SiteGround (host part only), then **Verify**.
3. DMARC TXT at `_dmarc`: `v=DMARC1; p=none; rua=mailto:you@YOURDOMAIN.com`
4. **Settings → API Keys** → Restricted → **Mail Send** only. Copy it once.
5. Mautic **Settings → Configuration → Email Settings**:
   - Scheme `smtp`, host `smtp.sendgrid.net`, port `587`, user `apikey`, password = the key.
   - From `hello@YOURDOMAIN.com`, plus a monitored reply-to.
   - Send mode: **queue**.
   - Postal address and unsubscribe link in every template.
6. Test to Gmail and `mail-tester.com`. SPF, DKIM and DMARC should all pass.

**Bounces:** plain SMTP doesn't tell Mautic about bounces. Either set up a bounce mailbox
under Email Settings → Monitored inbox (IMAP), or watch SendGrid's suppression list during
warmup and remove those contacts.

**Plan reality:** SendGrid has no permanent free tier for new signups. You get a 60-day
trial at 100 emails/day, then Essentials from $19.95/month. A dedicated IP needs Pro
($89.95/month). Check sendgrid.com/pricing.

## Part 9 — Warmup

| Days | Emails/day |
|---|---|
| 1–2 | 50 |
| 3–4 | 100 |
| 5–6 | 250 |
| 7–8 | 500 |
| 9–10 | 1,000 |
| 11+ | ~double every 2–3 days |

- The trial caps you at 100/day, so you can't pass days 3–4 until you upgrade.
- Mautic has **no daily cap setting**. Control volume with segments (e.g. a "warmup batch"
  tag added to N contacts per day) and campaign sends.
- Most-engaged opted-in contacts first. Bounces under 2%, complaints under 0.1%.
- Register the domain in Google Postmaster Tools.
- On SendGrid's shared IPs you are warming your **domain**, not an IP.

## Part 10 — Backups to Cloudflare R2

R2's free tier is 10 GB of storage with no egress fees, which is plenty for this.
Backblaze B2 works the same way with rclone.

1. Cloudflare dashboard → **R2** → Create bucket `YOURNAME-mautic-backups`.
2. R2 → **Manage API tokens** → Create token: **Object Read & Write**, scoped to that
   bucket only. Note the Access Key ID, Secret, and the S3 endpoint
   (`https://ACCOUNT_ID.r2.cloudflarestorage.com`).
3. On the VPS, run `rclone config` and create a remote named **`r2`**: type `s3`, provider
   `Cloudflare`, paste the key, secret and endpoint. The keys stay in
   `~/.config/rclone/rclone.conf` on the server, readable only by you.
4. Check: `rclone lsd r2:` lists the bucket.
5. Put `backup.sh` at `~/backup.sh`, set `REMOTE`, then:
   ```bash
   chmod +x ~/backup.sh
   ~/backup.sh
   crontab -e
   ```
   Add: `0 2 * * * $HOME/backup.sh >> $HOME/backup.log 2>&1`
6. **Test a restore once**:
   ```bash
   gunzip -c db-DATE.sql.gz | docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD"'
   ```

Namecheap also sells VPS snapshot backups. They're a fine extra, but keep the off-box copy:
a snapshot on the same provider doesn't help if the account or the box is lost.

## Part 11 — Ongoing care

- Weekly: `docker compose ps`, `free -h`, `df -h`. Swap constantly in use → upgrade to Magnetar.
- `unattended-upgrades` patches the OS. Reboot when `/var/run/reboot-required` exists.
  The restart policies bring Mautic back up.
- Mautic updates, after a fresh backup and reading the release notes:
  `docker compose pull && docker compose up -d`. To change minor/major version, edit the
  tag in the override file deliberately.
- Calendar reminder before the first-year renewal: the price goes up.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| Site won't load | ufw missing 80/443, DNS not propagated, Caddy down, or Caddy not pointing at 8080 |
| No certificate | A record wrong, or 80/443 blocked |
| Locked out of SSH | Use the console in Namecheap's VPS panel and fix `/etc/ssh/sshd_config.d/00-hardening.conf` |
| Containers die | Out of memory: check `free -h` and `docker stats`, or move to Magnetar |
| Emails not sending | `mautic_cron`/`mautic_worker` not running, wrong SMTP settings, domain not verified, or the trial's 100/day cap |
| Emails in spam | SPF/DKIM/DMARC failing, warming too fast, cold list |
| Backups fail in cron | Run `~/backup.sh` by hand and read `~/backup.log`; usually the rclone remote name |
