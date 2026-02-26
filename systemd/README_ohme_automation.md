# Ohme automation (systemd)

These units/timers automate the full pipeline:

1. `ohme-import.timer` -> `ohme-import.service`
   - Runs `npm run ha:store:ohme_power`
   - Pulls latest HA power history and upserts raw `ohme_charge_events`.

2. `ohme-group.timer` -> `ohme-group.service`
   - Runs `npm run ohme:group-events -- --merge-gap-minutes 15 --grouping-version v1_gap15`
   - Merges fragmented raw events into grouped sessions.

3. `ohme-price.timer` -> `ohme-price.service`
   - Runs `npm run ohme:price-groups -- --limit 500 --assumed-rate-p 7.0`
   - Prices grouped sessions (default assumed cheap rate workflow).

## Install on host

```bash
sudo cp systemd/ohme-*.service /etc/systemd/system/
sudo cp systemd/ohme-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ohme-import.timer ohme-group.timer ohme-price.timer
```

## Check status/logs

```bash
systemctl list-timers | rg ohme
systemctl status ohme-import.service ohme-group.service ohme-price.service
journalctl -u ohme-import.service -u ohme-group.service -u ohme-price.service -f
```

## Optional environment file

If required, create `/etc/default/octopus-ohme` and add:

```bash
HA_TOKEN=...
HA_HOST=home.465streetlane.co.uk
```

Then uncomment `EnvironmentFile=/etc/default/octopus-ohme` in the services.
