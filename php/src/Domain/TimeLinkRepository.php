<?php
declare(strict_types=1);

namespace Tds\Ext\Lexware\Domain;

use PDO;

/**
 * Links tds-ext-time-tracker `time_entry` rows to a Lexware project (`lx_time_link`)
 * and reads the billable time for a project. The time-tracker table lives in the
 * same DB (shared PDO) but is another extension's, so there is no cross-domain
 * FK — one link per entry is enforced by a unique index.
 */
final class TimeLinkRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** Assign an entry to a project (idempotent — re-assign moves the link). */
    public function assign(int $timeEntryId, int $projectId): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO lx_time_link (time_entry_id, project_id) VALUES (:e, :p)
             ON DUPLICATE KEY UPDATE project_id = VALUES(project_id)'
        );
        $stmt->execute([':e' => $timeEntryId, ':p' => $projectId]);
    }

    public function unassign(int $timeEntryId): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM lx_time_link WHERE time_entry_id = :e');
        $stmt->execute([':e' => $timeEntryId]);
    }

    /**
     * Completed, project-linked, NOT YET INVOICED time entries in an optional
     * date window, with a computed `duration_minutes` (the time_entry table
     * stores no duration). Empty when the time-tracker table is absent: the
     * INNER JOIN would otherwise throw "table doesn't exist" (1146) — the old
     * comment claimed it simply matched nothing.
     *
     * @return list<array<string,mixed>>
     */
    public function billableForProject(int $projectId, ?string $from, ?string $to): array
    {
        $sql = 'SELECT te.id, te.note,
                       TIMESTAMPDIFF(MINUTE, te.started_at, te.ended_at) AS duration_minutes
                FROM lx_time_link l
                INNER JOIN time_entry te ON te.id = l.time_entry_id
                WHERE l.project_id = :pid AND te.ended_at IS NOT NULL AND l.invoiced_ref IS NULL';
        $params = [':pid' => $projectId];
        if ($from !== null && $from !== '') {
            $sql .= ' AND te.started_at >= :from';
            $params[':from'] = $from . ' 00:00:00';
        }
        if ($to !== null && $to !== '') {
            $sql .= ' AND te.started_at <= :to';
            $params[':to'] = $to . ' 23:59:59';
        }
        $sql .= ' ORDER BY te.started_at ASC';
        try {
            // prepare() inside too: with native prepares the server rejects
            // the missing table there, not at execute().
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
        } catch (\PDOException $e) {
            if ($e->getCode() === '42S02') {
                return []; // tds-ext-time-tracker not installed
            }
            throw $e;
        }
        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'note' => $r['note'] !== null ? (string) $r['note'] : null,
            'duration_minutes' => (int) $r['duration_minutes'],
        ], $stmt->fetchAll());
    }

    /**
     * Reserve entries for one export. True only when EVERY id was still
     * billable — two exports of one period no longer bill the same hours.
     *
     * @param list<int> $timeEntryIds
     */
    public function reserve(array $timeEntryIds, string $reservation): bool
    {
        if ($timeEntryIds === []) {
            return false;
        }
        $in = implode(',', array_map('intval', $timeEntryIds));
        $stmt = $this->pdo->prepare(
            "UPDATE lx_time_link SET invoiced_ref = :r WHERE invoiced_ref IS NULL AND time_entry_id IN ({$in})"
        );
        $stmt->execute([':r' => $reservation]);
        if ($stmt->rowCount() === count($timeEntryIds)) {
            return true;
        }
        $this->release($reservation);
        return false;
    }

    /** Give a failed export's entries back. */
    public function release(string $reservation): void
    {
        $this->pdo->prepare('UPDATE lx_time_link SET invoiced_ref = NULL WHERE invoiced_ref = :r')
            ->execute([':r' => $reservation]);
    }

    /** Turn a reservation into the Lexware invoice it became. */
    public function markInvoiced(string $reservation, string $lexwareInvoiceId): void
    {
        $this->pdo->prepare('UPDATE lx_time_link SET invoiced_ref = :id, invoiced_at = NOW() WHERE invoiced_ref = :r')
            ->execute([':id' => $lexwareInvoiceId, ':r' => $reservation]);
    }
}
