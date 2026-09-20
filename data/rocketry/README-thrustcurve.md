# Rocket configuration datasets

Built 2026-09-20. Motor data pulled from `thrustcurve-db` npm package,
a bundled snapshot of ThrustCurve.org.

## Files in this folder

| File | Rows | Size | Est. tokens | Use |
|---|---|---|---|---|
| `motors-collegiate.csv` | 122 | 20 KB | ~5k | M, N, O class in production. Drop straight into a prompt. |
| `motors-hpr.csv` | 609 | 99 KB | ~25k | H through O in production. Fits most contexts. |
| `motors-all.csv` | 1129 | 176 KB | ~45k | Everything, including out of production. |
| `motors-hpr.json` | 609 | 335 KB | ~84k | Same as hpr.csv, JSON. Use only if you need JSON. |

CSV is roughly 3x cheaper in tokens than JSON for this data. Use CSV for prompts,
JSON for code.

Thrust curve sample arrays were stripped. Fetch them per motor from the
ThrustCurve download API if you need the curve itself.

## Schema

| Column | Unit | Notes |
|---|---|---|
| commonName | | e.g. `M520` |
| manufacturerAbbrev | | Cesaroni, AeroTech, Contrail, Loki, AMW, Hypertek, RATT |
| impulseClass | | A through O |
| type | | `SU` single use, `reload`, `hybrid` |
| diameter | mm | |
| length | mm | |
| totalWeightG | g | Loaded motor |
| propWeightG | g | Propellant only. This is the number the emissions model needs. |
| propInfo | | Manufacturer propellant name. Often blank for hybrids. Not a chemical formulation. |
| avgThrustN | N | |
| maxThrustN | N | |
| burnTimeS | s | |
| totImpulseNs | N·s | |
| certOrg | | NAR, TRA, CAR |
| availability | | `regular` in production, `OOP` out of production |
| source_url | | ThrustCurve motor profile page |

All units SI.

## Caveats

- `propInfo` is a trade name, not a formulation. It tells you the manufacturer's
  propellant line, not oxidizer/fuel/binder fractions. For CEA input you need
  the formulation, which is not in this dataset and is usually proprietary.
- Hybrids report `propWeightG` inconsistently. Some report fuel grain only,
  some report grain plus oxidizer. Check individual motors before using hybrid
  propellant mass in any calculation.
- 93 of the 609 in-production HPR motors have a blank `propInfo`.
- Snapshot, not live. Re-pull to refresh.

## Attribution

Data from ThrustCurve.org, maintained by John Coker. When surfacing a motor,
link its `source_url`. Do not hotlink `.eng` or `.rse` files.

## Refreshing

```bash
npm i thrustcurve-db
# full array, including thrust curve samples
node -e "console.log(require('thrustcurve-db').length)"
```

Or fetch the JSON directly:
```
https://cdn.jsdelivr.net/npm/thrustcurve-db@latest/thrustcurve-db.json
```

Live API, 2 requests per second maximum:
```
https://www.thrustcurve.org/api/v1/search.json
https://www.thrustcurve.org/api/v1/metadata.json
https://www.thrustcurve.org/api/v1/swagger.json
https://www.thrustcurve.org/llms.txt
```

---

# Vehicle-level data (not included, fetch these yourself)

Network access here is restricted to npm and a few other hosts, so these could
not be pulled. Both are free and need no key.

## GCAT launch vehicle database

Best structured source for orbital and suborbital vehicle configurations.
Jonathan McDowell, Center for Astrophysics. TSV files, five linked tables.

Index: `https://www.planet4589.org/space/gcat/web/lvs/index.html`
TSV directory: `https://planet4589.org/space/gcat/tsv/launch/ldir.html`

Tables: Families, Launch Vehicle List, LV Stages, Stages, Engines.

The Stages table is the one you want. Per stage it gives name, family,
manufacturer, length (m), diameter (m), full mass (tonne), dry mass (kg),
typical thrust (kN), typical burn duration (s), main engine name, and engine
multiplicity.

LV Stages maps vehicles to stages, with stage 0 for strap-on boosters, -1 for a
second strap-on type, and F for the fairing.

McDowell's own warning, which you should carry into any output: values are
approximate, intended to show differences between variants rather than to be
the most accurate available, and estimates were made where literature values do
not exist.

A cleaned CSV derivative of the object catalog exists at
`https://datahub.io/technology/gcat-artificial-space-objects` if you want
something pre-wrangled, though that covers objects rather than vehicles.

## Launch Library 2 (The Space Devs)

JSON, no key, free, rate limited.

```
https://ll.thespacedevs.com/2.3.0/launcher_configurations/?mode=detailed
https://ll.thespacedevs.com/2.2.0/config/launcher/?format=json
https://lldev.thespacedevs.com/2.2.0/config/launcher/   # dev mirror, higher limits, staler data
```

Gives per-configuration: name, family, variant, manufacturer, description,
active/reusable flags, and in detailed mode the physical and performance
figures. Better than GCAT for current commercial vehicles and for descriptions.
Worse for historical depth and per-stage breakdown.

Use the `lldev` mirror while developing so you do not burn the rate limit on
the production instance.

## Which to use

- Motor-class vehicles, collegiate and hobby: the CSVs in this folder.
- Historical and per-stage orbital detail: GCAT.
- Current commercial vehicles, names and descriptions for UI: Launch Library 2.
- Authoritative performance figures for a specific vehicle: the operator's own
  payload user's guide PDF. Nothing above beats it.
