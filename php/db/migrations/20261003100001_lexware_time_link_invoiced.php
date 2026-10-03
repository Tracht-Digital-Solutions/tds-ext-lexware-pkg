<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Which Lexware invoice a linked time entry went into.
 *
 * Nothing recorded it, so exporting the same project and period twice billed
 * the same hours twice. `invoiced_ref` holds a short-lived reservation while an
 * export is in flight and the Lexware invoice id once it succeeded; NULL means
 * billable.
 *
 * Idempotent (hasColumn): MySQL commits DDL implicitly, so a half-applied run
 * must be re-runnable rather than block every later migration in the shared
 * phinxlog. Class prefixed `Lexware*` for the same shared log.
 */
final class LexwareTimeLinkInvoiced extends AbstractMigration
{
    public function up(): void
    {
        $table = $this->table('lx_time_link');
        if (!$table->hasColumn('invoiced_ref')) {
            $table->addColumn('invoiced_ref', 'string', ['limit' => 64, 'null' => true, 'after' => 'project_id'])
                ->addColumn('invoiced_at', 'datetime', ['null' => true, 'after' => 'invoiced_ref'])
                ->addIndex(['project_id', 'invoiced_ref'], ['name' => 'idx_lx_time_link_billable'])
                ->update();
        }
    }

    public function down(): void
    {
        $table = $this->table('lx_time_link');
        if ($table->hasColumn('invoiced_ref')) {
            $table->removeIndexByName('idx_lx_time_link_billable')
                ->removeColumn('invoiced_at')
                ->removeColumn('invoiced_ref')
                ->update();
        }
    }
}
