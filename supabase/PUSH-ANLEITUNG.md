# Push-Benachrichtigungen einrichten (einmalig, ca. 15 Minuten)

Alles passiert im Supabase-Dashboard deines Projekts. Die drei geheimen Werte
(`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`) stehen **nicht** in diesem
Repo, du bekommst sie separat. Bitte nirgends öffentlich ablegen.

> Supabase benennt Menüpunkte gelegentlich um. Wenn ein Name nicht genau passt,
> such nach dem sinngemäßen Begriff.

## 1. Datenbank-Update

**SQL Editor** → neue Abfrage → Inhalt von `supabase/update-12.sql` einfügen → **Run**
(bei Nachfrage „Run without RLS“).

## 2. Erweiterungen einschalten

**Database → Extensions** → nacheinander suchen und einschalten:

- `pg_cron` (Zeitplan, läuft jede Minute)
- `pg_net` (damit der Zeitplan die Funktion aufrufen kann)

## 3. Geheimnisse hinterlegen

**Edge Functions → Secrets** (manchmal unter *Project Settings → Edge Functions*)
→ drei Einträge anlegen, Name genau so schreiben:

| Name | Wert |
|---|---|
| `VAPID_PUBLIC_KEY` | (separat erhalten) |
| `VAPID_PRIVATE_KEY` | (separat erhalten) |
| `CRON_SECRET` | (separat erhalten) |

## 4. Versand-Funktion anlegen

1. **Edge Functions → Deploy a new function → Via Editor**
2. Name: **`push`** (genau so, klein geschrieben)
3. Den gesamten Inhalt von `supabase/functions/push/index.ts` in die Datei `index.ts` einfügen
   (vorhandenen Beispielcode vorher löschen) → **Deploy**
4. In der Funktion unter **Details/Settings** die Option
   **„Enforce JWT verification“ / „Verify JWT“ ausschalten** und speichern.
   (Die Funktion prüft selbst: Zeitplan per Geheimnis, Test-Knopf per Anmeldung.)

## 5. Zeitplan starten

**SQL Editor** → folgendes einfügen, `HIER-CRON-SECRET` durch den Wert von `CRON_SECRET`
ersetzen → **Run**:

```sql
select cron.schedule(
  'familienplaner-push',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://pdxxnwdmqjyinefummha.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'HIER-CRON-SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
```

Zeitplan später wieder stoppen: `select cron.unschedule('familienplaner-push');`

## 6. Testen

1. iPhone: App über Safari → „Teilen“ → „Zum Home-Bildschirm“ installieren und von dort öffnen.
   Android: geht auch im Browser.
2. **Einstellungen → Benachrichtigungen → Auf diesem Gerät aktivieren** → Erlaubnis bestätigen.
3. **Test-Nachricht senden** → sollte nach wenigen Sekunden erscheinen.
4. Zeitplan prüfen: eine Erinnerung für in 2–3 Minuten anlegen (mit dir als Person).

## Wenn etwas nicht klappt

- **Test-Knopf sagt „Versand-Funktion nicht eingerichtet“:** Schritt 4 prüfen, Name muss `push` sein.
- **Test-Knopf meldet „Push-Dienst antwortet mit 403“:** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` prüfen
  (genau die erhaltenen Werte, ohne Leerzeichen). Danach in der App Benachrichtigungen aus- und wieder einschalten.
- **Test klappt, Zeitplan nicht:** meist ist die JWT-Prüfung (Schritt 4.4) noch an. Unter **Integrations → Cron** (oder `select * from cron.job_run_details order by start_time desc limit 5;`)
  nachsehen, ob der Job läuft. Unter **Edge Functions → push → Logs** stehen Fehler der Funktion.
  401 dort heißt: `CRON_SECRET` im Zeitplan und in den Secrets stimmen nicht überein.
- **Gar nichts kommt auf dem iPhone:** App muss vom Home-Bildschirm geöffnet sein, iOS 16.4 oder neuer,
  und unter iOS-Einstellungen → Mitteilungen → Familie erlaubt.

## Was wann kommt

- **Erinnerungen:** zur eingetragenen Uhrzeit; ohne Uhrzeit zur Tageszeit des Geräts.
- **Termine:** mit dem eingestellten Vorlauf (pro Termin unter „Mehr Optionen → Push-Erinnerung“ änderbar).
  Ganztägige Termine: morgens um 7 Uhr bzw. am Vortag um 18 Uhr.
- **Aufgaben:** einmal am Tag zur eingestellten Uhrzeit, nur die eigenen offenen (inkl. verpasster).
- Termine/Erinnerungen ohne Person gehen an alle, die das jeweilige Thema eingeschaltet haben.
