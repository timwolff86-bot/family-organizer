# Familienkonten einrichten (einmalig, ca. 15 Minuten)

Danach hat jede Familie ihre eigenen, getrennten Daten. Neue Familien kommen nur mit
einem Einladungscode hinein. Alles geht am Handy im Supabase-Dashboard.

> Supabase benennt Menüpunkte gelegentlich um. Wenn ein Name nicht genau passt,
> such nach dem sinngemäßen Begriff.

## 1. Sicherung

App → **Mehr** → ganz unten **„Daten sichern“** → Datei speichern
(iPhone: „In Dateien sichern“).

## 2. Push-Funktion erneuern

1. Supabase → **Edge Functions** → Funktion **Push** öffnen → **Code**
2. Gesamten Inhalt löschen und durch den Inhalt von
   https://raw.githubusercontent.com/timwolff86-bot/family-organizer/main/supabase/functions/push/index.ts
   ersetzen → **Deploy**

## 3. Datenbank umstellen

1. Supabase → **SQL Editor** → **New query**
2. Inhalt von
   https://raw.githubusercontent.com/timwolff86-bot/family-organizer/main/supabase/update-21.sql
   einfügen → **Run** (bei einer Warnung: „Run this query“ bestätigen)
3. Ergebnis: „Success. No rows returned“

## 4. Registrierung erlauben

Supabase → **Authentication** → **Sign In / Providers**:

- **Allow new users to sign up**: einschalten
- Unter **Email**: **Confirm email** ausschalten
  (Supabase verschickt ohne eigenen Mail-Dienst nur sehr wenige Mails.
  Den Schutz übernimmt der Einladungscode.)
- **Save**

## 5. Prüfen

App auf allen Handys einmal schließen und neu öffnen.
Alles ist noch da, unter **Mehr** steht **„Familie Wolff – Zugänge und Einladungen“**.

## 6. Eine Familie einladen

**Mehr → Familie Wolff → „Neue Familie einladen“** → Name eintragen → **Link teilen**.
Der Link ist 30 Tage gültig und nur einmal nutzbar.

## Später, für mehr Familien

- Eigener Mail-Dienst (z. B. Brevo oder Resend) unter
  Authentication → Emails → SMTP Settings, dann „Confirm email“ wieder einschalten.
