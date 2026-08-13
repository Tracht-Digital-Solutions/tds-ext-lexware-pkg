<?php
/**
 * API documentation for this module's routes — consumed through `ApiDocSource`
 * and rendered in the admin frontend's API reference (`GET /wiki.json`).
 *
 * `pattern` must match the Slim pattern in `register()` VERBATIM, inline regex
 * included: it is the join key for the route introspection.
 * `php/tests/LexwareApiDocsTest.php` fails the build if the documented set and
 * the registered set drift apart in either direction.
 */

declare(strict_types=1);

$customerId = ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id des Kunden im Lexware-Verzeichnis.'];

return [
    [
        'method' => 'GET',
        'pattern' => '/lexware/summary',
        'tag' => 'Übersicht',
        'summary' => 'Verbindungszustand und die letzten Rechnungsexporte',
        'description' => 'Die `dataEndpoint`-Route des Dashboard-Widgets. `configured` '
            . 'unterscheidet „noch nichts exportiert" von „kein API-Key hinterlegt".',
        'permission' => 'lexware:read',
        'responses' => [
            ['status' => 200, 'description' => '`{configured: bool, invoiceCount, recent: [...5]}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:read`.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/lexware/customers',
        'tag' => 'Verzeichnis',
        'summary' => 'Kunden des Abrechnungs-Verzeichnisses',
        'description' => 'Ein eigenes Verzeichnis, getrennt vom Portal-Kundenverzeichnis der '
            . '`customers`-Extension: hier hängen Stundensätze, Steuersätze und die '
            . 'Lexware-Kontakt-Id.',
        'permission' => 'lexware:read',
        'responses' => [
            ['status' => 200, 'description' => '`{customers: [{id, name, email, default_hourly_rate, tax_rate_percent, lexware_contact_id}]}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:read`.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/lexware/customers',
        'tag' => 'Verzeichnis',
        'summary' => 'Kunden im Abrechnungs-Verzeichnis anlegen',
        'permission' => 'lexware:write',
        'params' => [
            ['in' => 'body', 'name' => 'name', 'type' => 'string', 'required' => true, 'description' => 'Darf nicht leer sein.'],
            ['in' => 'body', 'name' => 'email', 'type' => 'string', 'description' => 'Wird validiert; ungültig oder leer ⇒ NULL.'],
            ['in' => 'body', 'name' => 'default_hourly_rate', 'type' => 'number', 'description' => 'Netto-Stundensatz als Vorgabe für die Projekte dieses Kunden.'],
            ['in' => 'body', 'name' => 'tax_rate_percent', 'type' => 'number', 'description' => 'Steuersatz in Prozent.'],
            ['in' => 'body', 'name' => 'note', 'type' => 'string', 'description' => 'Optional, auf 2.000 Zeichen gekürzt.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{id}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:write`.'],
            ['status' => 422, 'description' => '`name` fehlt.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/lexware/customers/{id:[0-9]+}',
        'tag' => 'Verzeichnis',
        'summary' => 'Einen Kunden samt seiner Projekte lesen',
        'permission' => 'lexware:read',
        'params' => [$customerId],
        'responses' => [
            ['status' => 200, 'description' => 'Der Kunde plus `projects: [...]`.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:read`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
        ],
    ],
    [
        'method' => 'PATCH',
        'pattern' => '/lexware/customers/{id:[0-9]+}',
        'tag' => 'Verzeichnis',
        'summary' => 'Kunden ändern',
        'description' => 'Echtes Teil-Update: nur mitgesendete Felder werden überschrieben, '
            . 'der Rest bleibt stehen (geprüft mit `array_key_exists`, ein bewusst '
            . 'gesendetes `null` leert das Feld also wirklich).',
        'permission' => 'lexware:write',
        'params' => [
            $customerId,
            ['in' => 'body', 'name' => 'name', 'type' => 'string', 'description' => 'Darf nicht auf leer gesetzt werden.'],
            ['in' => 'body', 'name' => 'email', 'type' => 'string', 'description' => 'Siehe Anlegen.'],
            ['in' => 'body', 'name' => 'default_hourly_rate', 'type' => 'number', 'description' => 'Siehe Anlegen.'],
            ['in' => 'body', 'name' => 'tax_rate_percent', 'type' => 'number', 'description' => 'Siehe Anlegen.'],
            ['in' => 'body', 'name' => 'note', 'type' => 'string', 'description' => 'Siehe Anlegen.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
            ['status' => 422, 'description' => '`name` wurde auf leer gesetzt.'],
        ],
    ],
    [
        'method' => 'DELETE',
        'pattern' => '/lexware/customers/{id:[0-9]+}',
        'tag' => 'Verzeichnis',
        'summary' => 'Kunden löschen',
        'description' => 'Nur lokal — ein bereits nach Lexware übertragener Kontakt bleibt '
            . 'dort bestehen.',
        'permission' => 'lexware:write',
        'params' => [$customerId],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:write`.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/lexware/customers/{id:[0-9]+}/projects',
        'tag' => 'Verzeichnis',
        'summary' => 'Projekt für einen Kunden anlegen',
        'description' => 'Das Projekt ist die Klammer, an der Zeiteinträge zur Abrechnung '
            . 'hängen. Ein Stundensatz am Projekt sticht den des Kunden.',
        'permission' => 'lexware:write',
        'params' => [
            $customerId,
            ['in' => 'body', 'name' => 'title', 'type' => 'string', 'required' => true, 'description' => 'Darf nicht leer sein.'],
            ['in' => 'body', 'name' => 'hourly_rate', 'type' => 'number', 'description' => 'Netto-Stundensatz nur für dieses Projekt.'],
            ['in' => 'body', 'name' => 'status', 'type' => 'active|archived', 'description' => 'Vorgabe `active`; unbekannte Werte fallen darauf zurück.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{id}` des Projekts.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:write`.'],
            ['status' => 404, 'description' => 'Unbekannter Kunde.'],
            ['status' => 422, 'description' => '`title` fehlt.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/lexware/time/unassigned',
        'tag' => 'Zeiten',
        'summary' => 'Zeiteinträge ohne Projektzuordnung',
        'description' => 'Die Arbeitsliste vor einer Abrechnung: alles, was erfasst, aber '
            . 'noch keinem Abrechnungsprojekt zugewiesen wurde.',
        'permission' => 'lexware:read',
        'params' => [
            ['in' => 'query', 'name' => 'from', 'type' => 'date', 'description' => 'Zeitraumbeginn, `YYYY-MM-DD` (10 Zeichen).'],
            ['in' => 'query', 'name' => 'to', 'type' => 'date', 'description' => 'Zeitraumende, `YYYY-MM-DD` (10 Zeichen).'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{entries: [...]}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:read`.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/lexware/time/assign',
        'tag' => 'Zeiten',
        'summary' => 'Zeiteintrag einem Abrechnungsprojekt zuordnen',
        'permission' => 'lexware:write',
        'params' => [
            ['in' => 'body', 'name' => 'timeEntryId', 'type' => 'int', 'required' => true, 'description' => 'Id aus dem Time-Tracker.'],
            ['in' => 'body', 'name' => 'projectId', 'type' => 'int', 'required' => true, 'description' => 'Id des Abrechnungsprojekts.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:write`.'],
            ['status' => 404, 'description' => 'Unbekanntes Projekt.'],
            ['status' => 422, 'description' => 'Eine der beiden Ids fehlt oder ist ≤ 0.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/lexware/time/unassign',
        'tag' => 'Zeiten',
        'summary' => 'Zuordnung eines Zeiteintrags aufheben',
        'permission' => 'lexware:write',
        'params' => [
            ['in' => 'body', 'name' => 'timeEntryId', 'type' => 'int', 'required' => true, 'description' => 'Id aus dem Time-Tracker.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:write`.'],
            ['status' => 422, 'description' => '`timeEntryId` fehlt oder ist ≤ 0.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/lexware/leads',
        'tag' => 'Kontakte',
        'summary' => 'Kontaktanfragen und Tickets als Lead-Kandidaten',
        'description' => 'Zieht Absender aus dem Kontakt-Posteingang und den Tickets zusammen '
            . 'und trägt je Eintrag die bereits übertragene `lexware_contact_id` nach — '
            . 'so ist auf einen Blick zu sehen, wer schon in Lexware steht.',
        'permission' => 'lexware:read',
        'responses' => [
            ['status' => 200, 'description' => '`{leads: [{source_type, source_id, name, email, company, lexware_contact_id}]}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:read`.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/lexware/customers/{id:[0-9]+}/push-contact',
        'tag' => 'Kontakte',
        'summary' => 'Verzeichniskunden als Kontakt nach Lexware übertragen',
        'description' => 'Legt bei Lexware an und merkt sich die Kontakt-Id am Kunden — '
            . 'spätere Rechnungen hängen sich daran. Ein Fehler von Lexware kommt als '
            . '**502** zurück, nicht als 500: die Anfrage war in Ordnung.',
        'permission' => 'lexware:write',
        'params' => [$customerId],
        'responses' => [
            ['status' => 201, 'description' => '`{lexwareContactId}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:write`.'],
            ['status' => 404, 'description' => 'Unbekannter Kunde.'],
            ['status' => 502, 'description' => 'Lexware hat die Anlage abgelehnt — die Meldung wird wörtlich durchgereicht.'],
            ['status' => 503, 'description' => 'Kein Lexware-API-Key konfiguriert.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/lexware/leads/push',
        'tag' => 'Kontakte',
        'summary' => 'Lead aus Kontaktanfrage oder Ticket nach Lexware übertragen',
        'description' => 'Die Herkunft (`source_type` + `source_id`) wird mitgespeichert, '
            . 'damit derselbe Lead nicht zweimal angelegt wird.',
        'permission' => 'lexware:write',
        'params' => [
            ['in' => 'body', 'name' => 'source_type', 'type' => 'contact_message|ticket', 'required' => true, 'description' => 'Woher der Lead stammt.'],
            ['in' => 'body', 'name' => 'source_id', 'type' => 'int', 'required' => true, 'description' => 'Id in der Quelle.'],
            ['in' => 'body', 'name' => 'name', 'type' => 'string', 'description' => 'Name — mindestens Name oder E-Mail muss vorhanden sein.'],
            ['in' => 'body', 'name' => 'email', 'type' => 'string', 'description' => 'E-Mail — mindestens Name oder E-Mail muss vorhanden sein.'],
            ['in' => 'body', 'name' => 'company', 'type' => 'string', 'description' => 'Optional, auf 250 Zeichen gekürzt.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{lexwareContactId}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:write`.'],
            ['status' => 422, 'description' => 'Herkunft fehlt, oder weder Name noch E-Mail vorhanden.'],
            ['status' => 502, 'description' => 'Lexware hat die Anlage abgelehnt.'],
            ['status' => 503, 'description' => 'Kein Lexware-API-Key konfiguriert.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/lexware/invoices/from-project',
        'tag' => 'Rechnungen',
        'summary' => 'Rechnung aus den Projektzeiten erzeugen',
        'description' => 'Der eigentliche Zweck der Extension. Der **Netto-Stundensatz wird '
            . 'in vier Stufen aufgelöst**: Angabe in der Anfrage → Projekt → Kunde → '
            . 'globale Vorgabe; ergibt das 0, wird abgebrochen statt eine Rechnung über '
            . 'null Euro zu schreiben. Ohne abrechenbare Zeiten im Zeitraum ebenfalls '
            . '422. Jeder Export wird protokolliert (Zeitraum, Minuten, Positionen), '
            . 'auch wenn er nicht finalisiert wurde.',
        'permission' => 'lexware:write',
        'params' => [
            ['in' => 'body', 'name' => 'projectId', 'type' => 'int', 'required' => true, 'description' => 'Abrechnungsprojekt.'],
            ['in' => 'body', 'name' => 'from', 'type' => 'date', 'description' => 'Zeitraumbeginn, `YYYY-MM-DD`.'],
            ['in' => 'body', 'name' => 'to', 'type' => 'date', 'description' => 'Zeitraumende, `YYYY-MM-DD`.'],
            ['in' => 'body', 'name' => 'hourlyRate', 'type' => 'number', 'description' => 'Übersteuert Projekt-, Kunden- und globalen Satz.'],
            ['in' => 'body', 'name' => 'taxRatePercentage', 'type' => 'number', 'description' => 'Übersteuert Projekt- und globalen Steuersatz.'],
            ['in' => 'body', 'name' => 'finalize', 'type' => 'bool', 'description' => 'true = bei Lexware direkt festschreiben statt als Entwurf anzulegen.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{id, resourceUri, totalMinutes, lineItemCount, finalized}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:write`.'],
            ['status' => 404, 'description' => 'Unbekanntes Projekt.'],
            ['status' => 422, 'description' => 'Kein Stundensatz auflösbar, oder keine abrechenbaren Zeiten im Zeitraum.'],
            ['status' => 502, 'description' => 'Lexware hat die Rechnung abgelehnt.'],
            ['status' => 503, 'description' => 'Kein Lexware-API-Key konfiguriert.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/lexware/invoices',
        'tag' => 'Rechnungen',
        'summary' => 'Protokoll der letzten 50 Rechnungsexporte',
        'description' => 'Das lokale Protokoll, nicht die Rechnungsliste aus Lexware.',
        'permission' => 'lexware:read',
        'responses' => [
            ['status' => 200, 'description' => '`{invoices: [...]}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `lexware:read`.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/lexware/admin/test',
        'tag' => 'Diagnose',
        'summary' => 'Verbindung zu Lexware prüfen',
        'description' => 'Ruft das Profil ab, um API-Key und Basis-URL zu prüfen. **Ein '
            . 'abgelehnter Key ergibt 200 mit `{ok: false, error}`, keinen Fehlerstatus** '
            . '— die Antwort ist das Ergebnis eines Tests, nicht das Scheitern der '
            . 'Anfrage, und die Oberfläche zeigt sie als Befund an.',
        'auth' => 'admin',
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true, organizationId}` oder `{ok: false, error}`, wenn Lexware ablehnt.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Angemeldet, aber kein Admin.'],
            ['status' => 503, 'description' => 'Kein Lexware-API-Key konfiguriert.'],
        ],
    ],
];
